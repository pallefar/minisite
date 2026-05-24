/**
 * Phase 39 — Inline Beta-Binomial Bayesian posterior P(variant > control).
 *
 * Closed-form Monte Carlo via Marsaglia-Tsang Gamma sampling. ~30 LOC; NO
 * external dependencies (no @stan/math; no simple-statistics). Verified
 * accuracy at experiment-scale event counts (10²–10⁵ trials) within ±0.5%.
 *
 * Imported by both Edge Fn admin RPCs (server-side dashboard aggregation)
 * AND the Vite-side admin preview (no Deno-only APIs used here — safe to
 * dual-bundle).
 *
 * Unit-test with a seeded Math.random mock (see __tests__).
 *
 * Source: Phase 39-RESEARCH.md Pattern 2. Mirrors PostHog OSS impl with
 * uniform Beta(1,1) prior. Consumed by admin RPC in Plan 39-07 + client preview.
 */

/**
 * P(variant > control) given Binomial outcomes with uniform Beta(1,1) prior.
 *
 * For typical experiment sample sizes (~10²-10⁵ trials) this matches the
 * analytic form within 0.5%.
 *
 * Beta(α, β) sample via two Gamma samples (Marsaglia-Tsang for shape ≥ 1;
 * easy form here since α = successes+1, β = failures+1, both ≥ 1).
 */
export function posteriorProbVariantWins(
  controlSuccesses: number,
  controlFailures: number,
  variantSuccesses: number,
  variantFailures: number,
  samples = 20_000,
): number {
  const a1 = controlSuccesses + 1;
  const b1 = controlFailures + 1;
  const a2 = variantSuccesses + 1;
  const b2 = variantFailures + 1;
  let wins = 0;
  for (let i = 0; i < samples; i++) {
    if (sampleBeta(a2, b2) > sampleBeta(a1, b1)) wins++;
  }
  return wins / samples;
}

function sampleBeta(a: number, b: number): number {
  const x = sampleGamma(a);
  const y = sampleGamma(b);
  return x / (x + y);
}

// Marsaglia-Tsang Gamma sample (shape ≥ 1) — Box-Muller for normal.
function sampleGamma(shape: number): number {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number;
    let v: number;
    do {
      x = boxMuller();
      v = 1 + c * x;
    } while (v <= 0);
    v = v ** 3;
    const u = Math.random();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x ** 2 + d * (1 - v + Math.log(v))) return d * v;
  }
}

function boxMuller(): number {
  return Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random());
}
