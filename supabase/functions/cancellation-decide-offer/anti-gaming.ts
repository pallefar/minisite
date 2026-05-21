/**
 * Phase 40 Plan 40-03 — anti-gaming guards for cancellation save-offers.
 *
 * Implements:
 *   D-02: 2-lifetime non-pause take cap
 *   D-03: 12-month cooldown between non-pause takes
 *   D-01: tenure-based offer gating
 *   D-15: stacking abuse clamp (35% combined effective cap)
 *
 * clampSavePct math per RESEARCH lines 591-611 verbatim.
 * All functions are pure — no DB/Stripe I/O. Tested in anti-gaming.test.ts.
 */

import type { OfferType, TenureBucket } from '../_shared/cancellation-types.ts';

// Re-export constants from shared types for consumers that import from here
export const STACKING_CAP_EFFECTIVE = 0.35;
export const COOLDOWN_DAYS = 365;
export const LIFETIME_CAP_NON_PAUSE = 2;

// ─── D-15: stacking clamp ────────────────────────────────────────────────────
/**
 * Given an existing combined discount percentage (e.g., 0.10 for 10% affiliate)
 * and the proposed save-offer percentage (e.g., 0.30 for 30%), compute the
 * effective combined discount and clamp to STACKING_CAP_EFFECTIVE (0.35).
 *
 * Math (multiplicative stacking): effective = 1 - (1 - existingPct) * (1 - savePct)
 * If effective > cap, solve for savePct that brings it to exactly cap:
 *   finalSavePct = max(0, 1 - (1 - STACKING_CAP_EFFECTIVE) / (1 - existingPct))
 *
 * Per RESEARCH lines 591-611 verbatim.
 * Applies ONLY to offer_type='discount' — extended_trial/pause/downgrade are exempt (Open Q5).
 */
export function clampSavePct(
  existingPct: number,
  savePct: number,
): {
  finalSavePct: number;
  clamped: boolean;
  preClampEffective: number;
  postClampEffective: number;
} {
  const preEffective = 1 - (1 - existingPct) * (1 - savePct);
  if (preEffective <= STACKING_CAP_EFFECTIVE) {
    return {
      finalSavePct: savePct,
      clamped: false,
      preClampEffective: preEffective,
      postClampEffective: preEffective,
    };
  }
  const finalSavePct = Math.max(0, 1 - (1 - STACKING_CAP_EFFECTIVE) / (1 - existingPct));
  return {
    finalSavePct,
    clamped: true,
    preClampEffective: preEffective,
    postClampEffective: STACKING_CAP_EFFECTIVE,
  };
}

// ─── D-02: lifetime cap check ────────────────────────────────────────────────
/**
 * Check if a user has exhausted their 2 lifetime non-pause save-offer takes.
 * Pause takes (offer_type='pause') do NOT count toward the cap per D-02.
 * extended_trial, discount, downgrade each count.
 */
export function checkLifetimeCap(
  priorTakes: Array<{ offer_type: OfferType }>,
): { exceeded: boolean; nonPauseCount: number } {
  const nonPauseCount = priorTakes.filter((t) => t.offer_type !== 'pause').length;
  return { exceeded: nonPauseCount >= LIFETIME_CAP_NON_PAUSE, nonPauseCount };
}

// ─── D-03: cooldown check ────────────────────────────────────────────────────
/**
 * Check if the user is within the 12-month cooldown window.
 * Cooldown applies to non-pause takes only. Looks at the most recent non-pause
 * taken_at timestamp. On cooldown if within COOLDOWN_DAYS days.
 *
 * Initial pause does NOT trigger cooldown; pause extensions (D-10) DO.
 * The D-10 extension flag is handled at the accept-offer layer by counting
 * extensions as non-pause for cooldown purposes.
 */
export function checkCooldown(
  priorTakes: Array<{ taken_at: string; offer_type: OfferType }>,
): { onCooldown: boolean; lastTakenAt: string | null } {
  const nonPauseTakes = priorTakes.filter((t) => t.offer_type !== 'pause');
  if (nonPauseTakes.length === 0) {
    return { onCooldown: false, lastTakenAt: null };
  }
  // Sort descending to find most recent
  const sorted = [...nonPauseTakes].sort(
    (a, b) => new Date(b.taken_at).getTime() - new Date(a.taken_at).getTime(),
  );
  const lastTakenAt = sorted[0]!.taken_at;
  const lastTakenDate = new Date(lastTakenAt);
  const cooldownEndDate = new Date(lastTakenDate);
  cooldownEndDate.setDate(cooldownEndDate.getDate() + COOLDOWN_DAYS);
  const onCooldown = new Date() < cooldownEndDate;
  return { onCooldown, lastTakenAt };
}

// ─── D-01: tenure gate ───────────────────────────────────────────────────────
/**
 * Returns true if the offer type is eligible for the given tenure bucket.
 *
 * D-01 rules:
 *   <30d:    pause + discount only
 *   30-180d: all 4 offer types
 *   >180d:   pause + discount + downgrade (NO extended_trial)
 *
 * Applies server-side as defense-in-depth; save_offer_rules table also
 * encodes tenure_buckets per rule but this gate runs after rule lookup
 * as a final eligibility assertion.
 */
export function applyTenureGate(tenureBucket: TenureBucket, offerType: OfferType): boolean {
  if (offerType === 'contact_csm') {
    // contact_csm is always eligible (D-04 clinic fork, not tenure-gated)
    return true;
  }
  switch (tenureBucket) {
    case '<30d':
      return offerType === 'pause' || offerType === 'discount';
    case '30-180d':
      return true; // all 4 offer types eligible
    case '>180d':
      // No extended_trial for long-tenure paying users
      return offerType !== 'extended_trial';
    default:
      return false;
  }
}
