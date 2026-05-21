/**
 * Phase 35 Plan 35-05 GAME-05 — User-facing challenge types + RPC wrappers.
 *
 * Used by Plan 35-06 WeeklyChallengeCard widget to render active challenges.
 * evaluate_challenge_progress_for_user is also called by Plan 35-09 notification cron.
 */
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Shared types — match the DB schema from Plan 35-05 migrations.
// ---------------------------------------------------------------------------

export type ChallengeType = 'log_count' | 'streak_days' | 'specific_action';
export type ChallengeStatus = 'draft' | 'active' | 'completed' | 'archived';
export type ChallengeDuration = 'week' | 'month';
export type ChallengeActionType = 'injection_log' | 'weight_log' | 'symptom_log' | 'workout_log';
export type ChallengeVariantKey = 'A' | 'B';

export interface WeeklyChallenge {
  id: string;
  title: string;
  framing: string;
  challenge_type: ChallengeType;
  threshold: number;
  action_type: ChallengeActionType | null;
  duration: ChallengeDuration;
  cohort_id: string | null;
  reward_xp: number;
  reward_badge_id: string | null;
  reward_freeze_tokens: number;
  reward_combo_badge_id: string | null;
  posthog_flag_id: string | null;
  status: ChallengeStatus;
  starts_at: string | null;
  ends_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChallengeVariant {
  id: string;
  challenge_id: string;
  variant_key: ChallengeVariantKey;
  framing: string;
  threshold: number | null;
  created_at: string;
}

export interface ChallengeProgress {
  user_id: string;
  challenge_id: string;
  variant_key: ChallengeVariantKey | null;
  progress_count: number;
  completed_at: string | null;
  notified_kickoff_at: string | null;
  notified_nudge_at: string | null;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Client-facing RPC wrappers
// ---------------------------------------------------------------------------

/**
 * Fetch active challenges visible to the current authenticated user.
 * Returns challenges with status='active' (RLS policy enforces this).
 */
export async function fetchActiveChallenges(): Promise<WeeklyChallenge[]> {
  const { data, error } = await supabase
    .from('weekly_challenges')
    .select('*')
    .eq('status', 'active')
    .gt('ends_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[challenges] fetchActiveChallenges failed:', error.message);
    return [];
  }
  return (data as WeeklyChallenge[]) ?? [];
}

/**
 * Fetch active challenge variants visible to the current authenticated user.
 * Used by WeeklyChallengeCard to resolve PostHog A/B framing.
 */
export async function fetchChallengeVariants(
  challengeId: string,
): Promise<ChallengeVariant[]> {
  const { data, error } = await supabase
    .from('challenge_variants')
    .select('*')
    .eq('challenge_id', challengeId);

  if (error) {
    console.error('[challenges] fetchChallengeVariants failed:', error.message);
    return [];
  }
  return (data as ChallengeVariant[]) ?? [];
}

/**
 * Evaluate challenge progress for the given user.
 * Called by Plan 35-09 cron via service-role; also callable by client for live read.
 * Returns void — progress rows are upserted into challenge_progress table.
 */
export async function evaluateChallengeProgress(userId: string): Promise<void> {
  const { error } = await supabase.rpc('evaluate_challenge_progress_for_user', {
    p_user: userId,
  });
  if (error) {
    console.error('[challenges] evaluateChallengeProgress failed:', error.message);
  }
}

/**
 * Fetch progress rows for the current user's active challenges.
 * Used by WeeklyChallengeCard to render progress state.
 */
export async function fetchChallengeProgressForUser(
  userId: string,
): Promise<ChallengeProgress[]> {
  const { data, error } = await supabase
    .from('challenge_progress')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    console.error('[challenges] fetchChallengeProgressForUser failed:', error.message);
    return [];
  }
  return (data as ChallengeProgress[]) ?? [];
}
