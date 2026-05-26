/**
 * merge.test.ts — Unit tests for tier boost + freshness de-rank + rankAndTrim.
 *
 * Phase 60 Plan 60-06. 8+ behavior cases from plan spec.
 *
 * Uses Deno.test. All float comparisons via Math.abs(a - b) < 1e-9 to avoid
 * floating-point false negatives.
 */

import {
  applyTierBoost,
  isStale,
  applyFreshnessDeRank,
  rankAndTrim,
} from '../merge.ts';

const EPSILON = 1e-9;

function assertClose(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > EPSILON) {
    throw new Error(
      `${label}: expected ${expected}, got ${actual} (diff: ${Math.abs(actual - expected)})`,
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// applyTierBoost
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('applyTierBoost: tier A × 1.2', () => {
  assertClose(applyTierBoost(0.5, 'A'), 0.6, 'tier A');
});

Deno.test('applyTierBoost: tier B × 1.0', () => {
  assertClose(applyTierBoost(0.5, 'B'), 0.5, 'tier B');
});

Deno.test('applyTierBoost: tier C × 0.85', () => {
  assertClose(applyTierBoost(0.5, 'C'), 0.425, 'tier C');
});

// ──────────────────────────────────────────────────────────────────────────────
// isStale
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('isStale: returns false for a date within freshness window', () => {
  // "now" is within the window — not stale
  const now = new Date().toISOString();
  const result = isStale(now, 180);
  if (result !== false) {
    throw new Error(`Expected false for date=now, window=180; got ${result}`);
  }
});

Deno.test('isStale: returns true for a date 365 days ago with window 180', () => {
  const past = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const result = isStale(past, 180);
  if (result !== true) {
    throw new Error(`Expected true for date=365d ago, window=180; got ${result}`);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// applyFreshnessDeRank
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('applyFreshnessDeRank: stale date applies × 0.5 penalty', () => {
  const staleDate = new Date(Date.now() - 400 * 86_400_000).toISOString();
  assertClose(applyFreshnessDeRank(0.8, staleDate, 180), 0.4, 'stale derank');
});

Deno.test('applyFreshnessDeRank: fresh date returns score unchanged', () => {
  const today = new Date().toISOString();
  assertClose(applyFreshnessDeRank(0.8, today, 180), 0.8, 'fresh no derank');
});

// ──────────────────────────────────────────────────────────────────────────────
// rankAndTrim — combined pipeline
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('rankAndTrim: returns correct count sorted by final_score DESC', () => {
  const now = new Date().toISOString();
  const staleDate = new Date(Date.now() - 400 * 86_400_000).toISOString();

  const rows = [
    { raw_score: 0.7, source_tier: 'B' as const, scraped_at: now, freshness_window_days: 180, id: 'b' },
    { raw_score: 0.6, source_tier: 'A' as const, scraped_at: now, freshness_window_days: 180, id: 'a' },
    { raw_score: 0.9, source_tier: 'C' as const, scraped_at: now, freshness_window_days: 180, id: 'c' },
    { raw_score: 0.5, source_tier: 'A' as const, scraped_at: now, freshness_window_days: 180, id: 'd' },
  ];

  const result = rankAndTrim(rows, 3);
  if (result.length !== 3) {
    throw new Error(`Expected 3 results; got ${result.length}`);
  }
  // C: 0.9 × 0.85 = 0.765; B: 0.7 × 1.0 = 0.70; A-first: 0.6 × 1.2 = 0.72
  // Sort: C(0.765) > A-first(0.72) > B(0.70) > A-second(0.60)
  // So result[0].id = 'c', result[1].id = 'a', result[2].id = 'b'
  if (result[0].id !== 'c') {
    throw new Error(`Expected id='c' at rank 0; got '${result[0].id}' (final_score=${result[0].final_score})`);
  }
  if (result[1].id !== 'a') {
    throw new Error(`Expected id='a' at rank 1; got '${result[1].id}' (final_score=${result[1].final_score})`);
  }
  if (result[2].id !== 'b') {
    throw new Error(`Expected id='b' at rank 2; got '${result[2].id}' (final_score=${result[2].final_score})`);
  }
});

Deno.test('rankAndTrim: combined tier-A stale chunk = raw × 1.2 × 0.5 = raw × 0.6, stale=true', () => {
  const staleDate = new Date(Date.now() - 400 * 86_400_000).toISOString();
  const rows = [
    { raw_score: 0.8, source_tier: 'A' as const, scraped_at: staleDate, freshness_window_days: 180 },
  ];
  const result = rankAndTrim(rows, 1);
  if (result.length !== 1) {
    throw new Error(`Expected 1 result; got ${result.length}`);
  }
  assertClose(result[0].final_score, 0.8 * 1.2 * 0.5, 'tier-A stale final_score');
  assertClose(result[0].final_score, 0.48, 'tier-A stale final_score = 0.48');
  if (result[0].stale !== true) {
    throw new Error(`Expected stale=true; got ${result[0].stale}`);
  }
});
