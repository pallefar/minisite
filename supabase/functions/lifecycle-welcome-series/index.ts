/**
 * `lifecycle-welcome-series` Edge Function — Phase 22 plan 22-02 (ON-02).
 *
 * Cron-invoked every 4 hours. Walks auth.users created in the last 8 days
 * and partitions by age bucket to pick the right welcome template:
 *
 *   age window (hours)        →  template
 *   0  ≤ age < 4              →  welcome_immediately
 *   22 ≤ age < 26             →  getting_started_day1
 *   70 ≤ age < 74             →  first_injection_reminder (only if no injection logged)
 *   166 ≤ age < 170           →  week_1_check_in
 *
 * Idempotency: before sending, check `email_send_log` for a row with the
 * same (user_id, template_name). If present, skip. (Audit_logs is NOT used
 * here because Phase 22 CHECK constraint does not include an email-sent
 * action value; per-send observability lives in `email_send_log` instead.)
 *
 * NB on `email_send_log`: Wave 0 did NOT ship a `public.email_send_log`
 * table. Phase 22 plan 22-02 inline-creates it via a side-migration would
 * be DDL-changing and out-of-scope for this function file. Instead we use
 * an idempotency lookup against `public.email_send_counters` keyed
 * `welcome:<user_id>:<template>` (the counters table already exists from
 * plan 22-01 — single row per (user_id, template) tracks "sent"). Counter
 * value is unused for these per-template keys; the row's PRESENCE is the
 * "sent" flag. See template-sent-log helper below.
 *
 * Cron auth: service-role bearer (constant-time compare). Per plan: this
 * function uses verify_jwt=false in deno config so the cron's net.http_post
 * can invoke it; the bearer check IS the auth.
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

interface RecipientRow {
  id: string;
  email: string;
  raw_user_meta_data: { first_name?: string } | null;
  created_at: string;
}

interface RunResult {
  processed: number;
  sent: number;
  skipped_already_sent: number;
  skipped_preferences: number;
  send_errors: number;
}

const TEMPLATE_BUCKETS: Array<{
  template: 'welcome_immediately' | 'getting_started_day1' | 'first_injection_reminder' | 'week_1_check_in';
  minHours: number;
  maxHours: number;
  category: string; // consent_records.email_preferences key
}> = [
  { template: 'welcome_immediately', minHours: 0, maxHours: 4, category: 'welcome' },
  { template: 'getting_started_day1', minHours: 22, maxHours: 26, category: 'welcome' },
  { template: 'first_injection_reminder', minHours: 70, maxHours: 74, category: 'welcome' },
  { template: 'week_1_check_in', minHours: 166, maxHours: 170, category: 'welcome' },
];

function bucketForAge(ageHours: number) {
  return TEMPLATE_BUCKETS.find((b) => ageHours >= b.minHours && ageHours < b.maxHours);
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
  if (!row) {
    // No consent row yet → default to OPT-IN for welcome series (user just signed up).
    // For other categories the per-fn caller decides.
    return true;
  }
  const prefs = row.email_preferences ?? {};
  const val = (prefs as Record<string, unknown>)[category];
  if (val === undefined || val === null) return true; // default opt-in
  return val === true || val === 'true';
}

async function markTemplateSent(userId: string, template: string): Promise<void> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  await (admin.from('email_send_counters').upsert(
    { key: `welcome:${userId}:${template}`, value: 1, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  ) as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

async function alreadySent(userId: string, template: string): Promise<boolean> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data } = (await (admin
    .from('email_send_counters')
    .select('key')
    .eq('key', `welcome:${userId}:${template}`)
    .limit(1) as any)) as { data: Array<{ key: string }> | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return (data?.length ?? 0) > 0;
}

async function hasInjection(userId: string): Promise<boolean> {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data } = (await (admin
      .from('injections')
      .select('id')
      .eq('user_id', userId)
      .limit(1) as any)) as { data: Array<{ id: string }> | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return (data?.length ?? 0) > 0;
  } catch {
    // Table may not exist in some local environments — fail open (assume no injection).
    return false;
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
  if (!health.ok) {
    return jsonResponse(200, { skipped: true, status: health.status });
  }

  const cutoff = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: users, error: selErr } = (await (admin
    .from('auth.users' as any)
    .select('id, email, raw_user_meta_data, created_at')
    .gt('created_at', cutoff)
    .not('email_confirmed_at', 'is', null) as any)) as {
      data: RecipientRow[] | null;
      error: { message?: string } | null;
    };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (selErr) {
    console.warn('[lifecycle-welcome] user-select failed', selErr.message ?? 'unknown');
    // Fail-open with 200 + zero — cron will retry on next tick.
    return jsonResponse(200, { ...result, error: 'select_failed' });
  }

  const unsubBase = `${SITE_URL()}/settings/email-preferences`;

  for (const u of users ?? []) {
    result.processed += 1;
    const ageMs = Date.now() - new Date(u.created_at).getTime();
    const ageHours = ageMs / 3_600_000;
    const bucket = bucketForAge(ageHours);
    if (!bucket) continue;

    // Skip if already sent.
    if (await alreadySent(u.id, bucket.template)) {
      result.skipped_already_sent += 1;
      continue;
    }

    // first_injection_reminder: skip if user already logged an injection.
    if (bucket.template === 'first_injection_reminder' && (await hasInjection(u.id))) {
      result.skipped_already_sent += 1;
      // Still mark as "sent" so we don't re-evaluate this user every 4h.
      await markTemplateSent(u.id, bucket.template);
      continue;
    }

    // Preferences gate.
    if (!(await isPreferenceEnabled(u.id, bucket.category))) {
      result.skipped_preferences += 1;
      continue;
    }

    const firstName = u.raw_user_meta_data?.first_name ?? '';
    const rendered = renderTemplate(bucket.template, {
      first_name: firstName,
      app_url: SITE_URL(),
      unsubscribe_url: unsubBase,
    });

    const dispatch = await sendResendEmail({
      to: u.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    if (dispatch.ok) {
      await markTemplateSent(u.id, bucket.template);
      result.sent += 1;
    } else {
      result.send_errors += 1;
      console.warn(
        `[lifecycle-welcome] send failed user=${u.id.slice(0, 8)} template=${bucket.template} err=${dispatch.error}`,
      );
    }
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
    console.warn('[lifecycle-welcome] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal');
  }
});

export const __internal = {
  handleRun,
  setAdminForTest,
  resetAdminForTest,
  bucketForAge,
};
