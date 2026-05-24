/**
 * Phase 39 Plan 39-03 — Deno tests for `_shared/bayes-posterior.ts`.
 *
 * Test plan (3 behaviors from 39-03-PLAN.md Task 1 <behavior>):
 *   T1 — Identical rates (1000 trials each, same successes/failures) → posterior ~0.5 ±0.05
 *   T2 — Variant 2× control rate with N=200 → posterior > 0.95
 *   T3 — Zero successes both arms → uniform prior → ~0.5 ±0.05
 *
 * Determinism: tests run a real Math.random sequence with samples=2000
 * (smaller than default 20_000 for fast test runs) and ±0.05 tolerance
 * which is well within the convergence band for Monte Carlo at that N.
 *
 * Per [[reference_deno_test_top_level_serve_trap]]: import handler only;
 * module under test is pure math with no Deno.serve side effect — safe.
 */
import { assert } from 'jsr:@std/assert@^1';
import { posteriorProbVariantWins } from './bayes-posterior.ts';

// ---------------------------------------------------------------------------
// T1 — Identical rates → posterior ~0.5
// ---------------------------------------------------------------------------

Deno.test('T1: identical control + variant rates → posterior ≈ 0.5 ±0.05', () => {
  // Both arms: 500 successes / 500 failures = 50% conversion rate.
  const p = posteriorProbVariantWins(500, 500, 500, 500, 2000);
  assert(
    p >= 0.45 && p <= 0.55,
    `expected posterior near 0.5; got ${p}`,
  );
});

// ---------------------------------------------------------------------------
// T2 — Variant 2× control rate, N=200 → posterior > 0.95
// ---------------------------------------------------------------------------

Deno.test('T2: variant 2× control rate, N=200 → posterior > 0.95', () => {
  // CONTROL: 20 successes / 180 failures = 10% conversion
  // VARIANT: 40 successes / 160 failures = 20% conversion (2× control)
  const p = posteriorProbVariantWins(20, 180, 40, 160, 5000);
  assert(p > 0.95, `expected posterior > 0.95 for 2× lift at N=200; got ${p}`);
});

// ---------------------------------------------------------------------------
// T3 — Zero successes both arms → uniform prior → ~0.5
// ---------------------------------------------------------------------------

Deno.test('T3: zero successes both arms → uniform prior → ≈ 0.5 ±0.05', () => {
  // Both arms: 0 successes / 0 failures = no evidence; Beta(1,1) uniform prior dominates.
  const p = posteriorProbVariantWins(0, 0, 0, 0, 2000);
  assert(
    p >= 0.45 && p <= 0.55,
    `expected posterior near 0.5 (uniform prior); got ${p}`,
  );
});
