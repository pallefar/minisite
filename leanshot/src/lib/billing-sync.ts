/**
 * Phase 14 Plan 14-09 — CR-01 gap-closure: the single named DB-to-store connector.
 *
 * This module closes CR-01 (14-VERIFICATION.md). `setTier()` existed in the Zustand
 * store with zero non-test call sites — nothing ever queried the `subscriptions`
 * table and pushed the result into the store. Every real user's `tier` was permanently
 * `'free'` because the DB-to-frontend read half of the billing sync path was never built.
 *
 * This is the SINGLE named DB-to-store connector for Phase 14 billing tier. It owns
 * the runtime link between the webhook-written `subscriptions` table and the Zustand
 * `tier` slice. App.tsx calls `syncBillingTier` from:
 *   1. The INITIAL_SESSION auth handler (on cold load)
 *   2. The SIGNED_IN auth handler (after email-link verify / sign-in)
 *   3. A window-focus listener (so Customer Portal round-trips are reflected
 *      within the CONTEXT D-09 10-second budget)
 *
 * Pattern G: no @stripe/stripe-js import.
 * Selector convention (CLAUDE.md): writes via `useStore.getState().setTier(...)` —
 *   a one-shot write outside render, NOT a subscription. Same pattern as `useToast`.
 */
import { getActiveTier } from '@/lib/billing';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import type { SubscriptionProvider } from '@/types';

/**
 * Sync the current user's billing tier from the `subscriptions` table into the
 * Zustand `tier` slice.
 *
 * Safe to call repeatedly (INITIAL_SESSION, SIGNED_IN, window focus). Never throws —
 * a query error logs via `console.error('[billing-sync] …')` and leaves the existing
 * persisted tier untouched (CONTEXT §6: stale tier offline is acceptable as a
 * best-available-guess). A missing row (no subscription) maps to `tier='free'` —
 * a previously-paid user who fully cancelled drops to free correctly.
 *
 * @param userId  The `auth.users.id` for the currently signed-in user. Must be
 *                non-empty; callers (App.tsx) guard for this via the
 *                `email_confirmed_at && !is_anonymous` check before calling.
 */
export async function syncBillingTier(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('status, current_period_end, plan_id, provider, is_paused, paused_until')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[billing-sync] subscriptions query failed', error.message);
    return; // Leave existing persisted tier untouched (best available guess).
  }

  // Narrow the raw text column to the status union that getActiveTier expects.
  // An unrecognized string falls through getActiveTier's default branch → 'free',
  // which is the safest paywall default.
  type StripeStatus =
    | 'incomplete'
    | 'incomplete_expired'
    | 'trialing'
    | 'active'
    | 'past_due'
    | 'canceled'
    | 'unpaid'
    | 'paused'
    | null;

  const status = (data?.status ?? null) as StripeStatus;

  const tier = getActiveTier(status, data?.current_period_end ?? null, new Date());

  useStore.getState().setTier({
    tier,
    current_period_end: data?.current_period_end ?? null,
    plan_id: data?.plan_id ?? null,
    provider: (data?.provider as SubscriptionProvider) ?? null,
  });

  // Phase 40 Plan 40-07 D-07 — pause state hydration.
  // Defensive defaults: if columns are absent (staging env, pre-40-02 migration),
  // default to is_paused=false so the banner never renders for un-paused users.
  // Error path already returns above — if we reach here, data may still be null
  // (no subscription row), which also maps to is_paused=false.
  useStore.getState().setPauseState(
    Boolean((data as { is_paused?: boolean } | null)?.is_paused ?? false),
    ((data as { paused_until?: string | null } | null)?.paused_until as string | null) ?? null,
  );
}
