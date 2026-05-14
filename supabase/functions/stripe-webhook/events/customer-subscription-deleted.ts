/**
 * customer-subscription-deleted.ts — Handler for `customer.subscription.deleted` event.
 *
 * Sets ux_tier='free' and status='canceled' on cancellation finalization.
 * current_period_end is preserved for audit (UI shouldn't read it after this point).
 */
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export async function handle(event: Stripe.Event, admin: SupabaseClient): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const subId = subscription.id;

  const { error } = await admin
    .from('subscriptions')
    .update({
      ux_tier: 'free',
      status: 'canceled',
    })
    .eq('id', subId);

  if (error) {
    console.error(
      '[stripe-webhook/subscription-deleted] update error',
      error.message,
    );
    throw new Error('subscription-deleted-update-failed');
  }
}
