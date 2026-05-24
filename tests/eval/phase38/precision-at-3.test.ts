/**
 * Phase 38 Plan 38-10 — Dim 6: Retrieval precision @3.
 *
 * AI-SPEC §5 Dim 6 (High):
 *   PASS: on the 20-row refset, mean precision@3 ≥ 0.6 against
 *         RD-labeled "relevant" set; per-scenario floor ≥ 0.33 (≥ 1/3
 *         relevant). Phase-aware: escalation-week + nausea → ≥ 2/3 picks
 *         are GI-management or hydration content.
 *   FAIL: mean < 0.5 OR any scenario returns zero relevant items.
 *
 * Precision@3 = |relevant ∩ top3| / 3, where relevant = expected_tags ∪
 * expected_required_top3_tag.
 */
import { describe, expect, it } from 'vitest';

import { callRecommender } from '../_fixtures/digest-call.ts';
import { loadRefset, SHOULD_RUN_EVAL } from '../_fixtures/refset.ts';

const describeIfLive = SHOULD_RUN_EVAL ? describe : describe.skip;

function precisionAt3(itemTags: Array<Set<string>>, relevant: Set<string>): number {
  if (itemTags.length === 0) return 0;
  const top3 = itemTags.slice(0, 3);
  let hits = 0;
  for (const tags of top3) {
    for (const t of tags) {
      if (relevant.has(t)) {
        hits += 1;
        break;
      }
    }
  }
  return hits / 3;
}

describeIfLive('Phase 38 Plan 38-10 Dim 6 — recommender precision@3', () => {
  const refset = loadRefset();
  const perRowScores: Array<{ id: string; score: number; floor: number }> = [];

  for (const row of refset) {
    it(`row ${row.id}: precision@3 ≥ ${row.expected_dim6_precision_at_3_min}`, async () => {
      const result = await callRecommender(row.user_facts.userId);
      expect(result.ok, `recommender call failed for ${row.id}: ${result.status}`).toBe(true);

      const relevant = new Set<string>(row.expected_tags);
      if (row.expected_required_top3_tag) relevant.add(row.expected_required_top3_tag);

      const itemTags = result.items.map((it) => new Set<string>(it.tags ?? []));
      const score = precisionAt3(itemTags, relevant);
      perRowScores.push({ id: row.id, score, floor: row.expected_dim6_precision_at_3_min });

      // Per-scenario floor.
      expect(
        score >= row.expected_dim6_precision_at_3_min,
        `row ${row.id}: precision@3=${score} < floor ${row.expected_dim6_precision_at_3_min}`,
      ).toBe(true);

      // Required-top3-tag invariant (Dim 6 phase-aware floor).
      if (row.expected_required_top3_tag) {
        const top3HasTag = itemTags
          .slice(0, 3)
          .some((tags) => tags.has(row.expected_required_top3_tag!));
        expect(
          top3HasTag,
          `row ${row.id}: required top3 tag ${row.expected_required_top3_tag} missing`,
        ).toBe(true);
      }
    });
  }

  it('mean precision@3 across refset ≥ 0.6', () => {
    if (perRowScores.length === 0) return; // upstream failures already surfaced
    const mean = perRowScores.reduce((a, r) => a + r.score, 0) / perRowScores.length;
    expect(mean, `mean precision@3 = ${mean.toFixed(3)} (per-row: ${JSON.stringify(perRowScores)})`).toBeGreaterThanOrEqual(
      0.6,
    );
  });
});
