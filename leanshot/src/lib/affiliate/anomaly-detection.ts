/**
 * anomaly-detection.ts — Pure-fn Z-score detector for Phase 26 Plan 26-02
 * AFFTIER-05 ratio anomaly layer.
 *
 * Shared by:
 *   - supabase/functions/affiliate-attribute (ratio detector — extends v1.2 AFF-08)
 *   - supabase/functions/stripe-webhook/events/invoice-paid (flag-on-conversion)
 *   - leanshot/src/components/admin/* (anomaly-review UI, Plan 26-05)
 *
 * D-09 threshold: |z| > 3 fires flag-without-blocking-payment ("default-trust").
 * D-10:           extends v1.2 raw-count detector; both detectors stay live.
 * Pitfall 4:      cold-start (stddev <= 0 OR any non-finite input) → null;
 *                 caller MUST treat null as "skip" not "0".
 *
 * Why pure: this module ships into the browser bundle AND a Deno Edge runtime.
 * Zero deps. No Math.* assumptions beyond ES2020 (Number.isFinite is standard).
 */

/**
 * Threshold for the Z-score anomaly flag. Locked to 3σ per D-09 — admin-review
 * tab (Plan 26-05) reads this same constant so the UI cutoff and the detection
 * cutoff can never drift.
 */
export const ANOMALY_Z_THRESHOLD = 3;

/**
 * Compute z-score = (observation - mean) / stddev with cold-start guard.
 *
 * Returns `null` when:
 *   - any input is non-finite (NaN, ±Infinity)
 *   - stddev <= 0 (cold-start or degenerate baseline)
 *
 * Defensive note: stddev_samp from Postgres can never go negative, but we
 * still guard against it because the same fn runs in JS land where the
 * "stddev" arg can come from anywhere (admin re-compute UI, test fixtures).
 */
export function computeZScore(observation: number, mean: number, stddev: number): number | null {
  if (!Number.isFinite(observation)) return null;
  if (!Number.isFinite(mean)) return null;
  if (!Number.isFinite(stddev)) return null;
  if (stddev <= 0) return null;
  return (observation - mean) / stddev;
}

/**
 * Predicate — should a z-score be flagged as an anomaly?
 *
 * True iff `Math.abs(z) > ANOMALY_Z_THRESHOLD` AND `z` is finite.
 * Null / NaN / ±Infinity always return false (cold-start = don't flag,
 * per D-09 default-trust).
 */
export function isAnomalyFlagged(z: number | null): boolean {
  if (z === null) return false;
  if (!Number.isFinite(z)) return false;
  return Math.abs(z) > ANOMALY_Z_THRESHOLD;
}
