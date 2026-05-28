/**
 * Client-side mirror tests for Phase 35 compute_level / xpToNextLevel / computePrestige.
 *
 * These tests mirror the pgTAP locked spot-check values from 35_xp_ledger_replay.sql.
 * If this test breaks, the client mirror has diverged from the DB formula (D-02, D-04).
 *
 * D-02: Level N requires N²×100 XP cumulative (quadratic curve).
 * D-03: Prestige increments at level 100/200/300...
 * D-04: Level computation is a pure function of XP total.
 */
import { describe, it, expect } from 'vitest';
import { computeLevel, xpToNextLevel, xpForLevel, computePrestige } from '@/lib/gamification/xp';

describe('computeLevel (client mirror of Plan 35-01 compute_level SQL fn)', () => {
  /**
   * D-02 locked spot-check values from pgTAP suite (35_xp_ledger_replay.sql).
   * These exact values MUST match the Postgres IMMUTABLE function.
   */
  it.each([
    [0, 1], // always at least level 1 (clamp)
    [99, 1], // below 100 — still level 1
    [100, 1], // exactly at level 1 boundary (1²×100=100; compute_level(100)=floor(sqrt(1))=1)
    [400, 2], // 2²×100 = 400
    [2500, 5], // 5²×100 = 2500
    [10000, 10], // 10²×100 = 10000
    [40000, 20], // 20²×100 = 40000
    [1000000, 100], // 100²×100 = 1000000
  ])('computeLevel(%i) === %i', (xp, expected) => {
    expect(computeLevel(xp)).toBe(expected);
  });

  it('computeLevel with just below level boundary returns lower level', () => {
    expect(computeLevel(399)).toBe(1); // 399 < 400 (level 2 boundary)
    expect(computeLevel(2499)).toBe(4); // just below level 5
    expect(computeLevel(9999)).toBe(9); // just below level 10
  });

  it('computeLevel handles negative XP gracefully (clamps to level 1)', () => {
    expect(computeLevel(-100)).toBe(1); // negative XP → clamp to 0 → level 1
  });
});

describe('computePrestige (D-03)', () => {
  it('computePrestige(1_000_000) === 1', () => {
    expect(computePrestige(1_000_000)).toBe(1); // level 100 / 100 = 1
  });

  it('computePrestige is 0 for levels 1-99', () => {
    expect(computePrestige(0)).toBe(0); // level 1 → 1/100 = 0
    expect(computePrestige(9999)).toBe(0); // level 9 → 9/100 = 0
  });
});

describe('xpToNextLevel (UI display helper)', () => {
  it('xpToNextLevel(450) returns correct level-2 progress', () => {
    // D-02 locked values from Plan 35-03 spec:
    // xp=450, level=2, currentLevelStart=400, nextLevelXp=900
    expect(xpToNextLevel(450)).toEqual({
      level: 2,
      xpInLevel: 50, // 450 - 400
      xpToNext: 450, // 900 - 450
      nextLevelXp: 900, // 3²×100
    });
  });

  it('xpToNextLevel(0) returns level-1 start', () => {
    // At 0 XP: level 1, started at 0 (clamp), next level starts at 400 (2²×100)
    const result = xpToNextLevel(0);
    expect(result.level).toBe(1);
    expect(result.xpInLevel).toBe(0); // 0 - 0 (level 1 starts at 0)
    expect(result.nextLevelXp).toBe(400); // 2²×100
    expect(result.xpToNext).toBe(400); // 400 - 0
  });

  it('xpToNextLevel(2500) returns level-5 at boundary', () => {
    // Exactly at level 5 start (5²×100 = 2500)
    const result = xpToNextLevel(2500);
    expect(result.level).toBe(5);
    expect(result.xpInLevel).toBe(0); // at the boundary — 0 XP into level 5
    expect(result.nextLevelXp).toBe(3600); // 6²×100 = 3600
    expect(result.xpToNext).toBe(1100); // 3600 - 2500
  });
});

describe('xpForLevel (D-02 inverse)', () => {
  it('xpForLevel(1) returns 0 (level 1 starts at 0 XP due to clamp)', () => {
    expect(xpForLevel(1)).toBe(0);
  });

  it('xpForLevel(2) returns 400', () => {
    expect(xpForLevel(2)).toBe(400); // 2²×100
  });

  it('xpForLevel(5) returns 2500', () => {
    expect(xpForLevel(5)).toBe(2500); // 5²×100
  });

  it('xpForLevel(10) returns 10000', () => {
    expect(xpForLevel(10)).toBe(10000); // 10²×100
  });

  it('xpForLevel(100) returns 1000000', () => {
    expect(xpForLevel(100)).toBe(1_000_000); // 100²×100
  });
});
