/**
 * invoice-payment-failed.ts — Handler for `invoice.payment_failed` event.
 *
 * Flips ux_tier='past_due' when invoice fails (D-08 banner trigger).
 * If Stripe still has status='active' (first failure within retry window),
 * this becomes a no-op on ux_tier (mapped value matches current value or
 * Stripe hasn't yet set status='past_due'). Stripe fires subscription.updated
 * with status='past_due' when Smart Retries are exhausted — that handler
 * re-confirms (behavior 2.17).
 */
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { mapStripeStatusToUxTier } from './subscription-updated.ts';

export async function handle(event: Stripe.Event, admin: SupabaseClient): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const subId = invoice.subscription as string | null;

  if (!subId) {
    console.log('[stripe-webhook/invoice-payment-failed] no subscription_id, skipping');
    return;
  }

  // Re-read subscription status from the invoice's embedded subscription_status.
  // If subscription_status is 'active', the first retry hasn't exhausted — no-op on ux_tier.
  const subStatus = (
    (invoice as unknown as { subscription_status?: string }).subscription_status ?? 'active'
  ) as Stripe.Subscription.Status;

  const uxTier = mapStripeStatusToUxTier(subStatus);

  const { error } = await admin
    .from('subscriptions')
    .update({
      ux_tier: uxTier,
      status: subStatus,
    })
    .eq('id', subId);

  if (error) {
    console.error('[stripe-webhook/invoice-payment-failed] update error', error.message);
    throw new Error('invoice-payment-failed-update-failed');
  }
}
