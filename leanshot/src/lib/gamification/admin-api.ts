/**
 * Phase 35 Plan 35-05 GAME-05/08 — Admin SECDEF RPC wrappers + typed errors.
 *
 * Mirrors Phase 27's CohortApiError pattern from @/lib/cohort/api.
 * Server-side admin role enforcement lives in the SECDEF functions;
 * this layer is a typed client wrapper only (Pattern S1 dual-layer).
 */
import { supabase } from '@/lib/supabase';
import type { ChallengeVariantKey } from './challenges';

// ---------------------------------------------------------------------------
// Typed error class — mirrors CohortApiError pattern.
// ---------------------------------------------------------------------------

export class ChallengeApiError extends Error {
  constructor(
    public readonly code:
      | 'not_admin'
      | 'max_2_variants'
      | 'challenge_not_found'
      | 'variant_not_found'
      | 'invalid_variant'
      | 'ship_winner_db_failed'
      | 'unknown',
    message: string,
  ) {
    super(message);
    this.name = 'ChallengeApiError';
  }
}

// ---------------------------------------------------------------------------
// create_weekly_challenge payload type
// ---------------------------------------------------------------------------

export interface CreateChallengePayload {
  title: string;
  framing: string;
  challenge_type: 'log_count' | 'streak_days' | 'specific_action';
  threshold: number;
  action_type?: 'injection_log' | 'weight_log' | 'symptom_log' | 'workout_log';
  duration: 'week' | 'month';
  cohort_id?: string;
  reward_xp?: number;
  reward_badge_id?: string;
  reward_freeze_tokens?: number;
  reward_combo_badge_id?: string;
  starts_at: string;
  ends_at: string;
  status: 'draft' | 'active';
  variants?: Array<{
    variant_key: ChallengeVariantKey;
    framing: string;
    threshold?: number;
  }>;
}

// ---------------------------------------------------------------------------
// Admin RPC wrappers
// ---------------------------------------------------------------------------

/**
 * Create a new weekly challenge (with optional A/B variants).
 * Admin-only: SECDEF re-checks profiles.admin_role server-side.
 * Returns the new challenge's UUID.
 */
export async function createWeeklyChallenge(payload: CreateChallengePayload): Promise<string> {
  const { data, error } = await supabase.rpc('create_weekly_challenge', {
    p_payload: payload as unknown as Record<string, unknown>,
  });
  if (error) {
    const code = error.message.includes('forbidden_not_admin')
      ? 'not_admin'
      : error.message.includes('max_2_variants')
        ? 'max_2_variants'
        : 'unknown';
    throw new ChallengeApiError(code, error.message);
  }
  return data as string;
}

/**
 * Ship the winning A/B variant for a challenge.
 * Two-phase: DB-side archives old + writes new active row, then
 * PostHog-side flips the feature flag via ship-winner-flag Edge Fn.
 *
 * DB transaction is authoritative — PostHog flip failure is logged
 * but does not throw (admin can flip manually in PostHog UI as fallback).
 */
export async function shipWinnerChallengeVariant(
  challengeId: string,
  winningVariant: ChallengeVariantKey,
  posthogFlagId: string | null,
): Promise<string> {
  // Phase 1: DB-side archive + new active row
  const { data, error } = await supabase.rpc('ship_winner_challenge_variant', {
    p_challenge_id: challengeId,
    p_winning_variant: winningVariant,
  });
  if (error) {
    const code = error.message.includes('forbidden_not_admin')
      ? 'not_admin'
      : error.message.includes('challenge_not_found')
        ? 'challenge_not_found'
        : error.message.includes('variant_not_found')
          ? 'variant_not_found'
          : 'ship_winner_db_failed';
    throw new ChallengeApiError(code, error.message);
  }

  // Phase 2: PostHog flag flip via Phase 34 ship-winner-flag Edge Fn (D-20 reuse)
  if (posthogFlagId) {
    const { error: fnError } = await supabase.functions.invoke('ship-winner-flag', {
      body: { flag_id: posthogFlagId, variant: winningVariant },
    });
    if (fnError) {
      // Log but don't throw — DB is truth; admin can flip PostHog manually
      console.warn(
        '[admin-api] PostHog flag flip failed (DB version write succeeded):',
        fnError.message,
      );
    }
  }

  return data as string;
}

/**
 * Enable or disable the leaderboard for a cohort.
 * D-11: requires support_lead/superadmin (SECDEF re-checks).
 */
export async function setCohortLeaderboardEnabled(
  cohortId: string,
  enabled: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_cohort_leaderboard_enabled', {
    p_cohort_id: cohortId,
    p_enabled: enabled,
  });
  if (error) {
    const code = error.message.includes('forbidden_not_admin') ? 'not_admin' : 'unknown';
    throw new ChallengeApiError(code, error.message);
  }
}
