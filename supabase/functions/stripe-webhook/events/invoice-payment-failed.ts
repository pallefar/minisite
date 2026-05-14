/**
 * invoice-payment-failed.ts — Handler for `invoice.payment_failed` event.
 *
 * Writes `ux_tier='past_due'` directly: an `invoice.payment_failed` event by
 * definition means a charge failed and Stripe dunning has started.
 * `customer.subscription.updated` (subscription-updated.ts) remains the
 * authority for the retry-exhausted and recovery transitions via the real
 * `subscription.status`. Closes CR-04 (D-08 banner trigger was inverted).
 */
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export async function handle(event: Stripe.Event, admin: SupabaseClient): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const subId = invoice.subscription as string | null;

  if (!subId) {
    console.log('[stripe-webhook/invoice-payment-failed] no subscription_id, skipping');
    return;
  }

  const { error } = await admin
    .from('subscriptions')
    .update({
      ux_tier: 'past_due',
      status: 'past_due',
    })
    .eq('id', subId);

  if (error) {
    console.error('[stripe-webhook/invoice-payment-failed] update error', error.message);
    throw new Error('invoice-payment-failed-update-failed');
  }
}
