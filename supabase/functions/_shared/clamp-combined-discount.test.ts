/**
 * Deno tests for clamp-combined-discount.ts — Phase 43 Plan 04 Task 1.
 *
 * Verifies the multiplicative stack (D-06) and the 70%-cap clip-promo-not-save
 * direction (D-07). Test 4 explicitly covers the save=1.0 division-by-zero
 * edge case (T-43-04-07).
 */

import { assertAlmostEquals, assertEquals, assertThrows } from 'jsr:@std/assert';
import { clampCombinedDiscount } from './clamp-combined-discount.ts';

Deno.test('passthrough when below cap', () => {
  // promo=0.30, save=0.25 → naive = 1 - 0.70*0.75 = 0.475
  const r = clampCombinedDiscount(0.30, 0.25);
  assertAlmostEquals(r.combinedPct, 0.475, 1e-9);
  assertEquals(r.clipped, false);
  assertEquals(r.finalPromoPct, 0.30);
  assertEquals(r.finalSavePct, 0.25);
});

Deno.test('exactly at cap (boundary inclusive)', () => {
  // promo=0.50, save=0.40 → naive = 1 - 0.50*0.60 = 0.70 exactly
  const r = clampCombinedDiscount(0.50, 0.40);
  assertAlmostEquals(r.combinedPct, 0.70, 1e-9);
  assertEquals(r.clipped, false);
  assertEquals(r.finalPromoPct, 0.50);
  assertEquals(r.finalSavePct, 0.40);
});

Deno.test('clips promo when above cap, preserves save', () => {
  // promo=0.50, save=0.50 → naive = 1 - 0.50*0.50 = 0.75 > 0.70
  // Clip promo: clipped = 1 - 0.30/(1 - 0.50) = 1 - 0.60 = 0.40
  // Combined back to 1 - 0.60*0.50 = 0.70 exactly.
  const r = clampCombinedDiscount(0.50, 0.50);
  assertAlmostEquals(r.combinedPct, 0.70, 1e-9);
  assertEquals(r.clipped, true);
  assertEquals(r.finalSavePct, 0.50); // SAVE preserved
  assertAlmostEquals(r.finalPromoPct, 0.40, 1e-9);
});

Deno.test('100% save → promo clipped to 0 (no division by zero)', () => {
  // T-43-04-07: division-by-zero guard.
  const r = clampCombinedDiscount(0.30, 1.0);
  assertEquals(r.clipped, true);
  assertEquals(r.finalSavePct, 1.0);
  assertEquals(r.finalPromoPct, 0);
  assertEquals(r.combinedPct, 1.0);
});

Deno.test('invalid inputs throw', () => {
  assertThrows(() => clampCombinedDiscount(-0.1, 0.5), Error, 'clamp:invalid_input');
  assertThrows(() => clampCombinedDiscount(1.1, 0.5), Error, 'clamp:invalid_input');
  assertThrows(() => clampCombinedDiscount(Number.NaN, 0.5), Error, 'clamp:invalid_input');
  assertThrows(() => clampCombinedDiscount(0.5, -0.01), Error, 'clamp:invalid_input');
  assertThrows(() => clampCombinedDiscount(0.5, Number.POSITIVE_INFINITY), Error, 'clamp:invalid_input');
});

Deno.test('high-priority example from RESEARCH Pitfall 7 (promo=0.50, save=0.30)', () => {
  // naive = 1 - 0.50*0.70 = 0.65 ≤ 0.70 → pass-through.
  const r = clampCombinedDiscount(0.50, 0.30);
  assertAlmostEquals(r.combinedPct, 0.65, 1e-9);
  assertEquals(r.clipped, false);
  assertEquals(r.finalPromoPct, 0.50);
  assertEquals(r.finalSavePct, 0.30);
});
