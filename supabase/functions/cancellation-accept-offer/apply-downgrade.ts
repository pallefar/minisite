/**
 * apply-downgrade.ts — Stripe Annual → Monthly downgrade for downgrade offer type.
 *
 * Phase 40 Plan 40-03 Task 2.
 *
 * Implements the primary downgrade path from CONTEXT D-01: Annual → Monthly.
 * Preserves revenue at lower friction vs full cancellation.
 *
 * Stripe API sequence: swap subscription item price to 'price_monthly' at next renewal.
 * proration_behavior: 'none' means the user stays on their current annual plan until the
 * current period ends, then billing switches to monthly (no mid-period proration/refund).
 * billing_cycle_anchor: 'now' resets the billing cycle to today — remove this if we want
 * the user to finish the current annual period first (per CONTEXT Discretion discussion).
 */

import Stripe from 'https://esm.sh/stripe@19?target=denonext';

/**
 * Downgrade a subscription from annual to monthly pricing.
 *
 * @param subscriptionId - Stripe subscription ID
 * @param stripe - Initialized Stripe client (pinned 2026-04-22.dahlia)
 * @returns { nextInvoiceDate } - ISO timestamp of next invoice after downgrade
 */
export async function applyDowngrade(
  subscriptionId: string,
  stripe: Stripe,
): Promise<{ nextInvoiceDate: string }> {
  // Retrieve the subscription to get the current subscription item ID
  const sub = await stripe.subscriptions.retrieve(subscriptionId);

  // Find the first subscription item (annual price)
  const subItem = sub.items.data[0];
  if (!subItem) {
    throw new Error('DOWNGRADE_FAILED:no_subscription_item');
  }

  // Swap annual price → monthly price
  // billing_cycle_anchor: 'now' resets billing cycle to today
  // proration_behavior: 'none' avoids mid-period prorations
  const updated = await stripe.subscriptions.update(subscriptionId, {
    items: [
      {
        id: subItem.id,
        price: 'price_monthly',
      },
    ],
    proration_behavior: 'none',
    billing_cycle_anchor: 'now',
  });

  const nextInvoiceDate = updated.current_period_end
    ? new Date(updated.current_period_end * 1000).toISOString()
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  return { nextInvoiceDate };
}
