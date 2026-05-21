/**
 * apply-pause.ts — Stripe pause_collection apply for 1/2/3-month preset.
 *
 * Phase 40 Plan 40-03 Task 2.
 *
 * Implements D-06: `pause_collection({ behavior: 'void', resumes_at })`.
 * Per RESEARCH lines 736-756 verbatim.
 *
 * A5: trialing subscriptions may reject pause via Stripe invalid_request_error.
 * Caller catches 'PAUSE_FAILED:*' and surfaces error code to client;
 * client (40-04) shows toast "Pause unavailable during trial. Try a discount instead."
 */

import Stripe from 'https://esm.sh/stripe@19?target=denonext';

/**
 * Apply a pause to a Stripe subscription.
 *
 * @param subscriptionId - Stripe subscription ID
 * @param pauseMonths - 1, 2, or 3 month preset
 * @param stripe - Initialized Stripe client (pinned 2026-04-22.dahlia)
 * @returns { resumesAt } - Unix timestamp when billing resumes
 * @throws Error('PAUSE_FAILED:{code}') on Stripe rejection (e.g. trialing sub — A5)
 */
export async function applyPause(
  subscriptionId: string,
  pauseMonths: 1 | 2 | 3,
  stripe: Stripe,
): Promise<{ resumesAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const resumesAt = now + pauseMonths * 30 * 24 * 60 * 60;

  try {
    await stripe.subscriptions.update(subscriptionId, {
      pause_collection: {
        behavior: 'void',
        resumes_at: resumesAt,
      },
    });
  } catch (err) {
    // A5: trialing subscriptions may reject pause
    // Wrap Stripe error so caller can surface specific code to client
    const stripeErr = err as { code?: string; type?: string; message?: string };
    const code = stripeErr.code ?? stripeErr.type ?? 'unknown';
    throw new Error(`PAUSE_FAILED:${code}`);
  }

  return { resumesAt };
}
