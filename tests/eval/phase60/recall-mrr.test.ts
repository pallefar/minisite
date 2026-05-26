/**
 * Phase 60 eval harness — Dim #2 + #3: Recall@k and MRR.
 *
 * Dim #2 — Recall@k: R@5 ≥ 0.80, R@10 ≥ 0.92 on gold examples with must_cite_chunk_ids.
 * Dim #3 — MRR: Mean Reciprocal Rank ≥ 0.65 across the same gold set.
 *
 * Suite alias: 'retrieval' maps to this suite per AI-SPEC §5 line 851.
 *
 * RED state: throws EvalFnAbsentError (EVAL_BASE_URL unset pre-60-06 deploy).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { shouldRunSuite } from './_lib/suite-flag';
import { loadFixture, type GoldExample } from './_lib/load-fixtures';
import { callRagRetrieve, EvalFnAbsentError } from './_lib/rag-client';
import { emitAiEvaluation, flushAiEvaluations } from './_lib/posthog-emit';

const SUITE = 'recall-mrr';
const DIM2 = 'Dim #2';
const DIM3 = 'Dim #3';

function recallAtK(retrievedIds: string[], expectedIds: string[], k: number): number {
  if (expectedIds.length === 0) return 1.0;
  const topK = new Set(retrievedIds.slice(0, k));
  const hits = expectedIds.filter((id) => topK.has(id)).length;
  return hits / expectedIds.length;
}

function computeMRR(retrievedIds: string[], expectedIds: string[]): number {
  const expectedSet = new Set(expectedIds);
  for (let i = 0; i < retrievedIds.length; i++) {
    if (expectedSet.has(retrievedIds[i])) {
      return 1.0 / (i + 1);
    }
  }
  return 0;
}

describe.skipIf(!shouldRunSuite(SUITE) && !shouldRunSuite('retrieval'))('Dim #2 + #3 — Recall@k and MRR', () => {
  const fixtures: GoldExample[] = loadFixture('gold-set.jsonl').filter(
    (ex) =>
      ex.expected_answer?.must_cite_chunk_ids &&
      ex.expected_answer.must_cite_chunk_ids.length > 0,
  );

  it.each(fixtures)('$id: recall@k and MRR', async (example) => {
    const expectedIds = example.expected_answer?.must_cite_chunk_ids ?? [];
    let pass = false;
    let score = 0;
    let metadata: Record<string, unknown> = {};

    try {
      const result = await callRagRetrieve(example.query, { k: 10 });
      const retrievedIds = result.chunks.map((c) => c.chunk_id);

      const recall5 = recallAtK(retrievedIds, expectedIds, 5);
      const recall10 = recallAtK(retrievedIds, expectedIds, 10);
      const mrr = computeMRR(retrievedIds, expectedIds);

      pass = recall5 >= 0.8 && recall10 >= 0.92 && mrr >= 0.65;
      score = (recall5 + recall10 + mrr) / 3;
      metadata = {
        recall_at_5: recall5,
        recall_at_10: recall10,
        mrr,
        topic_tag: example.topic_tag,
        expected_source_tier: example.expected_answer?.expected_source_tier,
      };
    } catch (err: unknown) {
      if (err instanceof EvalFnAbsentError) {
        pass = false;
        score = 0;
        metadata = { reason: 'fn_absent_red_state', error: err.message };
        emitAiEvaluation({ dimension: DIM2, suite: SUITE, pass, score, bucket: example.bucket, gold_example_id: example.id, metadata });
        emitAiEvaluation({ dimension: DIM3, suite: SUITE, pass, score, bucket: example.bucket, gold_example_id: example.id, metadata });
        expect(false, `RED state: ${err.message}`).toBe(true);
        return;
      }
      throw err;
    }

    emitAiEvaluation({ dimension: DIM2, suite: SUITE, pass, score: (metadata['recall_at_5'] as number) ?? 0, bucket: example.bucket, gold_example_id: example.id, metadata });
    emitAiEvaluation({ dimension: DIM3, suite: SUITE, pass, score: (metadata['mrr'] as number) ?? 0, bucket: example.bucket, gold_example_id: example.id, metadata });

    expect(
      (metadata['recall_at_5'] as number) ?? 0,
      `Recall@5 below 0.80 for ${example.id}`,
    ).toBeGreaterThanOrEqual(0.8);
    expect(
      (metadata['recall_at_10'] as number) ?? 0,
      `Recall@10 below 0.92 for ${example.id}`,
    ).toBeGreaterThanOrEqual(0.92);
    expect(
      (metadata['mrr'] as number) ?? 0,
      `MRR below 0.65 for ${example.id}`,
    ).toBeGreaterThanOrEqual(0.65);
  });

  afterAll(async () => {
    await flushAiEvaluations();
  });
});
