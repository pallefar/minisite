/**
 * Phase 60 eval harness — Dim #11: Stale-evidence drift detection.
 *
 * AI-SPEC §5 Dim #11 — PASS: citations with evidence_date < 2024-01-01 and
 * source_tier IN ('A','B') must have stale_evidence: true.
 * Target: ≥90% of stale-tier citations correctly flagged.
 *
 * RED state: throws EvalFnAbsentError (EVAL_BASE_URL unset pre-60-07 deploy).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { shouldRunSuite } from './_lib/suite-flag';
import { loadFixture, type GoldExample } from './_lib/load-fixtures';
import { callRagSynthesize, EvalFnAbsentError } from './_lib/rag-client';
import { emitAiEvaluation, flushAiEvaluations } from './_lib/posthog-emit';

const SUITE = 'stale-drift';
const DIM = 'Dim #11';

const STALE_CUTOFF = new Date('2024-01-01');

describe.skipIf(!shouldRunSuite(SUITE))('Dim #11 — Stale-evidence drift detection', () => {
  const freshnessCore: GoldExample[] = loadFixture('gold-set.jsonl').filter(
    (ex) => ex.bucket === 'freshness',
  );
  const staleExt: GoldExample[] = loadFixture('adversarial/stale-drift-extension.jsonl');
  const fixtures: GoldExample[] = [...freshnessCore, ...staleExt];

  it.each(fixtures)('$id: $query', async (example) => {
    let pass = false;
    let score = 0;
    let metadata: Record<string, unknown> = {};

    try {
      const result = await callRagSynthesize(example.query);

      const staleTierCitations = result.citations.filter((c) => {
        const evidenceDate = new Date(c.evidence_date);
        return (
          evidenceDate < STALE_CUTOFF && (c.source_tier === 'A' || c.source_tier === 'B')
        );
      });

      const flaggedCorrectly = staleTierCitations.filter((c) => c.stale_evidence === true);
      const staleRate =
        staleTierCitations.length === 0
          ? 1.0
          : flaggedCorrectly.length / staleTierCitations.length;

      pass = staleRate >= 0.9;
      score = staleRate;
      metadata = {
        stale_tier_citation_count: staleTierCitations.length,
        correctly_flagged: flaggedCorrectly.length,
        stale_rate: staleRate,
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
    expect(
      score,
      `Dim #11: Stale flagging rate ${score.toFixed(2)} < 0.90 for ${example.id}`,
    ).toBeGreaterThanOrEqual(0.9);
  });

  afterAll(async () => {
    await flushAiEvaluations();
  });
});
