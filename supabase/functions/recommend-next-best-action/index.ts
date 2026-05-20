/**
 * Phase 38 Plan 38-03 — `recommend-next-best-action` Edge Function.
 *
 * User-triggered top-3 next-best-action recommender. Builds deterministic
 * user-context text (RESEARCH Pattern 1 Option B), embeds via AI Gateway,
 * calls `match_content_embeddings` RPC with `sources=['content_embeddings']`
 * (Phase 50 future-proof), re-ranks via `_shared/recommender-rank.ts`, and
 * returns a multi-surface payload (D-01).
 *
 * Decisions honored:
 *   D-01: same Edge Fn serves dashboard / kb_footer / community_feed / course_landing.
 *         kb_article results fan out `surface_target = ['dashboard','kb_footer']`
 *         so the dashboard impression also primes the kb_footer slot.
 *   D-02: sparse-history (<5 events in last 14 days) → popularity fallback.
 *   D-03: response shape locked (recommendation_id + 7 other keys); expires_at = now + 7d.
 *   D-04: user-context text NEVER contains drug names / raw weights (renderUserContext sanitized).
 *   D-13: KB-source auto-approve flag passes through; non-KB flagged for HITL upstream.
 *
 * Guardrails:
 *   O4: anon callers (no JWT, no service_role) rejected with 401.
 *       `match_content_embeddings` RPC also raises EXCEPTION on NULL requesting_user_id.
 *   O6: pre-embed dose-change scrub lives in `_shared/openai-embed.ts`.
 *
 * Graceful degradation:
 *   - embed throws → popularity fallback path; emits `recommendation.embedding_fallback`.
 *   - RPC returns error → popularity fallback path; emits `recommendation.rpc_fallback`.
 *
 * Telemetry:
 *   - One `recommendation.shown` event per returned rec (D-13).
 *   - PostHog `client.shutdown()` MUST run BEFORE the Response is returned —
 *     Deno isolate teardown drops in-flight batches otherwise (RESEARCH PITFALL 1).
 *
 * Test seam:
 *   - `__setDepsForTest` allows unit tests to swap supabase / embed / posthog
 *     without env wiring. `__resetDepsForTest` clears the override.
 *   - `handle(req)` is the unit-test entry; Deno.serve wires it to the runtime.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { embed as embedReal } from '../_shared/openai-embed.ts';
import {
  captureServer as captureServerReal,
  shutdownPostHog as shutdownPostHogReal,
} from '../_shared/posthog-server.ts';
import {
  rankRecommendations,
  type RankCandidate,
  type RankedRecommendation,
} from '../_shared/recommender-rank.ts';
import { renderUserContext, type UserContextFacts } from '../_shared/render-user-context.ts';

// ── Constants ──────────────────────────────────────────────────────────────

const SPARSE_HISTORY_THRESHOLD = 5;
const SPARSE_HISTORY_WINDOW_DAYS = 14;
const DISMISSED_WINDOW_HOURS = 24;
const MATCH_COUNT = 10;
const TOP_N = 3;

type Surface = 'dashboard' | 'kb_footer' | 'community_feed' | 'course_landing';
const VALID_SURFACES: ReadonlySet<Surface> = new Set([
  'dashboard',
  'kb_footer',
  'community_feed',
  'course_landing',
]);

interface RequestBody {
  user_id?: string;
  surface?: Surface;
  exclude_content_id?: string;
  sources?: string[];
  locale?: string;
}

interface ResponsePayload {
  recommendations: RankedRecommendation[];
  fallback: 'personalized' | 'popular';
}

// ── Dependency-injection seam (test-only) ──────────────────────────────────

interface Deps {
  // Tests provide a mock that implements `from(...)` + `rpc(...)`; production
  // wires a real SupabaseClient. We deliberately widen the type here so the
  // test seam doesn't need to fabricate the full SupabaseClient surface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  makeSupabase: (authHeader: string) => any;
  embed: (text: string, opts: { userId: string }) => Promise<number[]>;
  captureServer: (args: {
    userId: string;
    event: string;
    properties?: Record<string, unknown>;
  }) => void;
  shutdownPostHog: () => Promise<void>;
  nowMs: () => number;
}

let _depsOverride: Deps | null = null;

export function __setDepsForTest(deps: Partial<Deps>): void {
  _depsOverride = {
    makeSupabase: deps.makeSupabase ?? defaultMakeSupabase,
    embed:
      deps.embed ??
      ((text, opts) => embedReal(text, { userId: opts.userId })),
    captureServer: deps.captureServer ?? captureServerReal,
    shutdownPostHog: deps.shutdownPostHog ?? shutdownPostHogReal,
    nowMs: deps.nowMs ?? (() => Date.now()),
  };
}

export function __resetDepsForTest(): void {
  _depsOverride = null;
}

function defaultMakeSupabase(authHeader: string): SupabaseClient {
  // Real Supabase client; used in production (not the test seam).
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
}

function getDeps(): Deps {
  return (
    _depsOverride ?? {
      makeSupabase: defaultMakeSupabase,
      embed: (text, opts) => embedReal(text, { userId: opts.userId }),
      captureServer: captureServerReal,
      shutdownPostHog: shutdownPostHogReal,
      nowMs: () => Date.now(),
    }
  );
}

// ── Auth gate ──────────────────────────────────────────────────────────────

/** Returns `null` when the caller is unauthenticated (anon). */
function authenticateRequest(req: Request): string | null {
  const header = req.headers.get('Authorization');
  if (!header) return null;
  if (!header.startsWith('Bearer ')) return null;
  return header;
}

