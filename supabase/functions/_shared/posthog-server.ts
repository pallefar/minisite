/**
 * Server-side PostHog helper for Supabase Edge Functions.
 *
 * Phase 24 D-11/D-13. See 24-CONTEXT.md + 24-RESEARCH.md Pattern 3 + PITFALL 1.
 *
 * CRITICAL: every consumer MUST wrap its handler in try/finally and call
 * `await shutdownPostHog()` before returning the Response — otherwise
 * batched events are dropped when the Deno isolate is torn down.
 *
 * TAXO-02 requirement: Edge Functions emit signup / payment / activation / refund
 * events that adblockers eat in the browser. This helper ensures those events
 * are captured server-side with Supabase auth.users.id as the distinct_id (D-13).
 *
 * Vendor-gated health-check pattern (reference_vendor_gated_send_health_check):
 * If POSTHOG_PROJECT_KEY is not set, captureServer is a no-op with a one-time warning.
 * This allows Edge Functions to deploy before the secret is configured without crashing.
 *
 * Phase 27 plan 27-04 EXTENSION — events_mirror dual-write (RESEARCH q#5):
 *   captureServer() ALSO performs a fire-and-forget INSERT into
 *   public.events_mirror so the funnel-anomaly cron (every 5 min) can query
 *   local event counts without hitting PostHog REST at rate-limit risk.
 *   The dual-write is best-effort: any failure (network, RLS, missing table)
 *   is caught + logged and NEVER throws back into the caller. The PostHog
 *   capture is the source of truth; events_mirror is a convenience cache.
 *
 *   Lazy supabase admin singleton mirrors the makeLazyAdmin pattern from
 *   _shared/lifecycle-utils.ts — instantiated on first capture, reused for
 *   the lifetime of the Deno isolate.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { PostHog } from 'npm:posthog-node@5.10.4';

let _client: PostHog | null = null;
let _missingKeyWarned = false;
let _mirrorAdmin: SupabaseClient | null = null;
let _mirrorAdminWarned = false;

function getClient(): PostHog | null {
  if (_client) return _client;
  const key = Deno.env.get('POSTHOG_PROJECT_KEY');
  if (!key) {
    if (!_missingKeyWarned) {
      console.warn('[posthog-server] POSTHOG_PROJECT_KEY missing — captureServer is a no-op until set.');
      _missingKeyWarned = true;
    }
    return null;
  }
  const host = Deno.env.get('POSTHOG_HOST') ?? 'https://us.i.posthog.com';
  _client = new PostHog(key, { host });
  return _client;
}

/**
 * Lazy supabase admin singleton for the events_mirror dual-write.
 *
 * Mirrors makeLazyAdmin() from _shared/lifecycle-utils.ts. Returns null if
 * SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY are missing (local dev without
 * full env wiring) — captureServer then short-circuits the mirror write
 * with a one-time warning.
 */
function getMirrorAdmin(): SupabaseClient | null {
  if (_mirrorAdmin) return _mirrorAdmin;
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !key) {
    if (!_mirrorAdminWarned) {
      console.warn(
        '[posthog-server] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — events_mirror dual-write disabled.',
      );
      _mirrorAdminWarned = true;
    }
    return null;
  }
  _mirrorAdmin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _mirrorAdmin;
}

/** Phase 27 plan 27-04 — test seam for the events_mirror admin singleton. */
export function setMirrorAdminForTest(client: unknown): void {
  _mirrorAdmin = client as SupabaseClient;
}

/** Phase 27 plan 27-04 — reset the events_mirror admin singleton (used in tests). */
export function resetMirrorAdminForTest(): void {
  _mirrorAdmin = null;
  _mirrorAdminWarned = false;
}

export type CaptureArgs = {
  /** Supabase auth.users.id — REQUIRED per D-13. Always use the Supabase uid, never anon id. */
  userId: string;
  /** Event name from src/lib/analytics/events*.ts */
  event: string;
  /** Optional event properties. Must NOT contain PHI (D-12). */
  properties?: Record<string, unknown>;
};

/**
 * Capture an event server-side via posthog-node AND dual-write to
 * public.events_mirror (Phase 27 plan 27-04 extension).
 *
 * userId is required (D-13 invariant: Edge Functions always use Supabase auth.users.id
 * as the distinct_id). If userId is empty, throws immediately.
 *
 * If POSTHOG_PROJECT_KEY is not set, the PostHog send is a no-op — but the
 * events_mirror dual-write still happens (the cron only reads from
 * events_mirror, so the anomaly path stays functional even pre-PostHog).
 *
 * The events_mirror write is fire-and-forget: any failure is logged via
 * console.warn and never thrown. Per RESEARCH q#5 resolution / Pattern S5
 * vendor-gated send.
 */
