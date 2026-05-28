/**
 * anomaly-detection.test.ts — Pure-fn coverage for Phase 26 Plan 26-02
 * AFFTIER-05 ratio Z-score anomaly detector.
 *
 * Contract under test:
 *   - computeZScore(observation, mean, stddev): returns numeric z-score or null
 *     (null on stddev <= 0 cold-start OR any non-finite input).
 *   - isAnomalyFlagged(z): returns true iff Math.abs(z) > 3 AND z is finite.
 *     Null / NaN / Infinity all return false.
 *
 * D-09 threshold lives in ANOMALY_Z_THRESHOLD (=3). Single source of truth
 * shared by client UI (admin review tab) AND Edge Fn (affiliate-attribute).
 */

import { describe, it, expect } from 'vitest';
import { ANOMALY_Z_THRESHOLD, computeZScore, isAnomalyFlagged } from '../anomaly-detection';

describe('ANOMALY_Z_THRESHOLD', () => {
  it('is 3 (D-09 lock — admin-review tab + Edge Fn must read this same const)', () => {
    expect(ANOMALY_Z_THRESHOLD).toBe(3);
  });
});

describe('computeZScore', () => {
  it('produces correct z-score for normal inputs', () => {
    expect(computeZScore(10, 5, 2)).toBe(2.5);
    expect(computeZScore(0, 5, 2)).toBe(-2.5);
    expect(computeZScore(5, 5, 2)).toBe(0);
  });

  it('returns null on cold-start (stddev=0)', () => {
    expect(computeZScore(10, 5, 0)).toBeNull();
  });

  it('returns null on negative stddev (defensive — stddev_samp can never go negative but be safe)', () => {
    expect(computeZScore(10, 5, -1)).toBeNull();
  });

  it('returns null on NaN inputs', () => {
    expect(computeZScore(NaN, 5, 2)).toBeNull();
    expect(computeZScore(10, NaN, 2)).toBeNull();
    expect(computeZScore(10, 5, NaN)).toBeNull();
  });

  it('returns null on Infinity inputs', () => {
    expect(computeZScore(Infinity, 5, 2)).toBeNull();
    expect(computeZScore(10, Infinity, 2)).toBeNull();
    expect(computeZScore(10, 5, Infinity)).toBeNull();
    expect(computeZScore(-Infinity, 5, 2)).toBeNull();
  });
});

describe('isAnomalyFlagged', () => {
  it('flags |z| > 3', () => {
    expect(isAnomalyFlagged(3.1)).toBe(true);
    expect(isAnomalyFlagged(-3.5)).toBe(true);
    expect(isAnomalyFlagged(10)).toBe(true);
    expect(isAnomalyFlagged(-100)).toBe(true);
  });

  it('does NOT flag |z| <= 3 (boundary inclusive on safe side)', () => {
    expect(isAnomalyFlagged(3.0)).toBe(false);
    expect(isAnomalyFlagged(-3.0)).toBe(false);
    expect(isAnomalyFlagged(0)).toBe(false);
    expect(isAnomalyFlagged(2.99)).toBe(false);
  });

  it('does NOT flag null / non-finite', () => {
    expect(isAnomalyFlagged(null)).toBe(false);
    expect(isAnomalyFlagged(NaN)).toBe(false);
    expect(isAnomalyFlagged(Infinity)).toBe(false);
    expect(isAnomalyFlagged(-Infinity)).toBe(false);
  });
});
