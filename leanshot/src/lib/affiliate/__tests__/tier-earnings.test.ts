/**
 * Phase 26 Plan 26-03 — AFFTIER-03 pure-fn rollup test.
 *
 * Tests `rollupTierEarnings` — the pure helper extracted from
 * `getTierEarningsBreakdown` so its sum-by-tier arithmetic is exercised
 * without a live Supabase client.
 *
 * Covers behavior:
 *   - empty input returns all-zeros
 *   - rows are bucketed by `tier_at_conversion_time` (standard|gold|lifetime)
 *   - unknown tier values are ignored defensively (do NOT contribute to total)
 *   - totalCents is the sum of the three known buckets
 */
import { describe, expect, it } from 'vitest';
import { rollupTierEarnings } from '../api';

describe('rollupTierEarnings (Plan 26-03 — AFFTIER-03)', () => {
  it('returns all-zero buckets when input is empty', () => {
    expect(rollupTierEarnings([])).toEqual({
      asStandardCents: 0,
      asGoldCents: 0,
      asLifetimeCents: 0,
      totalCents: 0,
    });
  });

  it('sums commission_cents grouped by tier_at_conversion_time', () => {
    const rows = [
      { tier_at_conversion_time: 'standard', commission_cents: 260 },
      { tier_at_conversion_time: 'standard', commission_cents: 260 },
      { tier_at_conversion_time: 'gold', commission_cents: 390 },
      { tier_at_conversion_time: 'lifetime', commission_cents: 325 },
    ];
    expect(rollupTierEarnings(rows)).toEqual({
      asStandardCents: 520,
      asGoldCents: 390,
      asLifetimeCents: 325,
      totalCents: 1235,
    });
  });

  it('ignores unknown tier values defensively (does not pollute total)', () => {
    const rows = [
      { tier_at_conversion_time: 'platinum', commission_cents: 999 },
      { tier_at_conversion_time: 'gold', commission_cents: 100 },
    ];
    const result = rollupTierEarnings(rows);
    expect(result.asGoldCents).toBe(100);
    expect(result.totalCents).toBe(100);
  });

  it('handles a single-bucket cluster correctly', () => {
    const rows = [
      { tier_at_conversion_time: 'lifetime', commission_cents: 1000 },
      { tier_at_conversion_time: 'lifetime', commission_cents: 250 },
    ];
    expect(rollupTierEarnings(rows)).toEqual({
      asStandardCents: 0,
      asGoldCents: 0,
      asLifetimeCents: 1250,
      totalCents: 1250,
    });
  });
});
