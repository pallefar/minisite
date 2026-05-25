/**
 * Phase 54 Plan 54-01 Task 3 — Wave-0 RED Deno test scaffold for push-dispatch.
 *
 * These tests cover PUSH-04 / PUSH-07 / PUSH-08 requirements.
 * They import { __internal } from './index.ts' which does NOT exist until
 * 54-02 ships. This is the intended RED Wave-0 state per the scaffold pattern
 * (feedback_wave_0_scaffolds_all_waves_red_test_pattern).
 *
 * Guard: import only __internal (not a top-level Deno.serve call) to avoid
 * the Deno.serve top-level trap (reference_deno_test_top_level_serve_trap).
 * The project pattern: guard Deno.serve with
 *   const denoGlobal: any = (globalThis as any).Deno;
 *   if (denoGlobal?.serve) { denoGlobal.serve(handler); }
 * exposing logic only via __internal for test injection.
 *
 * Tests:
 *   T1 — quiet-hours blocks non-urgent at 23:00 in user's UTC timezone
 *   T2 — quiet-hours urgent override: clinic-alerts (urgent_escalation=true) delivers at 23:00
 *   T3 — fan-out calls web transport for platform='web', apns for ios, fcm for android
 *   T4 — fail-soft: absent platform secret causes that platform to be skipped (no throw)
 *   T5 — failure_count increments on delivery failure; row deleted at 3 consecutive failures
 *   T6 — success resets failure_count to 0
 */

import { assertEquals, assertExists } from 'jsr:@std/assert@^1';
// RED: ./index.ts does not exist until 54-02 — this import will fail until GREEN.
// deno-lint-ignore no-unused-vars
import { __internal } from './index.ts';

// ─── Fake admin builder ─────────────────────────────────────────────────────

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SERVICE_BEARER = 'test-service-role-key';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', SERVICE_BEARER);
// VAPID env vars (web platform) — present for T3 web-transport test
Deno.env.set('VAPID_SUBJECT', 'mailto:test@leanshot.app');
Deno.env.set('VAPID_PUBLIC_KEY', 'test-public-key');
Deno.env.set('VAPID_PRIVATE_KEY', 'test-private-key');
// APNs + FCM env vars intentionally ABSENT for T4 fail-soft test
// (APNS_PRIVATE_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID, FCM_SERVICE_ACCOUNT_JSON
//  are NOT set so the respective platforms are skipped gracefully)

// deno-lint-ignore no-explicit-any
type FakeAdmin = any;

interface MockTransportCall {
  platform: string;
  deviceToken?: string;
  endpoint?: string;
  payload: Record<string, unknown>;
}

interface FakeAdminConfig {
  subscriptions: Array<{
    id: string;
    platform: string;
    endpoint?: string;
    p256dh?: string;
    auth?: string;
    device_token?: string;
    failure_count: number;
    user_id: string;
  }>;
  profile: { timezone: string } | null;
  categoryConfig: {
    category: string;
    urgent_escalation: boolean;
    daily_cap: number | null;
    weekly_cap: number | null;
  } | null;
  updates: Array<{ id: string; failure_count?: number; deleted?: boolean }>;
}

function makeFakeAdmin(cfg: FakeAdminConfig): FakeAdmin {
  return {
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          data: table === 'push_subscriptions' ? cfg.subscriptions : [],
          error: null,
        }),
        single: () => ({
          data: table === 'notification_category_config' ? cfg.categoryConfig : cfg.profile,
          error: null,
        }),
      }),
      update: (vals: Record<string, unknown>) => ({
        eq: (col: string, id: string) => {
          cfg.updates.push({ id, ...vals });
          return { data: null, error: null };
        },
      }),
      delete: () => ({
        eq: (col: string, id: string) => {
          cfg.updates.push({ id, deleted: true });
          return { data: null, error: null };
        },
      }),
    }),
  };
}

// ─── T1: Quiet-hours blocks non-urgent at 23:00 UTC ─────────────────────────

Deno.test('T1 — quiet-hours blocks non-urgent push at 23:00 UTC', async () => {
  const cfg: FakeAdminConfig = {
    subscriptions: [
      {
        id: 'sub-1', platform: 'web',
        endpoint: 'https://push.example.com/sub-1',
        p256dh: 'key1', auth: 'auth1', failure_count: 0, user_id: USER_ID,
      },
    ],
    profile: { timezone: 'UTC' },
    categoryConfig: { category: 'marketing', urgent_escalation: false, daily_cap: 10, weekly_cap: 50 },
    updates: [],
  };
  const admin = makeFakeAdmin(cfg);
  const { setAdminForTest, resetAdminForTest, dispatch } = __internal;
  setAdminForTest(admin);

  const transportCalls: MockTransportCall[] = [];
  const mockWebFn = async (_sub: unknown, _payload: unknown) => {
    transportCalls.push({ platform: 'web', payload: _payload as Record<string, unknown> });
    return { ok: true };
  };
  __internal.setWebTransportForTest(mockWebFn);

  // Simulate 23:00 UTC — inside quiet hours (22:00-08:00)
  const now = new Date('2026-01-01T23:00:00Z');
  const result = await dispatch({
    user_id: USER_ID,
    category: 'marketing',
    payload: { title: 'Test', body: 'Test body' },
    now,
  });

  assertEquals(result.skipped_quiet_hours, true, 'should skip during quiet hours');
  assertEquals(transportCalls.length, 0, 'transport should NOT be called during quiet hours');

  __internal.resetWebTransportForTest();
  resetAdminForTest();
});

