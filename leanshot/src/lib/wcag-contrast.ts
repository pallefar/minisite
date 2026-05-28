/**
 * Phase 31 Plan 31-05 — wcag-contrast.ts
 *
 * TypeScript port of the SQL `public._compute_wcag_contrast` helper
 * from supabase/migrations/20270601400003_p31_02_branding_expand_and_wcag.sql.
 *
 * Uses the same L^2.2 luminance approximation for WCAG AA contrast gate.
 * Parity vitest asserts ≤0.05 absolute tolerance vs pre-computed SQL values
 * across 6+ sample pairs (src/lib/__tests__/wcag-contrast.test.ts).
 *
 * Both functions are PURE — no side effects, no DOM access — safe in vitest
 * without jsdom.
 */

// ---------------------------------------------------------------------------
// parseOklch
// ---------------------------------------------------------------------------

/**
 * Parse an oklch() color string into its L, C, H channels.
 *
 * Accepts:
 *   - oklch(0.65 0.18 240)
 *   - oklch(65% 0.18 240)
 *   - oklch(0.65 0.18 240 / 1)
 *
 * Returns null for any non-oklch input (rgb(), hex, hsl(), named colors, etc.)
 *
 * Regex aligns with the SQL `_is_valid_oklch` pattern (31-02 migration):
 *   `^oklch\s*\(\s*(\d+\.?\d*%?)\s+(\d*\.?\d+)\s+(\d+\.?\d*)\s*(\/\s*[\d.]+%?)?\s*\)$`
 *
 * Returns { L: 0–1, C: 0–N, H: 0–360 } (L normalised from % if needed).
 */
export function parseOklch(s: string): { L: number; C: number; H: number } | null {
  // Tight regex matching both `oklch(L C H)` and `oklch(L C H / A)` forms.
  const match = s
    .trim()
    .match(/^oklch\s*\(\s*(\d+\.?\d*%?)\s+(\d*\.?\d+)\s+(\d+\.?\d*)\s*(?:\/\s*[\d.]+%?)?\s*\)$/);

  if (!match) return null;

  const rawL = match[1];
  const rawC = match[2];
  const rawH = match[3];

  if (rawL === undefined || rawC === undefined || rawH === undefined) return null;

  // Normalise L: percentage notation (e.g. "54.3%") → 0.543
  let L: number;
  if (rawL.endsWith('%')) {
    L = parseFloat(rawL.slice(0, -1)) / 100;
  } else {
    L = parseFloat(rawL);
  }

  const C = parseFloat(rawC);
  const H = parseFloat(rawH);

  if (isNaN(L) || isNaN(C) || isNaN(H)) return null;

  return { L, C, H };
}

// ---------------------------------------------------------------------------
// computeWcagContrast
// ---------------------------------------------------------------------------

/**
 * Compute the WCAG contrast ratio between two oklch() color strings.
 *
 * Mirrors the SQL `public._compute_wcag_contrast(c1, c2)` exactly:
 *   1. Extract L channel from oklch string
 *   2. Normalise % notation
 *   3. Clamp L to [0, 1]
 *   4. Approximate sRGB relative luminance via L^2.2  ← [ASSUMED/MEDIUM confidence]
 *   5. WCAG ratio: (lighter + 0.05) / (darker + 0.05)
 *   6. Round to 4 decimal places internally; return rounded to 2 decimals
 *
 * Returns 0.0 when either input fails the oklch parse (defensive — never throws).
 * Returns a number in [1.0, 21.0] for valid inputs.
 *
 * @param oklchA - First oklch() color string
 * @param oklchB - Second oklch() color string
 * @returns Contrast ratio (rounded to 2 decimal places)
 */
export function computeWcagContrast(oklchA: string, oklchB: string): number {
  const a = parseOklch(oklchA);
  const b = parseOklch(oklchB);

  // Bail out with 0.0 when either input is not valid oklch.
  if (a === null || b === null) return 0.0;

  // Clamp L to [0, 1]
  const l1 = Math.max(0, Math.min(1, a.L));
  const l2 = Math.max(0, Math.min(1, b.L));

  // [ASSUMED/MEDIUM confidence] L^2.2 luminance approximation.
  // oklch L is perceptual (0–1); raising to 2.2 approximates sRGB gamma expansion.
  const lum1 = Math.pow(l1, 2.2);
  const lum2 = Math.pow(l2, 2.2);

  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);

  // WCAG contrast ratio: (L_lighter + 0.05) / (L_darker + 0.05)
  // Round to 4 decimal places (matches SQL `round(..., 4)`), then return 2dp.
  const ratio = (lighter + 0.05) / (darker + 0.05);
  const ratio4 = Math.round(ratio * 10000) / 10000;
  return Math.round(ratio4 * 100) / 100;
}
