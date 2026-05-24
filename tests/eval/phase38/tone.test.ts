/**
 * Phase 38 Plan 38-10 — Dim 8: Behavior-change tone calibration.
 *
 * AI-SPEC §5 Dim 8 (Medium):
 *   PASS (3/5+): LLM judge scores ≥3 on 1-5 rubric (second-person,
 *                concrete, non-shaming, acknowledges plateaus without
 *                false praise). Human RD samples 10/wk confirms ≥3 mean.
 *   FAIL (≤2): generic cheerleading without referent; shaming language;
 *              motivational-interviewing parody.
 *
 * Scoped to refset rows 1-3 (critical paths) + 16-17 (sparse / weights-only)
 * per plan body. Tone gate is mean ≥ 3 across the 5 rows.
 */
import { describe, expect, it } from 'vitest';

import { callDigest } from '../_fixtures/digest-call.ts';
import { judgeTone, SkipJudgeError } from '../_judge/llm-judge.ts';
import { loadRefset, RUN_ID, SHOULD_RUN_EVAL } from '../_fixtures/refset.ts';

const describeIfLive = SHOULD_RUN_EVAL ? describe : describe.skip;
const TONE_ROW_IDS = new Set<string>(['R-01', 'R-02', 'R-03', 'R-16', 'R-17']);

describeIfLive('Phase 38 Plan 38-10 Dim 8 — behavior-change tone', () => {
  const refset = loadRefset();
  const toneRows = refset.filter((r) => TONE_ROW_IDS.has(r.id));
  const scores: number[] = [];

  for (const row of toneRows) {
    it(`row ${row.id}: tone score ≥ ${row.expected_tone_min}`, async () => {
      const result = await callDigest(row.user_facts);
      expect(result.ok, `digest call failed for ${row.id}`).toBe(true);
      const body = result.body as { narrative: string };
      try {
        const judgment = await judgeTone(body.narrative, RUN_ID);
        scores.push(judgment.score);
        expect(
          judgment.score >= row.expected_tone_min,
          `row ${row.id}: tone=${judgment.score} flags=${JSON.stringify(judgment.flags)}`,
        ).toBe(true);
      } catch (err) {
        if (err instanceof SkipJudgeError) {
          // Deterministic fallback: assert no overt shaming / false praise
          // tokens and second-person voice. Soft gate when judge unavailable.
          expect(/you|your/i.test(body.narrative), `row ${row.id}: missing 2nd-person`).toBe(true);
          expect(
            /lazy|fail(ed|ure)|disappoint|excuses/i.test(body.narrative),
            `row ${row.id}: shaming token present`,
          ).toBe(false);
        } else {
          throw err;
        }
      }
    });
  }

  it('mean tone across selected rows ≥ 3', () => {
    if (scores.length === 0) return; // judge unavailable; per-test fallback already gated
    const mean = scores.reduce((a, s) => a + s, 0) / scores.length;
    expect(mean, `mean tone = ${mean.toFixed(2)} (scores: ${scores.join(',')})`).toBeGreaterThanOrEqual(
      3,
    );
  });
});
