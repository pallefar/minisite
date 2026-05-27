/**
 * stripe-webhook Edge Function — Phase 14 Plan 03
 *
 * Single source of truth for `subscriptions` table state (D-14).
 *
 * Security invariants:
 *  - RAW BODY read via `request.text()` BEFORE any signature work (Pitfall 3).
 *    Never call `request.json()` before `constructEventAsync`.
 *  - Signature verification via `stripe.webhooks.constructEventAsync` +
 *    `Stripe.createSubtleCryptoProvider()` (required on Deno — Pitfall 2).
 *  - Idempotency via `subscription_events.event_id PRIMARY KEY` +
 *    `INSERT … ON CONFLICT DO NOTHING` (Pattern B). Postgres error 23505 =
 *    already processed → return 200 `{ duplicate: true }`.
 *  - PII safety: every error response is `{ error: '<short-code>' }`.
 *    `console.error` logs `err.message` but NEVER `event.data.object`.
 *  - `Cache-Control: private, no-store` on every response (T-14-03-I2).
 *  - SUPABASE_SERVICE_ROLE_KEY read once at cold-start into `admin` (T-14-03-E1).
 *    Never interpolated into responses or thrown errors.
 *
 * Phase 24 Plan 04:
 *  - Server-side PostHog capture for payment_completed + refund_issued (TAXO-02 / D-13).
 *  - captureServer uses Supabase uid as distinct_id (from stripe metadata.user_id or supabase_uid).
 *  - stripe_session_id is SHA-256 hashed before sending to PostHog (T-24-05b).
 *  - shutdownPostHog() is called in the outer finally block to flush events before Edge return.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@19?target=denonext';

import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';

import { BASE_RESPONSE_HEADERS } from './cors.ts';

// ─── Analytics helpers ────────────────────────────────────────────────────────
/**
 * SHA-256 hex of the input string.
 * Used to hash stripe_session_id before sending to PostHog (T-24-05b — PII safety).
 * NEVER send raw Stripe session IDs or customer IDs to PostHog.
 */
async function hashHex(input: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Module-level constants (cold-start, read once — T-14-03-E1) ─────────────
// STRIPE_WEBHOOK_SECRET and STRIPE_SECRET_KEY are read at request-time (lazy getters)
// so that test files can call Deno.env.set() before the first handleRequest invocation.
// SUPABASE_SERVICE_ROLE_KEY is read once at cold-start into `admin` and never
// re-interpolated into responses or thrown errors (T-14-03-E1 mitigation).
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

function getStripeSecretKey(): string {
  return Deno.env.get('STRIPE_SECRET_KEY') ?? '';
}
function getWebhookSecret(): string {
  return Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
}

// stripe client factory — not cached so tests can set STRIPE_SECRET_KEY via Deno.env.set.
function getStripe(): Stripe {
  return new Stripe(getStripeSecretKey() || 'sk_test_placeholder', {
    apiVersion: '2026-04-22.dahlia' as Stripe.LatestApiVersion, // RESEARCH Pattern 1 + A2
  });
}

// REQUIRED on Deno: native `crypto.subtle.timingSafeEqual` path (Pitfall 2).
const cryptoProvider = Stripe.createSubtleCryptoProvider();

// Service-role admin client — SUPABASE_SERVICE_ROLE_KEY read once here (T-14-03-E1).
// Never re-interpolated into responses or error strings.
const admin = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'placeholder_key', // read-once T-14-03-E1
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// ─── Response helper ─────────────────────────────────────────────────────────
function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: BASE_RESPONSE_HEADERS,
  });
}

// ─── Test injection shim ─────────────────────────────────────────────────────
// In production, `testCtx` is always undefined and the real DB + dispatchers are used.
// In tests, `testCtx` provides mock DB results and optional handler errors.
interface TestContext {
  insertResult?: { data: null; error: { code: string; message: string } | null };
  handlerResult?: Error | undefined;
}

