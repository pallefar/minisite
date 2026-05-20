/**
 * Phase 38 Plan 38-02 — business-rule re-ranker for the AI recommender.
 *
 * Takes 10 cosine-similarity candidates from `match_content_embeddings`,
 * applies CONTEXT business rules, returns top-3 ranked recommendations.
 *
 * Rules applied (CONTEXT decisions):
 *  - D-01: each result tagged with `surface_target: string[]` derived from the
 *    caller-provided `surface` parameter (multi-surface payload).
 *  - D-03: every recommendation has `expires_at = now() + 7d` (forces freshness).
 *  - D-03: `action_id` is OPTIONAL — absence means content-only (read this KB).
 *  - D-13: auto-approve KB-sourced content (`source_type === 'kb_article'` AND
 *    `action_id ∈ {null, 'read_kb'}`). Everything else flagged for HITL.
 *  - D-15: action_id (if set) MUST be in WHITELIST_ACTION_IDS — enforced upstream
 *    in digest-schema.ts; this module respects what it's handed.
 *
 *  - AI-SPEC §4 State Management: exclude rows the user dismissed in the last
 *    24h. Caller passes `dismissedIds` for that window.
 *  - AI-SPEC §6 O4: caller passes `excludeContentId` to prevent recommending
 *    the article currently being viewed (kb_footer surface).
 *
 * Determinism: same input ALWAYS produces the same output. No clock-reading
 * inside the ranker — the caller passes `nowMs` for `expires_at` so test runs
 * are deterministic.
 */

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface RankCandidate {
  source_table: string;
  content_id: string;
  source_type: string;
  title: string;
  similarity: number;
  /** Optional weighted score (caller's choice); defaults to similarity if absent. */
  weighted_score?: number;
}

export interface RankInput {
  candidates: RankCandidate[];
  userId: string;
  dismissedIds: string[];
  locale: string;
  surface: 'dashboard' | 'kb_footer' | 'community_feed' | 'course_landing';
  /** Skip the content currently being viewed (kb_footer surface). */
  excludeContentId?: string;
  /** Override `Date.now()` for deterministic expires_at — defaults to current time. */
  nowMs?: number;
  /** Number of results to return — defaults to 3 per D-03. */
  topN?: number;
}

export interface RankedRecommendation {
  recommendation_id: string;
  source_type: string;
  source_id: string;
  title: string;
  deeplink: string;
  score: number;
  surface_target: string[];
  action_id?: string;
  expires_at: string;
  auto_approve_kb: boolean;
}

/**
 * Build the deeplink for a content_id given its source_type. Shim paths for
 * surfaces not yet shipped (community + courses) per CONTEXT D-01 multi-
 * surface payload — wiring renders no-op until M4 ships.
 */
function buildDeeplink(sourceType: string, sourceId: string): string {
  switch (sourceType) {
    case 'kb_article':
      return `/kb/${sourceId}`;
    case 'blog_post':
      return `/blog/${sourceId}`;
    case 'community_post':
      return `/community/p/${sourceId}`; // shim, D-01
    case 'course_lesson':
      return `/courses/lesson/${sourceId}`; // shim, D-01
    default:
      // Unknown source — fall back to a generic content path so downstream
      // routing can 404 gracefully rather than crashing.
      return `/content/${sourceId}`;
  }
}

/**
 * Build a deterministic recommendation_id from (userId, contentId, surface,
 * nowMs/day-bucket). Day-bucket ensures dedup within a day but allows the
 * same content to surface tomorrow if still relevant.
 */
function buildRecommendationId(
  userId: string,
  contentId: string,
  surface: string,
  nowMs: number,
): string {
  const dayBucket = Math.floor(nowMs / (24 * 60 * 60 * 1000));
  // Short deterministic id; full uniqueness is on (user_id, content_id,
  // shown_at::date) at the DB layer.
  return `rec_${userId.slice(0, 8)}_${contentId.slice(0, 8)}_${surface[0]}_${dayBucket}`;
}

/**
 * Re-rank cosine-similarity candidates per CONTEXT business rules.
 *
 * Caller responsibilities:
 *  - candidates pre-sorted by descending similarity (RPC contract).
 *  - dismissedIds covers the last-24h window only.
 *  - locale forwarded as metadata (no per-locale filtering yet).
 */
export function rankRecommendations(input: RankInput): RankedRecommendation[] {
  const topN = input.topN ?? 3;
  const nowMs = input.nowMs ?? Date.now();
  const expiresAt = new Date(nowMs + SEVEN_DAYS_MS).toISOString();
  const dismissed = new Set(input.dismissedIds);

  const filtered = input.candidates.filter((c) => {
    if (input.excludeContentId && c.content_id === input.excludeContentId) return false;
    if (dismissed.has(c.content_id)) return false;
    return true;
  });

  return filtered.slice(0, topN).map((c) => {
    const isKb = c.source_type === 'kb_article';
    // D-13 default action for KB: 'read_kb'. Non-KB recommendations leave
    // action_id unset (content-only) unless an upstream classifier sets it.
    const actionId: string | undefined = isKb ? 'read_kb' : undefined;
    const autoApproveKb = isKb && (actionId === undefined || actionId === 'read_kb');
    return {
      recommendation_id: buildRecommendationId(input.userId, c.content_id, input.surface, nowMs),
      source_type: c.source_type,
      source_id: c.content_id,
      title: c.title,
      deeplink: buildDeeplink(c.source_type, c.content_id),
      score: c.weighted_score ?? c.similarity,
      surface_target: [input.surface],
      action_id: actionId,
      expires_at: expiresAt,
      auto_approve_kb: autoApproveKb,
    };
  });
}
