/**
 * `community-daily-digest` Edge Function — Phase 49 Plan 49-06 (DIGEST-02).
 *
 * Per-user daily community digest. Invoked hourly by the pg_cron schedule
 * (Plan 49-05) which fans out one POST per qualifying user. The cron passes
 * the service_role bearer + `{ user_id }` body shape.
 *
 * Lifecycle (per plan tasks + PATTERNS.md Pattern G, RESEARCH §Example 4):
 *
 *   1. Auth: `checkServiceRoleBearer` — constant-time compare against
 *      `SUPABASE_SERVICE_ROLE_KEY` (handles the new `sb_secret_*` token format
 *      per memory `reference_supabase_service_role_key_format_divergence`).
 *      401 on mismatch.
 *   2. Body: require `{ user_id: string }`. 400 on missing.
 *   3. Compute 3 content buckets via `Promise.all` on 3 SECDEF helper RPCs
 *      (digest_top_posts_in_spaces, digest_new_comments_on_my_posts,
 *      digest_recent_mentions). Each RPC takes `p_user_id` explicitly — the
 *      service-role caller has no session-user predicate to fall back on (per
 *      memory `feedback_rpc_auth_uid_vs_service_role_mismatch`).
 *   4. If all 3 buckets empty → UPSERT `digest_send_log` row with
 *      status='skipped:no-content' + return 200. NO email send.
 *   5. Opt-out check on `notification_settings` for
 *      (user_id, category='daily_community_digest', channel='email'):
 *      if `enabled === false` → UPSERT status='skipped:opted_out' +
 *      return 200; NO email send. Missing row falls through to category-config
 *      default (opt-IN per D-19).
 *   6. Fetch the user's email via `admin.auth.admin.getUserById(userId)`
 *      (per memory `reference_profiles_email_vs_auth_users_email` — profiles
 *      has NO email column). If no email → UPSERT status='error' + return 200.
 *   7. Mint a 90-day 1-click unsubscribe URL via `mintUnsubscribeToken`
 *      (Plan 49-08), category='daily_community_digest'.
 *   8. Call `sendEmail({ template: 'community_daily_digest', phi: false, ...,
 *      headers: { 'List-Unsubscribe': '<url>',
 *      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } })`.
 *   9. UPSERT `digest_send_log` row with status='sent'.
 *
 * Logging discipline: never log raw post bodies, comment bodies, or recipient
 * email. Log: status, bucket counts, user_id prefix (first 8 chars).
 *
 * Per memory `reference_deno_test_top_level_serve_trap` — `Deno.serve` is
 * wrapped in an env-var guard so `deno test` imports do NOT bind a port.
 */

import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';
import { sendEmail } from '../_shared/email-router.ts';
import { mintUnsubscribeToken } from '../_shared/unsubscribe-token.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// ─── Lazy admin singleton (production wiring) ────────────────────────────────

const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

// ─── Types ────────────────────────────────────────────────────────────────────

interface TopPostRow {
  post_id: string;
  space_id: string;
  space_name: string;
  body: string;
  score: number;
}

interface NewCommentRow {
  comment_id: string;
  post_id: string;
  body: string;
  author_id: string;
  created_at: string;
}

interface MentionRow {
  post_id: string;
  post_body: string;
  mentioner_id: string;
  mention_kind: string;
}

interface DailyDigestContent {
  topPosts: TopPostRow[];
  newComments: NewCommentRow[];
  mentions: MentionRow[];
}

type DigestSendStatus =
  | 'sent'
  | 'skipped:no-content'
  | 'skipped:opted_out'
  | 'error';

