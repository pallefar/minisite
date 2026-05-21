/**
 * `lifecycle-behavior-triggered` Edge Function — Phase 22 plan 22-02 (ON-02).
 *
 * Cron-invoked every 15 minutes. Three queries:
 *   (a) users whose FIRST injection was logged in last 15 min → first_injection_celebration
 *   (b) users whose logging streak hit exactly 7 days → 7_day_streak
 *   (c) users with last injection ≥ 72h ago and no logs since → missed_dose_day3
 *
 * Idempotency via `email_send_counters` key
 * `behavior:<user_id>:<template>[:<bucket>]` (presence = sent).
 *
 * Auth: service-role bearer (cron + verify_jwt=false).
 *
 * The exact "streak" and "first injection" computations depend on the
 * shape of the `injections` table. We use a conservative, schema-agnostic
 * approach: select `(user_id, occurred_at)` rows in the relevant windows
 * and group in-memory. If the table doesn't exist (e.g. local dev where
 * Phase 4+ migrations were not applied), the query fails-open and the
 * function reports `processed: 0`.
 */
import { resendDomainHealthCheck } from '../_shared/resend-domain-health-check.ts';
import { sendResendEmail } from '../_shared/lifecycle-send.ts';
import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';
// Phase 32 plan 32-05 (I18N-04): all three behavior triggers
// (first_injection_celebration, 7_day_streak, missed_dose_day3) localize
// subject + plain-text alt via the shared `lifecycle_behavior.*` keys.
// HTML stays in EN per D-09; contractor refines in Plan 32-06.
import { renderInLocale } from '../_shared/i18n-server.ts';
import { resolveLocale } from '../_shared/profiles-locale.ts';
import { renderTemplate, renderGamificationPayload } from './templates.ts';
import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';

const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

const SITE_URL = () => Deno.env.get('SITE_URL') ?? 'https://app.leanshot.app';

interface UserMeta {
  id: string;
  email: string;
  first_name?: string;
}

interface InjectionRow {
  user_id: string;
  occurred_at: string;
}

interface RunResult {
  processed: number;
  sent: number;
  skipped_already_sent: number;
  skipped_preferences: number;
  send_errors: number;
}

async function isPreferenceEnabled(userId: string, category: string): Promise<boolean> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data } = (await (admin
    .from('consent_records')
    .select('email_preferences')
    .eq('user_id', userId)
    .order('recorded_at', { ascending: false })
    .limit(1) as any)) as { data: Array<{ email_preferences?: Record<string, unknown> }> | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const row = data?.[0];
  if (!row) return true; // default opt-in
  const prefs = row.email_preferences ?? {};
  const val = (prefs as Record<string, unknown>)[category];
  if (val === undefined || val === null) return true;
  return val === true || val === 'true';
}

async function markSent(userId: string, key: string): Promise<void> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  await (admin.from('email_send_counters').upsert(
    {
      key: `behavior:${userId}:${key}`,
      value: 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  ) as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

async function alreadySent(userId: string, key: string): Promise<boolean> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data } = (await (admin
    .from('email_send_counters')
    .select('key')
    .eq('key', `behavior:${userId}:${key}`)
    .limit(1) as any)) as { data: Array<{ key: string }> | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return (data?.length ?? 0) > 0;
}

async function getUserMeta(userId: string): Promise<UserMeta | null> {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data } = await (admin.auth.admin as any).getUserById(userId);
    const u = data?.user;
    if (!u) return null;
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
    return {
      id: u.id,
      email: u.email ?? '',
      first_name: typeof meta.first_name === 'string' ? meta.first_name : undefined,
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  } catch {
    return null;
  }
}

async function recentInjections(sinceIso: string): Promise<InjectionRow[]> {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data } = (await (admin
      .from('injections')
      .select('user_id, occurred_at')
      .gt('occurred_at', sinceIso) as any)) as { data: InjectionRow[] | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return data ?? [];
  } catch {
    return [];
  }
}

async function lastInjectionPerUser(): Promise<Map<string, string>> {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data } = (await (admin
      .from('injections')
      .select('user_id, occurred_at')
      .order('occurred_at', { ascending: false })
      .limit(10_000) as any)) as { data: InjectionRow[] | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const m = new Map<string, string>();
    for (const r of data ?? []) {
      if (!m.has(r.user_id)) m.set(r.user_id, r.occurred_at);
    }
    return m;
  } catch {
    return new Map();
  }
}

