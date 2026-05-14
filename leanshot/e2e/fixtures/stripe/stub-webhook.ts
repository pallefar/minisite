/**
 * Phase 14 Plan 14-08 — Stripe webhook stub fixture.
 *
 * Exports `fireWebhookEvent` — signs a hand-crafted Stripe.Event payload with
 * the project's STRIPE_WEBHOOK_SECRET and POSTs it to the local stripe-webhook
 * Edge Function. Deterministic alternative to waiting for real Stripe webhook
 * delivery in test mode.
 *
 * Security note (T-14-08-02): this fixture intentionally forges signed Stripe
 * events. It is dev/test-only and ONLY uses the test-mode webhook secret; the
 * production secret is NEVER reachable from this code.
 *
 * Memory reference: [[reference_supabase_auth_traps]] — NEVER call public
 * auth-email endpoints from e2e. This fixture is webhook-only.
 */

import Stripe from 'stripe';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

/** Local URL for the stripe-webhook Edge Function. */
const DEFAULT_WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/stripe-webhook`;

export interface FireWebhookOpts {
  /** Override the default local webhook URL. */
  localUrl?: string;
}

/**
 * Sign and POST a Stripe event payload to the local stripe-webhook Edge Function.
 *
 * @param eventPayload  Stripe.Event-shaped object (does not need to be a real event ID)
 * @param opts          Optional: override the webhook URL
 * @returns             The fetch Response (caller can assert .status === 200)
 * @throws              If STRIPE_WEBHOOK_SECRET or SUPABASE_URL is missing
 */
export async function fireWebhookEvent(
  eventPayload: Stripe.Event,
  opts: FireWebhookOpts = {},
): Promise<Response> {
  if (!STRIPE_WEBHOOK_SECRET) {
    throw new Error(
      'fireWebhookEvent: STRIPE_WEBHOOK_SECRET env var is required but not set',
    );
  }
  if (!SUPABASE_URL) {
    throw new Error(
      'fireWebhookEvent: SUPABASE_URL (or VITE_SUPABASE_URL) env var is required but not set',
    );
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY || 'sk_test_placeholder', {
    apiVersion: '2026-04-22.dahlia' as Parameters<typeof Stripe>[1]['apiVersion'],
  });

  const payload = JSON.stringify(eventPayload);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: STRIPE_WEBHOOK_SECRET,
  });

  const targetUrl = opts.localUrl ?? DEFAULT_WEBHOOK_URL;

  return fetch(targetUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': signature,
    },
    body: payload,
  });
}

/**
 * Build a minimal Stripe.Event skeleton with overrides.
 * Reduces boilerplate in spec files that only care about a few fields.
 */
export function makeStripeEvent(
  type: string,
  dataObject: Record<string, unknown>,
  overrides: Partial<Stripe.Event> = {},
): Stripe.Event {
  return {
    id: `evt_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    object: 'event',
    api_version: '2026-04-22.dahlia',
    created: Math.floor(Date.now() / 1000),
    data: { object: dataObject as Stripe.Event['data']['object'] },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type: type as Stripe.Event['type'],
    ...overrides,
  };
}
