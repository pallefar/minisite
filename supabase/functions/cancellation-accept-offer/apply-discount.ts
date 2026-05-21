/**
 * apply-discount.ts — Stripe discounts[] array APPEND preserving affiliates.
 *
 * Phase 40 Plan 40-03 Task 2.
 *
 * Implements D-14: coupon stacking via discounts[] array append (Pitfall 2 avoidance).
 * Per PATTERNS §5 + RESEARCH lines 411-422 verbatim.
 *
 * CRITICAL: This function uses discounts-array APPEND: `discounts: [...existing, { coupon: couponId }]`
 * The legacy singular coupon-field form overwrites all existing discounts — it is never used here.
 * Verified by grep gate in verify/automated block.
 *
 * A1 ambiguity: Stripe may return `d.coupon` as either a string (coupon ID) or a Stripe.Coupon
 * object depending on whether `expand: ['discounts']` is used. Both forms handled correctly.
 *
 * The 35% stacking clamp (D-15) is already applied at decide-offer time; couponId passed here
 * is the FINAL clamped coupon from the save_offer_rules catalog (SAVE-{20|25|30}-{2|3}MO).
 *
 * Catalog coupon selection when clamp produces non-catalog percent:
 * decide-offer picks the CLOSEST catalog coupon ≤ finalSavePct. E.g., 27.78% clamp
 * → selects SAVE-25-{N}MO (25% ≤ 27.78%). The clamp can only REDUCE, never raise above cap.
 */

import Stripe from 'https://esm.sh/stripe@19?target=denonext';

/**
 * Append a save-offer coupon to a subscription's discounts array.
 * Preserves existing affiliate/referral coupons (D-14 stacking).
 *
 * @param subscriptionId - Stripe subscription ID
 * @param couponId - Catalog coupon ID (e.g. 'SAVE-25-3MO')
 * @param stripe - Initialized Stripe client (pinned 2026-04-22.dahlia)
 * @returns { appliedCouponId } - The coupon ID that was applied
 */
export async function applyDiscount(
  subscriptionId: string,
  couponId: string,
  stripe: Stripe,
): Promise<{ appliedCouponId: string }> {
  // 1. Retrieve current subscription with existing discounts expanded
  const sub = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['discounts'],
  });

  // 2. Build existing discounts array — A1: handle string OR Coupon object
  const discounts = (sub.discounts ?? []) as Array<string | Stripe.Discount>;
  const existing = discounts.map((d) => {
    if (typeof d === 'string') {
      // Already a discount ID — not typical when expanded but handle defensively
      return { coupon: d };
    }
    // d is a Stripe.Discount object; d.coupon can be string or Stripe.Coupon
    const couponField = d.coupon;
    if (typeof couponField === 'string') {
      return { coupon: couponField };
    }
    // couponField is a Stripe.Coupon object
    return { coupon: (couponField as Stripe.Coupon).id };
  });

  // 3. Append save-offer coupon using discounts[] array (never singular coupon-field overwrite)
  await stripe.subscriptions.update(subscriptionId, {
    discounts: [...existing, { coupon: couponId }],
  });

  return { appliedCouponId: couponId };
}