export function captureServer(args: CaptureArgs): void {
  if (!args.userId) {
    throw new Error('[posthog-server] userId required (D-13 — always use Supabase auth.users.id as distinct_id)');
  }
  // 1. PostHog (vendor-gated; no-op if POSTHOG_PROJECT_KEY missing).
  const c = getClient();
  if (c) {
    c.capture({ distinctId: args.userId, event: args.event, properties: args.properties });
  }
  // 2. events_mirror dual-write (best-effort, fire-and-forget).
  //    Phase 27 plan 27-04 — RESEARCH q#5: anomaly cron reads here locally
  //    instead of polling PostHog REST every 5 min.
  const admin = getMirrorAdmin();
  if (!admin) return; // env-gated no-op
  void (async () => {
    try {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const { error } = (await (admin
        .from('events_mirror')
        .insert({
          event_name: args.event,
          user_id: args.userId,
          properties: args.properties ?? {},
          distinct_id: args.userId,
        }) as any)) as { error: { message?: string } | null };
      /* eslint-enable @typescript-eslint/no-explicit-any */
      if (error) {
        console.warn(
          `[posthog-server] events_mirror dual-write failed event=${args.event} err=${error.message ?? 'unknown'}`,
        );
      }
    } catch (e) {
      console.warn(
        `[posthog-server] events_mirror dual-write threw event=${args.event} err=${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  })();
}

/**
 * Phase 50 Plan 50-04 — Deno-runtime port of Plan 50-03's captureRagEvent.
 *
 * Plan 50-03 placed captureRagEvent at `leanshot/src/lib/posthog/posthog-server.ts`
 * (Vite/Node side) because no Edge Fn factory existed for it. Plan 50-04's
 * rag-scrape-runner needs a Deno-runtime equivalent — that's this function.
 *
 * Differences from the Vite-side helper:
 *   - distinctId defaults to 'rag-system' (Phase 50 D-34: server-emitted scrape
 *     telemetry has no user; rag-system is the canonical system actor id).
 *   - Defensively scrubs PHI properties (user_id, patient_id) before capture.
 *   - Reuses the same env-gated PostHog client (`getClient()`) as captureServer
 *     so we share the events_mirror dual-write infrastructure when called from
 *     plans 50-06 / 50-08.
 *
 * The runner MUST still wrap the request handler in `try/finally { await
 * shutdownPostHog() }` per D-13 — same constraint as captureServer.
 */
export function captureRagEvent(args: {
  /** Defaults to 'rag-system' for cron-driven events; pass userId for user-triggered. */
  distinctId?: string;
  /** Event name — should be one of the rag_* events from Plan 50-03 events.ts. */
  name: string;
  /** Properties; user_id / patient_id are stripped defensively before send. */
  properties?: Record<string, unknown>;
}): void {
  const distinctId = args.distinctId ?? 'rag-system';
  if (!distinctId || !distinctId.trim()) {
    throw new Error('[posthog-server] captureRagEvent: distinctId required');
  }
  // Defensive PHI scrub (defense-in-depth atop events.phi.ts ESLint rule).
  const scrubbed: Record<string, unknown> = { ...(args.properties ?? {}) };
  delete scrubbed.user_id;
  delete scrubbed.patient_id;
  const c = getClient();
  if (c) {
    c.capture({ distinctId, event: args.name, properties: scrubbed });
  }
  // events_mirror dual-write is intentionally skipped for rag_* system events —
  // anomaly cron only consumes user-attributed events. Plan 50-09 may revisit.
}

/**
 * Phase 38 Plan 38-09 — typed Phase 38 event catalog.
 *
 * All Phase 38 events are PHI-FREE by design (D-04 sanitized narrative — actual
 * narratives stay in DB rows, never in PostHog payloads). This typed union lets
 * TypeScript catch typos at every captureServer() call site in Phase 38 Edge Fns.
 *
 * Companion migration: supabase/migrations/20270705000031_phase38_taxo_events.sql
 * is a comment-only catalog anchor; the source-of-truth registry is THIS file +
 * leanshot/src/lib/analytics/events.ts (client-emittable events only).
 *
 * REQUIREMENT (memory feedback_planner_iter1_anti_patterns): every Phase 38
 * Edge Fn that calls captureServer() MUST wrap its request handler in
 * `try { … } finally { await shutdownPostHog(); }` BEFORE returning the Response,
 * otherwise the Deno isolate is torn down and batched events are dropped.
 */
export type Phase38Event =
  // Activation (Phase 34 Plan 34-03 D-03/D-04) ─────────────────────────────
  // Same-plan widening per memory feedback_planner_missed_status_enum_widening
  // — this union member MUST land in the SAME commit as the Edge Fn that
  // fires it (supabase/functions/record-activation/index.ts).
  | 'activation_completed'
  // Recommender ────────────────────────────────────────────────────────────
  | 'recommendation.shown'
  | 'recommendation.clicked'
  | 'recommendation.dismissed'
  | 'recommendation.404_on_click'
  | 'recommendation.refusal_stripped'
  | 'recommendation.embedding_fallback'
  | 'recommendation.rpc_fallback'
  // Digest ─────────────────────────────────────────────────────────────────
  | 'digest.sent'
  | 'digest.skipped_optout'
  | 'digest.skipped_dedup'
  | 'digest.validation_failed'
  | 'digest.redflag_detected'
  | 'digest.redflag_rewrite'
  | 'digest.redflag_action_substitution'
  | 'digest.clinical_action_leak'
  | 'digest.baa_scope_resolved'
  | 'digest.baa_scope_violation'
  // Win-back ───────────────────────────────────────────────────────────────
  | 'win_back_trigger'
  | 'winback.batch_complete'
  // Embed batch ────────────────────────────────────────────────────────────
  | 'embed.batch_complete'
  | 'embed.dedup_skip'
  | 'embed.rate_limit_429'
  // HITL editorial ─────────────────────────────────────────────────────────
  | 'hitl_approve'
  | 'hitl_reject'
  | 'hitl_edit'
  // Plan personalize ───────────────────────────────────────────────────────
  | 'plan_personalize.hint_returned'
  // Offline eval / model telemetry ─────────────────────────────────────────
  | 'eval.judge.score'
  | 'anthropic.prompt_cache.hit';

/**
 * Typed payload contract for `recommendation.shown` — fires once per returned
 * rec (top-3 per call × every dashboard / kb_footer load). Keeping the contract
 * pinned here catches accidental schema drift when call sites are touched.
 */
export interface RecommendationShownProperties {
  recommendation_id: string;
  source_type: string;
  source_id: string;
  surface_target: string[];
  score: number;
  fallback: 'personalized' | 'popular';
  /** Optional — surface that originated the call (dashboard/kb_footer/etc.). */
  surface?: string;
}

/**
 * Typed payload contract for `digest.sent` — emitted once per delivered
 * weekly-digest email by the weekly-digest Edge Fn.
 */
export interface DigestSentProperties {
  /** Number of recs included in the digest body (1..3). */
  recs_count: number;
  /** ISO date of the Sunday this digest covers. */
  week_of: string;
  /** Channel — 'email' for v1. */
  channel: 'email';
  /** True when this delivery was a HITL-edited variant (D-13). */
  hitl_edited?: boolean;
}

/**
 * Typed payload contract for `recommendation.clicked` — emitted server-side
 * by the track-rec-click Edge Fn (Plan 38-09 Task 3). Client browsers MUST
 * NOT emit AI events directly (Phase 24 server-side capture rule + D-12).
 */
export interface RecommendationClickedProperties {
  recommendation_id: string;
  /** True only on the first click (idempotency — repeat clicks emit `first_click=false`). */
  first_click: boolean;
  surface?: string;
}

/**
 * Phase 34 Plan 34-05 (D-08c) — server-side PostHog identity alias.
 *
 * Used by the merge-anon-session Edge Fn post-signup to merge the pre-auth
 * event stream into the authenticated user_id. Server-side capture is
 * adblocker-resistant (PostHog requests from the browser get blocked; server
 * requests from the Edge Fn don't).
 *
 * posthog-node's alias() argument shape differs from posthog-js:
 *   - posthog-js:  posthog.alias(supabaseUid /* new */, anonDistinctId /* old */)
 *   - posthog-node: client.alias({ distinctId: supabaseUid, alias: anonDistinctId })
 * Both map "the new canonical id" to "the prior anonymous id"; getting the
 * arg order wrong silently swaps timelines (RESEARCH Pattern 4 PITFALL).
 *
 * Vendor-gated: if POSTHOG_PROJECT_KEY is unset (getClient() returns null),
 * this is a no-op — mirrors captureServer's startup-health-check behavior.
 * Errors thrown by the client are caught + logged; never re-thrown, since
 * alias is non-critical (it's an analytics-stitching optimization, not a
 * load-bearing user-data write).
 *
 * Idempotent within a session: posthog-node accepts repeated alias() calls
 * for the same pair without side effects (PostHog server de-dupes).
 */
export function aliasServerSide(supabaseUid: string, anonDistinctId: string): void {
  if (!supabaseUid || !anonDistinctId) return;
  const client = getClient();
  if (!client) return;
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (client as any).alias({ distinctId: supabaseUid, alias: anonDistinctId });
    /* eslint-enable @typescript-eslint/no-explicit-any */
  } catch (err) {
    console.warn('[posthog-server] aliasServerSide failed:', err);
  }
}

/**
 * Flush all queued events and shut down the posthog-node client.
 *
 * MUST be called in the `finally` block of every Edge Function handler that
 * uses captureServer(). The Deno isolate is torn down immediately after the
 * Response is returned — any in-flight HTTP requests to PostHog are dropped.
 * `await shutdownPostHog()` forces the client to flush its batch queue before
 * the isolate exits (RESEARCH PITFALL 1).
 *
 * Idempotent: safe to call multiple times or when no client was created.
 */
export async function shutdownPostHog(): Promise<void> {
  if (!_client) return;
  try {
    await _client.shutdown();
  } catch (e) {
    console.error('[posthog-server] shutdown failed', e);
  }
  _client = null;
}
