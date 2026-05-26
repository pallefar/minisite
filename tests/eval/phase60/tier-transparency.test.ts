/**
 * Phase 60 eval harness — Dim #8: Source-tier transparency.
 *
 * AI-SPEC §5 Dim #8 — PASS: every citation in every synthesis response has a
 * non-null source_tier matching the enum A|B|C|D|E|F.
 *
 * RED state: throws EvalFnAbsentError (EVAL_BASE_URL unset pre-60-06 deploy).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { shouldRunSuite } from './_lib/suite-flag';
import { loadFixture, type GoldExample } from './_lib/load-fixtures';
import { callRagSynthesize, EvalFnAbsentError } from './_lib/rag-client';
import { emitAiEvaluation, flushAiEvaluations } from './_lib/posthog-emit';

const SUITE = 'tier-transparency';
const DIM = 'Dim #8';

const VALID_TIERS = new Set(['A', 'B', 'C', 'D', 'E', 'F']);

describe.skipIf(!shouldRunSuite(SUITE))('Dim #8 — Source-tier transparency', () => {
  const fixtures: GoldExample[] = loadFixture('gold-set.jsonl').filter(
    (ex) => ex.expected_answer !== undefined,
  );

  it.each(fixtures)('$id: all citations have source_tier', async (example) => {
    let pass = false;
    let score = 0;
    let metadata: Record<string, unknown> = {};

    try {
      const result = await callRagSynthesize(example.query, {
        userContext: example.user_context
          ? { meds: example.user_context.meds ?? [], conditions: example.user_context.conditions ?? [] }
          : undefined,
      });

      const invalidCitations = result.citations.filter(
        (c) => !c.source_tier || !VALID_TIERS.has(c.source_tier),
      );
      pass = invalidCitations.length === 0;
      score = result.citations.length > 0
        ? (result.citations.length - invalidCitations.length) / result.citations.length
        : 1.0;
      metadata = {
        total_citations: result.citations.length,
        invalid_tier_count: invalidCitations.length,
        expected_tier: example.expected_answer?.expected_source_tier,
      };
    } catch (err: unknown) {
      if (err instanceof EvalFnAbsentError) {
        pass = false;
        score = 0;
        metadata = { reason: 'fn_absent_red_state', error: err.message };
        emitAiEvaluation({ dimension: DIM, suite: SUITE, pass, score, bucket: example.bucket, gold_example_id: example.id, metadata });
        expect(false, `RED state: ${err.message}`).toBe(true);
        return;
      }
      throw err;
    }

    emitAiEvaluation({ dimension: DIM, suite: SUITE, pass, score, bucket: example.bucket, gold_example_id: example.id, metadata });
    expect(pass, `Dim #8: Invalid source_tier in citations for ${example.id}`).toBe(true);
  });

  afterAll(async () => {
    await flushAiEvaluations();
  });
});
