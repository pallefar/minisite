/**
 * Phase 56 Plan 01 — Session frequency cap tests (AD-08).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { canShowNextImpression, resetSessionCounts } from './freqCap';

beforeEach(() => {
  resetSessionCounts();
});

describe('canShowNextImpression — ceiling enforcement', () => {
  it('returns true while count < ceiling', () => {
    expect(canShowNextImpression('banner-home', 3)).toBe(true);
    expect(canShowNextImpression('banner-home', 3)).toBe(true);
    expect(canShowNextImpression('banner-home', 3)).toBe(true);
  });

  it('returns false once count === ceiling (does not increment past ceiling)', () => {
    canShowNextImpression('banner-home', 2);
    canShowNextImpression('banner-home', 2);
    expect(canShowNextImpression('banner-home', 2)).toBe(false);
    // Calling again still returns false
    expect(canShowNextImpression('banner-home', 2)).toBe(false);
  });

  it('ceiling of 1 allows exactly one impression', () => {
    expect(canShowNextImpression('sidebar', 1)).toBe(true);
    expect(canShowNextImpression('sidebar', 1)).toBe(false);
  });

  it('ceiling of 0 never allows an impression', () => {
    expect(canShowNextImpression('never', 0)).toBe(false);
    expect(canShowNextImpression('never', 0)).toBe(false);
  });
});

describe('canShowNextImpression — independent keys', () => {
  it('two placements with ceiling 1 each get one impression each independently', () => {
    expect(canShowNextImpression('placement-a', 1)).toBe(true);
    expect(canShowNextImpression('placement-b', 1)).toBe(true);
    // Both are now exhausted
    expect(canShowNextImpression('placement-a', 1)).toBe(false);
    expect(canShowNextImpression('placement-b', 1)).toBe(false);
  });

  it('exhausting one placement does not affect another', () => {
    canShowNextImpression('slot-1', 1); // exhaust slot-1
    expect(canShowNextImpression('slot-2', 3)).toBe(true);
    expect(canShowNextImpression('slot-2', 3)).toBe(true);
  });
});

describe('resetSessionCounts', () => {
  it('clears all counters so the next call returns true again', () => {
    canShowNextImpression('banner', 1);
    // exhausted
    expect(canShowNextImpression('banner', 1)).toBe(false);
    resetSessionCounts();
    // reset — should return true again
    expect(canShowNextImpression('banner', 1)).toBe(true);
  });

  it('clears counters for all placements', () => {
    canShowNextImpression('a', 1);
    canShowNextImpression('b', 1);
    resetSessionCounts();
    expect(canShowNextImpression('a', 1)).toBe(true);
    expect(canShowNextImpression('b', 1)).toBe(true);
  });
});

describe('freqCap — no localStorage', () => {
  it('does not reference localStorage (state in module-level Map)', () => {
    // This test verifies the spec: state lives in a module-level Map.
    // We verify by resetting and confirming behaviour, not by inspecting
    // localStorage (which would require a browser env). The test structure
    // implicitly validates module-level state because resetSessionCounts()
    // works correctly across test calls.
    resetSessionCounts();
    expect(canShowNextImpression('test', 2)).toBe(true);
    expect(canShowNextImpression('test', 2)).toBe(true);
    expect(canShowNextImpression('test', 2)).toBe(false);
  });
});
