/**
 * Phase 42 Plan 42-05 — D-05 sentiment-halving integration test.
 *
 * Verifies that when notification_dismissal_state.throttle_until is in the
 * future, the effective daily cap is HALVED (floored). With daily_cap=4 and
 * throttle active, firedToday=2 blocks; firedToday=1 still fires.
 *
 * No DB calls.
 */

import { describe, expect, it } from 'vitest';

import {
  computeEffectiveCap,
  shouldFire,
  type CategoryConfig,
  type DismissalState,
  type NotificationSetting,
} from '../../../supabase/functions/_shared/notification-fire-decision.ts';

const NOW = '2026-05-19T10:00:00.000Z';
const PAST = '2026-05-18T10:00:00.000Z';
const FUTURE = '2026-05-26T10:00:00.000Z';

function cfg(dailyCap: number | null): CategoryConfig {
  return {
    category: 'ai-insights',
    daily_cap: dailyCap,
    weekly_cap: null,
    urgent_escalation: false,
    push_enabled_default: true,
    email_enabled_default: false,
    in_app_enabled_default: true,
  };
}

function prefs(): NotificationSetting[] {
  return [
    {
      user_id: 'u1',
      category: 'ai-insights',
      channel: 'email',
      enabled: true,
      snoozed_until: null,
      user_cap_override: null,
    },
    {
      user_id: 'u1',
      category: 'ai-insights',
      channel: 'web-push',
      enabled: true,
      snoozed_until: null,
      user_cap_override: null,
    },
    {
      user_id: 'u1',
      category: 'ai-insights',
      channel: 'in-app',
      enabled: true,
      snoozed_until: null,
      user_cap_override: null,
    },
  ];
}

const throttledFuture: DismissalState = {
  user_id: 'u1',
  category: 'ai-insights',
  consecutive_dismissals: 3,
  throttle_until: FUTURE,
  last_event_at: NOW,
};

const throttledPast: DismissalState = {
  user_id: 'u1',
  category: 'ai-insights',
  consecutive_dismissals: 1,
  throttle_until: PAST,
  last_event_at: NOW,
};

describe('shouldFire — sentiment-halving (D-05)', () => {
  it('computeEffectiveCap halves admin daily_cap when throttle_until > now', () => {
    const res = computeEffectiveCap(cfg(4), throttledFuture, [], NOW);
    expect(res.cap).toBe(2);
    expect(res.reason).toBe('throttled_halved');
  });

  it('computeEffectiveCap does NOT halve when throttle_until <= now (expired)', () => {
    const res = computeEffectiveCap(cfg(4), throttledPast, [], NOW);
    expect(res.cap).toBe(4);
    expect(res.reason).toBe('within_cap');
  });

  it('computeEffectiveCap leaves unlimited NULL as null even when throttled', () => {
    const res = computeEffectiveCap(cfg(null), throttledFuture, [], NOW);
    // NULL means UNLIMITED — halving null is still unlimited (D-04 clinical-uncapped).
    expect(res.cap).toBe(null);
    expect(res.reason).toBe('unlimited');
  });

  it('with daily_cap=4 + throttle active, firedToday=2 blocks fan-out', () => {
    const decision = shouldFire({
      user_id: 'u1',
      category: 'ai-insights',
      prefs: prefs(),
      cfg: cfg(4),
      dismissal: throttledFuture,
      firedTodayCount: 2,
      firedThisWeekCount: 0,
      now: NOW,
    });
    expect(decision.email).toBe(false);
    expect(decision.push).toBe(false);
    expect(decision.in_app).toBe(false);
    expect(decision.reasons.email).toBe('cap_exceeded');
  });

  it('with daily_cap=4 + throttle active, firedToday=1 still fires (1 < halved-cap 2)', () => {
    const decision = shouldFire({
      user_id: 'u1',
      category: 'ai-insights',
      prefs: prefs(),
      cfg: cfg(4),
      dismissal: throttledFuture,
      firedTodayCount: 1,
      firedThisWeekCount: 0,
      now: NOW,
    });
    expect(decision.push).toBe(true);
    expect(decision.in_app).toBe(true);
  });
});
