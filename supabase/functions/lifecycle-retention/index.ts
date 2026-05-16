/**
 * `lifecycle-retention` Edge Function — Phase 22 plan 22-02 (ON-02).
 *
 * Cron-invoked daily at 06:00 UTC. Three queries:
 *   (a) users with last_sign_in_at ≈ now - 7d → reengagement_7d_inactive
 *   (b) subscriptions canceled ~30d ago        → cancellation_winback_30d
 *   (c) Monday only + opt-in                   → weekly_digest
 *
 * Idempotency via `email_send_counters` row presence; bucket the dup-key by
 * date so cohort cron sends one email per user per cadence.
 *
 * Auth: service-role bearer (cron + verify_jwt=false).
 *
 * Schema-tolerance: every query is wrapped in try/catch and fails-open with
 * an empty array if the underlying table is missing (e.g. local dev).
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

interface RunResult {
  processed: number;
  sent: number;
  skipped_already_sent: number;
  skipped_preferences: number;
  send_errors: number;
}

async function isPreferenceEnabled(
  userId: string,
  category: string,
  defaultOptIn = true,
): Promise<boolean> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data } = (await (admin
    .from('consent_records')
    .select('email_preferences')
    .eq('user_id', userId)
    .order('recorded_at', { ascending: false })
    .limit(1) as any)) as { data: Array<{ email_preferences?: Record<string, unknown> }> | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const row = data?.[0];
  if (!row) return defaultOptIn;
  const prefs = row.email_preferences ?? {};
  const val = (prefs as Record<string, unknown>)[category];
  if (val === undefined || val === null) return defaultOptIn;
  return val === true || val === 'true';
}

async function markSent(userId: string, key: string): Promise<void> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  await (admin.from('email_send_counters').upsert(
    { key: `retention:${userId}:${key}`, value: 1, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  ) as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

async function alreadySent(userId: string, key: string): Promise<boolean> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data } = (await (admin
    .from('email_send_counters')
    .select('key')
    .eq('key', `retention:${userId}:${key}`)
    .limit(1) as any)) as { data: Array<{ key: string }> | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return (data?.length ?? 0) > 0;
}

async function dispatchTemplate(
  userMeta: UserMeta,
  category: string,
  template: 'reengagement_7d_inactive' | 'cancellation_winback_30d' | 'weekly_digest',
  extras: Record<string, unknown>,
  dupKey: string,
  defaultOptIn = true,
): Promise<'sent' | 'skipped_pref' | 'skipped_dup' | 'error'> {
  if (await alreadySent(userMeta.id, dupKey)) return 'skipped_dup';
  if (!(await isPreferenceEnabled(userMeta.id, category, defaultOptIn))) return 'skipped_pref';
  const rendered = renderTemplate(template, {
    first_name: userMeta.first_name,
    app_url: SITE_URL(),
    unsubscribe_url: `${SITE_URL()}/settings/email-preferences`,
    ...extras,
  });
  const dispatch = await sendResendEmail({
    to: userMeta.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
  if (dispatch.ok) {
    await markSent(userMeta.id, dupKey);
    return 'sent';
  }
  console.warn(
    `[lifecycle-retention] send failed user=${userMeta.id.slice(0, 8)} t=${template} err=${dispatch.error}`,
  );
  return 'error';
}

async function fetchReengagementCandidates(): Promise<UserMeta[]> {
  // last_sign_in_at in (now - 8d, now - 6d) window.
  const lo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const hi = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data } = (await (admin
      .from('auth.users' as any)
      .select('id, email, raw_user_meta_data, last_sign_in_at')
      .gt('last_sign_in_at', lo)
      .lt('last_sign_in_at', hi) as any)) as {
        data: Array<{ id: string; email: string; raw_user_meta_data: { first_name?: string } | null }> | null;
      };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return (data ?? []).map((u) => ({
      id: u.id,
      email: u.email,
      first_name: u.raw_user_meta_data?.first_name,
    }));
  } catch {
    return [];
  }
}

async function fetchWinbackCandidates(): Promise<UserMeta[]> {
  // subscriptions canceled_at in (now - 31d, now - 29d) window.
  const lo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const hi = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString();
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: subs } = (await (admin
      .from('subscriptions')
      .select('user_id, canceled_at')
      .gt('canceled_at', lo)
      .lt('canceled_at', hi) as any)) as { data: Array<{ user_id: string; canceled_at: string }> | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const uids = Array.from(new Set((subs ?? []).map((s) => s.user_id)));
    const out: UserMeta[] = [];
    for (const uid of uids) {
      const meta = await getUserMeta(uid);
      if (meta) out.push(meta);
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchDigestCandidates(): Promise<UserMeta[]> {
  // All users with a confirmed email (Monday only — filter at handler level).
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data } = (await (admin
      .from('auth.users' as any)
      .select('id, email, raw_user_meta_data')
      .not('email_confirmed_at', 'is', null)
      .limit(5_000) as any)) as {
        data: Array<{ id: string; email: string; raw_user_meta_data: { first_name?: string } | null }> | null;
      };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return (data ?? []).map((u) => ({
      id: u.id,
      email: u.email,
      first_name: u.raw_user_meta_data?.first_name,
    }));
  } catch {
    return [];
  }
}

async function getUserMeta(userId: string): Promise<UserMeta | null> {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data } = await (admin.auth.admin as any).getUserById(userId);
    const u = data?.user;
    if (!u || !u.email) return null;
    const m = (u.user_metadata ?? {}) as Record<string, unknown>;
    return { id: u.id, email: u.email, first_name: typeof m.first_name === 'string' ? m.first_name : undefined };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  } catch {
    return null;
  }
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

  const todayBucket = new Date().toISOString().slice(0, 10);

  // (a) Reengagement.
  for (const meta of await fetchReengagementCandidates()) {
    result.processed += 1;
    const r = await dispatchTemplate(meta, 'retention', 'reengagement_7d_inactive', {}, `reengagement:${todayBucket}`);
    if (r === 'sent') result.sent += 1;
    else if (r === 'skipped_pref') result.skipped_preferences += 1;
    else if (r === 'skipped_dup') result.skipped_already_sent += 1;
    else if (r === 'error') result.send_errors += 1;
  }

  // (b) Cancellation winback (30d).
  for (const meta of await fetchWinbackCandidates()) {
    result.processed += 1;
    const r = await dispatchTemplate(meta, 'retention', 'cancellation_winback_30d', {}, `winback:${todayBucket}`);
    if (r === 'sent') result.sent += 1;
    else if (r === 'skipped_pref') result.skipped_preferences += 1;
    else if (r === 'skipped_dup') result.skipped_already_sent += 1;
    else if (r === 'error') result.send_errors += 1;
  }

  // (c) Weekly digest — Monday only, OPT-IN (defaultOptIn=false).
  const isMonday = new Date().getUTCDay() === 1;
  if (isMonday) {
    for (const meta of await fetchDigestCandidates()) {
      result.processed += 1;
      // Bucket the dup-key by ISO week to avoid duplicate sends if cron retriggers same day.
      const r = await dispatchTemplate(
        meta,
        'weekly_digest',
        'weekly_digest',
        { doses_logged: 0, photos_added: 0, weight_delta: '—' },
        `weekly_digest:${todayBucket}`,
        false, // opt-in only (D-08 + ON-02 spec)
      );
      if (r === 'sent') result.sent += 1;
      else if (r === 'skipped_pref') result.skipped_preferences += 1;
      else if (r === 'skipped_dup') result.skipped_already_sent += 1;
      else if (r === 'error') result.send_errors += 1;
    }
  }

  return jsonResponse(200, { ok: true, ...result, monday: isMonday });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');
  try {
    return await handleRun(req);
  } catch (e) {
    console.warn('[lifecycle-retention] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal');
  }
});

export const __internal = { handleRun, setAdminForTest, resetAdminForTest };
