/**
 * Client-side mirror of Postgres compute_level() for UI hints.
 *
 * Phase 35 D-02, D-03, D-04.
 *
 * IMPORTANT: The single source of truth is the Postgres function
 * `compute_level(xp_total int)` shipped in Plan 35-01
 * (supabase/migrations/20270708000002_p35_compute_level_fn.sql).
 *
 * This module mirrors the SQL formula so the UI can compute
 * "XP to next level" and "current level" client-side for instant
 * display without an RPC round-trip. If this file diverges from
 * the SQL function, the UI hint will be wrong — DB always wins.
 *
 * Formula (D-02): Level N requires N² × 100 XP cumulative.
 *   Level 1: 100 XP  | Level 2: 400 XP   | Level 5: 2,500 XP
 *   Level 10: 10,000 | Level 20: 40,000   | Level 100: 1,000,000
 *
 * Spot-check values (locked by pgTAP in 35_xp_ledger_replay.sql):
 *   computeLevel(0) = 1       (always at least level 1)
 *   computeLevel(100) = 1     (level 1 boundary)
 *   computeLevel(400) = 2     (2²×100 = 400)
 *   computeLevel(2500) = 5    (5²×100 = 2500)
 *   computeLevel(10000) = 10  (10²×100 = 10000)
 *   computeLevel(40000) = 20  (20²×100 = 40000)
 *   computeLevel(1000000) = 100  (100²×100 = 1000000)
 *
 * Vitest mirror tests: src/lib/gamification/__tests__/xp.test.ts
 */

/**
 * Computes the user's level from their cumulative XP total.
 *
 * Mirror of Postgres `compute_level(xp_total int)` — D-02 quadratic curve.
 * Returns at least 1 (level never drops to 0).
 */
export function computeLevel(xpTotal: number): number {
  // D-02: Level N requires N² × 100 XP cumulative.
  // level = floor(sqrt(xpTotal / 100)), clamped to >= 1.
  return Math.max(1, Math.floor(Math.sqrt(Math.max(xpTotal, 0) / 100)));
}

/**
 * Returns the cumulative XP required to reach the START of the given level.
 *
 * D-02 inverse: level N starts at N² × 100 XP.
 */
export function xpForLevel(level: number): number {
  // D-02: For level N >= 2, starts at N²×100 XP cumulative.
  // Level 1 is special: starts at 0 XP (compute_level clamps floor(sqrt(xp/100)) to >= 1,
  // so level 1 covers XP [0, 399]).
  // Level 2: 2²×100 = 400. Level 5: 5²×100 = 2500. Level N≥2: N²×100.
  const l = Math.max(1, level);
  if (l <= 1) return 0;
  return l * l * 100;
}

/**
 * Returns XP progress context for the current level:
 *   - level: user's current level (integer >= 1)
 *   - xpInLevel: XP earned within the current level (0 to xpToNext - 1)
 *   - xpToNext: XP remaining until the next level
 *   - nextLevelXp: cumulative XP at which next level starts
 *
 * Used by LevelProgressCard and xpToNextLevel display in the dashboard.
 */
export function xpToNextLevel(xpTotal: number): {
  level: number;
  xpInLevel: number;
  xpToNext: number;
  nextLevelXp: number;
} {
  const level = computeLevel(xpTotal);
  const currentLevelStart = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  return {
    level,
    xpInLevel: xpTotal - currentLevelStart,
    xpToNext: nextLevelXp - xpTotal,
    nextLevelXp,
  };
}

/**
 * Computes the user's prestige rank from their cumulative XP total.
 *
 * D-03: Prestige increments every 100 levels (level 100 = prestige 1, level 200 = prestige 2, ...).
 * Returns 0 for normal play (levels 1-99).
 *
 * Mirror of Postgres `compute_prestige(xp_total int)`.
 */
export function computePrestige(xpTotal: number): number {
  return Math.max(0, Math.floor(computeLevel(xpTotal) / 100));
}