async function dispatchTemplate(
  userMeta: UserMeta,
  category: string,
  template: 'first_injection_celebration' | '7_day_streak' | 'missed_dose_day3',
  extraData: { streak_days?: number; days_since_last?: number } = {},
  idempotencyKey?: string,
): Promise<'sent' | 'skipped_pref' | 'skipped_dup' | 'error'> {
  const key = idempotencyKey ?? template;
  if (await alreadySent(userMeta.id, key)) return 'skipped_dup';
  if (!(await isPreferenceEnabled(userMeta.id, category))) return 'skipped_pref';

  const rendered = renderTemplate(template, {
    first_name: userMeta.first_name,
    app_url: SITE_URL(),
    unsubscribe_url: `${SITE_URL()}/settings/email-preferences`,
    ...extraData,
  });

  // I18N-04 language layer — all three behavior triggers share the
  // `lifecycle_behavior.*` namespace. resolveLocale caches via LRU(100)
  // so the 15-min cron tick stays cheap even when the same user fires
  // multiple triggers in a row.
  const lng = await resolveLocale(userMeta.id, admin);
  const i18nVars = {
    name: userMeta.first_name || 'there',
    reset_url: SITE_URL(),
  };
  const localizedSubject = await renderInLocale(lng, 'lifecycle_behavior.subject', i18nVars);
  const localizedText = await renderInLocale(lng, 'lifecycle_behavior.body', i18nVars);

  const dispatch = await sendResendEmail({
    to: userMeta.email,
    subject: localizedSubject,
    html: rendered.html,
    text: localizedText,
  });
  if (dispatch.ok) {
    await markSent(userMeta.id, key);
    return 'sent';
  }
  console.warn(
    `[lifecycle-behavior] send failed user=${userMeta.id.slice(0, 8)} t=${template} err=${dispatch.error}`,
  );
  return 'error';
}

