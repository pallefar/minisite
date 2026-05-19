/**
 * Phase 42 Plan 42-05 — D-04 user-tunable cap DOWNWARD-only integration test.
 *
 * Verifies:
 *   1. User cap_override BELOW admin daily_cap clamps the effective cap.
 *      (ai-insights admin daily_cap=3; user_cap_override=1; firedToday=1 → blocked)
 *   2. The DB CHECK trigger denies UPDATEs that raise user_cap_override
 *      above admin daily_cap (live DB test — runs against the cloud project
 *      when service-role secret is available; self-skips locally).
 *      This duplicates one scenario from notification-settings-rls.test.ts but
 *      is included here so the integration suite is self-contained for the
 *      `user_cap_override > admin cap` rejection invariant.
 *   3. Per-channel toggle: user disables email channel for billing → only
 *      email blocked; other channels honor their settings.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  computeEffectiveCap,
  shouldFire,
  type CategoryConfig,
  type NotificationSetting,
} from '../../../supabase/functions/_shared/notification-fire-decision.ts';

const NOW = '2026-05-19T10:00:00.000Z';

const aiCfg: CategoryConfig = {
  category: 'ai-insights',
  daily_cap: 3,
  weekly_cap: null,
  urgent_escalation: false,
  push_enabled_default: true,
  email_enabled_default: false,
  in_app_enabled_default: true,
};

const billingCfg: CategoryConfig = {
  category: 'billing',
  daily_cap: null,
  weekly_cap: 1,
  urgent_escalation: false,
  push_enabled_default: false,
  email_enabled_default: true,
  in_app_enabled_default: false,
};

function prefs(
  category: 'ai-insights' | 'billing',
  overrides: Partial<NotificationSetting>[] = [],
): NotificationSetting[] {
  const base: NotificationSetting[] = ['email', 'web-push', 'in-app'].map((ch) => ({
    user_id: 'u1',
    category,
    channel: ch as 'email' | 'web-push' | 'in-app',
    enabled: true,
    snoozed_until: null,
    user_cap_override: null,
  }));
  // Apply per-channel overrides
  for (const o of overrides) {
    const idx = base.findIndex((p) => p.channel === o.channel);
    if (idx >= 0) base[idx] = { ...base[idx], ...o };
  }
  return base;
}

// ─── pure-function path (no DB) ───────────────────────────────────────────────

describe('shouldFire — user_cap_override DOWNWARD (D-04)', () => {
  it('computeEffectiveCap clamps DOWNWARD: admin=3, user=1 → effective=1', () => {
    const res = computeEffectiveCap(
      aiCfg,
      null,
      prefs('ai-insights', [{ channel: 'in-app', user_cap_override: 1 }]),
      NOW,
    );
    expect(res.cap).toBe(1);
  });

  it('user_cap_override=1 + firedToday=1 blocks all channels', () => {
    const decision = shouldFire({
      user_id: 'u1',
      category: 'ai-insights',
      prefs: prefs('ai-insights', [{ channel: 'in-app', user_cap_override: 1 }]),
      cfg: aiCfg,
      dismissal: null,
      firedTodayCount: 1,
      firedThisWeekCount: 0,
      now: NOW,
    });
    expect(decision.push).toBe(false);
    expect(decision.in_app).toBe(false);
    expect(decision.reasons.cap).toBe('cap_exceeded');
  });

  it('per-channel toggle: email OFF for billing → email blocked, others honor settings', () => {
    const billingPrefs = prefs('billing', [{ channel: 'email', enabled: false }]);
    const decision = shouldFire({
      user_id: 'u1',
      category: 'billing',
      prefs: billingPrefs,
      cfg: billingCfg,
      dismissal: null,
      firedTodayCount: 0,
      firedThisWeekCount: 0,
      now: NOW,
    });
    expect(decision.email).toBe(false);
    expect(decision.reasons.email).toBe('disabled');
    // push + in-app are enabled in prefs (we set them true) — they should fire.
    expect(decision.push).toBe(true);
    expect(decision.in_app).toBe(true);
  });
});

// ─── DB CHECK trigger path (live; self-skips when secrets absent) ────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOULD_RUN_DB = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const describeIfDb = SHOULD_RUN_DB ? describe : describe.skip;

describeIfDb('DB CHECK trigger — user_cap_override > admin daily_cap denied', () => {
  let admin: SupabaseClient;
  let userId: string | undefined;
  const PREFIX = 'notifcapint-';

  beforeAll(async () => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
    admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const ts = Date.now();
    const { data, error } = await admin.auth.admin.createUser({
      email: `${PREFIX}u-${ts}@leanshot.test`,
      password: `Pass1234-${crypto.randomUUID().slice(0, 8)}`,
      email_confirm: true,
    });
    if (error) throw new Error(`createUser: ${error.message}`);
    userId = data.user!.id;

    // Seed a notification_settings row to attempt the cap-raise UPDATE against.
    await admin.from('notification_settings').insert({
      user_id: userId,
      category: 'ai-insights',
      channel: 'in-app',
      enabled: true,
    });
  }, 120_000);

  afterAll(async () => {
    if (!admin || !userId) return;
    try {
      await admin.from('notification_settings').delete().eq('user_id', userId);
    } catch {
      /* best-effort */
    }
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch {
      /* best-effort */
    }
  }, 60_000);

  it('UPDATE setting user_cap_override=5 (above admin daily_cap=3) is rejected by trigger', async () => {
    if (!userId) throw new Error('userId not seeded');
    const { error } = await admin
      .from('notification_settings')
      .update({ user_cap_override: 5 })
      .eq('user_id', userId)
      .eq('category', 'ai-insights')
      .eq('channel', 'in-app');
    expect(error).not.toBeNull();
    expect(String(error?.message ?? '')).toMatch(
      /cannot exceed admin daily_cap|check_violation|23514/i,
    );
  }, 30_000);

  it('UPDATE setting user_cap_override=1 (at-or-below admin daily_cap) is accepted', async () => {
    if (!userId) throw new Error('userId not seeded');
    const { error } = await admin
      .from('notification_settings')
      .update({ user_cap_override: 1 })
      .eq('user_id', userId)
      .eq('category', 'ai-insights')
      .eq('channel', 'in-app');
    expect(error).toBeNull();
  }, 30_000);
});
