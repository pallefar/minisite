/**
 * Phase 38 Plan 38-02 — tests for recommender-rank.ts.
 *
 * Coverage:
 *  T4: rankRecommendations takes 10 candidates + ranking input, returns top 3
 *  T5: EXCLUDES rows where user dismissed < 24h ago (dismissedIds membership)
 *  T6: tags each result with surface_target derived from caller's `surface`
 *  T7: auto_approve_kb=true when source_type='kb_article' AND action_id ∈ {null, 'read_kb'}
 *  T8: expires_at = nowMs + 7d (deterministic with caller-passed nowMs)
 *  +: exclude excludeContentId, deeplink derivation per source_type, non-KB
 *     auto_approve_kb=false.
 */

import { assert, assertEquals } from 'jsr:@std/assert@^1';
import { rankRecommendations, type RankCandidate, type RankInput } from './recommender-rank.ts';

const NOW_MS = new Date('2026-05-20T10:00:00Z').getTime();

function makeCandidates(count: number): RankCandidate[] {
  return Array.from({ length: count }, (_, i) => ({
    source_table: 'content_embeddings',
    content_id: `content-${String(i).padStart(2, '0')}`,
    source_type: i === 0 ? 'kb_article' : i === 1 ? 'blog_post' : i === 2 ? 'community_post' : 'course_lesson',
    title: `Title ${i}`,
    similarity: 0.9 - i * 0.05,
  }));
}

function baseInput(over: Partial<RankInput> = {}): RankInput {
  return {
    candidates: makeCandidates(10),
    userId: 'user-1234abcd',
    dismissedIds: [],
    locale: 'en-US',
    surface: 'dashboard',
    nowMs: NOW_MS,
    ...over,
  };
}

// ─── T4 ────────────────────────────────────────────────────────────────────

Deno.test('T4: rankRecommendations returns top-3 from 10 candidates by default', () => {
  const out = rankRecommendations(baseInput());
  assertEquals(out.length, 3);
  // First (highest similarity) is kb_article.
  assertEquals(out[0]!.source_type, 'kb_article');
  assertEquals(out[1]!.source_type, 'blog_post');
  assertEquals(out[2]!.source_type, 'community_post');
});

// ─── T5: dismissedIds exclusion ───────────────────────────────────────────

Deno.test('T5: rankRecommendations excludes dismissedIds (24h window)', () => {
  const out = rankRecommendations(
    baseInput({ dismissedIds: ['content-00', 'content-01'] }),
  );
  // content-00 and content-01 must NOT appear; content-02, 03, 04 should.
  const ids = out.map((r) => r.source_id);
  assert(!ids.includes('content-00'), 'content-00 dismissed → excluded');
  assert(!ids.includes('content-01'), 'content-01 dismissed → excluded');
  assertEquals(ids[0], 'content-02');
  assertEquals(out.length, 3);
});

Deno.test('T5b: rankRecommendations excludes excludeContentId (kb_footer surface)', () => {
  const out = rankRecommendations(
    baseInput({ surface: 'kb_footer', excludeContentId: 'content-00' }),
  );
  assert(!out.some((r) => r.source_id === 'content-00'));
});

// ─── T6: surface_target tagging ───────────────────────────────────────────

Deno.test('T6: each result tagged with surface_target derived from caller surface', () => {
  const surfaces: Array<RankInput['surface']> = [
    'dashboard',
    'kb_footer',
    'community_feed',
    'course_landing',
  ];
  for (const surface of surfaces) {
    const out = rankRecommendations(baseInput({ surface }));
    for (const r of out) {
      assertEquals(r.surface_target, [surface]);
    }
  }
});

// ─── T7: auto_approve_kb flag (D-13) ──────────────────────────────────────

Deno.test('T7: auto_approve_kb=true for kb_article + action_id=read_kb', () => {
  const out = rankRecommendations(baseInput());
  const kbResult = out.find((r) => r.source_type === 'kb_article');
  assert(kbResult, 'expected a kb_article in top-3');
  assertEquals(kbResult.action_id, 'read_kb');
  assertEquals(kbResult.auto_approve_kb, true);
});

Deno.test('T7b: auto_approve_kb=false for non-kb source types', () => {
  const out = rankRecommendations(baseInput());
  for (const r of out) {
    if (r.source_type !== 'kb_article') {
      assertEquals(r.auto_approve_kb, false);
      // Non-KB results have no default action_id (content-only).
      assertEquals(r.action_id, undefined);
    }
  }
});

// ─── T8: expires_at = nowMs + 7d (deterministic) ─────────────────────────

Deno.test('T8: expires_at = nowMs + 7 days (D-03 freshness window)', () => {
  const out = rankRecommendations(baseInput());
  const expectedExpires = new Date(NOW_MS + 7 * 24 * 60 * 60 * 1000).toISOString();
  for (const r of out) {
    assertEquals(r.expires_at, expectedExpires);
  }
});

// ─── Deeplink derivation ──────────────────────────────────────────────────

Deno.test('Deeplink: source_type → URL shape', () => {
  const out = rankRecommendations(baseInput({ topN: 4 }));
  // Order: kb_article, blog_post, community_post, course_lesson
  assertEquals(out[0]!.deeplink, '/kb/content-00');
  assertEquals(out[1]!.deeplink, '/blog/content-01');
  assertEquals(out[2]!.deeplink, '/community/p/content-02');
  assertEquals(out[3]!.deeplink, '/courses/lesson/content-03');
});

// ─── recommendation_id determinism ───────────────────────────────────────

Deno.test('recommendation_id is deterministic given (user, content, surface, day-bucket)', () => {
  const a = rankRecommendations(baseInput());
  const b = rankRecommendations(baseInput());
  for (let i = 0; i < a.length; i++) {
    assertEquals(a[i]!.recommendation_id, b[i]!.recommendation_id);
  }
});

Deno.test('recommendation_id differs for different surfaces', () => {
  const dash = rankRecommendations(baseInput({ surface: 'dashboard' }));
  const foot = rankRecommendations(baseInput({ surface: 'kb_footer' }));
  for (let i = 0; i < dash.length; i++) {
    assert(
      dash[i]!.recommendation_id !== foot[i]!.recommendation_id,
      'same content + different surface must produce different recommendation_id',
    );
  }
});

// ─── score uses weighted_score when present, falls back to similarity ────

Deno.test('score uses weighted_score when provided, else similarity', () => {
  const candidates = makeCandidates(10);
  candidates[0]!.weighted_score = 0.42;
  const out = rankRecommendations(baseInput({ candidates }));
  assertEquals(out[0]!.score, 0.42);
  // Subsequent rows without weighted_score fall back to similarity.
  assertEquals(out[1]!.score, candidates[1]!.similarity);
});

// ─── empty candidates returns [] ─────────────────────────────────────────

Deno.test('empty candidates returns []', () => {
  const out = rankRecommendations(baseInput({ candidates: [] }));
  assertEquals(out, []);
});