// ─── T2: Urgent override delivers clinic-alerts at 23:00 UTC ────────────────

Deno.test('T2 — quiet-hours urgent override: clinic-alerts delivers at 23:00 UTC', async () => {
  const cfg: FakeAdminConfig = {
    subscriptions: [
      {
        id: 'sub-2', platform: 'web',
        endpoint: 'https://push.example.com/sub-2',
        p256dh: 'key2', auth: 'auth2', failure_count: 0, user_id: USER_ID,
      },
    ],
    profile: { timezone: 'UTC' },
    // clinic-alerts: urgent_escalation=true — MUST bypass quiet-hours (Pitfall 3)
    categoryConfig: { category: 'clinic-alerts', urgent_escalation: true, daily_cap: null, weekly_cap: null },
    updates: [],
  };
  const admin = makeFakeAdmin(cfg);
  const { setAdminForTest, resetAdminForTest, dispatch } = __internal;
  setAdminForTest(admin);

  const transportCalls: MockTransportCall[] = [];
  const mockWebFn = async (_sub: unknown, _payload: unknown) => {
    transportCalls.push({ platform: 'web', payload: _payload as Record<string, unknown> });
    return { ok: true };
  };
  __internal.setWebTransportForTest(mockWebFn);

  const now = new Date('2026-01-01T23:00:00Z');
  const result = await dispatch({
    user_id: USER_ID,
    category: 'clinic-alerts',
    payload: { title: 'Urgent alert', body: 'Clinician alert body' },
    now,
  });

  assertEquals(result.skipped_quiet_hours, false, 'urgent should NOT be quiet-hours gated');
  assertEquals(transportCalls.length, 1, 'transport should be called for urgent push');
  assertEquals(result.sent, 1);

  __internal.resetWebTransportForTest();
  resetAdminForTest();
});

// ─── T3: Fan-out calls correct transport per platform ───────────────────────

Deno.test('T3 — fan-out calls web/apns/fcm transport per platform', async () => {
  const cfg: FakeAdminConfig = {
    subscriptions: [
      {
        id: 'sub-web', platform: 'web',
        endpoint: 'https://push.example.com/sub-web',
        p256dh: 'key-web', auth: 'auth-web', failure_count: 0, user_id: USER_ID,
      },
      {
        id: 'sub-ios', platform: 'ios',
        device_token: 'apns-token-abc', failure_count: 0, user_id: USER_ID,
      },
      {
        id: 'sub-android', platform: 'android',
        device_token: 'fcm-token-xyz', failure_count: 0, user_id: USER_ID,
      },
    ],
    profile: { timezone: 'UTC' },
    categoryConfig: { category: 'dose-reminders', urgent_escalation: false, daily_cap: 3, weekly_cap: 21 },
    updates: [],
  };
  const admin = makeFakeAdmin(cfg);
  const { setAdminForTest, resetAdminForTest, dispatch } = __internal;
  setAdminForTest(admin);

  const webCalls: string[] = [];
  const apnsCalls: string[] = [];
  const fcmCalls: string[] = [];

  __internal.setWebTransportForTest(async (sub: { endpoint: string }) => {
    webCalls.push(sub.endpoint);
    return { ok: true };
  });
  __internal.setApnsTransportForTest(async (token: string) => {
    apnsCalls.push(token);
    return { ok: true };
  });
  __internal.setFcmTransportForTest(async (token: string) => {
    fcmCalls.push(token);
    return { ok: true };
  });

  // Use daytime to avoid quiet-hours blocking (08:00 UTC)
  const now = new Date('2026-01-01T12:00:00Z');
  const result = await dispatch({
    user_id: USER_ID,
    category: 'dose-reminders',
    payload: { title: 'Dose reminder', body: 'Time for your injection' },
    now,
  });

  assertEquals(webCalls.length, 1, 'web transport called for web platform');
  assertEquals(apnsCalls.length, 1, 'apns transport called for ios platform');
  assertEquals(fcmCalls.length, 1, 'fcm transport called for android platform');
  assertEquals(webCalls[0], 'https://push.example.com/sub-web');
  assertEquals(apnsCalls[0], 'apns-token-abc');
  assertEquals(fcmCalls[0], 'fcm-token-xyz');
  assertEquals(result.sent, 3);

  __internal.resetWebTransportForTest();
  __internal.resetApnsTransportForTest();
  __internal.resetFcmTransportForTest();
  resetAdminForTest();
});

