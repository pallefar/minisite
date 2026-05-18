/**
 * Phase 26 Plan 01 — Affiliate tier source-of-truth.
 *
 * D-01: commission-rate table. These constants are the single source of truth
 * for the entire Phase 26 affiliate tier system. Two sites consume them:
 *
 *   1. The Postgres BEFORE INSERT trigger in
 *      supabase/migrations/20270701000003_affiliate_tier_stamp_trigger.sql
 *      hard-codes 25.00 (= lifetime * 100) into NEW.recurring_commission_pct_basis.
 *
 *   2. The client UI (PartnerTierEarningsBreakdown.tsx — Plan 26-03) and the
 *      lifetime-recurring cron Edge Function (Plan 26-06) both read
 *      TIER_COMMISSION_PCT to compute / display commission amounts.
 *
 * Plan-checker BLOCKER: any drift between the SQL CASE arms and
 * TIER_COMMISSION_PCT here is a hard fail. The single grep gate is:
 *   `grep -E '0\.20.*0\.30.*0\.25' supabase/migrations/20270701000003_*.sql`
 *
 * D-02: TIER_VOLUME_THRESHOLD = 10 matches the AFTER INSERT promotion trigger
 * in supabase/migrations/20270701000004_affiliate_promotion_trigger.sql
 * (`if v_count < 10 then return NEW; end if;`).
 *
 * D-03: canDowngrade is a pure type-level NO. Tier ratchets up only — fraud
 * freeze (frozen_at column, D-04) is the only retraction path and is handled
 * separately by admin RPCs.
 */

export const TIER_COMMISSION_PCT = {
  standard: 0.2,
  gold: 0.3,
  lifetime: 0.25,
} as const;

export const TIER_VOLUME_THRESHOLD = 10 as const;

export type AffiliateTier = keyof typeof TIER_COMMISSION_PCT;

/**
 * D-03 ratchet — pure type-level NO. Volume-driven downgrades are never
 * permitted. The only way an affiliate loses tier benefits is fraud-freeze
 * (D-04), which is a separate dimension (frozen_at column) and does NOT
 * mutate the tier field.
 *
 * Underscored parameters are intentional — the function is documentation
 * for the invariant; its body returns `false` unconditionally.
 */
export function canDowngrade(_from: AffiliateTier, _to: AffiliateTier): false {
  return false;
}
