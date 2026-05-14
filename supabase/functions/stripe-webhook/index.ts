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
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'stripe';

import { BASE_RESPONSE_HEADERS } from './cors.ts';

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
  const { handle: handleInvoicePaid } = await import('./events/invoice-paid.ts');
  const { handle: handleInvoicePaymentFailed } = await import(
    './events/invoice-payment-failed.ts'
  );
  const { handle: handleInvoiceUpcoming } = await import('./events/invoice-upcoming.ts');

  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event, admin);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event, admin);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event, admin);
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

  // Method guard
  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'method-not-allowed' });
  }

  // Signature header — must be present before any body read.
  const signature = request.headers.get('Stripe-Signature');
  if (!signature) {
    return jsonResponse(400, { error: 'missing-signature' });
  }

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
}

// ─── Entry point ─────────────────────────────────────────────────────────────
Deno.serve((request: Request) => handleRequest(request));

// ─── Internal exports for Deno test suite ────────────────────────────────────
// Mirror clinic-invite pattern: expose internals without re-binding Deno.serve.
export const __internal = {
  handleRequest,
};
