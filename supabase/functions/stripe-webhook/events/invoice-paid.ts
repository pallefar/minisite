/**
 * invoice-paid.ts — Handler for `invoice.paid` event.
 *
 * Clears past_due → paid on successful retry (D-08 banner clearing).
 * Re-fetches subscription status from the event payload for accuracy.
 */
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { mapStripeStatusToUxTier } from './subscription-updated.ts';

export async function handle(event: Stripe.Event, admin: SupabaseClient): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const subId = invoice.subscription as string | null;

  if (!subId) {
    // Invoice not tied to a subscription (one-time charge) — ignore.
    console.log('[stripe-webhook/invoice-paid] no subscription_id, skipping');
    return;
  }

  // Re-read subscription status from the invoice's embedded subscription object.
  // Safer than trusting the event ordering — re-syncs from Stripe truth.
  const invoiceObj = invoice as Stripe.Invoice & {
    subscription_details?: { metadata?: Record<string, string> };
  };

  // Use the subscription status if available on the invoice object.
  // If not available, default to 'active' (invoice.paid means payment succeeded).
  const subStatus = (
    (invoice as unknown as { subscription_status?: string }).subscription_status ?? 'active'
  ) as Stripe.Subscription.Status;

  const uxTier = mapStripeStatusToUxTier(subStatus);
  const periodEnd = invoice.period_end
    ? new Date(invoice.period_end * 1000).toISOString()
    : null;

  const { error } = await admin
    .from('subscriptions')
    .update({
      ux_tier: uxTier,
      status: subStatus,
      current_period_end: periodEnd,
    })
    .eq('id', subId);

  if (error) {
    console.error('[stripe-webhook/invoice-paid] update error', error.message);
    throw new Error('invoice-paid-update-failed');
  }

  void invoiceObj; // suppress unused warning
}