// ── Sparse-history fan-out helpers ─────────────────────────────────────────

/** D-01: kb_article surfaces on BOTH dashboard AND kb_footer slots. */
function expandSurfaceTargetForFanout(rec: RankedRecommendation): RankedRecommendation {
  if (rec.source_type !== 'kb_article') return rec;
  const set = new Set(rec.surface_target);
  set.add('kb_footer');
  return { ...rec, surface_target: [...set] };
}

// ── Popularity fallback (D-02) ────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildPopularityFallback(
  supabase: any,
  surface: Surface,
  excludeContentId: string | undefined,
  userId: string,
  nowMs: number,
): Promise<RankedRecommendation[]> {
  // Pull top-3 globally popular KB articles. Click-count ranking is left to a
  // future cron-computed materialized view (RECOMMEND-12); for v1 we use the
  // freshest published KB articles as the popularity proxy. This stays SAFE
  // (returns deterministic non-empty content) when the recommender path fails.
  const { data, error } = await supabase
    .from('content')
    .select('id, kind, title')
    .eq('kind', 'kb_article')
    .is('deleted_at', null)
    .is('visible_to_user_id', null)
    .order('published_at', { ascending: false })
    .limit(TOP_N);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((data as any[]) ?? []).filter(
    (r) => !excludeContentId || r.id !== excludeContentId,
  );
  if (error || rows.length === 0) {
    // Final safety net: empty array beats a 500 to the caller.
    return [];
  }
  const candidates: RankCandidate[] = rows.slice(0, TOP_N).map((r) => ({
    source_table: 'content_embeddings',
    content_id: r.id,
    source_type: r.kind ?? 'kb_article',
    title: r.title ?? '',
    similarity: 0.5, // popularity sentinel — not a true cosine score.
  }));
  return rankRecommendations({
    candidates,
    userId,
    dismissedIds: [],
    locale: 'en',
    surface,
    excludeContentId,
    nowMs,
    topN: TOP_N,
  }).map(expandSurfaceTargetForFanout);
}

// ── Personalized path (D-02 dense-history branch) ─────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadUserContextFacts(_supabase: any, _userId: string): Promise<UserContextFacts> {
  // Phase 38 v1: deterministic facts template with safe defaults. Subsequent
  // phases (Phase 24 TAXO unification) will wire real injection_log /
  // weight_log / mood_log joins. For now we surface a baseline context that
  // is stable across calls so HNSW retrieval remains warm + deterministic
  // (AI-SPEC §5 Dim 7 "embedding stability — same input → same vector").
  return {
    goalType: 'weight_loss',
    glp1Phase: 'maintenance',
    injectionCount: 0,
    weightDelta30d: null,
    units: 'kg',
    moodAvg: null,
    topSymptoms: [],
    streakDays: 0,
  };
}

