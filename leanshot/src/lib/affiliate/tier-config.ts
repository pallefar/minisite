/**
 * Phase 26 — Multi-tier affiliate tier configuration single source of truth.
 *
 * Plan 26-01 OWNS this file. Plan 26-03 (executing in parallel as Wave 1)
 * scaffolds the MINIMUM surface here so its UI + tests can compile/run before
 * 26-01 merges. When 26-01 lands first, the merge resolves cleanly because
 * 26-01 produces a superset: same TIER_COMMISSION_PCT + TIER_VOLUME_THRESHOLD
 * + AffiliateTier shape, plus a canDowngrade() ratchet helper that 26-03
 * does not consume.
 *
 * Plan-checker grep gate: values here MUST match the CASE arms in
 *   supabase/migrations/20270701000003_affiliate_tier_stamp_trigger.sql
 * (authored by Plan 26-01). 0.20 / 0.30 / 0.25 are the locked rates.
 *
 * Spec source: 26-CONTEXT.md D-01 (commission rates) + D-02 (volume threshold).
 */

// D-01 single source of truth — commission percent per tier.
export const TIER_COMMISSION_PCT = {
  standard: 0.2,
  gold: 0.3,
  lifetime: 0.25,
} as const;

// D-02 Standard -> Gold auto-promotion threshold (paid/confirmed conversions).
export const TIER_VOLUME_THRESHOLD = 10 as const;

export type AffiliateTier = keyof typeof TIER_COMMISSION_PCT;

/**
 * D-03 ratchet invariant — once promoted, a tier is sticky. Volume-downgrade
 * is NEVER permitted; only fraud-freeze (D-04 — frozen_at + freeze_reason on
 * the affiliates row) can suspend the partner. Plan 26-01 owns the unit-level
 * proof (tier-ratchet.test.ts).
 */
export function canDowngrade(_from: AffiliateTier, _to: AffiliateTier): false {
  return false;
}
