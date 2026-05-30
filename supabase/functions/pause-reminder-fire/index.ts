/**
 * `pause-reminder-fire` Edge Function — Phase 40 Plan 40-02 (POLISH-03, D-09).
 *
 * Supports two modes controlled by `?mode=` query param:
 *
 * MODE 1 (default / fire): T-7d reminder batch
 *   Invoked hourly at minute 0 by pg_cron 'p40-pause-t7-reminder' via vault.decrypted_secrets.
 *   Finds subscriptions where:
 *     - is_paused = true
 *     - reminded_t7 = false
 *     - paused_until BETWEEN now() AND now() + 7d
 *   Sends T-7d reminder email (template='pause_reminder_t7') via _shared/email-router.ts.
 *   Sets reminded_t7 = true after each successful send.
 *
 * MODE 2 (reconcile): A3 fail-safe auto-resume sweep
 *   Invoked every 4h at minute 15 by pg_cron 'p40-pause-autoresume-reconcile'.
 *   Finds subscriptions where:
 *     - is_paused = true
 *     - paused_until < now()  (resume date passed but local mirror still shows paused)
 *   For each, calls stripe.subscriptions.retrieve() and if Stripe shows pause_collection=null
 *   (i.e., actually auto-resumed), mirrors the state locally + fires T-0 email.
 *   This is the fail-safe for Assumption A3: Stripe drops the auto-resume webhook.
 *
 * Auth: service-role bearer (pg_cron via vault.decrypted_secrets bootstrap).
 * Error handling: per-candidate errors do NOT abort the batch.
 *
 * T-40-02-06: LIMIT 100/200 per invocation to prevent Stripe API quota burn.
 * T-40-02-03: PHI flag server-derived from clinic_id IS NOT NULL.
 * T-40-02-05: log err.message + err.code ONLY — NEVER full Stripe payload.
 *
 * Pattern: supabase/functions/challenge-evaluate-cron/index.ts (EXACT analog).
 */
import Stripe from 'https://esm.sh/stripe@19?target=denonext';
import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';
import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';
import { sendEmail } from '../_shared/email-router.ts';

const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

// ─── Stripe lazy singleton (reconcile mode only) ──────────────────────────────
// API version pinned per supabase/functions/stripe-webhook/index.ts line 64.

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (_stripe) return _stripe;
  _stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
    apiVersion: '2026-04-22.dahlia' as Stripe.LatestApiVersion,
  });
  return _stripe;
}

// Test injection — lets tests swap out Stripe without live API calls.
let _stripeImpl: typeof getStripe | null = null;
export function __setStripeForTest(impl: typeof getStripe): void { _stripeImpl = impl; }
export function __resetStripeForTest(): void { _stripeImpl = null; }
function stripe(): Stripe { return (_stripeImpl ?? getStripe)(); }

// Test injection — lets tests swap out sendEmail.
type SendEmailFn = typeof sendEmail;
let _sendEmailImpl: SendEmailFn = sendEmail;
export function __setSendEmailForTest(fn: SendEmailFn): void { _sendEmailImpl = fn; }
export function __resetSendEmailForTest(): void { _sendEmailImpl = sendEmail; }

// ─── Shared row types ─────────────────────────────────────────────────────────

interface SubscriptionReminderRow {
  id: string;
  user_id: string | null;
  clinic_id: string | null;
  paused_until: string | null;
}

interface ProfileRow {
  email: string | null;
  first_name: string | null;
}

// ─── Helper: fetch email + first_name from profiles ───────────────────────────

async function fetchProfile(userId: string): Promise<ProfileRow> {
  // public.profiles has NO email column (email lives on auth.users), and there
  // is no profiles.user_id/first_name to select — the old query returned a
  // PostgREST error → null → every reminder + resume email was silently dropped.
  // Resolve via the auth admin API, mirroring community-admin-report-digest.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.auth as any).admin.getUserById(userId);
  if (error) {
    console.error('[pause-reminder-fire] getUserById error', error.message);
    return { email: null, first_name: null };
  }
  const user = data?.user;
  return {
    email: (user?.email as string | null) ?? null,
    first_name: (user?.user_metadata?.first_name as string | undefined) ?? null,
  };
}

// ─── Mode: fire (T-7d reminder) ──────────────────────────────────────────────

