/**
 * `helpdesk-sla-breach-cron` Edge Function — Phase 37 Plan 37-05 (HELP-06).
 *
 * Invoked every 5 min by the pg_cron `helpdesk-sla-breach-check` schedule
 * (migration 20270707000007). Scans open tickets, evaluates per-tier SLA
 * targets, UPSERT-dedupes via the try_record_sla_breach() SECDEF RPC, and
 * dispatches `sla_breach_alert` emails to the on-call list.
 *
 * Pipeline:
 *
 *   1. Auth gate — Bearer ${SUPABASE_SERVICE_ROLE_KEY}; 401 on mismatch.
 *   2. Scan open tickets (status in ('open','pending','waiting_on_customer')).
 *   3. For each ticket, look up its sla_targets row (org_id × tier).
 *   4. Compute candidate breaches:
 *        - first_response: now > created_at + first_response_minutes AND
 *                          last_agent_message_at IS NULL.
 *        - resolution:     now > created_at + resolution_minutes.
 *      (Both can fire on the same ticket — separate UPSERT calls.)
 *   5. For each candidate breach, call try_record_sla_breach RPC. If it
 *      returns false, skip (within dedupe window — bare-UPDATE bug guard).
 *   6. Build recipient set: assigned_to email + sla_targets.alert_recipients
 *      + env SLA_BREACH_DEFAULT_ONCALL_EMAILS (deduped via Set).
 *   7. For each recipient, sendEmail({ template: 'sla_breach_alert',
 *      phi: false (hardcoded — internal alert) }). One failure does NOT
 *      block the others — per-recipient try/catch.
 *   8. Emit one PostHog 'helpdesk.sla.breach' event per breach.
 *   9. Return 200 { ok, breaches_emitted, tickets_scanned }.
 *
 * Forbidden:
 *   - Do NOT pass the ticket's phi value through on sla_breach_alert — it is
 *     ALWAYS internal (`phi: false` hardcoded). The alert body contains
 *     ticket_ref + tier + admin_url, nothing patient-derived. T-37-05-03 +
 *     plan-checker grep gate.
 *   - Do NOT call sendEmail inside a loop without try/catch — one failed
 *     recipient must not block the others.
 *   - Do NOT skip the UPSERT-returns-false branch — that's the dedupe
 *     semantics; bare UPDATE no-ops on first event (memory feedback
 *     state_counter_table_needs_upsert_on_event).
 */
import 'jsr:@std/dotenv/load';
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { sendEmail as defaultSendEmail } from '../_shared/email-router.ts';
import { captureServer as defaultCaptureServer, shutdownPostHog } from '../_shared/posthog-server.ts';
import { corsHeaders } from './cors.ts';

// ─── Env ──────────────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ADMIN_URL_BASE = 'https://app.leanshot.app/admin/helpdesk/inbox';

// ─── Admin client singleton ───────────────────────────────────────────────────
const _adminSingleton: { client: SupabaseClient | null } = { client: null };
function admin(): SupabaseClient {
  if (_adminSingleton.client) return _adminSingleton.client;
  _adminSingleton.client = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _adminSingleton.client;
}

