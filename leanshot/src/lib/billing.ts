/**
 * Phase 14 Plan 14-05 — Billing helpers: status collapse, feature registry, cache.
 *
 * Module-level helpers — module-level Map pattern follows clinic-permissions.ts:25-37
 * ahead of Phase 16 multi-provider cache.
 *
 * Three responsibilities:
 *   1. `getActiveTier()` — collapse Stripe's 8 subscription statuses to the 3 UX
 *      tiers per RESEARCH Pitfall 6. This is the canonical source of truth; the
 *      webhook handler (14-03 subscription-updated.ts) uses the same collapse logic
 *      on the server side (mapStripeStatusToUxTier). Both must stay aligned.
 *   2. `TIER_GATE_REGISTRY` — maps every `FeatureKey` to its default TierGateMode
 *      per CONTEXT D-05 (blur-upsell default), D-06 (ad-free primitive),
 *      D-07 (advanced-ai hard-block-cta).
 *   3. `clearTierCache()` — no-op in v1.2 (the Zustand store IS the cache).
 *      Exists so `useStore.signOut` can wire it AND Phase 16 can add a
 *      multi-provider in-memory cache without re-plumbing. See Phase 16 future
 *      extension note below.
 *
 * Registered features:
 *   'pharma-forecast' — 7-day pharmacology forecast overlay (MedLevelChart). blur-upsell.
 *   'advanced-ai'     — AI model selector (AIChatPanel). hard-block-cta.
 *   'ad-free'         — Ad-free experience primitive. hard-block-no-ui. Phase 20 consumer.
 */
import type { Tier } from '@/types';

// ─── Feature registry ────────────────────────────────────────────────────────

export type FeatureKey = 'pharma-forecast' | 'advanced-ai' | 'ad-free';
export type TierGateMode = 'blur-upsell' | 'hard-block-no-ui' | 'hard-block-cta';

/**
 * Default TierGateMode for each feature key.
 *
 * Pattern I: every key in this registry MUST have ≥1 non-test <TierGate feature="…">
 * consumer in src/, with ONE documented exception:
 *   'ad-free' — primitive registered; consumer ships in Phase 20 (AdMob/AdSense rollout).
 *               The grep gate in 14-05 verify explicitly skips 'ad-free'.
 *
 * CONTEXT references:
 *   D-05: blur-upsell is the default mode for web-tier paywalls.
 *   D-06: ad-free is primitive-only for now; Phase 20 wires the consumer.
 *   D-07: advanced-ai uses hard-block-cta so free users see an Upgrade CTA in
 *         the AI panel header rather than blurred content (which would be confusing
 *         for a dropdown selector).
 */
export const TIER_GATE_REGISTRY: Record<FeatureKey, TierGateMode> = Object.freeze({
  'pharma-forecast': 'blur-upsell',
  'advanced-ai': 'hard-block-cta',
  // Phase 20 consumer — registered here so the primitive is available for
  // Phase 20's AdMob/AdSense integration without re-plumbing billing.ts.
  'ad-free': 'hard-block-no-ui',
});

// ─── Status collapse ─────────────────────────────────────────────────────────

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

/**
 * Collapse Stripe subscription state (status + current_period_end) into the
 * 3-state UX tier per RESEARCH Pitfall 6.
 *
 * Collapse rules (verbatim from RESEARCH Pitfall 6):
 *   active + trialing               → 'paid'
 *   past_due + unpaid               → 'past_due'
 *   canceled (after period_end)     → 'free'
 *   canceled (before period_end)    → 'paid'  (Stripe keeps access until period_end)
 *   incomplete_expired              → 'free'
 *   incomplete                      → 'free'  (initial 23h payment window)
 *   paused                          → 'free'
 *   null (missing row)              → 'free'
 *
 * The `canceled` special case: Stripe marks a subscription as `canceled` at the
 * moment the user requests cancellation, but access continues until
 * `current_period_end`. This function checks whether the period has elapsed to
 * return the correct UX tier. The webhook (14-03) mirrors this logic.
 *
 * @param stripeStatus  one of Stripe's 8 statuses or null if no subscription row
 * @param currentPeriodEnd  ISO timestamp from Stripe subscription (or null)
 * @param now  injected for deterministic testing (use `new Date()` in production)
 */
export function getActiveTier(
  stripeStatus: StripeStatus,
  currentPeriodEnd: string | null,
  now: Date,
): Tier {
  if (stripeStatus === null) return 'free';

  switch (stripeStatus) {
    case 'active':
    case 'trialing':
      return 'paid';

    case 'past_due':
    case 'unpaid':
      return 'past_due';

    case 'canceled': {
      // Stripe convention: access continues until current_period_end after cancel.
      // If period_end is in the future → still 'paid'; elapsed → 'free'.
      if (currentPeriodEnd && new Date(currentPeriodEnd) > now) {
        return 'paid';
      }
      return 'free';
    }

    case 'incomplete':
    case 'incomplete_expired':
    case 'paused':
      return 'free';

    default:
      // TypeScript exhaustiveness guard — should never reach here unless Stripe
      // adds a new status. Fall back to 'free' (safest default for a paywall).
      return 'free';
  }
}

// ─── Cache reset ─────────────────────────────────────────────────────────────

/**
 * Reset the module-level billing tier cache. No-op in v1.2.
 *
 * In v1.2 the Zustand store IS the cache (`tier`, `current_period_end`,
 * `plan_id`, `provider` are all in the persist partialize block). This
 * function exists so:
 *   1. `useStore.signOut` can call it via dynamic import (matching the Phase 9
 *      `clearPermissionCache()` pattern) without coupling the store's static
 *      import graph to billing.ts.
 *   2. Phase 16 can introduce a multi-provider in-memory Map (e.g. to cache
 *      RevenueCat entitlement queries) by replacing this body with
 *      `billingCache.clear()` without changing any call-site.
 *
 * Idempotent: calling it multiple times does not throw.
 */
export function clearTierCache(): void {
  // No-op for v1.2. Phase 16 extension: replace with `billingCache.clear()`.
}
