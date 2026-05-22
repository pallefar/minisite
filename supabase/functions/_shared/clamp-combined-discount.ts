/**
 * clamp-combined-discount.ts — Phase 43 Plan 04, MEMBER-03 D-06 / D-07.
 *
 * Pure-function multiplicative discount-stack clamp consumed by:
 *   - supabase/functions/stripe-checkout/index.ts (BEFORE sessions.create)
 *   - supabase/functions/cancellation-accept-offer/index.ts (BEFORE applyDiscount)
 *
 * D-06 — Multiplicative stack (NOT additive):
 *   combinedPct = 1 - (1 - promoPct) * (1 - saveOfferPct)
 *
 * D-07 — 70% cap with SAVE-offer preservation:
 *   If combinedPct > 0.70, clip the FIRST argument (promo / lower priority) so
 *   the SAVE-offer (second argument) is preserved at its original value. This
 *   matches the convention "clampCombinedDiscount(clippable, preserved)".
 *
 *   Clip math: solve `0.70 = 1 - (1 - clippedPromo) * (1 - saveOfferPct)` for
 *   clippedPromo →  `clippedPromo = 1 - 0.30 / (1 - saveOfferPct)`.
 *
 * Edge cases:
 *   - `saveOfferPct >= 1` (100% off via SAVE) — division by zero in the clip
 *     formula. Save is already at-or-above the cap, so we return
 *     promo=0, save=saveOfferPct, combined=saveOfferPct, clipped=true.
 *   - Inputs must be finite, 0..1 inclusive. Anything else throws
 *     `Error('clamp:invalid_input')`.
 *   - Floating-point cap check uses an epsilon (1e-9) so `0.70` exactly is
 *     treated as below-cap, not clipped.
 *
 * See: RESEARCH Pitfall 7, PATTERNS §5, plan-checker iter-1 fix W3
 * (first-arg-is-clippable convention).
 */

export interface ClampResult {
  /** Final combined discount percentage 0..1 after any clipping. */
  combinedPct: number;
  /** True if the cap kicked in and the first arg was clipped. */
  clipped: boolean;
  /** Final value of the first arg (clippable / promo). */
  finalPromoPct: number;
  /** Final value of the second arg (preserved / SAVE-offer). */
  finalSavePct: number;
}

const CAP = 0.70;
const EPS = 1e-9;

function isValidPct(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
}

/**
 * Compute the multiplicative combined discount, clipping the FIRST argument
 * if the naive combination exceeds the 70% cap.
 *
 * @param promoPct - Clippable side (lower priority — e.g. existing promo coupon)
 * @param saveOfferPct - Preserved side (higher priority — e.g. accepted SAVE-offer)
 * @throws Error('clamp:invalid_input') if either arg is not finite in [0, 1]
 */
export function clampCombinedDiscount(
  promoPct: number,
  saveOfferPct: number,
): ClampResult {
  if (!isValidPct(promoPct) || !isValidPct(saveOfferPct)) {
    throw new Error('clamp:invalid_input');
  }

  const naive = 1 - (1 - promoPct) * (1 - saveOfferPct);

  // Below or exactly at cap (epsilon-inclusive) → pass-through.
  if (naive <= CAP + EPS) {
    return {
      combinedPct: naive,
      clipped: false,
      finalPromoPct: promoPct,
      finalSavePct: saveOfferPct,
    };
  }

  // Above cap → SAVE-offer preserved, PROMO clipped.
  if (saveOfferPct >= 1) {
    // 100% off via SAVE already exceeds the cap on its own; promo is moot.
    return {
      combinedPct: saveOfferPct,
      clipped: true,
      finalPromoPct: 0,
      finalSavePct: saveOfferPct,
    };
  }

  // clippedPromo = 1 - 0.30 / (1 - saveOfferPct)
  const clippedPromo = 1 - 0.30 / (1 - saveOfferPct);
  return {
    combinedPct: CAP,
    clipped: true,
    finalPromoPct: clippedPromo,
    finalSavePct: saveOfferPct,
  };
}
