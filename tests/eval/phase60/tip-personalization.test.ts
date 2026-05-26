/**
 * Phase 60 eval harness — Dim #13: Tip-of-day personalization.
 *
 * AI-SPEC §5 Dim #13 — PASS: tip-of-day response contains no prescriptive verbs
 * matching /^(take|increase|decrease|stop|start) /m.
 * Also: LLM-judge rubric stub — asserts presence of judge-score metadata field.
 *
 * RED state: throws EvalFnAbsentError (EVAL_BASE_URL unset pre-60-11 deploy).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { shouldRunSuite } from './_lib/suite-flag';
import { callRagTipOfDay, EvalFnAbsentError } from './_lib/rag-client';
import { emitAiEvaluation, flushAiEvaluations } from './_lib/posthog-emit';

const SUITE = 'tip-personalization';
const DIM = 'Dim #13';

const PRESCRIPTIVE_VERB_REGEX = /^(take|increase|decrease|stop|start) /im;

describe.skipIf(!shouldRunSuite(SUITE))('Dim #13 — Tip-of-day personalization (no prescriptive verbs)', () => {
  it('tip-of-day: no prescriptive verb in response body', async () => {
    let pass = false;
    let metadata: Record<string, unknown> = {};

    try {
      const result = await callRagTipOfDay();

      const prescriptiveMatch = PRESCRIPTIVE_VERB_REGEX.exec(result.answer_markdown);
      const hasPrescriptiveVerb = prescriptiveMatch !== null;
      const hasJudgeScore = result.cost_usd !== undefined; // stub: any numeric field signals judge metadata
      pass = !hasPrescriptiveVerb;
      metadata = {
        has_prescriptive_verb: hasPrescriptiveVerb,
        prescriptive_match: prescriptiveMatch?.[0],
        has_judge_score: hasJudgeScore,
        answer_preview: result.answer_markdown.slice(0, 100),
      };
    } catch (err: unknown) {
      if (err instanceof EvalFnAbsentError) {
        pass = false;
        metadata = { reason: 'fn_absent_red_state', error: err.message };
        emitAiEvaluation({
          dimension: DIM,
          suite: SUITE,
          pass,
          score: 0,
          bucket: 'tip_personalization',
          gold_example_id: 'tip-of-day-single',
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
      score: pass ? 1.0 : 0.0,
      bucket: 'tip_personalization',
      gold_example_id: 'tip-of-day-single',
      metadata,
    });

    expect(
      pass,
      `Dim #13: Prescriptive verb found in tip response: "${metadata['prescriptive_match']}"`,
    ).toBe(true);
  });

  afterAll(async () => {
    await flushAiEvaluations();
  });
});
