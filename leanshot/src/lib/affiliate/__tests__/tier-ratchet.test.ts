/**
 * Phase 26 Plan 01 — Pure-unit ratchet invariant (D-03).
 *
 * Asserts canDowngrade() refuses every legal downgrade pair across the
 * 3-tier set. No DB required — pure invariant proof.
 *
 * Also asserts TIER_COMMISSION_PCT + TIER_VOLUME_THRESHOLD values match
 * the SQL trigger constants (plan-checker single-source-of-truth gate).
 */
import { describe, expect, it } from 'vitest';
import {
  TIER_COMMISSION_PCT,
  TIER_VOLUME_THRESHOLD,
  canDowngrade,
  type AffiliateTier,
} from '../tier-config';

describe('D-03 ratchet — tier never downgrades', () => {
  const tiers: readonly AffiliateTier[] = ['standard', 'gold', 'lifetime'] as const;

  for (const from of tiers) {
    for (const to of tiers) {
      if (from === to) continue;
      // Ratchet order: standard < gold < lifetime.
      const fromIdx = tiers.indexOf(from);
      const toIdx = tiers.indexOf(to);
      const isDowngrade = fromIdx > toIdx;
      if (isDowngrade) {
        it(`refuses ${from} -> ${to}`, () => {
          expect(canDowngrade(from, to)).toBe(false);
        });
      }
    }
  }
});

describe('D-01 commission-rate table — SQL parity (plan-checker grep gate)', () => {
  it('TIER_COMMISSION_PCT has exactly 3 keys with the canonical values', () => {
    expect(TIER_COMMISSION_PCT).toEqual({
      standard: 0.2,
      gold: 0.3,
      lifetime: 0.25,
    });
  });

  it('TIER_VOLUME_THRESHOLD matches Migration 04 if v_count < 10', () => {
    expect(TIER_VOLUME_THRESHOLD).toBe(10);
  });
});
