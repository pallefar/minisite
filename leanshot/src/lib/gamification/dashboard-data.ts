/**
 * Phase 35 Plan 35-06 — Aggregated SECDEF RPC reader for gamification dashboard.
 *
 * Batches 3 parallel reads into a single Promise.all to minimize round-trips.
 * Called by GamificationCard's useEffect; results are passed down to all sub-cards.
 *
 * Data sources:
 *   - xp_total_for RPC (Plan 35-01 SECDEF)
 *   - freeze_tokens_remaining RPC (Plan 35-02 SECDEF)
 *   - streak_state table (Plan 35-02 schema)
 *   - computeLevel / xpToNextLevel / computePrestige (Plan 35-03 client mirror of D-04)
 */
import { supabase } from '@/lib/supabase';
import { computeLevel, xpToNextLevel, computePrestige } from '@/lib/gamification/xp';

export interface GamificationDashboardData {
  xpTotal: number;
  level: number;
  prestige: number;
  xpToNext: number;
  xpInLevel: number;
  nextLevelXp: number;
  streak: {
    current: number;
    longest: number;
    lastActionAt: string | null;
  };
  freezeTokens: number;
}

/**
 * Fetch all gamification data needed by the dashboard in a single Promise.all.
 * Returns a fully-typed GamificationDashboardData object.
 */
export async function fetchGamificationDashboard(
  userId: string,
): Promise<GamificationDashboardData> {
  const [xpResult, freezeResult, streakResult] = await Promise.all([
    supabase.rpc('xp_total_for', { p_user: userId }),
    supabase.rpc('freeze_tokens_remaining', { p_user: userId }),
    supabase
      .from('streak_state')
      .select('current_streak_days, longest_streak_days, last_action_at')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  const xpTotal = Number(xpResult.data ?? 0);
  const freezeTokens = Number(freezeResult.data ?? 0);
  const streakRow = streakResult.data;

  const level = computeLevel(xpTotal);
  const prestige = computePrestige(xpTotal);
  const { xpInLevel, xpToNext, nextLevelXp } = xpToNextLevel(xpTotal);

  return {
    xpTotal,
    level,
    prestige,
    xpToNext,
    xpInLevel,
    nextLevelXp,
    streak: {
      current: streakRow?.current_streak_days ?? 0,
      longest: streakRow?.longest_streak_days ?? 0,
      lastActionAt: streakRow?.last_action_at ?? null,
    },
    freezeTokens,
  };
}
