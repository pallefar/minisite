/**
 * Phase 42 Plan 42-05 — D-03 URGENT escalation integration test.
 *
 * Verifies that for clinic-alerts category (cfg.urgent_escalation = true),
 * the FireDecision returns urgent=true regardless of other state. This drives
 * the web-push `urgency: 'high'` header (FCM/APNS bypass quiet-hours).
 *
 * Other categories return urgent=false.
 */

import { describe, expect, it } from 'vitest';

import {
  shouldFire,
  type CategoryConfig,
  type NotificationSetting,
} from '../../../supabase/functions/_shared/notification-fire-decision.ts';

const NOW = '2026-05-19T10:00:00.000Z';

const clinicCfg: CategoryConfig = {
  category: 'clinic-alerts',
  daily_cap: null,
  weekly_cap: null,
  urgent_escalation: true,
  push_enabled_default: true,
  email_enabled_default: true,
  in_app_enabled_default: true,
};

const aiCfg: CategoryConfig = {
  category: 'ai-insights',
  daily_cap: 3,
  weekly_cap: null,
  urgent_escalation: false,
  push_enabled_default: true,
  email_enabled_default: false,
  in_app_enabled_default: true,
};

function prefs(category: 'clinic-alerts' | 'ai-insights'): NotificationSetting[] {
  return ['email', 'web-push', 'in-app'].map((ch) => ({
    user_id: 'u1',
    category,
    channel: ch as 'email' | 'web-push' | 'in-app',
    enabled: true,
    snoozed_until: null,
    user_cap_override: null,
  }));
}

describe('shouldFire — URGENT escalation (D-03)', () => {
  it('clinic-alerts → urgent=true with fully opted-in user', () => {
    const decision = shouldFire({
      user_id: 'u1',
      category: 'clinic-alerts',
      prefs: prefs('clinic-alerts'),
      cfg: clinicCfg,
      dismissal: null,
      firedTodayCount: 0,
      firedThisWeekCount: 0,
      now: NOW,
    });
    expect(decision.urgent).toBe(true);
    expect(decision.email).toBe(true);
    expect(decision.push).toBe(true);
    expect(decision.in_app).toBe(true);
  });

  it('clinic-alerts → urgent=true even when firedToday=999 (UNLIMITED cap)', () => {
    const decision = shouldFire({
      user_id: 'u1',
      category: 'clinic-alerts',
      prefs: prefs('clinic-alerts'),
      cfg: clinicCfg,
      dismissal: null,
      firedTodayCount: 999,
      firedThisWeekCount: 999,
      now: NOW,
    });
    expect(decision.urgent).toBe(true);
    expect(decision.push).toBe(true);
  });

  it('ai-insights → urgent=false', () => {
    const decision = shouldFire({
      user_id: 'u1',
      category: 'ai-insights',
      prefs: prefs('ai-insights'),
      cfg: aiCfg,
      dismissal: null,
      firedTodayCount: 0,
      firedThisWeekCount: 0,
      now: NOW,
    });
    expect(decision.urgent).toBe(false);
  });
});