// ─── Test seams ──────────────────────────────────────────────────────────────
type SendEmailFn = typeof defaultSendEmail;
let _sendEmailImpl: SendEmailFn = defaultSendEmail;
type CaptureFn = typeof defaultCaptureServer;
let _captureImpl: CaptureFn = defaultCaptureServer;
function captureServer(args: Parameters<CaptureFn>[0]): void {
  _captureImpl(args);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface TicketRow {
  id: string;
  org_id: string;
  priority: string;            // 'p1' | 'p2' | 'p3'
  assigned_to: string | null;
  created_at: string;          // ISO timestamp
  last_agent_message_at: string | null;
  status: string;
}

interface SlaTargetRow {
  first_response_minutes: number;
  resolution_minutes: number;
  alert_recipients: string[];
}

type BreachType = 'first_response' | 'resolution';

async function fetchOpenTickets(): Promise<TicketRow[]> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data, error } = (await (admin()
    .from('tickets')
    .select('id, org_id, priority, assigned_to, created_at, last_agent_message_at, status')
    .in('status', ['open', 'pending', 'waiting_on_customer']) as any)) as {
    data: TicketRow[] | null;
    error: { code?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (error) {
    console.warn('[helpdesk-sla-breach-cron] open-tickets-lookup-failed', error.code ?? 'unknown');
    return [];
  }
  return data ?? [];
}

async function fetchSlaTarget(orgId: string, tier: string): Promise<SlaTargetRow | null> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data, error } = (await (admin()
    .from('sla_targets')
    .select('first_response_minutes, resolution_minutes, alert_recipients')
    .eq('org_id', orgId)
    .eq('tier', tier)
    .maybeSingle() as any)) as { data: SlaTargetRow | null; error: { code?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (error) {
    console.warn('[helpdesk-sla-breach-cron] sla-target-lookup-failed', error.code ?? 'unknown');
    return null;
  }
  return data;
}

async function fetchProfileEmail(userId: string): Promise<string | null> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data } = (await (admin()
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle() as any)) as { data: { email?: string | null } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return data?.email ?? null;
}

/**
 * Returns true when the caller should send the alert email. Wraps the SECDEF
 * RPC and treats any RPC-side error as "skip" (cron will retry on the next
 * tick — we don't want a single noisy ticket to block all alerts).
 */
