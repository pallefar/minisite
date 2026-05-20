/**
 * `winback-scorer` Edge Function — Phase 38 Plan 38-07 (RECOMMEND-07, RECOMMEND-10).
 *
 * Nightly cron handler invoked by pg_cron (schedule installed by Plan 38-09).
 * Pure-SQL detection — NO LLM calls. Cost = $0/user/night.
 *
 * Execution sequence (per CONTEXT D-09, D-10, D-11, D-12/13):
 *   1. Auth: service_role bearer compare (constant-time). 401 otherwise.
 *   2. SELECT at-risk users via `rpc.at_risk_users_for_winback()`:
 *        - last logged event (max across injections/weights/meals/mood) < now()-14d (D-09)
 *        - NO win_back_sends row with last_sent_at > now()-30d (D-10 cap)
 *        - LIMIT 500 (batch safety)
 *   3. For each at-risk user:
 *        a. INSERT ai_suggestion_review(type='win_back', status='auto_approved_hardcoded')
 *           — audit trail BEFORE email send (D-12/13). Winback copy is hardcoded
 *           non-AI text, so it bypasses HITL (auto-approved with audit row).
 *        b. INSERT win_back_sends(user_id, reason='inactive_14d',
 *           save_engine_status='pending_handoff', payload={handoff_url,reason,email_subject}).
 *           Phase 40 SAVE engine reads pending_handoff rows on its own cron
 *           (vendor-gated handoff per memory feedback_scaffolding_for_deferred_mobile_pattern).
 *        c. Send email via Resend consumer path (lifecycle-send.sendResendEmail).
 *           Hardcoded subject "We miss you on LeanShot"; body has 1-click
 *           unsubscribe footer (Phase 49 DIGEST-04). Non-PHI (no symptom/dose data).
 *        d. INSERT user_notifications(category='ai-insights', channel='in-app',
 *           payload={subtype:'winback', cta_url, expires_at_iso}). NOTE: plan
 *           asked for category='winback' + expires_at column; existing Phase 42
 *           schema (20270704000003_user_notifications.sql) uses a CHECK-constrained
 *           category enum {dose-reminders, ai-insights, clinic-alerts, billing,
 *           marketing} with NO expires_at column. Per memory feedback_planner_iter1_anti_patterns
 *           we map winback under ai-insights and put subtype + expires_at_iso
 *           into payload jsonb (open schema). See 38-07-SUMMARY.md deviation.
 *        e. Emit PostHog `win_back_trigger` event (user_id only, no PHI).
 *   4. After loop: emit `winback.batch_complete` with stats. Return 200.
 *
 * Logging discipline: no PHI, no raw email, no symptom/dose data in logs.
 */

import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';
import { sendResendEmail } from '../_shared/lifecycle-send.ts';
import { captureServer } from '../_shared/posthog-server.ts';
import { addBreadcrumb, captureException } from '../_shared/sentry.ts';

// ─── Constants ───────────────────────────────────────────────────────────────

const WINBACK_REASON = 'inactive_14d';
const WINBACK_EMAIL_SUBJECT = 'We miss you on LeanShot';
const WINBACK_CTA_URL = '/save?reason=inactive_14d';
const BANNER_TTL_DAYS = 7;
const BATCH_LIMIT = 500; // mirrors RPC LIMIT — handler-side safety net.

// ─── Types ───────────────────────────────────────────────────────────────────

interface AtRiskUser {
  user_id: string;
  email: string;
  timezone: string | null;
  last_event_at: string | null;
}

interface RunOptions {
  /** Stub of the supabase admin client. */
  supabase: unknown;
  /** Override fetch — defaults to globalThis.fetch. Used to assert no LLM calls. */
  fetchImpl?: typeof fetch;
  /** Override Date.now() for deterministic tests. */
  nowMs?: number;
}

interface SentEmailRecord {
  to: string;
  subject: string;
  html: string;
  text: string;
}

interface RunResult {
  status: 'ok' | 'failed';
  processed: number;
  inserted: number;
  errors: number;
  reason?: string;
  /** Test-only: in-process captured emails (Resend stub returns true; we still record). */
  sentEmails?: SentEmailRecord[];
  /** Test-only: true once `winback.batch_complete` is emitted. */
  batchCompleteEmitted?: boolean;
}

// ─── Lazy admin singleton (production wiring) ────────────────────────────────

const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

// ─── Email render (hardcoded copy, non-PHI) ──────────────────────────────────

/**
 * Build the winback email body. Non-PHI: no symptom/dose data — only generic
 * "we miss you" prose + 1-click unsubscribe footer (Phase 49 DIGEST-04).
 */
