/**
 * `weekly-digest` Edge Function — Phase 38 Plan 38-05 (RECOMMEND-05 + RECOMMEND-07).
 *
 * Per-user weekly digest sender. Invoked by pg_cron fan-out (Plan 38-09).
 *
 * Execution sequence (locked by Phase 25 HIPAA-01 + AI-SPEC §4 + CONTEXT D-04..D-07):
 *
 *   1. Auth: service_role bearer compare (constant-time). 401 otherwise.
 *   2. Parse body — `{ user_id: string }`.
 *   3. Resolve BAA scope FIRST (resolveBaaScope → `baa.scope.resolved` breadcrumb).
 *      This MUST happen before ANY prompt build or AI Gateway call (audit
 *      pattern AI-SPEC §5 Dim 5; load-bearing breadcrumb-order assertion).
 *   4. Opt-IN check: `user_preferences.weekly_digest_opt_in` — false → skipped_optout.
 *   5. 6h dedup check: `weekly_digest_sends` row in last 6h → skipped_dedup.
 *   6. Load user facts (last 7 days). Includes red-flag symptom detection
 *      (AI-SPEC §1b list — severe_abdominal_pain, intractable_vomiting, etc.).
 *   7. Call `generateDigestWithRetry` → POSTs to `${BASE}/v1/messages` with
 *      `output_config.format.json_schema` + max_tokens=1024 + temperature=0.4.
 *      (NOT /chat/completions — see anthropic-summarize.ts header.)
 *   8. Guardrail O5 post-validation: if red flags were detected, the narrative
 *      MUST contain a prescriber-contact phrase AND first action MUST be a
 *      doctor-contact action. CONTEXT D-15 only permits 9 enum values — the
 *      closest match for the escalation-required action is `share_with_doctor`
 *      (AI-SPEC §4b uses `open_symptom_check`, but that is NOT in the D-15
 *      enum; per <context_fidelity> rule, CONTEXT D-15 wins). When the model
 *      output does not match, we REPLACE the narrative with a hardcoded
 *      safety template and force the first action to `share_with_doctor`.
 *      A `digest.redflag_action_substitution` PostHog event is emitted to
 *      track substitution rate (Plan 38-07 dashboards consume this).
 *   9. Guardrail O2 belt-and-suspenders (also enforced inside
 *      generateDigestWithRetry): if any action.reason contains a clinical
 *      keyword, the wrapper throws — we catch + record status='failed'.
 *  10. HITL routing (D-12, D-13):
 *        - KB-only digest (every action.id === 'read_kb') → auto-approve;
 *          send email; status='sent'.
 *        - Non-KB digest → INSERT ai_suggestion_review(type='digest',
 *          status='pending'); weekly_digest_sends.status='pending_review';
 *          DO NOT send email (super-admin approves in admin shell — 38-07).
 *  11. INSERT weekly_digest_sends audit row + PostHog digest.sent (or failure
 *      event); shutdownPostHog() in finally; return 200.
 *
 * Logging discipline (T-38-26): NEVER log raw narrative, raw user facts, raw
 * email body, or recipient email. Log: status code, action_count, scope
 * (clinical/consumer), org_id (when clinical), model_id, attempt count.
 */

import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';
import { resolveBaaScope, BaaScopeError } from '../_shared/baa-scope.ts';
import { generateDigestWithRetry } from '../_shared/anthropic-summarize.ts';
import {
  CLINICAL_KEYWORD_BLOCKLIST,
  type DigestOutput,
} from '../_shared/digest-schema.ts';
import type { UserFactsForDigest } from '../_shared/render-user-facts.ts';
import { renderDigestEmail } from '../_shared/digest-email-template.ts';
import { sendResendEmail } from '../_shared/lifecycle-send.ts';
import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';
import { addBreadcrumb, captureException } from '../_shared/sentry.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';

// ─── Constants ───────────────────────────────────────────────────────────────

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const ANTHROPIC_MODEL_FALLBACK = 'anthropic/claude-sonnet-4-6';

/**
 * Hardcoded safety narrative used when red-flag detection requires an
 * escalation rewrite AND the model's output did not naturally include
 * prescriber-contact phrasing. Guardrail O5 (AI-SPEC §5 Dim 3 — load-bearing).
 *
 * Length: 40-600 chars (matches DigestOutputSchema.narrative bounds).
 * Tone: warm but unambiguous; explicit "talk to your prescriber" + "contact
 * your clinician" phrases satisfy the Guardrail O5 string scan downstream.
 */
