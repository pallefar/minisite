/**
 * apply-extended-trial.ts — Stripe trial extension for extended_trial offer type.
 *
 * Phase 40 Plan 40-03 Task 2.
 *
 * Extends the subscription trial_end by extension_days from offer_config.
 * If not currently in trial, extends from now. Uses proration_behavior: 'none'
 * to avoid charge adjustments mid-period.
 */

import Stripe from 'https://esm.sh/stripe@19?target=denonext';

/**
 * Extend the trial period of a subscription.
 *
 * @param subscriptionId - Stripe subscription ID
 * @param extensionDays - Number of days to extend (7, 14, or 30)
 * @param stripe - Initialized Stripe client (pinned 2026-04-22.dahlia)
 * @returns { newTrialEnd, nextInvoiceDate } - ISO timestamps
 */
export async function applyExtendedTrial(
  subscriptionId: string,
  extensionDays: 7 | 14 | 30,
  stripe: Stripe,
): Promise<{ newTrialEnd: string; nextInvoiceDate: string }> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);

  // Base: use current trial_end if in trial, else extend from now
  const nowUnix = Math.floor(Date.now() / 1000);
  const baseTrialEnd = sub.trial_end && sub.trial_end > nowUnix ? sub.trial_end : nowUnix;
  const newTrialEndUnix = baseTrialEnd + extensionDays * 86400;

  await stripe.subscriptions.update(subscriptionId, {
    trial_end: newTrialEndUnix,
    proration_behavior: 'none',
  });

  const newTrialEndDate = new Date(newTrialEndUnix * 1000).toISOString();
  return { newTrialEnd: newTrialEndDate, nextInvoiceDate: newTrialEndDate };
}