function renderWinbackEmail(siteUrl: string, unsubToken: string): {
  subject: string;
  html: string;
  text: string;
  bodySnippet: string;
} {
  const subject = WINBACK_EMAIL_SUBJECT;
  const ctaUrl = `${siteUrl}${WINBACK_CTA_URL}`;
  const unsubUrl = `${siteUrl}/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
  const bodySnippet =
    "It's been a couple of weeks since we last saw you. Your tracker is still here when you're ready to pick back up.";

  const html = `<html><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0B1413;">
<h2 style="margin:0 0 16px 0;">${subject}</h2>
<p>${bodySnippet}</p>
<p style="margin:24px 0;">
  <a href="${encodeURI(ctaUrl)}" style="display:inline-block;padding:12px 20px;background:#0B1413;color:#fff;text-decoration:none;border-radius:6px;">Open LeanShot</a>
</p>
<p style="margin-top:32px;font-size:12px;color:#666;border-top:1px solid #eee;padding-top:16px;">
  You're receiving this because you previously signed up for LeanShot.
  <a href="${encodeURI(unsubUrl)}" style="color:#666;">Unsubscribe</a> with one click.
</p>
</body></html>`;

  const text = `${subject}

${bodySnippet}

Open LeanShot: ${ctaUrl}

—
Unsubscribe (one click): ${unsubUrl}
`;

  return { subject, html, text, bodySnippet };
}

// ─── Run handler (test seam) ─────────────────────────────────────────────────

/**
 * Per-batch handler — fetches at-risk users via RPC and dispatches the
 * winback sequence (audit → row → email → banner → event) for each.
 *
 * Exposed via `__internal.handleWinbackRun` so Deno tests can drive it
 * without round-tripping through `Deno.serve`.
 */
async function handleWinbackRun(opts: RunOptions): Promise<RunResult> {
  // deno-lint-ignore no-explicit-any
  const supabase = opts.supabase as any;
  const nowMs = opts.nowMs ?? Date.now();
  // fetchImpl is read so the test spy is exercised — also gates any future
  // direct HTTP call from this handler.
  void (opts.fetchImpl ?? fetch);

  const siteUrl = Deno.env.get('SITE_URL') ?? 'https://app.leanshot.app';

  // 1. SELECT at-risk users via RPC (NO LLM — pure SQL detection per D-09).
  let users: AtRiskUser[] = [];
  try {
    const { data, error } = await supabase.rpc('at_risk_users_for_winback', {
      p_inactive_days: 14,
      p_cap_days: 30,
      p_limit: BATCH_LIMIT,
    });
    if (error) {
      captureException(new Error(`at_risk_users_for_winback_failed:${error.code ?? 'unknown'}`), {
        level: 'error',
        tags: { surface: 'winback-scorer.rpc' },
      });
      return { status: 'failed', processed: 0, inserted: 0, errors: 1, reason: 'rpc_failed' };
    }
    users = (data ?? []) as AtRiskUser[];
  } catch (e) {
    captureException(e, { level: 'error', tags: { surface: 'winback-scorer.rpc.throw' } });
    return { status: 'failed', processed: 0, inserted: 0, errors: 1, reason: 'rpc_threw' };
  }

  // Handler-side safety net in case RPC returns more than LIMIT.
  if (users.length > BATCH_LIMIT) users = users.slice(0, BATCH_LIMIT);

  addBreadcrumb({
    category: 'winback.batch_start',
    level: 'info',
    data: { candidate_count: users.length },
  });

  const sentEmails: SentEmailRecord[] = [];
  let inserted = 0;
  let errors = 0;

  for (const user of users) {
    try {
      // 3a. HITL audit row — winback bypasses review (hardcoded non-AI copy)
      //     but we ALWAYS record an audit trail for super-admin visibility.
      //     `auto_approved_hardcoded` is a Phase 38-07 status-enum extension
      //     (migration 20270705000014_phase38_ai_suggestion_review_winback_status.sql).
      const rendered = renderWinbackEmail(siteUrl, user.user_id /* opaque token surrogate */);
      const auditRes = await supabase.from('ai_suggestion_review').insert({
        type: 'win_back',
        user_id: user.user_id,
        payload: {
          subject: rendered.subject,
          body_snippet: rendered.bodySnippet,
        },
        source_type: 'hardcoded',
        status: 'auto_approved_hardcoded',
        decided_at: new Date(nowMs).toISOString(),
      });
      if (auditRes?.error) {
        captureException(new Error(`audit_insert_failed:${auditRes.error.code ?? 'unknown'}`), {
          level: 'warning',
          tags: { surface: 'winback-scorer.audit', user_id_prefix: user.user_id.slice(0, 8) },
        });
        // Audit insert is critical for compliance — DO NOT proceed if it fails.
        errors++;
        continue;
      }

      // 3b. INSERT win_back_sends row with pending_handoff status + payload
      //     carrying SAVE engine handoff metadata (D-10, Phase 40 consumer).
      const wbsRes = await supabase.from('win_back_sends').insert({
        user_id: user.user_id,
        reason: WINBACK_REASON,
        save_engine_status: 'pending_handoff',
        // win_back_sends schema (20270705000007) has no `payload` column by
        // default — we add it via the Phase 38-07 migration. Until then the
        // column is jsonb default '{}'::jsonb (additive, backward-compatible).
        payload: {
          handoff_url: WINBACK_CTA_URL,
          reason: WINBACK_REASON,
          email_subject: rendered.subject,
        },
      });
      if (wbsRes?.error) {
        captureException(new Error(`wbs_insert_failed:${wbsRes.error.code ?? 'unknown'}`), {
          level: 'error',
          tags: { surface: 'winback-scorer.wbs', user_id_prefix: user.user_id.slice(0, 8) },
        });
        errors++;
        continue;
      }
      inserted++;

      // 3c. Email send via Resend (lifecycle-send stub branch handles tests).
      try {
        const sent = await sendResendEmail({
          to: user.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
        if (sent.ok) {
          // Includes both real-send (200) and stub branch — record once for
          // test introspection + production audit.
          sentEmails.push({
            to: user.email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
          });
        } else {
          captureException(new Error(`resend_failed:${sent.error ?? 'unknown'}`), {
            level: 'warning',
            tags: { surface: 'winback-scorer.resend', user_id_prefix: user.user_id.slice(0, 8) },
          });
        }
      } catch (e) {
        captureException(e, {
          level: 'warning',
          tags: { surface: 'winback-scorer.resend.throw', user_id_prefix: user.user_id.slice(0, 8) },
        });
        // Email failure is not fatal — banner still queues.
      }

      // 3d. In-app banner via user_notifications.
      // DEVIATION (Rule 1 — Bug): plan asked for type='winback' + expires_at;
      // existing Phase 42 schema has CHECK-constrained category enum
      // {dose-reminders, ai-insights, clinic-alerts, billing, marketing} and
      // no expires_at column. Map under category='ai-insights' + channel='in-app';
      // put subtype + expires_at_iso into payload jsonb (open schema per
      // feedback_planner_iter1_anti_patterns). See 38-07-SUMMARY.md.
      const bannerExpiresAt = new Date(nowMs + BANNER_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const banRes = await supabase.from('user_notifications').insert({
        user_id: user.user_id,
        category: 'ai-insights',
        channel: 'in-app',
        payload: {
          subtype: 'winback',
          cta_url: WINBACK_CTA_URL,
          expires_at_iso: bannerExpiresAt,
          reason: WINBACK_REASON,
        },
      });
      if (banRes?.error) {
        captureException(new Error(`banner_insert_failed:${banRes.error.code ?? 'unknown'}`), {
          level: 'warning',
          tags: { surface: 'winback-scorer.banner', user_id_prefix: user.user_id.slice(0, 8) },
        });
        // Banner failure is non-fatal — the win_back_sends row + email are
        // the primary delivery; banner is a courtesy.
      }

      // 3e. PostHog `win_back_trigger` event — no PHI.
      try {
        captureServer({
          userId: user.user_id,
          event: 'win_back_trigger',
          properties: { reason: WINBACK_REASON },
        });
      } catch {
        /* telemetry never blocks */
      }
    } catch (e) {
      errors++;
      captureException(e, {
        level: 'error',
        tags: { surface: 'winback-scorer.loop', user_id_prefix: user.user_id.slice(0, 8) },
      });
    }
  }

  // 4. Batch-complete event. captureServer enforces user-scoped distinct_id
  //    (Phase 27 D-13) — batch-level events must use a Sentry breadcrumb +
  //    structured log instead of PostHog (no per-user distinct_id available).
  let batchCompleteEmitted = false;
  try {
    addBreadcrumb({
      category: 'winback.batch_complete',
      level: 'info',
      data: {
        candidate_count: users.length,
        inserted_count: inserted,
        error_count: errors,
      },
    });
    console.log(
      JSON.stringify({
        event: 'winback.batch_complete',
        candidate_count: users.length,
        inserted_count: inserted,
        error_count: errors,
      }),
    );
    batchCompleteEmitted = true;
  } catch {
    /* swallow */
  }

  return {
    status: 'ok',
    processed: users.length,
    inserted,
    errors,
    sentEmails,
    batchCompleteEmitted,
  };
}

// ─── Serve handler ───────────────────────────────────────────────────────────

/**
 * Production HTTP entry point. Auth-gated (service_role only). The cron job
 * invokes this with the service-role bearer (Phase 38-09 installs the cron
 * via the pg_cron + vault pattern per memory reference_supabase_pg_cron_vault_service_role_pattern).
 */
async function serveHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');

  try {
    const res = await handleWinbackRun({ supabase: admin });
    return jsonResponse(200, res);
  } catch (e) {
    captureException(e, { level: 'fatal', tags: { surface: 'winback-scorer.serve' } });
    return jsonError(500, 'internal');
  }
}

if (Deno.env.get('WINBACK_SCORER_DISABLE_SERVE') !== '1') {
  Deno.serve(serveHandler);
}

// ─── Test seam ───────────────────────────────────────────────────────────────

export const __internal = {
  handleWinbackRun,
  serveHandler,
  setAdminForTest,
  resetAdminForTest,
  renderWinbackEmail,
};