async function handleRun(_req: Request): Promise<Response> {
  const result: RunResult = {
    processed: 0,
    sent: 0,
    skipped_already_sent: 0,
    skipped_preferences: 0,
    send_errors: 0,
  };

  const health = await resendDomainHealthCheck(admin);
  if (!health.ok) return jsonResponse(200, { skipped: true, status: health.status });

  const now = Date.now();

  // (a) First-injection celebration — injections occurred in last 15 min.
  const since15m = new Date(now - 15 * 60 * 1000).toISOString();
  const recent = await recentInjections(since15m);
  const firstByUser = new Map<string, string>();
  for (const r of recent) {
    if (!firstByUser.has(r.user_id)) firstByUser.set(r.user_id, r.occurred_at);
  }

  // Confirm these are TRULY first-ever injections (not just first in the 15m window).
  for (const [userId, occurredAt] of firstByUser) {
    try {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const { data: earlier } = (await (admin
        .from('injections')
        .select('id')
        .eq('user_id', userId)
        .lt('occurred_at', occurredAt)
        .limit(1) as any)) as { data: Array<{ id: string }> | null };
      /* eslint-enable @typescript-eslint/no-explicit-any */
      if ((earlier?.length ?? 0) > 0) continue; // not actually first
    } catch {
      continue;
    }
    result.processed += 1;
    const meta = await getUserMeta(userId);
    if (!meta || !meta.email) continue;
    const r = await dispatchTemplate(meta, 'behavior_triggered', 'first_injection_celebration');
    if (r === 'sent') result.sent += 1;
    else if (r === 'skipped_pref') result.skipped_preferences += 1;
    else if (r === 'skipped_dup') result.skipped_already_sent += 1;
    else if (r === 'error') result.send_errors += 1;
  }

  // (b) 7-day streak — users with at least one injection on each of last 7 calendar days.
  // Approximation: select injections from last 7 days, group by user, ensure 7 distinct day buckets.
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const last7 = await recentInjections(since7d);
  const byUser = new Map<string, Set<string>>();
  for (const r of last7) {
    const day = r.occurred_at.slice(0, 10); // YYYY-MM-DD bucket
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, new Set());
    byUser.get(r.user_id)!.add(day);
  }
  const todayBucket = new Date(now).toISOString().slice(0, 10);
  for (const [userId, days] of byUser) {
    if (days.size < 7) continue;
    result.processed += 1;
    const meta = await getUserMeta(userId);
    if (!meta || !meta.email) continue;
    // Bucket key includes today so daily-tick re-sends don't fire — only the first
    // streak-hit day for a given week wins.
    const dupKey = `7_day_streak:${todayBucket}`;
    const r = await dispatchTemplate(meta, 'behavior_triggered', '7_day_streak', { streak_days: days.size }, dupKey);
    if (r === 'sent') result.sent += 1;
    else if (r === 'skipped_pref') result.skipped_preferences += 1;
    else if (r === 'skipped_dup') result.skipped_already_sent += 1;
    else if (r === 'error') result.send_errors += 1;
  }

  // (c) Missed-dose day 3 — last injection ≥ 72h ago, no logs since.
  const lastMap = await lastInjectionPerUser();
  for (const [userId, lastAt] of lastMap) {
    const lastMs = new Date(lastAt).getTime();
    const ageH = (now - lastMs) / 3_600_000;
    if (ageH < 72 || ageH >= 96) continue; // only fire in 72-96h window
    result.processed += 1;
    const meta = await getUserMeta(userId);
    if (!meta || !meta.email) continue;
    const r = await dispatchTemplate(meta, 'behavior_triggered', 'missed_dose_day3', {
      days_since_last: Math.floor(ageH / 24),
    });
    if (r === 'sent') result.sent += 1;
    else if (r === 'skipped_pref') result.skipped_preferences += 1;
    else if (r === 'skipped_dup') result.skipped_already_sent += 1;
    else if (r === 'error') result.send_errors += 1;
  }

  // Phase 35 plan 35-09 — gamification branches (ethical-only).
  // These run independently of the Resend domain health check since they
  // insert into user_notifications (in-app) and do NOT send email.
  const streakWarnResult = await runStreakWarn();
  const kickoffResult = await runChallengeKickoff();
  const nudgeResult = await runChallengeNudge();
  const gamificationTotal = mergeResults(mergeResults(streakWarnResult, kickoffResult), nudgeResult);

  try {
    await shutdownPostHog();
  } catch (e) {
    console.error('[lifecycle-behavior] shutdownPostHog failed', e);
  }

  return jsonResponse(200, {
    ok: true,
    ...result,
    gamification: {
      streak_warn: streakWarnResult,
      challenge_kickoff: kickoffResult,
      challenge_nudge: nudgeResult,
      total: gamificationTotal,
    },
  });
}

// ---------------------------------------------------------------------------
// Phase 35 plan 35-09 — Gamification notification branches (ethical-only).
// D-09: streak-break warning fires AT MOST ONCE per cycle.
// D-21: Monday-only kickoff + 24h-ahead nudge if not on track.
// ---------------------------------------------------------------------------

interface StreakWarnRow {
  user_id: string;
  current_streak_days: number;
}

interface ChallengeKickoffRow {
  user_id: string;
  challenge_id: string;
  framing: string;
}

interface ChallengeNudgeRow {
  user_id: string;
  challenge_id: string;
  framing: string;
  threshold: number;
  progress_count: number;
}

/** Insert an in-app user_notifications row for a gamification event. */
async function insertUserNotification(
  userId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  await (admin.from('user_notifications').insert({
    user_id: userId,
    category: 'ai-insights',
    channel: 'in-app',
    payload,
  }) as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Run the streak-warn branch: D-09 single-shot at 6pm user-local when streak at risk. */
async function runStreakWarn(): Promise<RunResult> {
  const result: RunResult = {
    processed: 0,
    sent: 0,
    skipped_already_sent: 0,
    skipped_preferences: 0,
    send_errors: 0,
  };

  try {
    // F-1 reconciliation: use SECDEF helper RPC find_streak_warn_users(p_now) which encapsulates
    // the correlated NOT EXISTS query: streak >= 1, hour=18 user-local, freeze_tokens=0, no action today.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: warnUsers, error: rpcError } = (await (admin
      .rpc('find_streak_warn_users', {
        p_now: new Date().toISOString(),
      }) as any)) as { data: StreakWarnRow[] | null; error: unknown };
    /* eslint-enable @typescript-eslint/no-explicit-any */

    if (rpcError) {
      console.warn('[lifecycle-behavior] streak_warn rpc error', rpcError);
      return result;
    }

    const todayLocal = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC date as proxy; full tz handled in DB)

    for (const row of warnUsers ?? []) {
      result.processed += 1;
      try {
        const dupKey = `streak-warn:${todayLocal}`;
        if (await alreadySent(row.user_id, dupKey)) { result.skipped_already_sent += 1; continue; }
        if (!(await isPreferenceEnabled(row.user_id, 'ai-insights'))) { result.skipped_preferences += 1; continue; }

        const notifPayload = renderGamificationPayload('gamification.streak_warn', {
          streak_days: row.current_streak_days,
        });
        await insertUserNotification(row.user_id, notifPayload);
        await markSent(row.user_id, dupKey);
        captureServer({ userId: row.user_id, event: 'streak_warn_sent', properties: { streak_days: row.current_streak_days } });
        result.sent += 1;
      } catch (e) {
        console.warn('[lifecycle-behavior] streak_warn user error', row.user_id, e);
        result.send_errors += 1;
      }
    }
  } catch (e) {
    console.warn('[lifecycle-behavior] streak_warn batch error', e);
  }

  return result;
}

