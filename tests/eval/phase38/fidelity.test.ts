/**
 * Phase 38 Plan 38-10 — Dim 1: Factual fidelity to logged events.
 *
 * AI-SPEC §5 Dim 1 (Critical):
 *   PASS: 0 fabricated numerics across refset (set-difference of narrative
 *         numerics vs user_facts numerics).
 *   FAIL: any narrative claim contains a numeric not in user_facts.
 *
 * Strategy: deterministic numeric-set diff (no LLM call). The LLM judge in
 * judgeFidelity is a semantic secondary check; this Critical gate is
 * code-only so it cannot drift with model behavior.
 *
 * Skip behavior: when STAGING_BASE_URL unset, skipped (local dev). In CI
 * the env var is required (see .github/workflows/phase38-eval-nightly.yml).
 */
import { describe, expect, it } from 'vitest';

import { fidelityCheck } from '../_judge/fidelity-numerics.ts';
import { callDigest } from '../_fixtures/digest-call.ts';
import { loadRefset, SHOULD_RUN_EVAL } from '../_fixtures/refset.ts';

const describeIfLive = SHOULD_RUN_EVAL ? describe : describe.skip;

describeIfLive('Phase 38 Plan 38-10 Dim 1 — factual fidelity', () => {
  const refset = loadRefset();

  // We render the user-facts template inline here as a JSON.stringify of the
  // structured bundle — same canonical text the server-side
  // `renderUserFacts()` produces (kept lossless via .stringify so every
  // numeric is preserved). The fidelity check is set-equality, so a
  // permissive superset of the templated text is safe.
  for (const row of refset) {
    if (!row.expected_dim1_fidelity) continue;
    it(`row ${row.id}: zero fabricated numerics`, async () => {
      const result = await callDigest(row.user_facts);
      expect(result.ok, `digest call failed for ${row.id}: ${JSON.stringify(result.body)}`).toBe(
        true,
      );
      const body = result.body as { narrative: string };
      const userFactsText = JSON.stringify(row.user_facts);
      const fidelity = fidelityCheck(body.narrative, userFactsText);
      expect(
        fidelity.fabricated,
        `row ${row.id}: fabricated numerics ${JSON.stringify(fidelity.fabricated)}`,
      ).toEqual([]);
      expect(fidelity.score).toBe(1);
    });
  }
});
