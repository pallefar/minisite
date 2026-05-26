/**
 * refusal.test.ts — Unit tests for refusal gates.
 *
 * Phase 60 Plan 60-06. 6 behavior cases from plan spec.
 *
 * Mocking strategy: captureRagEvent from posthog-server.ts is a global singleton.
 * In Deno, we cannot easily stub ESM imports without dynamic import mocking.
 * Since captureRagEvent is a no-op when POSTHOG_PROJECT_KEY is not set, we rely
 * on the absent env var to make it a no-op. We verify refusal shapes directly.
 *
 * For full call-count verification we spy on globalThis-level state: refusal.ts
 * calls captureRagEvent which is a no-op when POSTHOG_PROJECT_KEY is absent,
 * so we verify the returned response shape instead of PostHog call counts in unit tests.
 * Integration tests (integration.test.ts) verify the full emit path end-to-end.
 */

import {
  OUT_OF_CORPUS_COSINE_FLOOR,
  POST_RERANK_SCORE_FLOOR,
  shouldRefuseOutOfCorpus,
  shouldRefusePostRerank,
  outOfCorpusRefusal,
  postRerankRefusal,
} from '../refusal.ts';

// Ensure POSTHOG_PROJECT_KEY is absent so captureRagEvent is a no-op.
// (In this test env, Deno.env.get('POSTHOG_PROJECT_KEY') should already be unset.)
try {
  Deno.env.delete('POSTHOG_PROJECT_KEY');
} catch {
  // In some environments, env operations may not be available — acceptable.
}

// ──────────────────────────────────────────────────────────────────────────────
// shouldRefuseOutOfCorpus — boundary tests at 0.65
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('shouldRefuseOutOfCorpus returns true at 0.64 (below floor)', () => {
  const result = shouldRefuseOutOfCorpus(0.64);
  if (result !== true) {
    throw new Error(`Expected true for 0.64 < ${OUT_OF_CORPUS_COSINE_FLOOR}; got ${result}`);
  }
});

Deno.test('shouldRefuseOutOfCorpus returns false at 0.65 (exactly at floor)', () => {
  const result = shouldRefuseOutOfCorpus(0.65);
  if (result !== false) {
    throw new Error(`Expected false for 0.65 >= ${OUT_OF_CORPUS_COSINE_FLOOR}; got ${result}`);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// shouldRefusePostRerank — boundary tests at 0.5
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('shouldRefusePostRerank returns true at 0.49 (below floor)', () => {
  const result = shouldRefusePostRerank(0.49);
  if (result !== true) {
    throw new Error(`Expected true for 0.49 < ${POST_RERANK_SCORE_FLOOR}; got ${result}`);
  }
});

Deno.test('shouldRefusePostRerank returns false at 0.5 (exactly at floor)', () => {
  const result = shouldRefusePostRerank(0.5);
  if (result !== false) {
    throw new Error(`Expected false for 0.5 >= ${POST_RERANK_SCORE_FLOOR}; got ${result}`);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// outOfCorpusRefusal — response shape + PostHog event fire
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('outOfCorpusRefusal returns correctly shaped response', async () => {
  const traceId = 'test-trace-001';
  const maxCosine = 0.55;
  const topicTag = 'glp1_titration';

  const result = await outOfCorpusRefusal(traceId, maxCosine, topicTag);

  if (result.refused !== true) throw new Error(`Expected refused=true; got ${result.refused}`);
  if (result.refusal_reason !== 'out_of_corpus') {
    throw new Error(`Expected refusal_reason='out_of_corpus'; got '${result.refusal_reason}'`);
  }
  if (result.max_cosine !== maxCosine) {
    throw new Error(`Expected max_cosine=${maxCosine}; got ${result.max_cosine}`);
  }
  if (!Array.isArray(result.results) || result.results.length !== 0) {
    throw new Error(`Expected results=[]; got ${JSON.stringify(result.results)}`);
  }
  if (result.count !== 0) {
    throw new Error(`Expected count=0; got ${result.count}`);
  }
  if (result.trace_id !== traceId) {
    throw new Error(`Expected trace_id='${traceId}'; got '${result.trace_id}'`);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// postRerankRefusal — response shape + PostHog event fire
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('postRerankRefusal returns correctly shaped response with refusal_reason=post_rerank_low_relevance', async () => {
  const traceId = 'test-trace-002';
  const maxScore = 0.35;

  const result = await postRerankRefusal(traceId, maxScore);

  if (result.refused !== true) throw new Error(`Expected refused=true; got ${result.refused}`);
  if (result.refusal_reason !== 'post_rerank_low_relevance') {
    throw new Error(`Expected refusal_reason='post_rerank_low_relevance'; got '${result.refusal_reason}'`);
  }
  if (result.max_rerank_score !== maxScore) {
    throw new Error(`Expected max_rerank_score=${maxScore}; got ${result.max_rerank_score}`);
  }
  if (!Array.isArray(result.results) || result.results.length !== 0) {
    throw new Error(`Expected results=[]; got ${JSON.stringify(result.results)}`);
  }
  if (result.count !== 0) {
    throw new Error(`Expected count=0; got ${result.count}`);
  }
  if (result.trace_id !== traceId) {
    throw new Error(`Expected trace_id='${traceId}'; got '${result.trace_id}'`);
  }
  // max_cosine should be undefined since this is post-rerank refusal
  if ('max_cosine' in result && result.max_cosine !== undefined) {
    throw new Error(`Expected max_cosine to be absent or undefined; got ${result.max_cosine}`);
  }
});
