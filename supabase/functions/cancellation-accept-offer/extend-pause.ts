/**
 * extend-pause.ts — D-10 pause extension; updates Stripe pause_collection.resumes_at.
 *
 * Phase 40 Plan 40-03 Task 2.
 *
 * Per RESEARCH lines 763-784 verbatim.
 *
 * D-10: Extending an active pause counts as taking the pause offer AGAIN and DOES increment
 * the lifetime take counter. This is the exception to D-02's "pause exempt" rule:
 *   - Initial pause: does NOT count toward 2-lifetime-take cap
 *   - Pause extension via D-10: DOES count (3-month pause + 1-month extension = take #2;
 *     subsequent extension = BLOCKED by checkLifetimeCap in decide-offer)
 *
 * The incrementing responsibility sits in accept-offer/index.ts (extension flag detection).
 * This module just does the Stripe API call.
 */

import Stripe from 'https://esm.sh/stripe@19?target=denonext';

/**
 * Extend an active subscription pause by additional months.
 *
 * @param subscriptionId - Stripe subscription ID
 * @param extraMonths - Additional months to add (1, 2, or 3)
 * @param stripe - Initialized Stripe client (pinned 2026-04-22.dahlia)
 * @returns { resumesAt } - New unix timestamp when billing resumes
 * @throws Error('SUB_NOT_PAUSED') if subscription is not currently paused
 */
export async function extendPause(
  subscriptionId: string,
  extraMonths: 1 | 2 | 3,
  stripe: Stripe,
): Promise<{ resumesAt: number }> {
  // 1. Retrieve current pause_collection.resumes_at
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const currentResumesAt = sub.pause_collection?.resumes_at;

  // 2. Guard: subscription must be paused
  if (!currentResumesAt) {
    throw new Error('SUB_NOT_PAUSED');
  }

  // 3. Extend resumes_at by extraMonths (approximate 30-day months, matching applyPause)
  const newResumesAt = currentResumesAt + extraMonths * 30 * 24 * 60 * 60;

  // 4. Update Stripe subscription with new resumes_at
  await stripe.subscriptions.update(subscriptionId, {
    pause_collection: {
      behavior: 'void',
      resumes_at: newResumesAt,
    },
  });

  return { resumesAt: newResumesAt };
}
