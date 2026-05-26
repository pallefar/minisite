/**
 * Phase 60 eval harness — Dim #12: Cost envelope.
 *
 * AI-SPEC §5 Dim #12 / G6 — PASS: p95 cost_usd across the 40-example gold-set
 * sweep is ≤ $0.04 per synthesis call.
 *
 * RED state: throws EvalFnAbsentError (EVAL_BASE_URL unset pre-60-06 deploy).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { shouldRunSuite } from './_lib/suite-flag';
import { loadFixture, type GoldExample } from './_lib/load-fixtures';
import { callRagSynthesize, EvalFnAbsentError } from './_lib/rag-client';
import { emitAiEvaluation, flushAiEvaluations } from './_lib/posthog-emit';

const SUITE = 'cost';
const DIM = 'Dim #12';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

describe.skipIf(!shouldRunSuite(SUITE))('Dim #12 — Cost envelope (p95 ≤ $0.04 per call)', () => {
  const fixtures: GoldExample[] = loadFixture('gold-set.jsonl');
  const costs: number[] = [];

  it.each(fixtures)('$id: cost telemetry', async (example) => {
    let pass = false;
    let cost = 0;
    let metadata: Record<string, unknown> = {};

    try {
      const result = await callRagSynthesize(example.query, {
        userContext: example.user_context
          ? { meds: example.user_context.meds ?? [], conditions: example.user_context.conditions ?? [] }
          : undefined,
      });

      cost = result.cost_usd ?? 0;
      costs.push(cost);
      pass = cost <= 0.04;
      metadata = { cost_usd: cost, has_cost_telemetry: result.cost_usd !== undefined };
    } catch (err: unknown) {
      if (err instanceof EvalFnAbsentError) {
        pass = false;
        cost = 0;
        metadata = { reason: 'fn_absent_red_state', error: err.message };
        emitAiEvaluation({ dimension: DIM, suite: SUITE, pass, score: 0, bucket: example.bucket, gold_example_id: example.id, metadata });
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
      bucket: example.bucket,
      gold_example_id: example.id,
      metadata,
    });
  });

  it('p95 cost across all 40 examples ≤ $0.04', () => {
    if (costs.length === 0) return; // upstream RED-state failures already surfaced
    const sorted = [...costs].sort((a, b) => a - b);
    const p95 = percentile(sorted, 0.95);
    emitAiEvaluation({
      dimension: DIM,
      suite: SUITE,
      pass: p95 <= 0.04,
      score: p95,
      bucket: 'cost_envelope',
      gold_example_id: 'aggregate-p95',
      metadata: { p95_cost_usd: p95, sample_count: costs.length },
    });
    expect(p95, `Dim #12: p95 cost $${p95.toFixed(4)} exceeds $0.04 limit`).toBeLessThanOrEqual(0.04);
  });

  afterAll(async () => {
    await flushAiEvaluations();
  });
});
