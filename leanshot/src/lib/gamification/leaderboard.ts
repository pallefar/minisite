/**
 * Typed client wrappers for the Phase 35 leaderboard SECDEF RPCs.
 *
 * Context:
 *   - set_leaderboard_optin: upsert/opt-out; validates cohort_enabled + member + handle
 *   - suggest_leaderboard_handle: generates a default theme-rand4 suggestion
 *   - get_leaderboard_for_user: returns top-10 + ±5 neighborhood with is_self flag
 *
 * IMPORTANT: All three RPCs are CLIENT-CALLED ONLY (auth.uid() context, Pitfall 8).
 * These wrappers MUST NOT be called from service-role Edge Fns. Edge Fns that process
 * XP events (xp-event, xp-grant, admin-grant-freeze-token, challenge-notify) MUST NOT
 * import or invoke these functions.
 *
 * Consumed by:
 *   - Plan 35-06: LeaderboardCard widget (calls fetchLeaderboardForCohort)
 *   - Plan 35-08: Settings → Leaderboards subtab (calls setLeaderboardOptin + suggestLeaderboardHandle)
 */
import { supabase } from '@/lib/supabase';

/** A single row returned by get_leaderboard_for_user. */
export interface LeaderboardRow {
  handle: string;
  xp_7d: number;
  rank_in_cohort: number;
  is_self: boolean;
  refreshed_at: string;
}

/** Typed error class for leaderboard RPC failures. */
export class LeaderboardApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LeaderboardApiError';
  }
}

/**
 * Opt a user into (or out of) the leaderboard for the given cohort.
 *
 * @param cohortId - UUID of the cohort
 * @param handle   - The chosen handle (required when optIn=true; pass null when opting out)
 * @param optIn    - true to opt in, false to opt out
 * @throws LeaderboardApiError on RPC failure
 */
export async function setLeaderboardOptin(
  cohortId: string,
  handle: string | null,
  optIn: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_leaderboard_optin', {
    p_cohort_id: cohortId,
    p_handle: handle ?? '',
    p_opt_in: optIn,
  });

  if (error) {
    const code = mapSetOptinError(error);
    throw new LeaderboardApiError(code, error.message);
  }
}

function mapSetOptinError(error: { code: string; message: string }): string {
  const { code, message } = error;
  if (code === '42501') {
    if (message.includes('not_cohort_member')) return 'not_cohort_member';
    if (message.includes('unauthenticated')) return 'unauthenticated';
    return 'unauthorized';
  }
  if (code === 'P0001') {
    if (message.includes('cohort_leaderboard_disabled')) return 'cohort_leaderboard_disabled';
    return 'rpc_error';
  }
  if (code === 'P0002') return 'cohort_not_found';
  if (code === '22023') return 'invalid_handle';
  return 'unknown';
}

/**
 * Fetch a server-generated handle suggestion in the form `<theme>-<rand4digit>`.
 * The Settings → Leaderboards form pre-fills this; the user may override it.
 *
 * @throws LeaderboardApiError if the RPC could not generate a unique handle after 10 retries
 */
export async function suggestLeaderboardHandle(): Promise<string> {
  const { data, error } = await supabase.rpc('suggest_leaderboard_handle');

  if (error || typeof data !== 'string') {
    throw new LeaderboardApiError(
      'suggest_failed',
      error?.message ?? 'failed to suggest handle',
    );
  }
  return data;
}

/**
 * Fetch the leaderboard for the given cohort: top-10 entries + requesting user's ±5 neighborhood.
 * Returns rows sorted ascending by rank_in_cohort.
 * Returns empty array if the cohort has no opted-in users yet.
 *
 * @param cohortId - UUID of the cohort (user must be a member)
 * @throws LeaderboardApiError if user is not a cohort member or unauthenticated
 */
export async function fetchLeaderboardForCohort(cohortId: string): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.rpc('get_leaderboard_for_user', {
    p_cohort_id: cohortId,
  });

  if (error) {
    const code =
      error.code === '42501' && error.message.includes('not_cohort_member')
        ? 'not_cohort_member'
        : error.code === '42501'
          ? 'unauthenticated'
          : 'unknown';
    throw new LeaderboardApiError(code, error.message);
  }

  return (data ?? []) as LeaderboardRow[];
}
