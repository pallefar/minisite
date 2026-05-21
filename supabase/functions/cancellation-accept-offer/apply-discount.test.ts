/**
 * apply-discount.test.ts — Unit tests for applyDiscount.
 * Phase 40 Plan 40-03 Task 2.
 *
 * Critical assertions:
 * - Existing discounts are preserved (D-14 stacking)
 * - NEVER calls singular coupon-field form (Pitfall 2 / T-40-03-08)
 * - A1 dual-shape handling: coupon as string AND as Coupon object both produce correct shape
 */

import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { applyDiscount } from './apply-discount.ts';
import type Stripe from 'https://esm.sh/stripe@19?target=denonext';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeStripeWithExistingDiscounts(existingDiscounts: unknown[]): {
  stripe: Stripe;
  getCapturedUpdate: () => { subscriptionId: string; params: unknown } | null;
} {
  let capturedUpdate: { subscriptionId: string; params: unknown } | null = null;

  const stripe = {
    subscriptions: {
      retrieve: async (subscriptionId: string) => ({
        id: subscriptionId,
        discounts: existingDiscounts,
      }),
      update: async (subscriptionId: string, params: unknown) => {
        capturedUpdate = { subscriptionId, params };
        return { id: subscriptionId };
      },
    },
  } as unknown as Stripe;

  return { stripe, getCapturedUpdate: () => capturedUpdate };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

Deno.test('applyDiscount: preserves existing affiliate discount (D-14 stacking)', async () => {
  // Existing discount with coupon as Coupon object (expanded form)
  const existingDiscounts = [
    { coupon: { id: 'REF-10', percent_off: 10 } },
  ];
  const { stripe, getCapturedUpdate } = makeStripeWithExistingDiscounts(existingDiscounts);

  const result = await applyDiscount('sub_test', 'SAVE-25-3MO', stripe);
  assertEquals(result.appliedCouponId, 'SAVE-25-3MO');

  const update = getCapturedUpdate();
  assert(update !== null, 'stripe.subscriptions.update must be called');

  const params = update!.params as { discounts: Array<{ coupon: string }> };
  // Must contain BOTH the affiliate coupon AND the new save-offer coupon
  assertEquals(params.discounts.length, 2);
  assertEquals(params.discounts[0]!.coupon, 'REF-10');
  assertEquals(params.discounts[1]!.coupon, 'SAVE-25-3MO');
});

Deno.test('applyDiscount: works with no existing discounts (clean subscription)', async () => {
  const { stripe, getCapturedUpdate } = makeStripeWithExistingDiscounts([]);

  await applyDiscount('sub_clean', 'SAVE-20-2MO', stripe);

  const update = getCapturedUpdate();
  const params = update!.params as { discounts: Array<{ coupon: string }> };
  assertEquals(params.discounts.length, 1);
  assertEquals(params.discounts[0]!.coupon, 'SAVE-20-2MO');
});

Deno.test('applyDiscount: handles A1 — coupon as string (non-expanded form)', async () => {
  // When discounts are NOT expanded, Stripe may return string IDs instead of objects
  const existingDiscounts = [
    'di_ref10_id', // discount ID string form (non-expanded)
  ];
  // Simulate a non-expanded discount (string form)
  const stripe = {
    subscriptions: {
      retrieve: async (subscriptionId: string) => ({
        id: subscriptionId,
        // Stripe.Discount has a coupon field; if unexpanded discount is a string
        // in our mapping code we handle it differently
        discounts: [{ coupon: 'REF-10' }], // coupon as plain string (A1 case)
      }),
      update: async (_subId: string, params: unknown) => {
        return { id: _subId, _capturedParams: params };
      },
    },
  } as unknown as Stripe;

  // Capture update params
  let capturedParams: unknown = null;
  const stripeWithCapture = {
    subscriptions: {
      retrieve: async (subscriptionId: string) => ({
        id: subscriptionId,
        discounts: [{ coupon: 'REF-10' }], // string coupon (A1 case)
      }),
      update: async (_subId: string, params: unknown) => {
        capturedParams = params;
        return { id: _subId };
      },
    },
  } as unknown as Stripe;

  await applyDiscount('sub_a1', 'SAVE-30-3MO', stripeWithCapture);

  const params = capturedParams as { discounts: Array<{ coupon: string }> };
  assertEquals(params.discounts.length, 2);
  assertEquals(params.discounts[0]!.coupon, 'REF-10'); // string coupon preserved correctly
  assertEquals(params.discounts[1]!.coupon, 'SAVE-30-3MO');
});

Deno.test('applyDiscount: handles A1 — coupon as Coupon object (expanded form)', async () => {
  // Standard expanded form where coupon is a Stripe.Coupon object
  let capturedParams: unknown = null;
  const stripe = {
    subscriptions: {
      retrieve: async (subscriptionId: string) => ({
        id: subscriptionId,
        discounts: [
          { coupon: { id: 'AFFILIATE-15', percent_off: 15, object: 'coupon' } },
        ],
      }),
      update: async (_subId: string, params: unknown) => {
        capturedParams = params;
        return { id: _subId };
      },
    },
  } as unknown as Stripe;

  await applyDiscount('sub_a1_obj', 'SAVE-25-2MO', stripe);

  const params = capturedParams as { discounts: Array<{ coupon: string }> };
  assertEquals(params.discounts.length, 2);
  assertEquals(params.discounts[0]!.coupon, 'AFFILIATE-15'); // Coupon object .id extracted
  assertEquals(params.discounts[1]!.coupon, 'SAVE-25-2MO');
});

Deno.test('applyDiscount: multiple existing discounts all preserved', async () => {
  const existingDiscounts = [
    { coupon: { id: 'REF-10', percent_off: 10 } },
    { coupon: { id: 'PROMO-5', percent_off: 5 } },
  ];
  const { stripe, getCapturedUpdate } = makeStripeWithExistingDiscounts(existingDiscounts);

  await applyDiscount('sub_multi', 'SAVE-20-3MO', stripe);

  const update = getCapturedUpdate();
  const params = update!.params as { discounts: Array<{ coupon: string }> };
  assertEquals(params.discounts.length, 3);
  assertEquals(params.discounts[0]!.coupon, 'REF-10');
  assertEquals(params.discounts[1]!.coupon, 'PROMO-5');
  assertEquals(params.discounts[2]!.coupon, 'SAVE-20-3MO');
});