// ─── T4: Fail-soft when platform secret is absent ───────────────────────────

Deno.test('T4 — fail-soft: absent APNs/FCM secrets skip platform without throw', async () => {
  // APNs and FCM secrets are NOT set in this test environment.
  // push-dispatch must detect empty env vars and skip those platforms gracefully.
  const cfg: FakeAdminConfig = {
    subscriptions: [
      {
        id: 'sub-web', platform: 'web',
        endpoint: 'https://push.example.com/sub-web',
        p256dh: 'key-web', auth: 'auth-web', failure_count: 0, user_id: USER_ID,
      },
      {
        id: 'sub-ios', platform: 'ios',
        device_token: 'apns-token', failure_count: 0, user_id: USER_ID,
      },
    ],
    profile: { timezone: 'UTC' },
    categoryConfig: { category: 'ai-insights', urgent_escalation: false, daily_cap: 5, weekly_cap: 35 },
    updates: [],
  };
  const admin = makeFakeAdmin(cfg);
  const { setAdminForTest, resetAdminForTest, dispatch } = __internal;
  setAdminForTest(admin);

  const webCalls: string[] = [];
  __internal.setWebTransportForTest(async (sub: { endpoint: string }) => {
    webCalls.push(sub.endpoint);
    return { ok: true };
  });
  // APNs transport NOT set (absent secret simulation — transport should not be called)

  const now = new Date('2026-01-01T12:00:00Z');
  let threw = false;
  try {
    await dispatch({
      user_id: USER_ID,
      category: 'ai-insights',
      payload: { title: 'AI Insight', body: 'Your weekly insight' },
      now,
    });
  } catch {
    threw = true;
  }

  assertEquals(threw, false, 'dispatch must NOT throw when a platform secret is absent');
  assertEquals(webCalls.length, 1, 'web platform (secret present) should still deliver');

  __internal.resetWebTransportForTest();
  resetAdminForTest();
});

// ─── T5: failure_count increments; row deleted at 3 consecutive failures ────

Deno.test('T5 — failure_count increments on failure; deleted at 3 consecutive failures', async () => {
  const cfg: FakeAdminConfig = {
    subscriptions: [
      {
        id: 'sub-fail', platform: 'web',
        endpoint: 'https://push.example.com/sub-fail',
        p256dh: 'key-fail', auth: 'auth-fail', failure_count: 2, user_id: USER_ID,
      },
    ],
    profile: { timezone: 'UTC' },
    categoryConfig: { category: 'billing', urgent_escalation: false, daily_cap: 5, weekly_cap: 35 },
    updates: [],
  };
  const admin = makeFakeAdmin(cfg);
  const { setAdminForTest, resetAdminForTest, dispatch } = __internal;
  setAdminForTest(admin);

  // Transport returns failure
  __internal.setWebTransportForTest(async () => ({ ok: false, status: 410 }));

  const now = new Date('2026-01-01T12:00:00Z');
  const result = await dispatch({
    user_id: USER_ID,
    category: 'billing',
    payload: { title: 'Invoice', body: 'Your subscription renewal' },
    now,
  });

  // failure_count was 2, now 3 → row should be deleted (PUSH-08 auto-prune)
  const deletedEntry = cfg.updates.find((u) => u.id === 'sub-fail' && u.deleted === true);
  assertExists(deletedEntry, 'row should be deleted after 3 consecutive failures');
  assertEquals(result.pruned, 1, 'pruned count should be 1');

  __internal.resetWebTransportForTest();
  resetAdminForTest();
});

// ─── T6: Success resets failure_count to 0 ──────────────────────────────────

Deno.test('T6 — success resets failure_count to 0', async () => {
  const cfg: FakeAdminConfig = {
    subscriptions: [
      {
        id: 'sub-recover', platform: 'web',
        endpoint: 'https://push.example.com/sub-recover',
        p256dh: 'key-rec', auth: 'auth-rec', failure_count: 1, user_id: USER_ID,
      },
    ],
    profile: { timezone: 'UTC' },
    categoryConfig: { category: 'ai-insights', urgent_escalation: false, daily_cap: 5, weekly_cap: 35 },
    updates: [],
  };
  const admin = makeFakeAdmin(cfg);
  const { setAdminForTest, resetAdminForTest, dispatch } = __internal;
  setAdminForTest(admin);

  // Transport succeeds this time
  __internal.setWebTransportForTest(async () => ({ ok: true }));

  const now = new Date('2026-01-01T12:00:00Z');
  await dispatch({
    user_id: USER_ID,
    category: 'ai-insights',
    payload: { title: 'AI Insight', body: 'Your insight' },
    now,
  });

  const resetEntry = cfg.updates.find(
    (u) => u.id === 'sub-recover' && (u as Record<string, unknown>)['failure_count'] === 0
  );
  assertExists(resetEntry, 'failure_count should be reset to 0 on delivery success');

  __internal.resetWebTransportForTest();
  resetAdminForTest();
});
