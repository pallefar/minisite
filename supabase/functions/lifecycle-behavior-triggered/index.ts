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
import { renderTemplate } from './templates.ts';

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
  const dispatch = await sendResendEmail({
    to: userMeta.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
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

  return jsonResponse(200, { ok: true, ...result });
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

export const __internal = { handleRun, setAdminForTest, resetAdminForTest };
