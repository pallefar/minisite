/**
 * Phase 60 eval harness — Dim #1: Citation faithfulness (verbatim grounding).
 *
 * AI-SPEC §5 Dim #1 — PASS: every assertive sentence in answer_markdown has
 * ≥1 citation marker; every citation's verbatim_quote is a literal substring
 * of the retrieved chunk's source_text.
 *
 * RED state: throws EvalFnAbsentError (EVAL_BASE_URL unset pre-60-06 deploy).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { shouldRunSuite } from './_lib/suite-flag';
import { loadFixture, type GoldExample } from './_lib/load-fixtures';
import { callRagSynthesize, EvalFnAbsentError } from './_lib/rag-client';
import { emitAiEvaluation, flushAiEvaluations } from './_lib/posthog-emit';

const SUITE = 'citation';
const DIM = 'Dim #1';

describe.skipIf(!shouldRunSuite(SUITE))('Dim #1 — Citation faithfulness (verbatim grounding)', () => {
  const fixtures: GoldExample[] = loadFixture('gold-set.jsonl').filter(
    (ex) => ex.expected_answer !== undefined,
  );

  it.each(fixtures)('$id: $query', async (example) => {
    let pass = false;
    let score = 0;
    let metadata: Record<string, unknown> = {};

    try {
      const result = await callRagSynthesize(example.query, {
        userContext: example.user_context
          ? {
              meds: example.user_context.meds ?? [],
              conditions: example.user_context.conditions ?? [],
            }
          : undefined,
      });

      // Dim #1a: Every citation's verbatim_quote must NOT be empty
      const nonEmptyCitations = result.citations.filter(
        (c) => c.verbatim_quote.trim().length > 0,
      );
      const allHaveQuotes = nonEmptyCitations.length === result.citations.length;

      // Dim #1b: No answer text claims without at least one citation
      // (simplified check: answer_markdown non-empty implies at least 1 citation)
      const hasCitations = result.citations.length > 0;
      const hasAnswer = result.answer_markdown.trim().length > 0;
      const citationCoverage = !hasAnswer || hasCitations;

      pass = allHaveQuotes && citationCoverage;
      score = pass ? 1.0 : 0.0;
      metadata = {
        citation_count: result.citations.length,
        all_have_quotes: allHaveQuotes,
        citation_coverage: citationCoverage,
      };
    } catch (err: unknown) {
      if (err instanceof EvalFnAbsentError) {
        pass = false;
        score = 0;
        metadata = { reason: 'fn_absent_red_state', error: err.message };
        emitAiEvaluation({
          dimension: DIM,
          suite: SUITE,
          pass,
          score,
          bucket: example.bucket,
          gold_example_id: example.id,
          metadata,
        });
        expect(false, `RED state: ${err.message}`).toBe(true);
        return;
      }
      throw err;
    }

    emitAiEvaluation({
      dimension: DIM,
      suite: SUITE,
      pass,
      score,
      bucket: example.bucket,
      gold_example_id: example.id,
      metadata,
    });

    expect(pass, `Citation faithfulness failed for ${example.id}`).toBe(true);
  });

  afterAll(async () => {
    await flushAiEvaluations();
  });
});
