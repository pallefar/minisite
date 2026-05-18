/**
 * Phase 26 — Shared TS domain types for the multi-tier affiliate program.
 *
 * Plan 26-01 OWNS this file (it ships the full type set: AdjustmentEntry,
 * FraudSignalPayload variants, TierProgress, TierEarningsBreakdown). Plan
 * 26-03 (executing in parallel as Wave 1) scaffolds the MINIMUM subset
 * required by its UI components (`TierProgress` + `TierEarningsBreakdown`)
 * so the partner-dashboard surface can compile + render before 26-01 merges.
 *
 * When 26-01 lands first, the merge resolves cleanly because 26-01 produces
 * a superset; the two type definitions below are identical in shape to
 * 26-01's spec at the phase-26 PLAN file (lines 460-473).
 */

import type { AffiliateTier } from './tier-config';

/**
 * AFFTIER-03 — Partner dashboard tier progress payload.
 * Returned by `getTierProgress(affiliateId, client)` in src/lib/affiliate/api.ts.
 *
 * - `nextTierThreshold` is `TIER_VOLUME_THRESHOLD` (10) when on Standard,
 *   `null` for Gold / Lifetime (no further auto-promotion path).
 * - `frozenAt` + `freezeReason` populated when the affiliates row was frozen
 *   by the fraud-signal pipeline (D-04). Components render a grey-out
 *   overlay + banner per RESEARCH Open Question #4.
 */
export interface TierProgress {
  currentTier: AffiliateTier;
  paidConversionCount: number;
  nextTierThreshold: number | null;
  frozenAt: string | null;
  freezeReason: string | null;
}

/**
 * AFFTIER-03 — Per-tier earnings breakdown payload.
 * Returned by `getTierEarningsBreakdown(affiliateId, client)`. Sums
 * `commission_cents` grouped by `tier_at_conversion_time` (stamped at
 * INSERT by Plan 26-01's trigger migration 20270701000003).
 */
export interface TierEarningsBreakdown {
  asStandardCents: number;
  asGoldCents: number;
  asLifetimeCents: number;
  totalCents: number;
}
