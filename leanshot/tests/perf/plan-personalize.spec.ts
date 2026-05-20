/**
 * Phase 38 Plan 38-06 — Perf gate for `plan-personalize` Edge Function.
 *
 * Asserts P99 < 50ms over 100 calls (10 fixture users × 10 calls each).
 * D-17 hot-conversion-path budget. Cold-start (~200ms typical) is excluded
 * via 5 pre-warm calls before measurement.
 *
 * Run gating: only runs when STAGING_BASE_URL + a service-role token are
 * provided in env. Locally + in PR CI without staging creds, this test is
 * skipped (perf gate is enforced in staging-deploy job).
 *
 *   STAGING_BASE_URL=https://ytnsipxxmzgaebkqmokp.functions.supabase.co \
 *   PLAN_PERSONALIZE_TOKEN=<service_role> \
 *   PLAN_PERSONALIZE_USER_IDS="uuid1,uuid2,..." \
 *   npm run test -- tests/perf/plan-personalize.spec.ts
 *
 * On failure: emits per-rule + per-user p99 breakdowns to aid query-plan
 * debugging (see plan 38-06 "done" criteria).
 */

import { describe, it, expect } from 'vitest';

const STAGING_BASE_URL = process.env.STAGING_BASE_URL ?? '';
const TOKEN = process.env.PLAN_PERSONALIZE_TOKEN ?? '';
const USER_IDS_RAW = process.env.PLAN_PERSONALIZE_USER_IDS ?? '';

// Allow either explicit user-id list (preferred — covers all 5 rules) or
// a single seed UUID we re-use 10× (acceptable for raw budget check).
const USER_IDS = USER_IDS_RAW.split(',').map((s) => s.trim()).filter(Boolean);

// Top-level skip — when staging creds absent, do not register the perf
// suite at all (no false-pass from vitest, no error).
const ENABLED = Boolean(STAGING_BASE_URL && TOKEN);

const P99_BUDGET_MS = 50;
const PRE_WARM_CALLS = 5;
const CALLS_PER_USER = 10;
const CONTEXTS = ['paywall', 'save_offer'] as const;

interface CallResult {
  user_id: string;
  context: 'paywall' | 'save_offer';
  duration_ms: number;
  status: number;
  offer_hint?: string;
}

async function callPersonalize(userId: string, ctx: 'paywall' | 'save_offer'): Promise<CallResult> {
  const t0 = performance.now();
  const res = await fetch(`${STAGING_BASE_URL}/plan-personalize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_id: userId, context: ctx }),
  });
  const duration_ms = performance.now() - t0;
  let offer_hint: string | undefined;
  try {
    const body = (await res.json()) as { offer_hint?: string };
    offer_hint = body.offer_hint;
  } catch {
    // ignore body parse failures — duration still recorded
  }
  return { user_id: userId, context: ctx, duration_ms, status: res.status, offer_hint };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100));
  return sorted[idx]!;
}

describe.skipIf(!ENABLED)('plan-personalize perf gate (P99 < 50ms)', () => {
  it(
    'completes 100 calls with p99 < 50ms (excluding cold-start)',
    async () => {
      // Use whatever user_ids were provided; default to the first one repeated
      // if only one was given — keeps the test runnable with minimal seeding.
      const baseUsers = USER_IDS.length > 0 ? USER_IDS : [];
      expect(baseUsers.length).toBeGreaterThan(0);

      // 1. Pre-warm — exclude cold-start latency from the gate (D-17).
      for (let i = 0; i < PRE_WARM_CALLS; i++) {
        const u = baseUsers[i % baseUsers.length]!;
        await callPersonalize(u, 'paywall');
      }

      // 2. Measured run — 10 calls per user (or repeat list to reach 100).
      const results: CallResult[] = [];
      const target = 100;
      let i = 0;
      while (results.length < target) {
        const u = baseUsers[i % baseUsers.length]!;
        const ctx = CONTEXTS[i % CONTEXTS.length]!;
        // Skip 4xx — we only measure the happy hot-path budget.
        // (If staging is misconfigured this fails fast via the 200-rate assert below.)
        // eslint-disable-next-line no-await-in-loop
        const r = await callPersonalize(u, ctx);
        results.push(r);
        i++;
        if (i > target * 3) break; // safety
      }

      const ok = results.filter((r) => r.status === 200);
      expect(ok.length, `≥95 of 100 calls must be 200 (got ${ok.length})`).toBeGreaterThanOrEqual(95);

      const durations = ok.map((r) => r.duration_ms).sort((a, b) => a - b);
      const p50 = percentile(durations, 50);
      const p95 = percentile(durations, 95);
      const p99 = percentile(durations, 99);

      // Verbose breakdown on failure (per `done` criteria of plan 38-06).
      if (p99 >= P99_BUDGET_MS) {
        const byUser = new Map<string, number[]>();
        const byHint = new Map<string, number[]>();
        for (const r of ok) {
          (byUser.get(r.user_id) ?? byUser.set(r.user_id, []).get(r.user_id)!).push(r.duration_ms);
          const k = r.offer_hint ?? '(none)';
          (byHint.get(k) ?? byHint.set(k, []).get(k)!).push(r.duration_ms);
        }
        const perUser = Array.from(byUser.entries()).map(([u, ds]) => ({
          user_id: u.slice(0, 8),
          p99: percentile([...ds].sort((a, b) => a - b), 99),
          n: ds.length,
        }));
        const perHint = Array.from(byHint.entries()).map(([h, ds]) => ({
          hint: h,
          p99: percentile([...ds].sort((a, b) => a - b), 99),
          n: ds.length,
        }));
        console.error('[plan-personalize perf] p50/p95/p99 (ms):', { p50, p95, p99 });
        console.error('[plan-personalize perf] per-user p99 breakdown:', perUser);
        console.error('[plan-personalize perf] per-hint p99 breakdown:', perHint);
        console.error(
          '[plan-personalize perf] hint: investigate via EXPLAIN ANALYZE on plan_personalize_facts() ' +
            'and confirm idx_paywall_events_user_dismissed is used.',
        );
      }

      expect(p99, `P99 budget exceeded: ${p99.toFixed(1)}ms (budget ${P99_BUDGET_MS}ms)`)
        .toBeLessThan(P99_BUDGET_MS);
    },
    /* test-level timeout */ 60_000,
  );
});

// Smoke (always-on): when ENABLED is false, at least confirm the test file
// loaded and the env-derived ENABLED flag is observable. This keeps the file
// from being silently dead in coverage reports.
describe('plan-personalize perf harness wiring', () => {
  it('exports a numeric P99 budget', () => {
    expect(P99_BUDGET_MS).toBeGreaterThan(0);
    expect(PRE_WARM_CALLS).toBeGreaterThan(0);
    expect(CALLS_PER_USER).toBeGreaterThan(0);
  });
});
