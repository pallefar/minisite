/**
 * Phase 42 Plan 42-05 — D-06 per-category snooze integration test.
 *
 * Verifies that when ANY notification_settings row for (user, category) has
 * snoozed_until in the future, ALL channels are blocked regardless of cap
 * or enabled state.
 *
 * No DB calls.
 */

import { describe, expect, it } from 'vitest';

import {
  isSnoozeActive,
  shouldFire,
  type CategoryConfig,
  type NotificationSetting,
} from '../../../supabase/functions/_shared/notification-fire-decision.ts';

const NOW = '2026-05-19T10:00:00.000Z';
const FUTURE = '2026-05-26T10:00:00.000Z';
const PAST = '2026-05-18T10:00:00.000Z';

const aiCfg: CategoryConfig = {
  category: 'ai-insights',
  daily_cap: 3,
  weekly_cap: null,
  urgent_escalation: false,
  push_enabled_default: true,
  email_enabled_default: false,
  in_app_enabled_default: true,
};

function makePrefs(snoozedUntil: string | null): NotificationSetting[] {
  return [
    {
      user_id: 'u1',
      category: 'ai-insights',
      channel: 'in-app',
      enabled: true,
      snoozed_until: snoozedUntil, // snooze stored on in-app row; should apply to all channels
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
      channel: 'email',
      enabled: true,
      snoozed_until: null,
      user_cap_override: null,
    },
  ];
}

describe('shouldFire — snooze (D-06)', () => {
  it('isSnoozeActive returns true when any pref has snoozed_until > now', () => {
    expect(isSnoozeActive(makePrefs(FUTURE), NOW)).toBe(true);
  });

  it('isSnoozeActive returns false when snoozed_until is in the past (expired)', () => {
    expect(isSnoozeActive(makePrefs(PAST), NOW)).toBe(false);
  });

  it('isSnoozeActive returns false when all prefs have null snoozed_until', () => {
    expect(isSnoozeActive(makePrefs(null), NOW)).toBe(false);
  });

  it('active snooze blocks ALL channels regardless of cap or enabled', () => {
    const decision = shouldFire({
      user_id: 'u1',
      category: 'ai-insights',
      prefs: makePrefs(FUTURE),
      cfg: aiCfg,
      dismissal: null,
      firedTodayCount: 0, // well under cap
      firedThisWeekCount: 0,
      now: NOW,
    });
    expect(decision.email).toBe(false);
    expect(decision.push).toBe(false);
    expect(decision.in_app).toBe(false);
    expect(decision.reasons.email).toBe('snoozed');
    expect(decision.reasons.push).toBe('snoozed');
    expect(decision.reasons.in_app).toBe('snoozed');
  });

  it('expired snooze does NOT block — channels fire normally', () => {
    const decision = shouldFire({
      user_id: 'u1',
      category: 'ai-insights',
      prefs: makePrefs(PAST),
      cfg: aiCfg,
      dismissal: null,
      firedTodayCount: 0,
      firedThisWeekCount: 0,
      now: NOW,
    });
    expect(decision.push).toBe(true);
    expect(decision.in_app).toBe(true);
    expect(decision.reasons.push).toBe('allowed');
  });
});
