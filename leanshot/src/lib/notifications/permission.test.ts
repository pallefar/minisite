/**
 * Phase 42 Plan 42-08 — requestPushPermission tests (Pitfall 3 enforcement).
 *
 * Behavior:
 *  - throws when called without fromUserGesture: true (Pitfall 3 invariant)
 *  - on 'granted' → pushManager.subscribe with VAPID applicationServerKey
 *    → POST sub to /push-subscribe with auth bearer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestPushPermission } from './permission';

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: () => getSessionMock() } },
}));

describe('requestPushPermission (Plan 42-08 Pitfall 3 enforcement)', () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    getSessionMock.mockReset();
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    // Phase 70-07 cascade-37 — requestPushPermission() reads
    // import.meta.env.VITE_VAPID_PUBLIC_KEY (permission.ts:75) and returns
    // { state: 'unsupported' } when it's absent. That var is only present via
    // the dev machine's .env.local, NOT in CI — so this suite passed locally
    // but failed in CI ('unsupported' !== 'granted'). Stub the env the function
    // depends on so the test is deterministic regardless of ambient env.
    vi.stubEnv(
      'VITE_VAPID_PUBLIC_KEY',
      'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8',
    );
  });

  it('throws synchronously when called without fromUserGesture (Pitfall 3 guard)', async () => {
    // @ts-expect-error — intentionally bad call to verify runtime guard
    await expect(requestPushPermission({})).rejects.toThrow(/user gesture/i);
    // @ts-expect-error — also rejects undefined
    await expect(requestPushPermission(undefined)).rejects.toThrow(/user gesture/i);
  });

  it('returns unsupported when Notification API not available', async () => {
    const origNotification = (globalThis as { Notification?: unknown }).Notification;
    // Delete to simulate older browser
    delete (globalThis as { Notification?: unknown }).Notification;
    try {
      const res = await requestPushPermission({ fromUserGesture: true });
      expect(res.state).toBe('unsupported');
    } finally {
      (globalThis as { Notification?: unknown }).Notification = origNotification;
    }
  });

  it('subscribes via PushManager and POSTs to /push-subscribe on granted', async () => {
    // Build a fake jsdom Notification + serviceWorker + PushManager surface.
    const subJson = { endpoint: 'https://fcm.example/abc', keys: { p256dh: 'x', auth: 'y' } };
    const fakeSub = {
      toJSON: () => subJson,
    } as unknown as PushSubscription;
    const subscribeFn = vi.fn().mockResolvedValue(fakeSub);
    const reg = { pushManager: { subscribe: subscribeFn } } as unknown as ServiceWorkerRegistration;

    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      writable: true,
      value: {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      },
    });
    Object.defineProperty(globalThis, 'PushManager', {
      configurable: true,
      writable: true,
      value: function PushManager() {},
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve(reg) },
    });

    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'jwt-token' } } });
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => 'ok',
    });

    const res = await requestPushPermission({ fromUserGesture: true });
    expect(res.state).toBe('granted');
    expect(subscribeFn).toHaveBeenCalledWith(
      expect.objectContaining({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      }),
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/functions/v1/push-subscribe'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer jwt-token',
        }),
      }),
    );
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.unstubAllEnvs();
  });
});
