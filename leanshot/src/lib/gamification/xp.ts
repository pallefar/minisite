/**
 * Phase 35 Plan 35-03 — Client-side XP + level computation.
 *
 * Mirrors the Postgres SECURITY DEFINER function `compute_level(xp_total)`.
 * Plan 35-03 owns the canonical implementation + pgTAP parity tests;
 * this file is the client mirror (D-04: pure function of XP total).
 *
 * D-02: Quadratic level curve — Level N requires N² × 100 XP cumulative.
 *   Level 1: 100 · Level 2: 400 · Level 3: 900 · Level 5: 2,500 · Level 10: 10,000
 * D-03: No max-level cap. Display caps at 100 with Prestige badge thereafter.
 *
 * NOTE: This stub is scaffolded by Plan 35-06 to unblock sibling-wave compilation.
 * Plan 35-03 owns the Vitest parity tests (VALIDATION row 35-03-04 / T-35-06-05).
 */

/**
 * Compute the user's current level from their cumulative XP total.
 * D-02 quadratic: Level N threshold = N² × 100.
 */
export function computeLevel(xpTotal: number): number {
  if (xpTotal <= 0) return 1;
  // floor(sqrt(xpTotal / 100)) gives the highest N where N²×100 <= xpTotal
  const level = Math.floor(Math.sqrt(xpTotal / 100));
  return Math.max(1, level);
}

export interface XpLevelBreakdown {
  level: number;
  /** XP accumulated within the current level (above the level's base threshold). */
  xpInLevel: number;
  /** XP remaining to reach the next level. */
  xpToNext: number;
  /** Total XP threshold for the next level. */
  nextLevelXp: number;
}

/**
 * Decompose XP total into per-level progress metrics.
 * Used by LevelProgressCard ring display.
 */
export function xpToNextLevel(xpTotal: number): XpLevelBreakdown {
  const level = computeLevel(xpTotal);
  const currentLevelXp = level * level * 100;        // XP threshold for current level
  const nextLevelXp = (level + 1) * (level + 1) * 100; // XP threshold for next level
  const xpInLevel = Math.max(0, xpTotal - currentLevelXp);
  const xpToNext = Math.max(0, nextLevelXp - xpTotal);
  return { level, xpInLevel, xpToNext, nextLevelXp };
}

/**
 * Compute prestige tier (D-03: increments at level 100/200/300/...).
 * Returns 0 for non-prestige users.
 */
export function computePrestige(xpTotal: number): number {
  const level = computeLevel(xpTotal);
  return Math.floor(level / 100);
}
