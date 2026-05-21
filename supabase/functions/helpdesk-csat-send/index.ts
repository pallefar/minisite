/**
 * `helpdesk-csat-send` Edge Function — Phase 37 Plan 37-05 (HELP-05).
 *
 * Invoked by the AFTER UPDATE OF status trigger trg_helpdesk_on_ticket_close
 * (migration 20270707000008) when a ticket transitions to status='closed'.
 * Dispatches the CSAT survey email via `_shared/email-router.ts` (phi-aware:
 * SES for PHI tickets, Resend for non-PHI) and stamps tickets.csat_sent_at as
 * the idempotency anchor.
 *
 * Pipeline:
 *
 *   1. CORS preflight + method gate.
 *   2. Auth gate — Bearer ${SUPABASE_SERVICE_ROLE_KEY}; 401 on mismatch.
 *   3. Parse { ticket_id }; 400 on missing.
 *   4. Lookup ticket; 404 on miss.
 *   5. If ticket.csat_sent_at already set → 200 { skipped: 'already_sent' }.
 *   6. Lookup csat_responses for this ticket — if exists, 200 { skipped: 'already_responded' }.
 *   7. Lookup profile email by ticket.user_id. If no email, 200 { skipped: 'no_recipient' }.
 *   8. Build signed CSAT URL — 14-day expiry, HMAC-SHA256 over `${ticket_id}:csat:${expires_at}`.
 *      Uses dedicated HELPDESK_CSAT_SIGNING_SECRET (NOT the reply-token HMAC key).
 *   9. sendEmail(admin, { template: 'csat_followup', to, vars, phi: ticket.phi }).
 *  10. UPDATE tickets SET csat_sent_at = now() WHERE id = ticket_id.
 *  11. Return 200 { ok: true }.
 *
 * Forbidden:
 *   - Do NOT log profile.email, ticket.subject, or any user-data field — short
 *     error codes via console.warn only (template-literal user input is the
 *     T-25-03-I1 footgun).
 *   - Do NOT swallow sendEmail errors on phi=true — they MUST propagate
 *     (T-25-03-S4: silent fallback to Resend == PHI outside BAA boundary).
 *     We surface a 500 to the trigger and intentionally DO NOT stamp
 *     csat_sent_at so a future trigger refire can retry.
 *   - Do NOT recursively re-invoke this Edge Fn (the trigger is bounded to
 *     the open→closed transition; the csat_sent_at UPDATE doesn't touch
 *     status so the trigger doesn't refire).
 *
 * Threat model anchor:
 *   - T-37-05-01 (duplicate CSAT) — csat_sent_at idempotency + already_responded check.
 *   - T-37-05-03 (PHI leak)       — phi flag passed verbatim from ticket row.
 *   - T-37-05-04 (URL tamper)     — HMAC-SHA256 with dedicated CSAT secret.
 *   - T-37-05-05 (spoofing)       — Service-role Bearer gate; 401 on mismatch.
 */
import 'jsr:@std/dotenv/load';
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { sendEmail as defaultSendEmail } from '../_shared/email-router.ts';
import { corsHeaders } from './cors.ts';

// ─── Env ──────────────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// 14-day signed-CSAT-URL expiry. Long enough that users who open the email
// after the weekend still hit a valid link; short enough that ticket churn
// doesn't accumulate stale endpoints.
const CSAT_URL_EXPIRY_SECONDS = 14 * 24 * 60 * 60;

// CSAT landing page lives under the marketing surface (Plan 37-06 owns the
// route handler). The Edge Fn only generates the URL; the landing page
// re-validates the HMAC server-side before accepting a rating.
const CSAT_LANDING_BASE = 'https://app.leanshot.app/help/csat';

// ─── Admin client singleton ───────────────────────────────────────────────────
const _adminSingleton: { client: SupabaseClient | null } = { client: null };
function admin(): SupabaseClient {
  if (_adminSingleton.client) return _adminSingleton.client;
  _adminSingleton.client = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _adminSingleton.client;
}

