/**
 * subscription-updated.ts — Handler for `customer.subscription.created` and
 * `customer.subscription.updated` events.
 *
 * Also owns the canonical `mapStripeStatusToUxTier()` function (Pitfall 6).
 * Re-exported for reuse by invoice-paid.ts and invoice-payment-failed.ts.
 *
 * Phase 29 Plan 03 — D-05: HMAC realtime broadcast on org-{hmac8}-subscriptions.
 * When subscription.metadata.clinic_id is present, broadcasts `subscription_updated`
 * on the Phase 28 HMAC channel so clinic admin billing UI reflects within 30s (SC#4).
 * Broadcast failure is caught + Sentry-logged; never re-thrown (Stripe retry safety).
 */
import type Stripe from 'https://esm.sh/stripe@19?target=denonext';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import * as Sentry from '../../_shared/sentry.ts';
import { channelNameFor } from '../../_shared/realtime.ts';

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

/**
 * D-05 test spy interface — allows tests to inject a mock `channelSend` function
 * without mutating the frozen ESM namespace.
 *
 * @internal — only used by subscription-updated.test.ts
 */
export interface D05Spy {
  /** Called with the computed channel name and payload. */
  channelSend: (channelName: string, payload: Record<string, unknown>) => Promise<void>;
}

export async function handle(
  event: Stripe.Event,
  admin: SupabaseClient,
  _d05Spy?: D05Spy,
): Promise<void> {
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

  // ─── Phase 29 D-05: HMAC realtime broadcast ──────────────────────────────
  //
  // When this is a clinic subscription (clinic_id present in metadata), broadcast
  // `subscription_updated` on the Phase 28 HMAC channel so clinic admin billing
  // surfaces reflect within 30s (SC#4 SLA). Failure is caught and Sentry-logged;
  // NEVER re-thrown (a 500 would trigger Stripe retries amplifying the failure).

  if (!clinicId) {
    // Consumer subscription — no realtime broadcast needed.
    return;
  }

  try {
    const broadcastPayload: Record<string, unknown> = {
      subscription_id: subId,
      status: subscription.status,
      current_period_end: subscription.current_period_end ?? null,
    };

    if (_d05Spy) {
      // Test path: delegate to spy instead of live admin.channel call.
      // The channel name is computed deterministically even in tests.
      const channelName = await channelNameFor(clinicId, 'subscriptions');
      await _d05Spy.channelSend(channelName, broadcastPayload);
    } else {
      // Production path: fetch Vault secret, compute HMAC channel name, broadcast.
      const { data: secretHex, error: rpcErr } = await admin.rpc(
        'get_realtime_channel_keying',
      );
      if (rpcErr || !secretHex) {
        // Vault secret unavailable — log and skip broadcast (non-fatal).
        console.warn(
          '[stripe-webhook/subscription-updated] get_realtime_channel_keying unavailable — skipping D-05 broadcast',
          rpcErr?.message,
        );
        return;
      }
      const channelName = await channelNameFor(clinicId, 'subscriptions', secretHex as string);
      await admin.channel(channelName).send({
        type: 'broadcast',
        event: 'subscription_updated',
        payload: broadcastPayload,
      });
    }
  } catch (err) {
    Sentry.captureException(err, {
      tags: { d05_broadcast: 'failed' },
    });
    // Do NOT re-throw — Stripe retries with exponential backoff would amplify a 500.
  }
}