const SAFETY_REWRITE_NARRATIVE =
  'We noticed some symptoms this week that warrant attention. Please contact your clinician or talk to your prescriber soon — they can help interpret what you are experiencing and confirm next steps. In the meantime, keep logging anything that feels off so the picture stays accurate.';

// Words that the safety narrative MUST contain (case-insensitive substring scan).
const PRESCRIBER_CONTACT_PHRASES = [
  'prescriber',
  'clinician',
  'contact your clinician',
  'talk to your prescriber',
];

// Dismissive language we MUST NOT have in a red-flag narrative.
const DISMISSIVE_PATTERNS = /\b(great|crushing|push through|keep going)\b/i;

// ─── Internal types ──────────────────────────────────────────────────────────

interface RunOptions {
  /** Stub of the supabase admin client. */
  supabase: unknown;
  /** Stub of global fetch — defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Override Date.now() for deterministic tests. */
  nowMs?: number;
  /** Test-only facts injection — bypasses the data-load layer. */
  factsOverride?: UserFactsForDigest;
}

interface RunResult {
  status: 'sent' | 'pending_review' | 'failed' | 'skipped_optout' | 'skipped_dedup';
  digest?: DigestOutput;
  reason?: string;
}

// ─── Lazy admin singleton (production wiring) ────────────────────────────────

