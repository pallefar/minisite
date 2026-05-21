/**
 * `challenge-evaluate-cron` Edge Function — Phase 35 plan 35-09 D-21.
 *
 * Invoked hourly at minute 22 by pg_cron via vault.decrypted_secrets bearer.
 * Loops all users with at least one active challenge, calls
 * evaluate_challenge_progress_for_user(p_user) SECDEF RPC for each, then
 * fire-and-forgets lifecycle-behavior-triggered to dispatch any pending
 * in-app notifications (streak-warn, challenge-kickoff, challenge-nudge).
 *
 * Auth: service-role bearer (pg_cron via vault.decrypted_secrets bootstrap).
 * Error handling: per-user errors do NOT abort the batch; they are counted
 * and reported in the JSON response body.
 *
 * Pattern: supabase/functions/admin-grant-freeze-token/index.ts (service-role
 * bearer, captureServer, shutdownPostHog in finally).
 */
import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';
import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';

const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

interface ActiveUserRow {
  user_id: string;
}

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');

  try {
    // 1. Find all users with at least one active challenge (deduplicated).
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: challengeRows, error: queryError } = (await (admin
      .from('challenge_progress')
      .select('user_id, weekly_challenges!inner(status, ends_at)')
      .eq('weekly_challenges.status', 'active')
      .gt('weekly_challenges.ends_at', new Date().toISOString()) as any)) as {
      data: Array<{ user_id: string }> | null;
      error: unknown;
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */

    if (queryError) {
      console.error('[challenge-evaluate-cron] query error', queryError);
      return jsonError(500, 'query_error');
    }

    // Deduplicate user IDs.
    const userIdSet = new Set<string>((challengeRows ?? []).map((r: ActiveUserRow) => r.user_id));
    const uniqueUsers = Array.from(userIdSet);

    let processed = 0;
    let errors = 0;

    for (const userId of uniqueUsers) {
      try {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        await (admin.rpc('evaluate_challenge_progress_for_user', { p_user: userId }) as any);
        /* eslint-enable @typescript-eslint/no-explicit-any */
        processed++;
      } catch (e) {
        console.error('[challenge-evaluate-cron] per-user error', userId, e);
        errors++;
      }
    }

    // 2. Fire-and-forget lifecycle-behavior-triggered to dispatch any new notifications
    //    (gamification branches: streak-warn, challenge-kickoff, challenge-nudge).
    //    Failures are logged but do not affect the response.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    void (admin as any).functions
      .invoke('lifecycle-behavior-triggered', { body: { trigger: 'gamification' } })
      .catch((e: unknown) => {
        console.warn('[challenge-evaluate-cron] lifecycle dispatch failed', e);
      });
    /* eslint-enable @typescript-eslint/no-explicit-any */

    captureServer({
      userId: 'system',
      event: 'gamification_cron_completed',
      properties: {
        users_processed: processed,
        errors,
        kind: 'challenge_evaluate',
      },
    });

    return jsonResponse(200, { ok: true, processed, errors });
  } catch (e) {
    console.error('[challenge-evaluate-cron] handler failed', e);
    return jsonError(500, 'internal_error');
  } finally {
    try {
      await shutdownPostHog();
    } catch (e) {
      console.error('[challenge-evaluate-cron] shutdownPostHog failed', e);
    }
  }
}

Deno.serve(handler);

export const __internal = { handler, setAdminForTest, resetAdminForTest };
