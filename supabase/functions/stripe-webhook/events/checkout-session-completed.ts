/**
 * checkout-session-completed.ts — Handler for `checkout.session.completed` event.
 * Phase 14 Plan 03 Task 2 (full implementation).
 */
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export async function handle(event: Stripe.Event, admin: SupabaseClient): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const subId = session.subscription as string;
  const customerId = session.customer as string;

  // Metadata contract from plan 14-04: tier_kind, user_id, clinic_id
  const meta = (
    (session.subscription_data?.metadata ?? session.metadata) as Record<string, string>
  ) ?? {};

  if (meta.tier_kind === 'web') {
    // Write stripe_customers mapping
    const { error: cusErr } = await admin.from('stripe_customers').upsert(
      { user_id: meta.user_id, stripe_customer_id: customerId },
      { onConflict: 'user_id' },
    );
    if (cusErr) {
      console.error('[stripe-webhook/checkout-completed] stripe_customers upsert', cusErr.message);
    }

    // Upsert subscriptions row with ux_tier='paid' (Pitfall 8 — grant on checkout, not invoice)
    const { error: subErr } = await admin.from('subscriptions').upsert(
      {
        id: subId,
        provider: 'stripe',
        user_id: meta.user_id,
        clinic_id: null,
        stripe_customer_id: customerId,
        status: 'trialing',
        ux_tier: 'paid',
        plan_id: session.line_items?.data?.[0]?.price?.id ?? null,
        current_period_end: null,
        trial_end: null,
        cancel_at_period_end: false,
        metadata: { provider: 'stripe', tier_kind: 'web' },
      },
      { onConflict: 'id' },
    );
    if (subErr) {
      console.error('[stripe-webhook/checkout-completed] subscriptions upsert', subErr.message);
      throw new Error('subscriptions-upsert-failed');
    }
  } else if (meta.tier_kind === 'clinic') {
    // Write clinic_stripe_customers mapping
    const { error: cusErr } = await admin.from('clinic_stripe_customers').upsert(
      { clinic_id: meta.clinic_id, stripe_customer_id: customerId },
      { onConflict: 'clinic_id' },
    );
    if (cusErr) {
      console.error(
        '[stripe-webhook/checkout-completed] clinic_stripe_customers upsert',
        cusErr.message,
      );
    }

    // Upsert subscriptions row for clinic
    const { error: subErr } = await admin.from('subscriptions').upsert(
      {
        id: subId,
        provider: 'stripe',
        user_id: null,
        clinic_id: meta.clinic_id,
        stripe_customer_id: customerId,
        status: 'trialing',
        ux_tier: 'paid',
        plan_id: null,
        current_period_end: null,
        trial_end: null,
        cancel_at_period_end: false,
        metadata: { provider: 'stripe', tier_kind: 'clinic' },
      },
      { onConflict: 'id' },
    );
    if (subErr) {
      console.error(
        '[stripe-webhook/checkout-completed] clinic subscriptions upsert',
        subErr.message,
      );
      throw new Error('clinic-subscriptions-upsert-failed');
    }
  } else {
    // Missing metadata.tier_kind — integration bug in plan 14-04's Checkout session creation.
    // Return error so dispatcher returns 500 and Stripe retries until 14-04 fixes its wiring.
    throw new Error(
      `metadata-missing: tier_kind not in {web,clinic} for session ${session.id}`,
    );
  }
}