// ─── sendEmail test seam ──────────────────────────────────────────────────────
// Production code calls sendEmail via this indirection so Deno tests can
// monkey-patch via __internal.setSendEmailForTest without needing
// jsr:@std/testing/mock to mutate non-configurable ESM module bindings.
type SendEmailFn = typeof defaultSendEmail;
let _sendEmailImpl: SendEmailFn = defaultSendEmail;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface CsatInput {
  ticketId: string;
}

function parseInput(body: unknown): CsatInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const ticketId = typeof b.ticket_id === 'string' ? b.ticket_id.trim() : '';
  if (!ticketId) return null;
  return { ticketId };
}

interface TicketRow {
  id: string;
  org_id: string;
  user_id: string;
  phi: boolean;
  subject: string;
  csat_sent_at: string | null;
}

async function fetchTicket(ticketId: string): Promise<TicketRow | null> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data, error } = (await (admin()
    .from('tickets')
    .select('id, org_id, user_id, phi, subject, csat_sent_at')
    .eq('id', ticketId)
    .maybeSingle() as any)) as { data: TicketRow | null; error: { code?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (error) {
    console.warn('[helpdesk-csat-send] ticket-lookup-failed', error.code ?? 'unknown');
    return null;
  }
  return data;
}

interface CsatResponseRow {
  ticket_id: string;
}

async function fetchExistingCsatResponse(ticketId: string): Promise<CsatResponseRow | null> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data, error } = (await (admin()
    .from('csat_responses')
    .select('ticket_id')
    .eq('ticket_id', ticketId)
    .maybeSingle() as any)) as { data: CsatResponseRow | null; error: { code?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (error) {
    // Treat lookup failure as "no row exists" — better to risk a duplicate
    // (which the user can ignore) than to silently never send the survey.
    console.warn('[helpdesk-csat-send] csat-response-lookup-failed', error.code ?? 'unknown');
    return null;
  }
  return data;
}

interface ProfileRow {
  email: string | null;
}

async function fetchProfileEmail(userId: string): Promise<string | null> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data, error } = (await (admin()
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle() as any)) as { data: ProfileRow | null; error: { code?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (error) {
    console.warn('[helpdesk-csat-send] profile-lookup-failed', error.code ?? 'unknown');
    return null;
  }
  return data?.email ?? null;
}

// ─── HMAC signing helper ──────────────────────────────────────────────────────
// Mirrors the helpdesk-hmac pattern but uses a DEDICATED secret
// (HELPDESK_CSAT_SIGNING_SECRET) — the reply-token HMAC key has a different
// threat model and surface, so they must not share secrets. T-37-05-04.

const _signer = {
  encoder: new TextEncoder(),
};

async function hmacSignBase64Url(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    _signer.encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, _signer.encoder.encode(message)),
  );
  let bin = '';
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/**
 * Build a signed one-tap CSAT URL with HMAC-SHA256 over `${ticketId}:csat:${expires_at}`.
 * Returns the URL or null if the signing secret is unset.
 *
 * Query params:
 *   t = ticket_id
 *   e = expires_at (unix seconds)
 *   s = base64url-encoded HMAC signature
 *
 * The landing page (Plan 37-06) verifies by:
 *   1. Reject if e is in the past.
 *   2. Recompute `${t}:csat:${e}` HMAC with the same secret and constant-time
 *      compare against s.
 */