async function handleFireMode(): Promise<{ processed: number; sent: number; errors: number }> {
  const windowEnd = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const now = new Date().toISOString();

  const { data: candidates, error: queryErr } = await admin
    .from('subscriptions')
    .select('id, user_id, clinic_id, paused_until')
    .lt('paused_until', windowEnd)
    .gt('paused_until', now)
    .eq('is_paused', true)
    .eq('reminded_t7', false)
    .limit(200);

  if (queryErr) {
    console.error('[pause-reminder-fire] fire query error', queryErr.message, queryErr.code);
    throw new Error('fire_query_error');
  }

  const rows = (candidates ?? []) as SubscriptionReminderRow[];
  let sent = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      if (!row.user_id) {
        console.warn('[pause-reminder-fire] fire: no user_id for sub', row.id);
        errors++;
        continue;
      }

      const profile = await fetchProfile(row.user_id);
      if (!profile.email) {
        console.warn('[pause-reminder-fire] fire: no email for user', row.user_id);
        errors++;
        continue;
      }

      const isPhi = row.clinic_id != null;

      await _sendEmailImpl(admin, {
        template: 'pause_reminder_t7',
        to: profile.email,
        vars: {
          user_first_name: profile.first_name ?? '',
          resumes_at: row.paused_until ?? '',
          // card last4 not available in subscriptions table; template falls back to 'on file'
        },
        phi: isPhi,
      });

      // Mark reminded_t7 = true so this sub doesn't get re-processed.
      await admin
        .from('subscriptions')
        .update({ reminded_t7: true })
        .eq('id', row.id);

      sent++;
    } catch (err) {
      console.error(
        '[pause-reminder-fire] fire: per-candidate error for sub',
        row.id,
        err instanceof Error ? err.message : 'unknown',
        (err as Record<string, unknown>)?.code ?? '',
      );
      errors++;
      // Continue batch — per-candidate errors must NOT abort.
    }
  }

  captureServer({
    userId: 'system',
    event: 'pause_reminder_fire_completed',
    properties: { mode: 'fire', processed: rows.length, sent, errors },
  });

  return { processed: rows.length, sent, errors };
}

// ─── Mode: reconcile (A3 fail-safe auto-resume sweep) ────────────────────────

async function handleReconcileMode(): Promise<{ processed: number; reconciled: number; errors: number }> {
  const now = new Date().toISOString();

  // Find paused subs whose resume date has passed (local mirror lags Stripe).
  const { data: candidates, error: queryErr } = await admin
    .from('subscriptions')
    .select('id, user_id, clinic_id, paused_until')
    .lt('paused_until', now)
    .eq('is_paused', true)
    .limit(100);

  if (queryErr) {
    console.error('[pause-reminder-fire] reconcile query error', queryErr.message, queryErr.code);
    throw new Error('reconcile_query_error');
  }

  const rows = (candidates ?? []) as SubscriptionReminderRow[];
  let reconciled = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      // Retrieve live state from Stripe.
      const stripeSub = await stripe().subscriptions.retrieve(row.id);

      // If Stripe shows pause_collection = null → subscription actually auto-resumed.
      if (stripeSub.pause_collection != null) {
        // Still paused on Stripe side — local mirror is correct, nothing to do.
        continue;
      }

      // Stripe confirms auto-resumed. Mirror the state locally.
      await admin
        .from('subscriptions')
        .update({ is_paused: false, paused_until: null, reminded_t7: false })
        .eq('id', row.id);

      // Fire T-0 confirmation email (best-effort; idempotent with webhook path).
      if (row.user_id) {
        const profile = await fetchProfile(row.user_id);
        if (profile.email) {
          const isPhi = row.clinic_id != null;
          await _sendEmailImpl(admin, {
            template: 'pause_resumed_t0',
            to: profile.email,
            vars: {
              user_first_name: profile.first_name ?? '',
              resumed_at: new Date().toISOString(),
            },
            phi: isPhi,
          });
        }
      }

      reconciled++;
    } catch (err) {
      console.error(
        '[pause-reminder-fire] reconcile: per-candidate error for sub',
        row.id,
        err instanceof Error ? err.message : 'unknown',
        (err as Record<string, unknown>)?.code ?? '',
      );
      errors++;
      // Continue batch — per-candidate errors must NOT abort.
    }
  }

  captureServer({
    userId: 'system',
    event: 'pause_autoresume_reconcile_completed',
    properties: { mode: 'reconcile', processed: rows.length, reconciled, errors },
  });

  return { processed: rows.length, reconciled, errors };
}

// ─── Request handler ──────────────────────────────────────────────────────────

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');

  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') ?? 'fire';

  try {
    if (mode === 'reconcile') {
      const result = await handleReconcileMode();
      return jsonResponse(200, { ok: true, mode: 'reconcile', ...result });
    } else {
      const result = await handleFireMode();
      return jsonResponse(200, { ok: true, mode: 'fire', ...result });
    }
  } catch (e) {
    console.error('[pause-reminder-fire] handler failed', e);
    return jsonError(500, 'internal_error');
  } finally {
    try {
      await shutdownPostHog();
    } catch (e) {
      console.error('[pause-reminder-fire] shutdownPostHog failed', e);
    }
  }
}

Deno.serve(handler);

export const __internal = { handler, setAdminForTest, resetAdminForTest };