/** Run the challenge-kickoff branch: D-21 Monday-only. */
async function runChallengeKickoff(): Promise<RunResult> {
  const result: RunResult = {
    processed: 0,
    sent: 0,
    skipped_already_sent: 0,
    skipped_preferences: 0,
    send_errors: 0,
  };

  try {
    // Monday-only kickoff: DOW=1 (ISO Mon), hour in [8,10] user-local, notified_kickoff_at IS NULL.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: kickoffUsers, error } = (await (admin
      .from('challenge_progress')
      .select(
        'user_id, challenge_id, weekly_challenges!inner(framing, status, starts_at), profiles!inner(timezone)',
      )
      .is('notified_kickoff_at', null)
      .eq('weekly_challenges.status', 'active') as any)) as {
      data: Array<{
        user_id: string;
        challenge_id: string;
        weekly_challenges: { framing: string; status: string; starts_at: string };
        profiles: { timezone: string };
      }> | null;
      error: unknown;
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */

    if (error) {
      console.warn('[lifecycle-behavior] challenge_kickoff query error', error);
      return result;
    }

    const now = new Date();

    for (const row of kickoffUsers ?? []) {
      // Filter Monday morning user-local (DOW=1 = Monday, hour 8-10)
      const tz = (row.profiles as { timezone?: string })?.timezone ?? 'UTC';
      const localHourStr = now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false });
      const localDowStr = now.toLocaleString('en-US', { timeZone: tz, weekday: 'narrow' });
      // Check: Monday (short weekday 'M') + hour in [8..10]
      const localHour = parseInt(localHourStr, 10);
      // Get DOW using Intl
      const dowNum = ['Su','Mo','Tu','We','Th','Fr','Sa'].indexOf(
        new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(now).slice(0, 2)
      );
      if (dowNum !== 1) continue; // not Monday
      if (localHour < 8 || localHour > 10) continue; // outside kickoff window

      // Confirm challenge started within last 7 days
      const startsAt = new Date((row.weekly_challenges as { starts_at: string }).starts_at);
      const ageMs = now.getTime() - startsAt.getTime();
      if (ageMs < 0 || ageMs > 7 * 24 * 60 * 60 * 1000) continue;

      result.processed += 1;
      try {
        const dupKey = `challenge-kickoff:${row.challenge_id}`;
        if (await alreadySent(row.user_id, dupKey)) { result.skipped_already_sent += 1; continue; }
        if (!(await isPreferenceEnabled(row.user_id, 'ai-insights'))) { result.skipped_preferences += 1; continue; }

        const notifPayload = renderGamificationPayload('gamification.challenge_kickoff', {
          challenge_id: row.challenge_id,
          challenge_framing: (row.weekly_challenges as { framing: string }).framing,
        });
        await insertUserNotification(row.user_id, notifPayload);

        // Defense-in-depth: also update notified_kickoff_at in challenge_progress.
        /* eslint-disable @typescript-eslint/no-explicit-any */
        await (admin
          .from('challenge_progress')
          .update({ notified_kickoff_at: now.toISOString() })
          .eq('user_id', row.user_id)
          .eq('challenge_id', row.challenge_id) as any);
        /* eslint-enable @typescript-eslint/no-explicit-any */

        await markSent(row.user_id, dupKey);
        captureServer({ userId: row.user_id, event: 'challenge_kickoff_sent', properties: { challenge_id: row.challenge_id } });
        result.sent += 1;
      } catch (e) {
        console.warn('[lifecycle-behavior] challenge_kickoff user error', row.user_id, e);
        result.send_errors += 1;
      }
    }
  } catch (e) {
    console.warn('[lifecycle-behavior] challenge_kickoff batch error', e);
  }

  return result;
}

