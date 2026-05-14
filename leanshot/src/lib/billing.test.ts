/**
 * Phase 14 Plan 14-05 — billing.ts unit tests.
 *
 * Covers:
 *   - getActiveTier(): all 8 Stripe subscription statuses + null (missing row)
 *   - clearTierCache(): idempotency
 *   - TIER_GATE_REGISTRY: shape validation (3 keys, correct modes)
 */
import { describe, expect, it } from 'vitest';
import { TIER_GATE_REGISTRY, clearTierCache, getActiveTier } from './billing';

const NOW = new Date('2026-05-14T12:00:00Z');
const FUTURE = '2026-07-01T00:00:00Z'; // clearly in the future relative to NOW
const PAST = '2026-04-01T00:00:00Z'; // clearly in the past relative to NOW

describe('getActiveTier — Stripe status collapse (RESEARCH Pitfall 6)', () => {
  it('active → paid', () => {
    expect(getActiveTier('active', FUTURE, NOW)).toBe('paid');
  });

  it('trialing → paid', () => {
    expect(getActiveTier('trialing', '2026-05-21T00:00:00Z', NOW)).toBe('paid');
  });

  it('past_due → past_due', () => {
    expect(getActiveTier('past_due', PAST, NOW)).toBe('past_due');
  });

  it('unpaid → past_due', () => {
    expect(getActiveTier('unpaid', PAST, NOW)).toBe('past_due');
  });

  it('canceled with period already elapsed → free', () => {
    expect(getActiveTier('canceled', PAST, NOW)).toBe('free');
  });

  it('canceled but still in paid period → paid (Stripe keeps access until period_end)', () => {
    expect(getActiveTier('canceled', FUTURE, NOW)).toBe('paid');
  });

  it('incomplete → free (initial 23h payment window)', () => {
    expect(getActiveTier('incomplete', null, NOW)).toBe('free');
  });

  it('incomplete_expired → free', () => {
    expect(getActiveTier('incomplete_expired', null, NOW)).toBe('free');
  });

  it('paused → free', () => {
    expect(getActiveTier('paused', null, NOW)).toBe('free');
  });

  it('null (missing subscription row) → free', () => {
    expect(getActiveTier(null, null, NOW)).toBe('free');
  });
});

describe('clearTierCache — idempotency', () => {
  it('does not throw on first call', () => {
    expect(() => clearTierCache()).not.toThrow();
  });

  it('does not throw on second consecutive call (idempotent)', () => {
    clearTierCache();
    expect(() => clearTierCache()).not.toThrow();
  });
});

describe('TIER_GATE_REGISTRY — shape validation', () => {
  it('has exactly 3 keys', () => {
    expect(Object.keys(TIER_GATE_REGISTRY)).toHaveLength(3);
  });

  it('pharma-forecast → blur-upsell', () => {
    expect(TIER_GATE_REGISTRY['pharma-forecast']).toBe('blur-upsell');
  });

  it('advanced-ai → hard-block-cta', () => {
    expect(TIER_GATE_REGISTRY['advanced-ai']).toBe('hard-block-cta');
  });

  it('ad-free → hard-block-no-ui (Phase 20 consumer)', () => {
    expect(TIER_GATE_REGISTRY['ad-free']).toBe('hard-block-no-ui');
  });
});