interface RunResult {
  status: DigestSendStatus;
  bucket_counts?: { topPosts: number; newComments: number; mentions: number };
  reason?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Call the 3 daily-digest SECDEF RPCs concurrently. Each RPC takes
 * `p_user_id` because the service-role caller has no session-user predicate
 * (per memory `feedback_rpc_auth_uid_vs_service_role_mismatch`).
 */
export async function computeDailyDigest(
  supabase: SupabaseClient,
  userId: string,
): Promise<DailyDigestContent> {
  // deno-lint-ignore no-explicit-any
  const c = supabase as any;
  const [topRes, commentsRes, mentionsRes] = await Promise.all([
    c.rpc('digest_top_posts_in_spaces', { p_user_id: userId }),
    c.rpc('digest_new_comments_on_my_posts', { p_user_id: userId }),
    c.rpc('digest_recent_mentions', { p_user_id: userId }),
  ]);
  return {
    topPosts: Array.isArray(topRes?.data) ? (topRes.data as TopPostRow[]) : [],
    newComments: Array.isArray(commentsRes?.data)
      ? (commentsRes.data as NewCommentRow[])
      : [],
    mentions: Array.isArray(mentionsRes?.data)
      ? (mentionsRes.data as MentionRow[])
      : [],
  };
}

/** True iff every bucket is empty (no email-worthy content for this user). */
export function isEmpty(content: DailyDigestContent): boolean {
  return (
    content.topPosts.length === 0 &&
    content.newComments.length === 0 &&
    content.mentions.length === 0
  );
}

/**
 * UPSERT one row into `digest_send_log` with the canonical conflict key
 * (user_id, kind, sent_date) — per Plan 49-04 migration.
 *
 * Per memory `feedback_state_counter_table_needs_upsert_on_event`: counter
 * tables keyed by (user, slot) must use INSERT … ON CONFLICT, not bare UPDATE.
 * `sent_date` is a GENERATED column so the conflict collapses to one row per
 * UTC calendar day regardless of intra-day retries.
 */
async function upsertDigestLog(
  supabase: SupabaseClient,
  userId: string,
  status: DigestSendStatus,
  err?: string,
): Promise<void> {
  // deno-lint-ignore no-explicit-any
  const c = supabase as any;
  try {
    await c.from('digest_send_log').upsert(
      {
        user_id: userId,
        kind: 'daily',
        sent_at: new Date().toISOString(),
        status,
        error_message: err ?? null,
      },
      { onConflict: 'user_id,kind,sent_date' },
    );
  } catch (e) {
    // Audit failure is logged but does NOT fail the run — surfaces in Sentry.
    console.warn(
      '[community-daily-digest] digest_send_log upsert failed',
      e instanceof Error ? e.name : 'unknown',
    );
  }
}

/**
 * Check if the user has explicitly opted out of the daily community digest
 * email channel. Returns `true` when `enabled === false`; missing row OR
 * `enabled === true` returns `false` (i.e. proceed with send).
 *
 * Per D-19 the default is opt-IN, so missing rows fall through and the user
 * receives the digest on day 1 (the settings UI seeds the row on first edit).
 */
async function isOptedOut(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  // deno-lint-ignore no-explicit-any
  const c = supabase as any;
  try {
    const res = await c
      .from('notification_settings')
      .select('enabled')
      .eq('user_id', userId)
      .eq('category', 'daily_community_digest')
      .eq('channel', 'email')
      .maybeSingle();
    return res?.data?.enabled === false;
  } catch (e) {
    // Missing-row OR query-error → fall through (default opt-IN per D-19).
    console.warn(
      '[community-daily-digest] notification_settings lookup failed',
      e instanceof Error ? e.name : 'unknown',
    );
    return false;
  }
}

/** Fetch the user's email via the auth.admin namespace (service-role only). */
async function getUserEmail(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  // deno-lint-ignore no-explicit-any
  const c = supabase as any;
  try {
    const { data } = await c.auth.admin.getUserById(userId);
    const email = data?.user?.email;
    return typeof email === 'string' && email.length > 0 ? email : null;
  } catch {
    return null;
  }
}

/**
 * Build the 1-click unsubscribe URL. The token's HMAC is the only auth (per
 * RFC 8058 the unsubscribe handler accepts the POST without a session header)
 * so the token must include `user_id` + `category` + a far-future `exp` so
 * stale links remain usable for ~90 days.
 */
function buildUnsubscribeUrl(userId: string): string {
  const token = mintUnsubscribeToken({
    user_id: userId,
    category: 'daily_community_digest',
    exp: Math.floor(Date.now() / 1000) + 90 * 86400,
  });
  return `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/unsubscribe-handler?t=${encodeURIComponent(token)}`;
}

// ─── Public run handler (test seam) ──────────────────────────────────────────

/**
 * Per-user dispatch sequence. Exposed via `__internal.handleRun` so deno
 * tests can drive it without going through `Deno.serve`.
 *
 * Every exit path emits exactly ONE `digest_send_log` UPSERT (sent / skipped /
 * error). The function never throws — failures convert to status='error' rows.
 */
export async function handleRun(userId: string): Promise<RunResult> {
  const supabase = admin as SupabaseClient;

  if (!userId || typeof userId !== 'string') {
    return { status: 'error', reason: 'missing_user_id' };
  }

  // ── Step 3: compute 3 buckets via Promise.all. ──────────────────────────
  let content: DailyDigestContent;
  try {
    content = await computeDailyDigest(supabase, userId);
  } catch (e) {
    await upsertDigestLog(supabase, userId, 'error', 'compute_failed');
    console.warn(
      '[community-daily-digest] compute failed',
      e instanceof Error ? e.name : 'unknown',
    );
    return { status: 'error', reason: 'compute_failed' };
  }

  const bucket_counts = {
    topPosts: content.topPosts.length,
    newComments: content.newComments.length,
    mentions: content.mentions.length,
  };

  // ── Step 4: empty-content short-circuit. ────────────────────────────────
  if (isEmpty(content)) {
    await upsertDigestLog(supabase, userId, 'skipped:no-content');
    return { status: 'skipped:no-content', bucket_counts };
  }

  // ── Step 5: opt-out check. ──────────────────────────────────────────────
  if (await isOptedOut(supabase, userId)) {
    await upsertDigestLog(supabase, userId, 'skipped:opted_out');
    return { status: 'skipped:opted_out', bucket_counts };
  }

  // ── Step 6: fetch the user's email. ─────────────────────────────────────
  const email = await getUserEmail(supabase, userId);
  if (!email) {
    await upsertDigestLog(supabase, userId, 'error', 'no_email');
    return { status: 'error', reason: 'no_email', bucket_counts };
  }

  // ── Step 7: mint unsubscribe URL. ───────────────────────────────────────
  let unsubUrl: string;
  try {
    unsubUrl = buildUnsubscribeUrl(userId);
  } catch (e) {
    // UNSUBSCRIBE_SECRET missing — record + bail; do NOT send an email
    // without an unsubscribe URL (RFC 8058 + Gmail bulk-sender rule).
    await upsertDigestLog(supabase, userId, 'error', 'unsub_mint_failed');
    console.warn(
      '[community-daily-digest] mintUnsubscribeToken failed',
      e instanceof Error ? e.name : 'unknown',
    );
    return { status: 'error', reason: 'unsub_mint_failed', bucket_counts };
  }

  // ── Step 8: send the email via the shared router (non-PHI path). ────────
  try {
    await sendEmail(supabase, {
      template: 'community_daily_digest',
      to: email,
      vars: { content, unsubUrl },
      phi: false,
      headers: {
        'List-Unsubscribe': `<${unsubUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
  } catch (e) {
    await upsertDigestLog(supabase, userId, 'error', 'send_failed');
    console.warn(
      '[community-daily-digest] sendEmail threw',
      e instanceof Error ? e.name : 'unknown',
    );
    return { status: 'error', reason: 'send_failed', bucket_counts };
  }

  // ── Step 9: success — record the audit row. ─────────────────────────────
  await upsertDigestLog(supabase, userId, 'sent');
  return { status: 'sent', bucket_counts };
}

// ─── Serve handler (production runtime entry point) ─────────────────────────
//
// Guarded by `COMMUNITY_DAILY_DIGEST_DISABLE_SERVE=1` so unit tests can import
// the module without binding a port (per memory
// `reference_deno_test_top_level_serve_trap`). Production invocation never
// sets the env var → `Deno.serve` runs normally.

if (Deno.env.get('COMMUNITY_DAILY_DIGEST_DISABLE_SERVE') !== '1') {
  Deno.serve(async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

    if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');

    let body: { user_id?: string };
    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'invalid_json');
    }
    if (!body?.user_id || typeof body.user_id !== 'string') {
      return jsonError(400, 'missing_user_id');
    }

    try {
      const res = await handleRun(body.user_id);
      return jsonResponse(200, res);
    } catch (e) {
      console.warn(
        '[community-daily-digest] unhandled',
        e instanceof Error ? e.name : 'unknown',
      );
      return jsonError(500, 'internal');
    }
  });
}

// ─── Test seam ──────────────────────────────────────────────────────────────

export const __internal = {
  handleRun,
  computeDailyDigest,
  isEmpty,
  setAdminForTest,
  resetAdminForTest,
};