/** Run the challenge-nudge branch: D-21 24h-ahead if not on track. */
async function runChallengeNudge(): Promise<RunResult> {
  const result: RunResult = {
    processed: 0,
    sent: 0,
    skipped_already_sent: 0,
    skipped_preferences: 0,
    send_errors: 0,
  };

  try {
    const now = new Date();
    const h24Later = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const h25Later = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString();

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: nudgeUsers, error } = (await (admin
      .from('challenge_progress')
      .select(
        'user_id, challenge_id, progress_count, weekly_challenges!inner(framing, status, threshold, ends_at)',
      )
      .is('notified_nudge_at', null)
      .is('completed_at', null)
      .eq('weekly_challenges.status', 'active')
      .gte('weekly_challenges.ends_at', h24Later)
      .lte('weekly_challenges.ends_at', h25Later) as any)) as {
      data: Array<{
        user_id: string;
        challenge_id: string;
        progress_count: number;
        weekly_challenges: { framing: string; status: string; threshold: number; ends_at: string };
      }> | null;
      error: unknown;
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */

    if (error) {
      console.warn('[lifecycle-behavior] challenge_nudge query error', error);
      return result;
    }

    for (const row of nudgeUsers ?? []) {
      const challenge = row.weekly_challenges as { framing: string; threshold: number };
      // Only nudge if below threshold
      if (row.progress_count >= challenge.threshold) continue;

      result.processed += 1;
      try {
        const dupKey = `challenge-nudge:${row.challenge_id}`;
        if (await alreadySent(row.user_id, dupKey)) { result.skipped_already_sent += 1; continue; }
        if (!(await isPreferenceEnabled(row.user_id, 'ai-insights'))) { result.skipped_preferences += 1; continue; }

        const notifPayload = renderGamificationPayload('gamification.challenge_nudge', {
          challenge_id: row.challenge_id,
          challenge_framing: challenge.framing,
          progress_count: row.progress_count,
          threshold: challenge.threshold,
        });
        await insertUserNotification(row.user_id, notifPayload);

        // Defense-in-depth: update notified_nudge_at.
        /* eslint-disable @typescript-eslint/no-explicit-any */
        await (admin
          .from('challenge_progress')
          .update({ notified_nudge_at: new Date().toISOString() })
          .eq('user_id', row.user_id)
          .eq('challenge_id', row.challenge_id) as any);
        /* eslint-enable @typescript-eslint/no-explicit-any */

        await markSent(row.user_id, dupKey);
        captureServer({
          userId: row.user_id,
          event: 'challenge_nudge_sent',
          properties: {
            challenge_id: row.challenge_id,
            progress: row.progress_count,
            threshold: challenge.threshold,
          },
        });
        result.sent += 1;
      } catch (e) {
        console.warn('[lifecycle-behavior] challenge_nudge user error', row.user_id, e);
        result.send_errors += 1;
      }
    }
  } catch (e) {
    console.warn('[lifecycle-behavior] challenge_nudge batch error', e);
  }

  return result;
}

/** Merge two RunResult objects (for combining gamification branch results). */
function mergeResults(a: RunResult, b: RunResult): RunResult {
  return {
    processed: a.processed + b.processed,
    sent: a.sent + b.sent,
    skipped_already_sent: a.skipped_already_sent + b.skipped_already_sent,
    skipped_preferences: a.skipped_preferences + b.skipped_preferences,
    send_errors: a.send_errors + b.send_errors,
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');
  try {
    return await handleRun(req);
  } catch (e) {
    console.warn('[lifecycle-behavior] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal');
  }
});

export const __internal = {
  handleRun,
  setAdminForTest,
  resetAdminForTest,
  // Phase 35 plan 35-09 — gamification branch test seams
  runStreakWarn,
  runChallengeKickoff,
  runChallengeNudge,
};
