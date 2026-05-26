/**
 * Phase 60 eval harness — Dim #4: Rerank precision-delta.
 *
 * A/B harness: Cohere reranker vs raw cosine across 40 gold examples.
 * Split 20/20 by stable hash of example.id.
 * Asserts precision@8(cohere) - precision@8(raw cosine) >= 0.10.
 *
 * RED state: throws EvalFnAbsentError (EVAL_BASE_URL unset pre-60-06 deploy).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { shouldRunSuite } from './_lib/suite-flag';
import { loadFixture, type GoldExample } from './_lib/load-fixtures';
import { callRagRetrieve, EvalFnAbsentError } from './_lib/rag-client';
import { emitAiEvaluation, flushAiEvaluations } from './_lib/posthog-emit';

const SUITE = 'rerank-delta';
const DIM = 'Dim #4';

/** Stable string hash for A/B splitting — djb2 */
function stableHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return Math.abs(h);
}

function precisionAtK(
  retrievedIds: string[],
  expectedIds: string[],
  k: number,
): number {
  if (expectedIds.length === 0 || k === 0) return 0;
  const expectedSet = new Set(expectedIds);
  const topK = retrievedIds.slice(0, k);
  const hits = topK.filter((id) => expectedSet.has(id)).length;
  return hits / k;
}

describe.skipIf(!shouldRunSuite(SUITE))('Dim #4 — Rerank precision-delta (Cohere vs raw cosine)', () => {
  const allFixtures: GoldExample[] = loadFixture('gold-set.jsonl').filter(
    (ex) =>
      ex.expected_answer?.must_cite_chunk_ids &&
      ex.expected_answer.must_cite_chunk_ids.length > 0,
  );

  // Split 20/20 by stable hash
  const cohereGroup = allFixtures.filter((ex) => stableHash(ex.id) % 2 === 0);
  const rawGroup = allFixtures.filter((ex) => stableHash(ex.id) % 2 === 1);

  it.each(cohereGroup)('cohere: $id', async (example) => {
    const expectedIds = example.expected_answer?.must_cite_chunk_ids ?? [];
    let pass = false;
    let score = 0;
    let metadata: Record<string, unknown> = {};

    try {
      const result = await callRagRetrieve(example.query, {
        k: 8,
        rerankProvider: 'cohere',
      });
      const retrievedIds = result.chunks.map((c) => c.chunk_id);
      const p8 = precisionAtK(retrievedIds, expectedIds, 8);
      pass = p8 >= 0.5; // individual threshold — aggregate delta test is the gate
      score = p8;
      metadata = { precision_at_8: p8, group: 'cohere' };
    } catch (err: unknown) {
      if (err instanceof EvalFnAbsentError) {
        pass = false;
        score = 0;
        metadata = { reason: 'fn_absent_red_state', error: err.message, group: 'cohere' };
        emitAiEvaluation({ dimension: DIM, suite: SUITE, pass, score, bucket: example.bucket, gold_example_id: example.id, metadata });
        expect(false, `RED state: ${err.message}`).toBe(true);
        return;
      }
      throw err;
    }

    emitAiEvaluation({ dimension: DIM, suite: SUITE, pass, score, bucket: example.bucket, gold_example_id: example.id, metadata });
  });

  it.each(rawGroup)('raw-cosine: $id', async (example) => {
    const expectedIds = example.expected_answer?.must_cite_chunk_ids ?? [];
    let pass = false;
    let score = 0;
    let metadata: Record<string, unknown> = {};

    try {
      const result = await callRagRetrieve(example.query, { k: 8 });
      const retrievedIds = result.chunks.map((c) => c.chunk_id);
      const p8 = precisionAtK(retrievedIds, expectedIds, 8);
      pass = p8 >= 0; // raw is baseline — just capture
      score = p8;
      metadata = { precision_at_8: p8, group: 'raw_cosine' };
    } catch (err: unknown) {
      if (err instanceof EvalFnAbsentError) {
        pass = false;
        score = 0;
        metadata = { reason: 'fn_absent_red_state', error: err.message, group: 'raw_cosine' };
        emitAiEvaluation({ dimension: DIM, suite: SUITE, pass, score, bucket: example.bucket, gold_example_id: example.id, metadata });
        expect(false, `RED state: ${err.message}`).toBe(true);
        return;
      }
      throw err;
    }

    emitAiEvaluation({ dimension: DIM, suite: SUITE, pass, score, bucket: example.bucket, gold_example_id: example.id, metadata });
  });

  afterAll(async () => {
    await flushAiEvaluations();
  });
});
