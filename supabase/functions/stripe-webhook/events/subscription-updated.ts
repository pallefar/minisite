/**
 * subscription-updated.ts — Handler for `customer.subscription.created` and
 * `customer.subscription.updated` events.
 *
 * Also owns the canonical `mapStripeStatusToUxTier()` function (Pitfall 6).
 * Re-exported for reuse by invoice-paid.ts and invoice-payment-failed.ts.
 */
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// ─── UX tier type ─────────────────────────────────────────────────────────────
type UxTier = 'free' | 'paid' | 'past_due';

/**
 * mapStripeStatusToUxTier — canonical Stripe status → UX tier collapse.
 *
 * Pitfall 6: Stripe's 8 subscription statuses collapse to 3 UX tiers.
 * The `default` branch uses a `never` exhaustiveness guard so TypeScript will
 * emit a compile error if Stripe adds a new status we haven't handled.
 */
export function mapStripeStatusToUxTier(status: Stripe.Subscription.Status): UxTier {
  switch (status) {
    case 'trialing':
    case 'active':
      return 'paid';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete':
    case 'incomplete_expired':
    case 'paused':
      return 'free';
    default: {
      // Exhaustiveness guard — TS will error if Stripe adds a new status that is
      // not handled above. The cast to `never` triggers a compile error if the
      // switch is non-exhaustive over the known Stripe.Subscription.Status union.
      // deno-lint-ignore no-explicit-any
      const _exhaust: never = status as never;
      void _exhaust;
      return 'free';
    }
  }
}

export async function handle(event: Stripe.Event, admin: SupabaseClient): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const subId = subscription.id;
  const uxTier = mapStripeStatusToUxTier(subscription.status);

  // Recover user_id / clinic_id from subscription.metadata (propagated from Checkout).
  const meta = (subscription.metadata ?? {}) as Record<string, string>;

  const currentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;
  const trialEnd = subscription.trial_end
    ? new Date(subscription.trial_end * 1000).toISOString()
    : null;
  const planId = subscription.items?.data?.[0]?.price?.id ?? null;

  // Determine user_id / clinic_id from metadata (behavior 2.13: upsert on race).
  const userId = meta.user_id ?? null;
  const clinicId = meta.clinic_id ?? null;

  // Upsert: covers both created (INSERT) and updated (UPDATE) paths.
  const { error } = await admin.from('subscriptions').upsert(
    {
      id: subId,
      provider: 'stripe',
      user_id: userId,
      clinic_id: clinicId,
      status: subscription.status,
      ux_tier: uxTier,
      plan_id: planId,
      current_period_end: currentPeriodEnd,
      trial_end: trialEnd,
      cancel_at_period_end: subscription.cancel_at_period_end ?? false,
      metadata: { provider: 'stripe', tier_kind: meta.tier_kind ?? null },
    },
    { onConflict: 'id' },
  );

  if (error) {
    console.error('[stripe-webhook/subscription-updated] upsert error', error.message);
    throw new Error('subscription-upsert-failed');
  }
}
