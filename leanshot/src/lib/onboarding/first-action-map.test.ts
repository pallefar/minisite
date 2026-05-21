/**
 * Phase 34 Plan 34-07 (ONBOARD-13) — first-action-map unit tests.
 *
 * Covers the goal→action mapping (D-13) + 3-card deterministic output for the
 * FirstActionSurface. Pure module, no async, no mocks.
 */

import { describe, expect, it } from 'vitest';
import {
  ACTION_CATALOG,
  GOAL_ACTION_MAP,
  getCardsForGoal,
  type PrimaryGoal,
} from './first-action-map';

const ALL_GOALS: PrimaryGoal[] = [
  'lose-weight',
  'build-muscle',
  'new-prescription',
  'build-habit',
  'doctor-monitored',
  'family-supporter',
  'manage-symptoms',
  'track-with-vial-supply',
];

describe('first-action-map: GOAL_ACTION_MAP', () => {
  it('covers all 8 goals with a recommended action_type', () => {
    for (const goal of ALL_GOALS) {
      expect(GOAL_ACTION_MAP[goal]).toBeDefined();
    }
    expect(Object.keys(GOAL_ACTION_MAP)).toHaveLength(8);
  });

  it('every recommended action_type is a key in ACTION_CATALOG', () => {
    for (const goal of ALL_GOALS) {
      const action = GOAL_ACTION_MAP[goal];
      expect(ACTION_CATALOG[action]).toBeDefined();
    }
  });
});

describe('first-action-map: getCardsForGoal', () => {
  it('lose-weight → recommended first_weight_log; fallbacks first_injection_log + first_workout_log', () => {
    const cards = getCardsForGoal('lose-weight');
    expect(cards).toHaveLength(3);
    expect(cards[0]).toEqual({ action_type: 'first_weight_log', recommended: true });
    // Recommended is `first_weight_log` (a universal fallback) → it gets
    // replaced by the workout log so we still emit 2 fallbacks.
    const fallbackTypes = [cards[1].action_type, cards[2].action_type];
    expect(fallbackTypes).toContain('first_injection_log');
    expect(fallbackTypes).toContain('first_workout_log');
    expect(cards[1].recommended).toBe(false);
    expect(cards[2].recommended).toBe(false);
  });

  it('family-supporter → recommended waitlist_join; fallbacks first_weight_log + first_injection_log', () => {
    const cards = getCardsForGoal('family-supporter');
    expect(cards[0]).toEqual({ action_type: 'waitlist_join', recommended: true });
    const fallbackTypes = [cards[1].action_type, cards[2].action_type];
    expect(fallbackTypes).toContain('first_weight_log');
    expect(fallbackTypes).toContain('first_injection_log');
  });

  it('build-muscle → recommended first_workout_log; fallbacks first_weight_log + first_injection_log', () => {
    const cards = getCardsForGoal('build-muscle');
    expect(cards[0]).toEqual({ action_type: 'first_workout_log', recommended: true });
    const fallbackTypes = [cards[1].action_type, cards[2].action_type];
    expect(fallbackTypes).toContain('first_weight_log');
    expect(fallbackTypes).toContain('first_injection_log');
  });

  it('new-prescription → recommended first_injection_log; fallback set substitutes the workout when injection is recommended', () => {
    const cards = getCardsForGoal('new-prescription');
    expect(cards[0].action_type).toBe('first_injection_log');
    expect(cards[0].recommended).toBe(true);
    const fallbackTypes = [cards[1].action_type, cards[2].action_type];
    expect(fallbackTypes).toContain('first_weight_log');
    expect(fallbackTypes).toContain('first_workout_log');
  });

  it('no goal returns duplicate action_types across the 3 cards', () => {
    for (const goal of ALL_GOALS) {
      const cards = getCardsForGoal(goal);
      const set = new Set(cards.map((c) => c.action_type));
      expect(set.size).toBe(3);
    }
  });

  it('exactly one recommended:true card per goal; first card is always the recommended one', () => {
    for (const goal of ALL_GOALS) {
      const cards = getCardsForGoal(goal);
      const recommendedCount = cards.filter((c) => c.recommended).length;
      expect(recommendedCount).toBe(1);
      expect(cards[0].recommended).toBe(true);
    }
  });

  it('every emitted action_type resolves in ACTION_CATALOG (no stray keys)', () => {
    for (const goal of ALL_GOALS) {
      const cards = getCardsForGoal(goal);
      for (const c of cards) {
        expect(ACTION_CATALOG[c.action_type]).toBeDefined();
        expect(typeof ACTION_CATALOG[c.action_type].label).toBe('string');
        expect(typeof ACTION_CATALOG[c.action_type].surface).toBe('string');
      }
    }
  });
});