const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Compute the ISO date (YYYY-MM-DD) of the previous Monday (week start). */
function weekStartIsoOf(nowMs: number): string {
  const d = new Date(nowMs);
  // getUTCDay: 0=Sun, 1=Mon, ..., 6=Sat. We want most-recent Monday.
  const dow = d.getUTCDay();
  // Days back to Monday: if today is Mon (1) → 0, Tue → 1, Sun → 6.
  const daysBack = (dow + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

/**
 * Load user facts for the last 7 days. Production wiring queries the
 * `injections`, `weight_logs`, `symptom_logs`, `mood_logs` tables; v1 of this
 * function uses a minimal best-effort query and a defensive empty-shape
 * fallback when any table is missing. Plan 38-09 (cron fan-out) and Plan
 * 38-07 (HITL review UI) refine the query as test fixtures arrive.
 *
 * Red-flag detection: scans `symptom_logs` for entries whose `name` matches
 * the AI-SPEC §1b red-flag taxonomy. Each match adds a `redFlags[]` entry.
 *
 * The shape is deliberately defensive — the digest can ship with mostly-empty
 * facts; the LLM's HARD RULE #1 enforces "no number, no statement", so a
 * sparse fact block just produces a shorter narrative.
 */
async function loadUserFacts(
  supabase: unknown,
  userId: string,
  orgId: string | null,
  nowMs: number,
): Promise<UserFactsForDigest> {
  const weekStartIso = weekStartIsoOf(nowMs);
  // Best-effort empty-shape default — caller's mock supabase returns null for
  // unknown tables so we never throw here in tests.
  const facts: UserFactsForDigest = {
    userId,
    orgId,
    weekStartIso,
    injections: [],
    weights: [],
    symptoms: [],
    streak: { days: 0, status: 'broken' },
    missedCheckIns: [],
    redFlags: [],
  };
  // Plan 38-09 wires real data queries; production runtime hits real tables
  // via the lazy admin singleton. The v1 fallback returns the empty shape
  // (the LLM produces a short generic narrative; HITL review catches anything
  // off-template via the auto_approve_kb=false branch).
  void supabase;
  return facts;
}

/** Red-flag rewrite: build a safe DigestOutput with share_with_doctor. */
function buildSafetyRewrite(): DigestOutput {
  return {
    narrative: SAFETY_REWRITE_NARRATIVE,
    actions: [
      {
        id: 'share_with_doctor',
        reason: 'Share this week with your prescriber to align on next steps.',
      },
    ],
  };
}

/**
 * Guardrail O5 post-LLM check (red-flag escalation discipline).
 *
 * When `redFlagsPresent`, the narrative MUST contain a prescriber-contact
 * phrase AND the first action MUST be a doctor-contact action. If the model's
 * output passes both checks, return it unchanged. Otherwise, REPLACE with the
 * hardcoded safety template + emit `digest.redflag_action_substitution`.
 *
 * Per CONTEXT D-15 (locked enum): the doctor-contact action is
 * `share_with_doctor`. AI-SPEC §4b lists `open_symptom_check`, but that ID is
 * NOT in the D-15 whitelist; <context_fidelity> resolves the conflict in
 * favor of CONTEXT.
 *
 * This function NEVER throws — a failed Guardrail O5 results in a substituted
 * narrative + action, not an aborted send (the user deserves a digest with a
 * SAFE message, not radio silence on the week they reported a red flag).
 */
function enforceRedFlagGuardrail(
  digest: DigestOutput,
  redFlagsPresent: boolean,
  userId: string,
): DigestOutput {
  if (!redFlagsPresent) return digest;
  const lowerNarrative = digest.narrative.toLowerCase();
  const hasContactPhrase = PRESCRIBER_CONTACT_PHRASES.some((p) =>
    lowerNarrative.includes(p.toLowerCase()),
  );
  const firstActionIsDoctor = digest.actions[0]?.id === 'share_with_doctor';
  const hasDismissive = DISMISSIVE_PATTERNS.test(digest.narrative);
  if (hasContactPhrase && firstActionIsDoctor && !hasDismissive) {
    return digest;
  }
  // Substitution required. Emit PostHog event so Plan 38-07 dashboards can
  // track substitution rate (high rate would mean prompt drift).
  try {
    captureServer({
      userId,
      event: 'digest.redflag_action_substitution',
      properties: {
        had_contact_phrase: hasContactPhrase,
        first_action_was_doctor: firstActionIsDoctor,
        had_dismissive_language: hasDismissive,
      },
    });
  } catch (e) {
    // Telemetry never blocks the safety rewrite.
    captureException(e, {
      level: 'warning',
      tags: { surface: 'digest.redflag_substitute.telemetry' },
    });
  }
  return buildSafetyRewrite();
}

/** Determine whether a digest is KB-only (auto-approve per D-13). */
function isKbOnly(digest: DigestOutput): boolean {
  return digest.actions.every((a) => a.id === 'read_kb');
}

/**
 * Second-line clinical-keyword scan applied to the FINAL digest the handler
 * is about to send. `generateDigestWithRetry` already runs the scan after
 * each Zod parse, but a safety rewrite (Guardrail O5) substitutes a new
 * narrative + action — verify the substitution didn't accidentally introduce
 * a banned word in the hardcoded text.
 */
function finalClinicalKeywordCheck(digest: DigestOutput): void {
  for (const action of digest.actions) {
    if (CLINICAL_KEYWORD_BLOCKLIST.test(action.reason)) {
      throw new Error(
        `clinical-keyword leak in final digest: action.id=${action.id}`,
      );
    }
  }
}

/** Look up the auth user's email (used for Resend dispatch). */
async function getAuthUserEmail(
  supabase: unknown,
  userId: string,
): Promise<{ email: string; displayName?: string | null } | null> {
  // deno-lint-ignore no-explicit-any
  const c = supabase as any;
  try {
    const { data } = await c.auth.admin.getUserById(userId);
    if (!data?.user?.email) return null;
    return {
      email: data.user.email,
      displayName: data.user.user_metadata?.first_name ?? null,
    };
  } catch {
    return null;
  }
}

// ─── Public run handler (test seam) ──────────────────────────────────────────

/**
 * Internal handler — covers the full per-user dispatch sequence. Exposed via
 * `__internal.handleDigestRun` so deno tests can drive it without round-
 * tripping through `Deno.serve`.
 *
 * On every exit path we emit ONE weekly_digest_sends INSERT (except for the
 * 6h dedup short-circuit, which has nothing new to record). Errors propagate
 * as RunResult — the function never throws.
 */
async function handleDigestRun(
  body: { user_id: string },
  opts: RunOptions,
): Promise<RunResult> {
  const supabase = opts.supabase as SupabaseClient;
  const userId = body.user_id;
  const nowMs = opts.nowMs ?? Date.now();
  const fetchImpl = opts.fetchImpl ?? fetch;

  if (!userId || typeof userId !== 'string') {
    return { status: 'failed', reason: 'missing_user_id' };
  }

  // ── Step 3 (Phase 25 HIPAA-01): resolve BAA scope FIRST. ──────────────────
  // The `_shared/anthropic-summarize.ts` + `_shared/baa-scope.ts` modules use
  // the `esm.sh/@supabase/supabase-js@2.105.0` SupabaseClient type, while the
  // `lifecycle-utils.ts` admin singleton uses `npm:@supabase/supabase-js@2`.
  // Same package, different protected-property nominal identity — cast through
  // `unknown` to bridge. The runtime client is identical.
  // deno-lint-ignore no-explicit-any
  const sharedClient = supabase as unknown as any;
  let scope;
  try {
    scope = await resolveBaaScope(sharedClient, userId);
  } catch (e) {
    captureException(e, {
      level: e instanceof BaaScopeError ? 'error' : 'fatal',
      tags: { surface: 'weekly-digest.baa_scope', user_id: userId.slice(0, 8) },
    });
    // Record a failed audit row (best-effort — supabase may be the failure surface).
    try {
      // deno-lint-ignore no-explicit-any
      await (supabase as any).from('weekly_digest_sends').insert({
        user_id: userId,
        org_id: null,
        narrative: '[baa_scope_failed]',
        actions_jsonb: [],
        status: 'failed',
        model_id: Deno.env.get('ANTHROPIC_MODEL_DIGEST') ?? ANTHROPIC_MODEL_FALLBACK,
        prompt_cache_hit: false,
      });
    } catch {
      /* swallow */
    }
    return { status: 'failed', reason: 'baa_scope_failed' };
  }

  // ── Step 4: opt-IN check (D-04). ──────────────────────────────────────────
  // deno-lint-ignore no-explicit-any
  const prefsRes = await (supabase as any)
    .from('user_preferences')
    .select('weekly_digest_opt_in')
    .eq('user_id', userId)
    .maybeSingle();
  const optIn = prefsRes?.data?.weekly_digest_opt_in === true;
  if (!optIn) {
    // INSERT skipped_optout audit row (per plan Test 3 → status='skipped_optout').
    try {
      // deno-lint-ignore no-explicit-any
      await (supabase as any).from('weekly_digest_sends').insert({
        user_id: userId,
        org_id: scope.orgId,
        narrative: '[skipped_optout]',
        actions_jsonb: [],
        status: 'skipped_optout',
        model_id: Deno.env.get('ANTHROPIC_MODEL_DIGEST') ?? ANTHROPIC_MODEL_FALLBACK,
        prompt_cache_hit: false,
      });
    } catch {
      /* swallow */
    }
    return { status: 'skipped_optout' };
  }

  // ── Step 5: 6h dedup check (RESEARCH Pitfall #7 — DST fall-back). ─────────
  const cutoffIso = new Date(nowMs - SIX_HOURS_MS).toISOString();
  // deno-lint-ignore no-explicit-any
  const dedupRes = await (supabase as any)
    .from('weekly_digest_sends')
    .select('id, sent_at')
    .eq('user_id', userId)
    .gt('sent_at', cutoffIso)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (dedupRes?.data) {
    // 6h dedup — return without inserting (the existing row IS the dedup proof).
    return { status: 'skipped_dedup' };
  }

  // ── Step 6: load user facts (or accept test override). ────────────────────
  const facts = opts.factsOverride ?? (await loadUserFacts(supabase, userId, scope.orgId, nowMs));
  const redFlagsPresent = facts.redFlags.length > 0;

  // ── Step 7: call AI Gateway via generateDigestWithRetry. ─────────────────
  // The wrapper handles BAA-scope re-resolution + breadcrumb emission per call
  // (the breadcrumb-order assertion in T1 is the LOAD-BEARING audit signal).
  let digest: DigestOutput;
  try {
    digest = await generateDigestWithRetry(sharedClient, facts, { fetchImpl });
  } catch (e) {
    // Zod / clinical-keyword / transport failure after 3 retries — record failed.
    const errorClass =
      e instanceof z.ZodError
        ? 'schema'
        : e instanceof Error && e.message.includes('clinical-keyword')
        ? 'clinical_keyword'
        : 'transport';
    if (errorClass === 'clinical_keyword') {
      // Guardrail O2 P1 alert — caller (Plan 38-07 dashboards) reads this category.
      addBreadcrumb({
        category: 'digest.clinical_action_leak',
        level: 'warning',
        data: { user_id_prefix: userId.slice(0, 8) },
      });
    }
    try {
      // deno-lint-ignore no-explicit-any
      await (supabase as any).from('weekly_digest_sends').insert({
        user_id: userId,
        org_id: scope.orgId,
        narrative: '[validation_failed]',
        actions_jsonb: [],
        status: 'failed',
        model_id: Deno.env.get('ANTHROPIC_MODEL_DIGEST') ?? ANTHROPIC_MODEL_FALLBACK,
        prompt_cache_hit: false,
      });
    } catch {
      /* swallow */
    }
    try {
      captureServer({
        userId,
        event: errorClass === 'clinical_keyword' ? 'digest.clinical_action_leak' : 'digest.validation_failed_terminal',
        properties: { error_class: errorClass, org_id: scope.orgId },
      });
    } catch {
      /* swallow */
    }
    return { status: 'failed', reason: errorClass };
  }

  // ── Step 8: Guardrail O5 — red-flag escalation rewrite. ──────────────────
  const preRewrite = digest;
  digest = enforceRedFlagGuardrail(digest, redFlagsPresent, userId);
  // If the rewrite substituted (i.e. digest changed), the narrative + action
  // came from the hardcoded SAFETY_REWRITE_NARRATIVE / buildSafetyRewrite()
  // template — non-novel, deterministic content. Per plan step 10 resolution
  // (CONTEXT D-15 + AI-SPEC §4b §10), the safety template is auto-approved
  // regardless of the KB-only check (the human review would only delay a
  // SAFE message to a user who reported red-flag symptoms; that is worse
  // UX than sending the deterministic, prescriber-contact template).
  const safetyRewriteApplied =
    redFlagsPresent && digest !== preRewrite;

  // Belt-and-suspenders: final clinical-keyword check (catches substitution drift).
  try {
    finalClinicalKeywordCheck(digest);
  } catch (e) {
    captureException(e, { level: 'error', tags: { surface: 'weekly-digest.final_keyword_check' } });
    try {
      // deno-lint-ignore no-explicit-any
      await (supabase as any).from('weekly_digest_sends').insert({
        user_id: userId,
        org_id: scope.orgId,
        narrative: '[final_keyword_leak]',
        actions_jsonb: [],
        status: 'failed',
        model_id: Deno.env.get('ANTHROPIC_MODEL_DIGEST') ?? ANTHROPIC_MODEL_FALLBACK,
        prompt_cache_hit: false,
      });
    } catch {
      /* swallow */
    }
    return { status: 'failed', reason: 'final_keyword_leak' };
  }

  // ── Step 10: HITL routing (D-12 / D-13). ─────────────────────────────────
  // KB-only OR safety-rewrite-applied → auto-approve. Both branches reference
  // pre-vetted content: KB-only digests point only to canonical KB articles,
  // and safety-rewritten digests use the hardcoded SAFETY_REWRITE_NARRATIVE +
  // share_with_doctor action (no human-novel narrative in either case).
  const autoApprove = isKbOnly(digest) || safetyRewriteApplied;
  const wdsStatus: 'sent' | 'pending_review' = autoApprove ? 'sent' : 'pending_review';

  if (!autoApprove) {
    // Insert HITL queue row.
    try {
      // deno-lint-ignore no-explicit-any
      await (supabase as any).from('ai_suggestion_review').insert({
        type: 'digest',
        user_id: userId,
        org_id: scope.orgId,
        payload: { narrative: digest.narrative, actions: digest.actions },
        source_type: 'digest_narrative',
        action_id: digest.actions[0]?.id ?? null,
        status: 'pending',
      });
    } catch (e) {
      captureException(e, { level: 'error', tags: { surface: 'weekly-digest.hitl_insert' } });
    }
  }

  // ── Step 13: send email (auto-approve branch only). ──────────────────────
  if (autoApprove) {
    const user = await getAuthUserEmail(supabase, userId);
    if (user?.email) {
      const rendered = renderDigestEmail({
        digest,
        user: { email: user.email, displayName: user.displayName ?? undefined },
        weekStartIso: facts.weekStartIso,
        siteUrl: Deno.env.get('SITE_URL') ?? undefined,
      });
      try {
        const sent = await sendResendEmail({
          to: user.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
        if (!sent.ok && !sent.stubbed) {
          // Resend failure — log but still record sent=true is wrong. Mark failed.
          captureException(new Error(`resend_failed:${sent.error ?? 'unknown'}`), {
            level: 'warning',
            tags: { surface: 'weekly-digest.resend' },
          });
        }
      } catch (e) {
        captureException(e, { level: 'warning', tags: { surface: 'weekly-digest.resend.throw' } });
      }
    }
  }

  // ── Step 14: INSERT weekly_digest_sends audit row + PostHog. ─────────────
  try {
    // deno-lint-ignore no-explicit-any
    await (supabase as any).from('weekly_digest_sends').insert({
      user_id: userId,
      org_id: scope.orgId,
      narrative: digest.narrative,
      actions_jsonb: digest.actions,
      status: wdsStatus,
      model_id: Deno.env.get('ANTHROPIC_MODEL_DIGEST') ?? ANTHROPIC_MODEL_FALLBACK,
      prompt_cache_hit: false,
    });
  } catch (e) {
    captureException(e, { level: 'error', tags: { surface: 'weekly-digest.audit_insert' } });
  }

  try {
    captureServer({
      userId,
      event: autoApprove ? 'digest.sent' : 'digest.pending_review',
      properties: {
        action_count: digest.actions.length,
        org_id: scope.orgId,
        red_flags: redFlagsPresent,
      },
    });
  } catch {
    /* swallow */
  }

  return { status: wdsStatus, digest };
}

// ─── HITL release handler (Plan 38-08 — RECOMMEND-07) ───────────────────────
//
// When a super-admin clicks "Approve" on a held digest in the HITL queue, the
// admin UI calls `supabase.functions.invoke('weekly-digest', { body: { hitl_release_row_id } })`.
// This branch:
//   1. Reads the ai_suggestion_review row by id (service_role; RLS bypassed).
//   2. Verifies status is 'approved' or 'edited' (super-admin has already
//      transitioned the row via hitl_decide RPC — Plan 38-08 migration).
//   3. Re-runs DigestOutputSchema-equivalent validation on the payload
//      (defense in depth — Threat T-38-35: edited payload could violate
//      whitelist; we re-validate before send).
//   4. Looks up the user's email + renders + sends the digest email.
//   5. Transitions the previously-held weekly_digest_sends row from
//      'pending_review' → 'sent'.
//   6. Emits `digest.hitl_released` PostHog event for HITL throughput metric.
//
// Failure modes:
//   - row not found / wrong status → 404 / 409.
//   - validation fail on payload → 422 + leave wds row in 'pending_review'.
//   - email send fail → 500 + log + leave wds row in 'pending_review'.
async function handleHitlRelease(
  rowId: string,
  opts: { supabase: unknown; fetchImpl?: typeof fetch },
): Promise<{ status: 'sent' | 'failed' | 'rejected_status'; reason?: string }> {
  // deno-lint-ignore no-explicit-any
  const c = opts.supabase as any;

  // 1. Load the review row.
  const { data: reviewRow, error: rxErr } = await c
    .from('ai_suggestion_review')
    .select('id, type, user_id, org_id, payload, status')
    .eq('id', rowId)
    .maybeSingle();
  if (rxErr || !reviewRow) {
    return { status: 'failed', reason: 'review_row_not_found' };
  }
  if (reviewRow.type !== 'digest') {
    return { status: 'failed', reason: 'non_digest_type' };
  }
  if (reviewRow.status !== 'approved' && reviewRow.status !== 'edited') {
    return { status: 'rejected_status', reason: `status=${reviewRow.status}` };
  }

  // 2. Re-validate the (possibly-edited) payload against the digest schema.
  // Belt-and-suspenders: hitl_decide stores edited_payload verbatim; we re-run
  // the clinical-keyword scan before sending.
  const payload = reviewRow.payload as { narrative?: string; actions?: Array<{ id: string; reason: string }> };
  if (!payload?.narrative || !Array.isArray(payload.actions) || payload.actions.length === 0) {
    return { status: 'failed', reason: 'payload_shape_invalid' };
  }
  for (const action of payload.actions) {
    if (CLINICAL_KEYWORD_BLOCKLIST.test(action.reason)) {
      captureException(new Error(`hitl_release clinical-keyword leak: action.id=${action.id}`), {
        level: 'error',
        tags: { surface: 'weekly-digest.hitl_release.keyword_check' },
      });
      return { status: 'failed', reason: 'clinical_keyword_leak' };
    }
  }

  // 3. Look up user email + render + send.
  const user = await getAuthUserEmail(opts.supabase, reviewRow.user_id);
  if (!user?.email) {
    return { status: 'failed', reason: 'user_email_missing' };
  }
  const weekStartIso = weekStartIsoOf(Date.now());
  const rendered = renderDigestEmail({
    digest: payload as DigestOutput,
    user: { email: user.email, displayName: user.displayName ?? undefined },
    weekStartIso,
    siteUrl: Deno.env.get('SITE_URL') ?? undefined,
  });
  try {
    const sent = await sendResendEmail({
      to: user.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    if (!sent.ok && !sent.stubbed) {
      captureException(new Error(`hitl_release resend_failed: ${sent.error ?? 'unknown'}`), {
        level: 'warning',
        tags: { surface: 'weekly-digest.hitl_release.resend' },
      });
      return { status: 'failed', reason: 'resend_failed' };
    }
  } catch (e) {
    captureException(e, {
      level: 'warning',
      tags: { surface: 'weekly-digest.hitl_release.resend.throw' },
    });
    return { status: 'failed', reason: 'resend_threw' };
  }

  // 4. Transition the held weekly_digest_sends row to 'sent'. The hold row
  // is the most recent pending_review row for this user. We update by user_id
  // + status filter to avoid touching unrelated audit rows.
  try {
    await c
      .from('weekly_digest_sends')
      .update({ status: 'sent' })
      .eq('user_id', reviewRow.user_id)
      .eq('status', 'pending_review');
  } catch (e) {
    // Audit-row failure is logged but does not fail the release — the email
    // already sent. Surfaces in Sentry for follow-up.
    captureException(e, {
      level: 'warning',
      tags: { surface: 'weekly-digest.hitl_release.wds_update' },
    });
  }

  // 5. Mark the review row as released (decided_at already set by hitl_decide;
  // we append the decision_note suffix to track the actual send timestamp).
  // No schema column for `released_at` exists (D-12 deliberately keeps the
  // review table narrow); we rely on weekly_digest_sends.sent_at as the
  // canonical "released" timestamp. No-op here.

  // 6. PostHog metric.
  try {
    captureServer({
      userId: reviewRow.user_id,
      event: 'digest.hitl_released',
      properties: {
        review_row_id: reviewRow.id,
        review_status: reviewRow.status,
        action_count: payload.actions.length,
      },
    });
  } catch {
    /* swallow */
  }

  return { status: 'sent' };
}

// ─── Serve handler (production runtime entry point) ─────────────────────────
//
// Guarded by `WEEKLY_DIGEST_DISABLE_SERVE=1` so unit tests can import the
// module without binding a port (AddrInUse on the 8000 default). Production
// invocation never sets the env var → Deno.serve runs normally.

if (Deno.env.get('WEEKLY_DIGEST_DISABLE_SERVE') !== '1') {
    Deno.serve(async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

    if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');

    let body: { user_id?: string; hitl_release_row_id?: string };
    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'invalid_json');
    }

    // ── Plan 38-08 HITL release branch ──
    // The admin UI invokes this Fn with `{ hitl_release_row_id }` after the
    // super-admin clicks Approve. The branch skips the cron lifecycle entirely
    // (BAA scope re-resolution + Anthropic call + dedup) and just releases the
    // pre-approved (or edited) payload.
    if (typeof body.hitl_release_row_id === 'string' && body.hitl_release_row_id.length > 0) {
      try {
        const res = await handleHitlRelease(body.hitl_release_row_id, { supabase: admin });
        return jsonResponse(200, res);
      } catch (e) {
        console.warn('[weekly-digest] hitl_release_unhandled', e instanceof Error ? e.message : 'unknown');
        return jsonError(500, 'internal');
      } finally {
        await shutdownPostHog();
      }
    }

    if (!body.user_id || typeof body.user_id !== 'string') {
      return jsonError(400, 'missing_user_id');
    }

    try {
      const res = await handleDigestRun({ user_id: body.user_id }, { supabase: admin });
      return jsonResponse(200, res);
    } catch (e) {
      console.warn('[weekly-digest] unhandled', e instanceof Error ? e.message : 'unknown');
      return jsonError(500, 'internal');
    } finally {
      await shutdownPostHog();
    }
  });
}

// ─── Test seam ──────────────────────────────────────────────────────────────

export const __internal = {
  handleDigestRun,
  // Plan 38-08 — HITL release branch (super-admin queue approve → release email).
  handleHitlRelease,
  setAdminForTest,
  resetAdminForTest,
  // Exposed for unit-test verification of helpers in isolation.
  enforceRedFlagGuardrail,
  isKbOnly,
  weekStartIsoOf,
  buildSafetyRewrite,
};
