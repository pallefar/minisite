/**
 * Phase 54 Plan 54-01 Task 3 — Wave-0 RED vitest scaffold for native push.
 *
 * Tests cover PUSH-02 / PUSH-03 / PUSH-05 requirements.
 * These tests are RED until 54-03 ships because:
 *   1. registerForPush() from ./push is a Phase 12 stub that throws.
 *   2. @capacitor/push-notifications is NOT installed until 54-03.
 *
 * Run under vitest-mobile.config.ts (aliases @capacitor/core → capacitor-core mock).
 * @capacitor/push-notifications is mocked inline via vi.mock() here since the
 * package is deferred to 54-03 (reference_sentry_capacitor_npm_install_blocker
 * means install uses --legacy-peer-deps; gated to its own plan).
 *
 * Test plan:
 *   T1 — registerForPush on web (isNativePlatform=false) returns {ok:false}
 *   T2 — native iOS: checkPermissions called BEFORE requestPermissions (PUSH-05 soft-prompt ordering)
 *   T3 — native iOS: on permission granted + registration event fires → POSTs {platform:'ios', device_token}
 *   T4 — native Android: on registration → POSTs {platform:'android', device_token}
 *   T5 — permission denied returns {ok:false, error:'permission-denied'}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock @capacitor/push-notifications ────────────────────────────────────
//
// Inline vi.mock because:
//   (a) @capacitor/push-notifications is not installed in 54-01 (deferred to 54-03)
//   (b) vitest-mobile.config.ts does not alias it yet (aliased in 54-03 alongside install)
// This mock simulates the Capacitor plugin's checkPermissions / requestPermissions /
// register / addListener API shape (Capacitor 8.x official API).

vi.mock('@capacitor/push-notifications', () => {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  const PushNotifications = {
    checkPermissions: vi.fn(async () => ({ receive: 'prompt' as 'prompt' | 'granted' | 'denied' })),
    requestPermissions: vi.fn(async () => ({
      receive: 'granted' as 'prompt' | 'granted' | 'denied',
    })),
    register: vi.fn(async () => undefined),
    addListener: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
      return Promise.resolve({ remove: () => undefined });
    }),
    removeAllListeners: vi.fn(async () => undefined),
    // Test helper: fire a simulated event
    __emit: (event: string, ...args: unknown[]) => {
      (listeners[event] ?? []).forEach((cb) => cb(...args));
    },
    __resetListeners: () => {
      Object.keys(listeners).forEach((k) => delete listeners[k]);
    },
  };

  return { PushNotifications };
});

// ─── Supabase URL stub for fetch calls ──────────────────────────────────────

const SUPABASE_URL = 'https://test.supabase.co';
const ACCESS_TOKEN = 'user-jwt-token';

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('push.ts — native push registration (Wave-0 RED scaffold)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── T1: Web path returns {ok:false} ────────────────────────────────────────

  it('T1 — registerForPush on web (not native) returns {ok:false}', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.isNativePlatform.mockReturnValue(false);
    Capacitor.getPlatform.mockReturnValue('web');

    // RED: ./push currently throws — this test fails until 54-03 implements registerForPush
    const { registerForPush } = await import('./push');
    const result = await registerForPush(ACCESS_TOKEN, SUPABASE_URL);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not-native/);
  });

  // ── T2: iOS soft-prompt ordering — checkPermissions BEFORE requestPermissions ─

  it('T2 — native iOS: checkPermissions called BEFORE requestPermissions (PUSH-05)', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.isNativePlatform.mockReturnValue(true);
    Capacitor.getPlatform.mockReturnValue('ios');

    const { PushNotifications } = await import('@capacitor/push-notifications');
    const callOrder: string[] = [];
    PushNotifications.checkPermissions.mockImplementationOnce(async () => {
      callOrder.push('checkPermissions');
      return { receive: 'prompt' };
    });
    PushNotifications.requestPermissions.mockImplementationOnce(async () => {
      callOrder.push('requestPermissions');
      return { receive: 'denied' }; // denied to avoid registration flow
    });

    const { registerForPush } = await import('./push');
    await registerForPush(ACCESS_TOKEN, SUPABASE_URL);

    expect(callOrder[0]).toBe('checkPermissions');
    expect(callOrder[1]).toBe('requestPermissions');
  });

  // ── T3: iOS granted → 'registration' listener fires → POST {platform:'ios', device_token}

  it('T3 — native iOS: registration event fires → POST device_token with platform:ios', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.isNativePlatform.mockReturnValue(true);
    Capacitor.getPlatform.mockReturnValue('ios');

    const { PushNotifications } = await import('@capacitor/push-notifications');
    PushNotifications.checkPermissions.mockResolvedValue({ receive: 'granted' });

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    // register() triggers 'registration' event asynchronously
    PushNotifications.register.mockImplementationOnce(async () => {
      // Simulate APNs token delivery (fired after registration)
      (PushNotifications as unknown as { __emit: (e: string, d: unknown) => void }).__emit(
        'registration',
        { value: 'apns-device-token-ios-123' },
      );
    });

    const { registerForPush } = await import('./push');
    const result = await registerForPush(ACCESS_TOKEN, SUPABASE_URL);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/functions/v1/push-subscribe');
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body.platform).toBe('ios');
    expect(body.device_token).toBe('apns-device-token-ios-123');

    vi.unstubAllGlobals();
  });

  // ── T4: Android granted → 'registration' listener fires → POST platform:'android' ─

  it('T4 — native Android: registration event fires → POST device_token with platform:android', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.isNativePlatform.mockReturnValue(true);
    Capacitor.getPlatform.mockReturnValue('android');

    const { PushNotifications } = await import('@capacitor/push-notifications');
    PushNotifications.checkPermissions.mockResolvedValue({ receive: 'granted' });

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    PushNotifications.register.mockImplementationOnce(async () => {
      (PushNotifications as unknown as { __emit: (e: string, d: unknown) => void }).__emit(
        'registration',
        { value: 'fcm-device-token-android-456' },
      );
    });

    const { registerForPush } = await import('./push');
    const result = await registerForPush(ACCESS_TOKEN, SUPABASE_URL);

    expect(result.ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(body.platform).toBe('android');
    expect(body.device_token).toBe('fcm-device-token-android-456');

    vi.unstubAllGlobals();
  });

  // ── T5: Permission denied returns {ok:false, error:'permission-denied'} ────

  it('T5 — permission denied returns {ok:false, error:"permission-denied"}', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.isNativePlatform.mockReturnValue(true);
    Capacitor.getPlatform.mockReturnValue('ios');

    const { PushNotifications } = await import('@capacitor/push-notifications');
    PushNotifications.checkPermissions.mockResolvedValue({ receive: 'prompt' });
    PushNotifications.requestPermissions.mockResolvedValue({ receive: 'denied' });

    const { registerForPush } = await import('./push');
    const result = await registerForPush(ACCESS_TOKEN, SUPABASE_URL);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/permission-denied/);
  });
});
