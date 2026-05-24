/**
 * Phase 38 Plan 38-10 — Dim 7: Stale-content surfacing rate.
 *
 * AI-SPEC §5 Dim 7 (High):
 *   PASS: zero recommendations point to content.published_at IS NULL or
 *         content_embeddings.stale=true AND last_embedded_at > 30 days ago
 *         (RECOMMEND-04). 404 click-through rate < 0.5%.
 *   FAIL: any recommendation 404s; embedding > 30 days stale surfaces.
 *
 * Strategy: row R-18 (stale fixture) + 5 synthetic stale-content scenarios
 * seeded by the GH Actions workflow. The recommender response items carry
 * `published_at` + `stale` flags (from the SECDEF RPC) which we assert.
 */
import { describe, expect, it } from 'vitest';

import { callRecommender } from '../_fixtures/digest-call.ts';
import { loadRefset, SHOULD_RUN_EVAL } from '../_fixtures/refset.ts';

const describeIfLive = SHOULD_RUN_EVAL ? describe : describe.skip;
const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;

describeIfLive('Phase 38 Plan 38-10 Dim 7 — stale-content surfacing', () => {
  const refset = loadRefset();

  // Refset stale fixture.
  for (const row of refset) {
    if (row.expected_excluded_content_ids.length === 0) continue;
    it(`row ${row.id}: excluded content ids never surface`, async () => {
      const result = await callRecommender(row.user_facts.userId);
      expect(result.ok).toBe(true);
      const surfaced = result.items.map((it) => it.content_id);
      for (const excluded of row.expected_excluded_content_ids) {
        expect(
          surfaced.includes(excluded),
          `row ${row.id}: excluded content ${excluded} surfaced`,
        ).toBe(false);
      }
    });
  }

  // Synthetic stale-content invariants: every surfaced item must be fresh.
  const SYNTHETIC_USERS: string[] = [
    'p38-eval-stale-A',
    'p38-eval-stale-B',
    'p38-eval-stale-C',
    'p38-eval-stale-D',
    'p38-eval-stale-E',
  ];

  for (const userId of SYNTHETIC_USERS) {
    it(`synthetic ${userId}: zero stale surfaces`, async () => {
      const result = await callRecommender(userId);
      expect(result.ok).toBe(true);
      for (const item of result.items) {
        expect(item.stale !== true, `${userId}: stale item ${item.content_id}`).toBe(true);
        expect(
          item.published_at !== null && item.published_at !== undefined,
          `${userId}: unpublished item ${item.content_id}`,
        ).toBe(true);
        if (item.published_at) {
          const ageMs = Date.now() - new Date(item.published_at).getTime();
          expect(
            ageMs <= THIRTY_DAYS_MS * 12,
            `${userId}: item ${item.content_id} older than 12 months`,
          ).toBe(true);
        }
      }
    });
  }
});
