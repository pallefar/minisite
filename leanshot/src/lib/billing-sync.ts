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
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import type { SubscriptionProvider, Tier } from '@/types';

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
  // M1/M2: read the canonical `tier_effective` view (grouped per user → exactly ≤1
  // row; unifies Stripe + RevenueCat + Lifetime via has_active). This replaces the
  // prior direct `subscriptions.maybeSingle()` which:
  //   M1 — errored (PGRST116) for a cross-provider user with >1 subscriptions row,
  //        leaving the persisted store tier stale.
  //   M2 — resolved a Lifetime purchaser (lifetime_purchases row, NO subscriptions
  //        row) to 'free', wrongly blocking Pro features behind TierGate.
  const { data: te, error: teError } = await supabase
    .from('tier_effective')
    .select('has_active, has_past_due, effective_period_end, winning_provider')
    .eq('user_id', userId)
    .maybeSingle();

  if (teError) {
    console.error('[billing-sync] tier_effective query failed', teError.message);
    return; // Leave existing persisted tier untouched (best available guess).
  }

  // Collapse to the 3-state UX tier. 'paid' (active access — includes trial +
  // lifetime via has_active) wins over 'past_due'; a missing row (no sub, no
  // lifetime) → 'free' (safest paywall default).
  const tier: Tier = te?.has_active ? 'paid' : te?.has_past_due ? 'past_due' : 'free';

  // plan_id + pause state are subscription-specific and NOT exposed by the view —
  // read them from the subscriptions row separately, tolerating >1 row (a
  // cross-provider user) by taking the latest-ending one via order+limit(1) so
  // this read can never trip PGRST116 (the M1 crash).
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('plan_id, is_paused, paused_until')
    .eq('user_id', userId)
    .order('current_period_end', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  useStore.getState().setTier({
    tier,
    current_period_end: (te?.effective_period_end as string | null) ?? null,
    plan_id: (sub?.plan_id as string | null) ?? null,
    provider: (te?.winning_provider as SubscriptionProvider) ?? null,
  });

  // Phase 40 Plan 40-07 D-07 — pause state hydration.
  // Defensive defaults: if columns are absent (staging env, pre-40-02 migration) or
  // there is no subscriptions row (lifetime-only / never-subscribed), default to
  // is_paused=false so the pause banner never renders spuriously.
  useStore
    .getState()
    .setPauseState(
      Boolean((sub as { is_paused?: boolean } | null)?.is_paused ?? false),
      ((sub as { paused_until?: string | null } | null)?.paused_until as string | null) ?? null,
    );
}
