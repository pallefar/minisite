/**
 * invoice-paid.ts — Handler for `invoice.paid` event.
 *
 * Writes `ux_tier='paid'` directly: an `invoice.paid` event by definition means
 * the charge succeeded, so the past_due banner clears. `current_period_end` is
 * taken from the real `invoice.period_end` field. Closes CR-04 (handler previously
 * read a non-existent field via an unsafe cast — see VERIFICATION.md).
 */
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export async function handle(event: Stripe.Event, admin: SupabaseClient): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const subId = invoice.subscription as string | null;

  if (!subId) {
    // Invoice not tied to a subscription (one-time charge) — ignore.
    console.log('[stripe-webhook/invoice-paid] no subscription_id, skipping');
    return;
  }

  const periodEnd = invoice.period_end
    ? new Date(invoice.period_end * 1000).toISOString()
    : null;

  const { error } = await admin
    .from('subscriptions')
    .update({
      ux_tier: 'paid',
      status: 'active',
      current_period_end: periodEnd,
    })
    .eq('id', subId);

  if (error) {
    console.error('[stripe-webhook/invoice-paid] update error', error.message);
    throw new Error('invoice-paid-update-failed');
  }
}
