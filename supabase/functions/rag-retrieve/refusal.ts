/**
 * refusal.ts — Out-of-corpus + post-rerank-low-relevance refusal gates.
 *
 * Phase 60 Plan 60-06. AI-SPEC §6 G3 (out-of-corpus) + G4 (post-rerank-low-relevance).
 *
 * Threshold constants:
 *   OUT_OF_CORPUS_COSINE_FLOOR = 0.65 (AI-SPEC §6 G3)
 *   POST_RERANK_SCORE_FLOOR    = 0.5  (AI-SPEC §6 G4)
 *
 * Both are SOURCE-LITERAL constants (T-60-06-02: NOT env-overridable — tamper-proof).
 *
 * PostHog: fires 'rag_refusal_emitted' via captureRagEvent (system-attributed,
 * distinctId='rag-system') — refusal is a system-level quality gate, not user-attributed
 * telemetry. D-13 user-attribution invariant applies to user-generated AI calls only.
 *
 * Note: plan spec described emitRagRefusal() but actual posthog-rag-events.ts exposes
 * emitRefusalEmitted(args: { userId, properties }) which requires userId and a
 * 'surface' property. Since this Fn doesn't carry a user JWT in the refusal path,
 * we use captureRagEvent directly (the system-attribution primitive). [Rule 1 fix]
 */

import { captureRagEvent } from '../_shared/posthog-server.ts';

/** AI-SPEC §6 G3: refuse when max(cosine_similarity) < this threshold (saves all downstream cost). */
export const OUT_OF_CORPUS_COSINE_FLOOR = 0.65;

/** AI-SPEC §6 G4: refuse when max(rerank_score) < this threshold after reranking. */
export const POST_RERANK_SCORE_FLOOR = 0.5;

/** Structured response returned on any refusal. */
export interface RetrieveRefusalResponse {
  refused: true;
  refusal_reason: 'out_of_corpus' | 'post_rerank_low_relevance';
  max_cosine?: number;
  max_rerank_score?: number;
  results: [];
  count: 0;
  trace_id: string;
}

/**
 * Returns true when the max cosine similarity is below the out-of-corpus threshold.
 * This fires BEFORE the rerank call to save Cohere/Jina cost.
 */
export function shouldRefuseOutOfCorpus(maxCosine: number): boolean {
  return maxCosine < OUT_OF_CORPUS_COSINE_FLOOR;
}

/**
 * Returns true when the max rerank score is below the post-rerank relevance threshold.
 */
export function shouldRefusePostRerank(maxScore: number): boolean {
  return maxScore < POST_RERANK_SCORE_FLOOR;
}

/**
 * Build an out-of-corpus refusal response and emit 'rag_refusal_emitted' to PostHog.
 * Fires BEFORE rerank call — zero Cohere/Jina cost when corpus doesn't support query.
 */
export async function outOfCorpusRefusal(
  traceId: string,
  maxCosine: number,
  topicTag?: string,
): Promise<RetrieveRefusalResponse> {
  captureRagEvent({
    distinctId: 'rag-system',
    name: 'rag_refusal_emitted',
    properties: {
      trace_id: traceId,
      refusal_reason: 'out_of_corpus',
      max_cosine: maxCosine,
      ...(topicTag ? { topic_tag: topicTag } : {}),
    },
  });
  return {
    refused: true,
    refusal_reason: 'out_of_corpus',
    max_cosine: maxCosine,
    results: [],
    count: 0,
    trace_id: traceId,
  };
}

/**
 * Build a post-rerank low-relevance refusal response and emit 'rag_refusal_emitted' to PostHog.
 * Fires after rerank when all reranked results score below the relevance floor.
 */
export async function postRerankRefusal(
  traceId: string,
  maxRerankScore: number,
  topicTag?: string,
): Promise<RetrieveRefusalResponse> {
  captureRagEvent({
    distinctId: 'rag-system',
    name: 'rag_refusal_emitted',
    properties: {
      trace_id: traceId,
      refusal_reason: 'post_rerank_low_relevance',
      max_rerank_score: maxRerankScore,
      ...(topicTag ? { topic_tag: topicTag } : {}),
    },
  });
  return {
    refused: true,
    refusal_reason: 'post_rerank_low_relevance',
    max_rerank_score: maxRerankScore,
    results: [],
    count: 0,
    trace_id: traceId,
  };
}