async function tryRecordBreach(ticketId: string, breachType: BreachType): Promise<boolean> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data, error } = (await (admin().rpc('try_record_sla_breach', {
    p_ticket_id: ticketId,
    p_breach_type: breachType,
  }) as any)) as { data: boolean | null; error: { code?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (error) {
    console.warn('[helpdesk-sla-breach-cron] rpc-failed', error.code ?? 'unknown');
    return false;
  }
  return Boolean(data);
}

function computeBreaches(t: TicketRow, sla: SlaTargetRow): BreachType[] {
  const breaches: BreachType[] = [];
  const createdAtMs = Date.parse(t.created_at);
  if (Number.isNaN(createdAtMs)) return breaches;
  const ageMin = (Date.now() - createdAtMs) / 60_000;

  // first_response: age > target AND no agent reply yet.
  if (ageMin > sla.first_response_minutes && !t.last_agent_message_at) {
    breaches.push('first_response');
  }
  // resolution: age > target (independent of agent-reply state — the SLA is
  // wall-clock to close, not to first-reply).
  if (ageMin > sla.resolution_minutes) {
    breaches.push('resolution');
  }
  return breaches;
}

function envOncallList(): string[] {
  const raw = Deno.env.get('SLA_BREACH_DEFAULT_ONCALL_EMAILS') ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function buildRecipientSet(
  t: TicketRow,
  sla: SlaTargetRow,
): Promise<Set<string>> {
  const set = new Set<string>();
  if (t.assigned_to) {
    const email = await fetchProfileEmail(t.assigned_to);
    if (email) set.add(email);
  }
  for (const r of sla.alert_recipients ?? []) {
    if (r && typeof r === 'string') set.add(r.trim());
  }
  for (const r of envOncallList()) set.add(r);
  return set;
}

interface DispatchArgs {
  ticket: TicketRow;
  sla: SlaTargetRow;
  breachType: BreachType;
  recipients: Set<string>;
}

async function dispatchAlerts(args: DispatchArgs): Promise<void> {
  const { ticket, sla, breachType, recipients } = args;
  const createdAtMs = Date.parse(ticket.created_at);
  const elapsedMinutes = Math.floor((Date.now() - createdAtMs) / 60_000);
  const targetMinutes =
    breachType === 'first_response' ? sla.first_response_minutes : sla.resolution_minutes;
  const adminUrl = `${ADMIN_URL_BASE}?ticket=${ticket.id}`;

  for (const to of recipients) {
    try {
      await _sendEmailImpl(admin(), {
        template: 'sla_breach_alert',
        to,
        vars: {
          ticket_ref: ticket.id,
          tier: ticket.priority,
          breach_type: breachType,
          elapsed_minutes: elapsedMinutes,
          target_minutes: targetMinutes,
          admin_url: adminUrl,
        },
        // HARDCODED — see T-37-05-03 + plan-checker grep gate. Even when the
        // underlying ticket is PHI, the alert body contains only ticket_ref +
        // tier + breach_type + admin_url. No patient data ever flows through
        // this template.
        phi: false,
      });
    } catch (err) {
      // Per-recipient isolation — one failed send does NOT block the others.
      // The breach is still counted; the on-call rotation will re-fire after
      // the 24h dedupe window expires.
      const errName = err instanceof Error ? err.name : 'unknown';
      console.warn('[helpdesk-sla-breach-cron] recipient-send-failed', errName);
    }
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export interface HandlerOptions {
  /** Reserved for future test injection. */
  _reserved?: never;
}

export async function handler(req: Request, _opts: HandlerOptions = {}): Promise<Response> {
  // 1. CORS preflight + method gate.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  // 2. Auth gate.
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${SERVICE_KEY}`;
  if (!SERVICE_KEY || auth !== expected) {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  // 3. Scan open tickets.
  const tickets = await fetchOpenTickets();
  let breachesEmitted = 0;

  for (const t of tickets) {
    const sla = await fetchSlaTarget(t.org_id, t.priority);
    if (!sla) continue; // No SLA target row for this org/tier — nothing to enforce.

    const breaches = computeBreaches(t, sla);
    if (breaches.length === 0) continue;

    for (const breachType of breaches) {
      // UPSERT-dedupe via SECDEF RPC. If returns false (within 24h window),
      // skip the email send and the event emit — but log nothing (cron noise).
      const shouldAlert = await tryRecordBreach(t.id, breachType);
      if (!shouldAlert) continue;

      const recipients = await buildRecipientSet(t, sla);
      if (recipients.size === 0) {
        // No on-call configured — count as emitted (state row is recorded) but
        // there's literally nobody to alert. The admin observability surface
        // (Plan 08) can flag orgs with empty alert_recipients.
        console.warn('[helpdesk-sla-breach-cron] no-recipients-for-breach');
      }

      await dispatchAlerts({ ticket: t, sla, breachType, recipients });

      // Emit PostHog event regardless of recipient count — the breach happened.
      // distinctId = assigned_to (the agent who would have owned the response).
      // Fall back to ticket id as a synthetic distinct id when unassigned, so
      // captureServer's userId requirement is satisfied without inventing PHI.
      captureServer({
        userId: t.assigned_to ?? `ticket:${t.id}`,
        event: 'helpdesk.sla.breach',
        properties: {
          ticket_id: t.id,
          breach_type: breachType,
          tier: t.priority,
          recipients_count: recipients.size,
          elapsed_minutes: Math.floor(
            (Date.now() - Date.parse(t.created_at)) / 60_000,
          ),
        },
      });

      breachesEmitted += 1;
    }
  }

  return jsonResponse(200, {
    ok: true,
    tickets_scanned: tickets.length,
    breaches_emitted: breachesEmitted,
  });
}

// ─── Deno.serve entrypoint (try/finally + shutdownPostHog) ────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  try {
    return await handler(req);
  } catch (e) {
    console.error('[helpdesk-sla-breach-cron] unhandled', e instanceof Error ? e.name : 'unknown');
    return jsonResponse(500, { error: 'internal_error' });
  } finally {
    await shutdownPostHog();
  }
});

// ─── Internal test seams ──────────────────────────────────────────────────────
export const __internal = {
  computeBreaches,
  envOncallList,
  setAdminForTest(client: SupabaseClient): void {
    _adminSingleton.client = client;
  },
  resetAdminForTest(): void {
    _adminSingleton.client = null;
  },
  setSendEmailForTest(fn: SendEmailFn): void {
    _sendEmailImpl = fn;
  },
  resetSendEmailForTest(): void {
    _sendEmailImpl = defaultSendEmail;
  },
  setCaptureForTest(fn: CaptureFn): void {
    _captureImpl = fn;
  },
  resetCaptureForTest(): void {
    _captureImpl = defaultCaptureServer;
  },
};
