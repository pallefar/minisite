/**
 * `cancellation-seed-coupons` Edge Function — Phase 40 Plan 40-01 D-12/D-13.
 *
 * Idempotent Stripe coupon seed: creates the 6 fixed save-offer coupon combinations
 * (SAVE-{20,25,30}-{2,3}MO) in the Stripe account.
 *
 * Idempotency: each coupon creation uses idempotencyKey `seed-${id}-v1`.
 * Re-runs silently skip already-created coupons (resource_already_exists catch).
 *
 * Auth: service-role bearer only (T-40-01-05 mitigation).
 * Pattern: RESEARCH §"Stripe coupon catalog seed" + PATTERNS §"No-analog cases".
 * Stripe SDK: esm.sh/stripe@19, apiVersion '2026-04-22.dahlia' (PATTERNS §"Stripe SDK init").
 * PostHog flush in finally (PATTERNS §"PostHog flush in finally").
 *
 * Called by the orchestrator at deploy-time (Plan 40-06 close-out task).
 * NOT callable by end-users — service-role bearer gate enforced.
 */
import Stripe from 'https://esm.sh/stripe@19?target=denonext';
import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
} from '../_shared/lifecycle-utils.ts';
import { shutdownPostHog } from '../_shared/posthog-server.ts';

/** Stripe coupon catalog — 6 fixed combinations per D-12/D-13. */
const COUPON_CATALOG = [
  { id: 'SAVE-20-2MO', percent_off: 20, duration_in_months: 2 },
  { id: 'SAVE-20-3MO', percent_off: 20, duration_in_months: 3 },
  { id: 'SAVE-25-2MO', percent_off: 25, duration_in_months: 2 },
  { id: 'SAVE-25-3MO', percent_off: 25, duration_in_months: 3 },
  { id: 'SAVE-30-2MO', percent_off: 30, duration_in_months: 2 },
  { id: 'SAVE-30-3MO', percent_off: 30, duration_in_months: 3 },
] as const;

/** Injected Stripe factory — replaced in tests via setStripeForTest. */
let _stripeInstance: Stripe | null = null;

function getStripe(): Stripe {
  if (_stripeInstance === null) {
    _stripeInstance = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2026-04-22.dahlia' as Stripe.LatestApiVersion,
    });
  }
  return _stripeInstance;
}

/** Test hook: inject a mock Stripe client. */
export function setStripeForTest(client: Stripe | null): void {
  _stripeInstance = client;
}

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');

  const created: string[] = [];
  const skipped: string[] = [];
  const stripe = getStripe();

  try {
    for (const coupon of COUPON_CATALOG) {
      try {
        await stripe.coupons.create(
          {
            id: coupon.id,
            percent_off: coupon.percent_off,
            duration: 'repeating',
            duration_in_months: coupon.duration_in_months,
            name: `Save ${coupon.percent_off}% for ${coupon.duration_in_months} months`,
            metadata: {
              source: 'phase_40_save_flow',
              cohort: 'all',
            },
          },
          {
            idempotencyKey: `seed-${coupon.id}-v1`,
          },
        );
        created.push(coupon.id);
      } catch (err: unknown) {
        // Idempotent: skip coupons that already exist — A7 mitigation (T-40-01-04).
        const stripeErr = err as { code?: string; message?: string };
        if (stripeErr.code === 'resource_already_exists') {
          skipped.push(coupon.id);
          continue;
        }
        // Log safe fields only — NEVER log err.raw (T-40-01-06 / T-14-03-I1).
        console.error('cancellation-seed-coupons: Stripe error', {
          code: stripeErr.code,
          message: stripeErr.message,
          coupon_id: coupon.id,
        });
        throw err;
      }
    }

    return jsonResponse(200, {
      ok: true,
      created: created.length,
      skipped: skipped.length,
      created_ids: created,
      skipped_ids: skipped,
    });
  } finally {
    await shutdownPostHog();
  }
}

export const __internal = { handler, setStripeForTest };

export default {
  fetch: handler,
} satisfies Deno.ServeDefaultExport;
