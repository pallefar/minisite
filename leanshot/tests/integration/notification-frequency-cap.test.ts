/**
 * Phase 42 Plan 42-05 — frequency-cap integration test (D-04).
 *
 * Verifies that the PURE shouldFire() function correctly blocks notification
 * fan-out once firedTodayCount has reached the admin daily_cap.
 *
 * No DB calls — the pure function is mocked against in-memory fixtures.
 */

import { describe, expect, it } from 'vitest';

import {
  shouldFire,
  type CategoryConfig,
  type DismissalState,
  type NotificationSetting,
  type ShouldFireInput,
} from '../../../supabase/functions/_shared/notification-fire-decision.ts';

const NOW = '2026-05-19T10:00:00.000Z';

function aiInsightsCfg(): CategoryConfig {
  return {
    category: 'ai-insights',
    daily_cap: 3,
    weekly_cap: null,
    urgent_escalation: false,
    push_enabled_default: true,
    email_enabled_default: false,
    in_app_enabled_default: true,
  };
}

function prefsFor(category: ShouldFireInput['category'], userId: string): NotificationSetting[] {
  return [
    {
      user_id: userId,
      category,
      channel: 'email',
      enabled: true,
      snoozed_until: null,
      user_cap_override: null,
    },
    {
      user_id: userId,
      category,
      channel: 'web-push',
      enabled: true,
      snoozed_until: null,
      user_cap_override: null,
    },
    {
      user_id: userId,
      category,
      channel: 'in-app',
      enabled: true,
      snoozed_until: null,
      user_cap_override: null,
    },
  ];
}

const noDismissal: DismissalState | null = null;

describe('shouldFire — frequency cap (D-04)', () => {
  it('allows fire when firedToday=2 < daily_cap=3', () => {
    const decision = shouldFire({
      user_id: 'u1',
      category: 'ai-insights',
      prefs: prefsFor('ai-insights', 'u1'),
      cfg: aiInsightsCfg(),
      dismissal: noDismissal,
      firedTodayCount: 2,
      firedThisWeekCount: 0,
      now: NOW,
    });
    expect(decision.email).toBe(true);
    expect(decision.push).toBe(true);
    expect(decision.in_app).toBe(true);
    expect(decision.reasons.email).toBe('allowed');
  });

  it('blocks all channels when firedToday=3 == daily_cap=3', () => {
    const decision = shouldFire({
      user_id: 'u1',
      category: 'ai-insights',
      prefs: prefsFor('ai-insights', 'u1'),
      cfg: aiInsightsCfg(),
      dismissal: noDismissal,
      firedTodayCount: 3,
      firedThisWeekCount: 0,
      now: NOW,
    });
    expect(decision.email).toBe(false);
    expect(decision.push).toBe(false);
    expect(decision.in_app).toBe(false);
    expect(decision.reasons.email).toBe('cap_exceeded');
    expect(decision.reasons.cap).toBe('cap_exceeded');
  });

  it('UNLIMITED cap (NULL daily_cap) fires regardless of firedToday', () => {
    const cfg: CategoryConfig = {
      category: 'dose-reminders',
      daily_cap: null,
      weekly_cap: null,
      urgent_escalation: false,
      push_enabled_default: true,
      email_enabled_default: true,
      in_app_enabled_default: true,
    };
    const decision = shouldFire({
      user_id: 'u1',
      category: 'dose-reminders',
      prefs: prefsFor('dose-reminders', 'u1'),
      cfg,
      dismissal: noDismissal,
      firedTodayCount: 999,
      firedThisWeekCount: 999,
      now: NOW,
    });
    expect(decision.email).toBe(true);
    expect(decision.push).toBe(true);
    expect(decision.in_app).toBe(true);
    expect(decision.reasons.cap).toBe('unlimited');
  });

  it('weekly_cap=1 blocks when firedThisWeek=1 (billing)', () => {
    const cfg: CategoryConfig = {
      category: 'billing',
      daily_cap: null,
      weekly_cap: 1,
      urgent_escalation: false,
      push_enabled_default: false,
      email_enabled_default: true,
      in_app_enabled_default: false,
    };
    const decision = shouldFire({
      user_id: 'u1',
      category: 'billing',
      prefs: prefsFor('billing', 'u1'),
      cfg,
      dismissal: noDismissal,
      firedTodayCount: 0,
      firedThisWeekCount: 1,
      now: NOW,
    });
    expect(decision.email).toBe(false);
    expect(decision.reasons.email).toBe('cap_exceeded');
  });
});