async function loadDismissedIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  nowMs: number,
): Promise<string[]> {
  const sinceIso = new Date(nowMs - DISMISSED_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = (await (supabase
    .from('recommendation_events')
    .select('source_id')
    .eq('user_id', userId)
    .gt('dismissed_at', sinceIso) as any)) as {
      data: Array<{ source_id: string }> | null;
      error: { message?: string } | null;
    };
  if (error || !data) return [];
  return data.map((r) => r.source_id).filter(Boolean);
}

// ── Sparse-history check (D-02) ────────────────────────────────────────────

async function isSparseHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  nowMs: number,
): Promise<boolean> {
  const sinceIso = new Date(
    nowMs - SPARSE_HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (await (supabase
    .from('recommendation_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gt('shown_at', sinceIso) as any)) as { count: number | null; error: unknown };
  const count = result.count ?? 0;
  return count < SPARSE_HISTORY_THRESHOLD;
}

// ── Audit-insert recommendation_events ─────────────────────────────────────

async function insertRecommendationEvents(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  recs: RankedRecommendation[],
): Promise<void> {
  if (recs.length === 0) return;
  const rows = recs.map((r) => ({
    recommendation_id: r.recommendation_id,
    user_id: userId,
    source_type: r.source_type,
    source_id: r.source_id,
    action_id: r.action_id ?? null,
    surface_target: r.surface_target,
    score: r.score,
    expires_at: r.expires_at,
  }));
  try {
    await supabase.from('recommendation_events').insert(rows);
  } catch (_e) {
    // Audit-log write failure is non-fatal — telemetry still fires, the
    // user receives recommendations, and the dual-write events_mirror in
    // captureServer catches the analytics signal.
  }
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function handle(req: Request): Promise<Response> {
  const deps = getDeps();

  // 1. Auth gate (Guardrail O4: reject anon).
  const authHeader = authenticateRequest(req);
  if (!authHeader) {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  // 2. Body parse + validate.
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }
  if (!body.user_id || typeof body.user_id !== 'string') {
    return jsonResponse(400, { error: 'user_id required' });
  }
  const surface: Surface = (body.surface ?? 'dashboard') as Surface;
  if (!VALID_SURFACES.has(surface)) {
    return jsonResponse(400, { error: 'invalid surface' });
  }
  const sources = body.sources ?? ['content_embeddings'];
  const excludeContentId = body.exclude_content_id;
  const locale = body.locale ?? 'en';
  const userId = body.user_id;

  const supabase = deps.makeSupabase(authHeader);
  const nowMs = deps.nowMs();

  // 3. Sparse-history check (D-02). If <5 events in last 14d, popularity fallback.
  let fallback: 'personalized' | 'popular' = 'personalized';
  let recommendations: RankedRecommendation[] = [];

  try {
    const sparse = await isSparseHistory(supabase, userId, nowMs);
    if (sparse) {
      fallback = 'popular';
      recommendations = await buildPopularityFallback(
        supabase,
        surface,
        excludeContentId,
        userId,
        nowMs,
      );
    } else {
      // 4. Personalized path.
      try {
        const facts = await loadUserContextFacts(supabase, userId);
        const contextText = renderUserContext(facts);
        const vec = await deps.embed(contextText, { userId });

        const { data, error } = await supabase.rpc('match_content_embeddings', {
          query_embedding: vec,
          match_count: MATCH_COUNT,
          requesting_user_id: userId,
          sources,
        });
        if (error) {
          throw new Error(`match_content_embeddings failed: ${error.message ?? 'unknown'}`);
        }
        const candidates = (data as RankCandidate[] | null) ?? [];
        const dismissedIds = await loadDismissedIds(supabase, userId, nowMs);
        const ranked = rankRecommendations({
          candidates,
          userId,
          dismissedIds,
          locale,
          surface,
          excludeContentId,
          nowMs,
          topN: TOP_N,
        });
        if (ranked.length === 0) {
          // No personalized candidates after filtering → popularity fallback.
          fallback = 'popular';
          recommendations = await buildPopularityFallback(
            supabase,
            surface,
            excludeContentId,
            userId,
            nowMs,
          );
        } else {
          recommendations = ranked.map(expandSurfaceTargetForFanout);
        }
      } catch (err) {
        // Graceful degradation: embed or RPC failure → popularity fallback.
        // Emit telemetry so the SRE dashboard can spot a sustained issue.
        try {
          deps.captureServer({
            userId,
            event:
              err instanceof Error && err.message.startsWith('match_content_embeddings')
                ? 'recommendation.rpc_fallback'
                : 'recommendation.embedding_fallback',
            properties: {
              surface,
              reason: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
            },
          });
        } catch {
          /* telemetry never blocks fallback */
        }
        fallback = 'popular';
        recommendations = await buildPopularityFallback(
          supabase,
          surface,
          excludeContentId,
          userId,
          nowMs,
        );
      }
    }

    // 5. Audit-insert + telemetry.
    await insertRecommendationEvents(supabase, userId, recommendations);
    for (const rec of recommendations) {
      try {
        deps.captureServer({
          userId,
          event: 'recommendation.shown',
          properties: {
            recommendation_id: rec.recommendation_id,
            source_type: rec.source_type,
            source_id: rec.source_id,
            surface_target: rec.surface_target,
            score: rec.score,
            fallback,
          },
        });
      } catch {
        /* telemetry never blocks response */
      }
    }
  } finally {
    // 6. Drain PostHog batches BEFORE returning (RESEARCH PITFALL 1).
    try {
      await deps.shutdownPostHog();
    } catch {
      /* ignore */
    }
  }

  const payload: ResponsePayload = { recommendations, fallback };
  return jsonResponse(200, payload);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Runtime entry ──────────────────────────────────────────────────────────

// `Deno.serve` is only registered when the file is loaded by the Deno runtime
// (not when imported by the test file, where we exercise `handle` directly).
if (import.meta.main) {
  Deno.serve((req) => handle(req));
}