async function buildSignedCsatUrl(ticketId: string): Promise<string | null> {
  const secret = Deno.env.get('HELPDESK_CSAT_SIGNING_SECRET') ?? '';
  if (!secret) {
    console.warn('[helpdesk-csat-send] csat-signing-secret-missing');
    return null;
  }
  const expiresAt = Math.floor(Date.now() / 1000) + CSAT_URL_EXPIRY_SECONDS;
  const sig = await hmacSignBase64Url(secret, `${ticketId}:csat:${expiresAt}`);
  const u = new URL(CSAT_LANDING_BASE);
  u.searchParams.set('t', ticketId);
  u.searchParams.set('e', String(expiresAt));
  u.searchParams.set('s', sig);
  return u.toString();
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export interface HandlerOptions {
  /** Unused; reserved for symmetry with sibling Edge Fns and future tests. */
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

  // 2. Auth gate — Bearer ${SUPABASE_SERVICE_ROLE_KEY}.
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${SERVICE_KEY}`;
  if (!SERVICE_KEY || auth !== expected) {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  // 3. Parse input.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }
  const input = parseInput(rawBody);
  if (!input) {
    return jsonResponse(400, { error: 'missing_ticket_id' });
  }

  // 4. Lookup ticket.
  const ticket = await fetchTicket(input.ticketId);
  if (!ticket) {
    return jsonResponse(404, { error: 'ticket_not_found' });
  }

  // 5. Idempotency anchor — csat_sent_at already set.
  if (ticket.csat_sent_at) {
    return jsonResponse(200, { ok: true, skipped: 'already_sent' });
  }

  // 6. Defensive — user already responded to CSAT (the response page can land
  //    a row before our async send pipeline catches up).
  const existing = await fetchExistingCsatResponse(ticket.id);
  if (existing) {
    return jsonResponse(200, { ok: true, skipped: 'already_responded' });
  }

  // 7. Lookup recipient.
  const email = await fetchProfileEmail(ticket.user_id);
  if (!email) {
    // No recipient yet — return 200 so the trigger doesn't retry storm.
    // csat_sent_at is intentionally NOT stamped so a future profile-email
    // update + trigger refire can still deliver.
    return jsonResponse(200, { ok: true, skipped: 'no_recipient' });
  }

  // 8. Build signed CSAT URL.
  const csatUrl = await buildSignedCsatUrl(ticket.id);
  if (!csatUrl) {
    return jsonResponse(500, { error: 'csat_url_signing_failed' });
  }

  // 9. Dispatch via phi-aware email-router.
  //    phi is passed verbatim from ticket.phi — caller is authoritative
  //    (T-37-05-03; the router is a single switch).
  try {
    await _sendEmailImpl(admin(), {
      template: 'csat_followup',
      to: email,
      vars: {
        ticket_ref: ticket.id,
        csat_url: csatUrl,
        // Subject hint is short and pre-clamped here; the template clamps too
        // but defense-in-depth on PHI surfaces never hurts.
        subject_hint: (ticket.subject ?? '').slice(0, 60),
      },
      phi: ticket.phi,
    });
  } catch (err) {
    // T-25-03-S4: on phi=true SES failure we MUST NOT silently fall back to
    // Resend. The error already short-codes itself in email-router; here we
    // log the bounded error name and surface a 500 so the trigger sees the
    // failure. csat_sent_at stays NULL so future retries are possible.
    const errName = err instanceof Error ? err.name : 'unknown';
    console.warn('[helpdesk-csat-send] sendEmail-failed', errName);
    return jsonResponse(500, { error: 'send_failed' });
  }

  // 10. Stamp idempotency anchor.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { error: updErr } = (await (admin()
    .from('tickets')
    .update({ csat_sent_at: new Date().toISOString() })
    .eq('id', ticket.id) as any)) as { error: { code?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (updErr) {
    // Email already sent — we can't unsend it. The next trigger refire will
    // see a non-null csat_sent_at only if this UPDATE eventually succeeds, or
    // the already_responded guard will catch it. Log and continue.
    console.warn('[helpdesk-csat-send] csat-sent-at-update-failed', updErr.code ?? 'unknown');
  }

  return jsonResponse(200, { ok: true });
}

// ─── Deno.serve entrypoint ───────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  try {
    return await handler(req);
  } catch (e) {
    console.error('[helpdesk-csat-send] unhandled', e instanceof Error ? e.name : 'unknown');
    return jsonResponse(500, { error: 'internal_error' });
  }
});

// ─── Internal test seams ──────────────────────────────────────────────────────
export const __internal = {
  CSAT_URL_EXPIRY_SECONDS,
  CSAT_LANDING_BASE,
  hmacSignBase64Url,
  buildSignedCsatUrl,
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
};
