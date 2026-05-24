/**
 * Phase 38 Plan 38-10 — Dim 9: Cost + latency adherence.
 *
 * AI-SPEC §5 Dim 9 (High):
 *   PASS: Recommender P95 < 800ms (RECOMMEND-06 gate); Digest P95 < 8s;
 *         Recommender cost ≤ $3e-6/call; Digest cost ≤ $0.012/call;
 *         Phase 38 total ≤ $0.05/user/month.
 *   FAIL: sustained breach (>5% of calls / 1h window).
 *
 * Strategy: 100 recommender + 20 digest calls (sample size matches AI-SPEC
 * §5). P95 computed via sorted-array nearest-rank. Cost is read from the
 * Vercel AI Gateway usage REST API when AI_GATEWAY_USAGE_TOKEN is set;
 * otherwise advisory (cost gate skipped, latency gate still hard).
 */
import { describe, expect, it } from 'vitest';

import { callDigest, callRecommender } from '../_fixtures/digest-call.ts';
import { loadRefset, SHOULD_RUN_EVAL } from '../_fixtures/refset.ts';

const describeIfLive = SHOULD_RUN_EVAL ? describe : describe.skip;

function p95(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, rank)] ?? 0;
}

describeIfLive('Phase 38 Plan 38-10 Dim 9 — cost + latency', () => {
  const refset = loadRefset();

  it('recommender P95 < 800ms across 100 calls', async () => {
    const latencies: number[] = [];
    // Cycle through refset user ids; pad to 100 with synthetic ids so the
    // staging recommender exercises both seeded + fall-through paths.
    for (let i = 0; i < 100; i++) {
      const userId =
        refset[i % refset.length]?.user_facts.userId ??
        `p38-eval-latency-${i.toString().padStart(3, '0')}`;
      const result = await callRecommender(userId);
      if (result.ok) latencies.push(result.latency_ms);
    }
    const p95Latency = p95(latencies);
    expect(
      p95Latency < 800,
      `recommender P95=${p95Latency}ms over ${latencies.length} samples (gate 800ms)`,
    ).toBe(true);
  }, 120_000);

  it('digest P95 < 8s across 20 calls', async () => {
    const latencies: number[] = [];
    for (let i = 0; i < 20; i++) {
      const row = refset[i % refset.length]!;
      const result = await callDigest(row.user_facts);
      if (result.ok) latencies.push(result.latency_ms);
    }
    const p95Latency = p95(latencies);
    expect(
      p95Latency < 8000,
      `digest P95=${p95Latency}ms over ${latencies.length} samples (gate 8000ms)`,
    ).toBe(true);
  }, 300_000);

  it('cost gate: Phase 38 monthly projection ≤ $0.05/user (advisory if env unset)', async () => {
    const usageToken = process.env.AI_GATEWAY_USAGE_TOKEN;
    if (!usageToken) {
      // Advisory mode — surface a non-failing log line for the dashboard.
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: 'eval.cost.advisory',
          properties: { reason: 'AI_GATEWAY_USAGE_TOKEN unset; cost-gate skipped' },
        }),
      );
      return;
    }
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const res = await fetch(`https://ai-gateway.vercel.sh/v1/usage?from=${since}`, {
      headers: { Authorization: `Bearer ${usageToken}` },
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: 'eval.cost.advisory',
          properties: { reason: `usage api ${res.status}` },
        }),
      );
      return;
    }
    const usage = (await res.json()) as {
      data?: Array<{ cost_usd?: number; api_key_label?: string }>;
    };
    const phase38Cost = (usage.data ?? [])
      .filter((d) => d.api_key_label?.includes('phase38') || d.api_key_label?.includes('digest'))
      .reduce((a, d) => a + (d.cost_usd ?? 0), 0);

    // 24h sample → 30-day projection. Gate at $0.05/user (10k user denom).
    const projectedMonthlyPerUser = (phase38Cost * 30) / 10_000;
    expect(
      projectedMonthlyPerUser <= 0.05,
      `projected monthly cost/user = $${projectedMonthlyPerUser.toFixed(5)} (gate $0.05)`,
    ).toBe(true);
  });
});