// ─── Dispatcher (event-type → handler) ──────────────────────────────────────
// Task 1: stub dispatcher that no-ops for unrecognized types.
// Task 2 wires the real imports from ./events/*.ts.
async function dispatch(
  event: Stripe.Event,
  testCtx?: TestContext,
): Promise<void> {
  // Test mode: if testCtx is provided, use mock dispatch behavior.
  if (testCtx !== undefined) {
    // If testCtx.handlerResult is an Error, throw it to simulate handler failure.
    if (testCtx.handlerResult instanceof Error) {
      throw testCtx.handlerResult;
    }
    // Otherwise (handlerResult is undefined), this is a successful handler test — no-op.
    return;
  }

  // Lazy import the real handlers (resolved at Task 2; stubs are in events/ already).
  const { handle: handleCheckoutCompleted } = await import(
    './events/checkout-session-completed.ts'
  );
  const { handle: handleSubscriptionUpdated } = await import('./events/subscription-updated.ts');
  const { handle: handleSubscriptionDeleted } = await import(
    './events/customer-subscription-deleted.ts'
  );
  const { handle: handleInvoiceCreated } = await import('./events/invoice-created.ts');
  const { handle: handleInvoicePaid } = await import('./events/invoice-paid.ts');
  const { handle: handleInvoicePaymentFailed } = await import(
    './events/invoice-payment-failed.ts'
  );
  const { handle: handleInvoiceUpcoming } = await import('./events/invoice-upcoming.ts');
  // Phase 19 Plan 19-04 (AFF-03) — Stripe Connect onboarding state mirror.
  const { handle: handleAccountUpdated } = await import('./events/account-updated.ts');
  // Phase 26 Plan 26-07 (AFFTIER-04) — refund / dispute claw-back via payouts.adjustments.
  const { handle: handleChargeRefunded } = await import('./events/charge-refunded.ts');
  const { handle: handleChargeDisputeCreated } = await import(
    './events/charge-dispute-created.ts'
  );

  switch (event.type) {
    case 'checkout.session.completed': {
      await handleCheckoutCompleted(event, admin);
      // Phase 24 D-13: capture payment_completed server-side (adblock-immune).
      // stripe_session_id is SHA-256 hashed before sending to PostHog (T-24-05b).
      const session = event.data.object as Stripe.Checkout.Session;
      const meta = (
        (session.subscription_data?.metadata ?? session.metadata) as Record<string, string> | null
      ) ?? {};
      const userId = meta.user_id ?? meta.supabase_uid ?? null;
      if (userId) {
        captureServer({
          userId,
          event: 'payment_completed',
          properties: {
            plan: meta.tier_kind === 'clinic' ? 'clinic' : (meta.plan ?? 'monthly'),
            price_cents: session.amount_total ?? 0,
            stripe_session_id_hash: await hashHex(session.id),
          },
        });
      } else {
        console.warn('[stripe-webhook] payment_completed: no user_id/supabase_uid in session metadata — skipping PostHog capture');
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event, admin);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event, admin);
      break;
    case 'invoice.created':
      // Phase 29 Plan 03 — D-04: validate meter quantity against local snapshot.
      await handleInvoiceCreated(event, admin);
      break;
    case 'invoice.paid':
      await handleInvoicePaid(event, admin);
      break;
    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(event, admin);
      break;
    case 'invoice.upcoming':
      await handleInvoiceUpcoming(event, admin);
      break;
    case 'account.updated':
      // Phase 19 Plan 19-04 (AFF-03) — affiliate.stripe_payouts_enabled mirror.
      await handleAccountUpdated(event, admin);
      break;
    case 'charge.refunded': {
      // Phase 24 D-13: capture refund_issued server-side.
      const charge = event.data.object as Stripe.Charge;
      const refundUserId = (charge.metadata as Record<string, string>)?.user_id
        ?? (charge.metadata as Record<string, string>)?.supabase_uid
        ?? null;
      if (refundUserId) {
        captureServer({
          userId: refundUserId,
          event: 'refund_issued',
          properties: {
            reason: charge.failure_message ?? (event.data.object as Record<string, unknown>).reason as string ?? 'unspecified',
            // TODO[24-04]: enrich days_since_signup — Plan 24-07 sync can patch with DB lookup.
            days_since_signup: 0,
          },
        });
      } else {
        console.warn('[stripe-webhook] refund_issued: no user_id/supabase_uid in charge metadata — skipping PostHog capture');
      }
      // Phase 26 Plan 26-07 (AFFTIER-04 / D-06): claw back affiliate commission
      // via payouts.adjustments. Runs alongside the Phase 24 PostHog capture
      // above — both must execute on every charge.refunded event.
      await handleChargeRefunded(event, admin);
      break;
    }
    case 'charge.dispute.created':
      // Phase 26 Plan 26-07 (AFFTIER-04 / D-06): claw back commission AND write
      // fraud_signals row for superadmin review (D-04 — NO auto-freeze).
      await handleChargeDisputeCreated(event, admin);
      break;
    default:
      // Unsubscribed event type — log + no-op + 200 (safe forward-compatibility).
      console.log('[stripe-webhook] unhandled event type', event.type);
  }
}

// ─── Core request handler ────────────────────────────────────────────────────
export async function handleRequest(
  request: Request,
  testCtx?: TestContext,
): Promise<Response> {
  // OPTIONS preflight — Stripe servers don't send this, but keep surface uniform.
  if (request.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: BASE_RESPONSE_HEADERS });
  }

  // Phase 69.7 — operational smoke endpoint (GET only, no signature required).
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname.endsWith('/healthz')) {
    return jsonResponse(200, { ok: true, fn: 'stripe-webhook' });
  }

  // Method guard
  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'method-not-allowed' });
  }

  // Signature header — must be present before any body read.
  const signature = request.headers.get('Stripe-Signature');
  if (!signature) {
    return jsonResponse(400, { error: 'missing-signature' });
  }

  // Phase 24 D-13 / RESEARCH PITFALL 1:
  // Wrap all event processing in try/finally so shutdownPostHog() is ALWAYS called
  // before the Response is returned. The Deno isolate shuts down immediately after
  // the Response; without this flush, in-flight posthog-node batch requests are dropped.
  try {
    // RAW BODY — DO NOT JSON.parse before verify (Pitfall 3 invariant).
    // This MUST be the first body operation. Any prior request.json() call would
    // consume the body and make signature verification impossible.
    const body = await request.text();

    // Signature verification via Subtle Crypto (Pitfall 2 — Deno native crypto).
    let event: Stripe.Event;
    try {
      event = await getStripe().webhooks.constructEventAsync(
        body,
        signature,
        getWebhookSecret(),
        undefined,
        cryptoProvider,
      );
    } catch (err) {
      console.error(
        '[stripe-webhook] bad signature',
        err instanceof Error ? err.message : 'unknown',
      );
      return jsonResponse(400, { error: 'bad-signature' });
    }

    // Idempotency insert (Pattern B — event_id PRIMARY KEY).
    // In test mode, use the injected mock result.
    let insertErr: { code: string; message: string } | null = null;

    if (testCtx?.insertResult !== undefined) {
      insertErr = testCtx.insertResult.error;
    } else {
      const { error } = await admin.from('subscription_events').insert({
        event_id: event.id,
        event_type: event.type,
        payload: event,
      });
      insertErr = error as { code: string; message: string } | null;
    }

    if (insertErr) {
      if (insertErr.code === '23505') {
        // Duplicate event.id — already processed. Return 200 so Stripe stops retrying.
        return jsonResponse(200, { duplicate: true });
      }
      // Other DB error — 500 triggers Stripe's 24h retry curve.
      console.error('[stripe-webhook] subscription_events insert error', insertErr.message);
      return jsonResponse(500, { error: 'internal' });
    }

    // Dispatch to per-event handler.
    try {
      await dispatch(event, testCtx);
    } catch (err) {
      // PII safety: log message only, NEVER event.data.object (T-14-03-I1).
      console.error(
        '[stripe-webhook] handler error',
        err instanceof Error ? err.message : 'unknown',
      );
      return jsonResponse(500, { error: 'internal' });
    }

    // Best-effort: mark event as processed (failure is logged, doesn't change response).
    if (!testCtx) {
      const { error: updateErr } = await admin
        .from('subscription_events')
        .update({ processed_at: new Date().toISOString() })
        .eq('event_id', event.id);
      if (updateErr) {
        console.error('[stripe-webhook] processed_at update error', updateErr.message);
      }
    }

    return jsonResponse(200, { ok: true });
  } finally {
    // Phase 24 D-13 / RESEARCH PITFALL 1: flush posthog-node batch queue before the
    // Deno isolate is torn down. This runs even on error paths so events from
    // partially-processed requests are still captured.
    await shutdownPostHog();
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────
Deno.serve((request: Request) => handleRequest(request));

// ─── Internal exports for Deno test suite ────────────────────────────────────
// Mirror clinic-invite pattern: expose internals without re-binding Deno.serve.
export const __internal = {
  handleRequest,
};
