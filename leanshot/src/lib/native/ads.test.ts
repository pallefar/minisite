// Phase 56 + Phase 70 — unit tests for the AdMob boot-wiring (initAdNetwork).
//
// Runs under `vitest-mobile.config.ts`, which aliases:
//   - `@capacitor/core` → __mocks__/capacitor-core.ts (consumed via ./platform
//     → detectPlatform), driven per-test via Capacitor.getPlatform.
//   - `@capacitor-community/admob` → __mocks__/capacitor-community-admob.ts so
//     the real native binding never loads and AdMob.* are vi.fn()s. vi.resetModules()
//     re-evaluates the aliased mock per test → zeroed call counts (mirrors the
//     iap.test.ts ↔ revenuecat-purchases-capacitor pattern).
//
// Verifies the configureRC-mirroring gating discipline: native-only,
// env-gated (silent no-op until VITE_ADMOB_APP_ID_* land), and idempotent.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('ads.ts — AdMob boot-wiring (initAdNetwork)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('on web → AdMob.initialize NEVER called (native-only gate)', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('web');
    Capacitor.isNativePlatform.mockReturnValue(false);
    // Even with an app ID present, web must short-circuit.
    vi.stubEnv('VITE_ADMOB_APP_ID_IOS', 'ca-app-pub-test~ios');
    const { initAdNetwork } = await import('./ads');
    await initAdNetwork();
    const { AdMob } = await import('@capacitor-community/admob');
    expect(AdMob.initialize).not.toHaveBeenCalled();
  });

  it('on capacitor-web → AdMob.initialize NEVER called (native binding is ios/android only)', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('web');
    Capacitor.isNativePlatform.mockReturnValue(true); // → detectPlatform() === 'capacitor-web'
    vi.stubEnv('VITE_ADMOB_APP_ID_IOS', 'ca-app-pub-test~ios');
    const { initAdNetwork } = await import('./ads');
    await initAdNetwork();
    const { AdMob } = await import('@capacitor-community/admob');
    expect(AdMob.initialize).not.toHaveBeenCalled();
  });

  it('on ios with app ID → AdMob.initialize called once in test mode', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    vi.stubEnv('VITE_ADMOB_APP_ID_IOS', 'ca-app-pub-test~ios');
    const { initAdNetwork } = await import('./ads');
    await initAdNetwork();
    const { AdMob } = await import('@capacitor-community/admob');
    expect(AdMob.initialize).toHaveBeenCalledTimes(1);
    expect(AdMob.initialize).toHaveBeenCalledWith({
      testingDevices: [],
      initializeForTesting: true,
    });
  });

  it('on android with app ID → AdMob.initialize called once', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('android');
    Capacitor.isNativePlatform.mockReturnValue(true);
    vi.stubEnv('VITE_ADMOB_APP_ID_ANDROID', 'ca-app-pub-test~android');
    const { initAdNetwork } = await import('./ads');
    await initAdNetwork();
    const { AdMob } = await import('@capacitor-community/admob');
    expect(AdMob.initialize).toHaveBeenCalledTimes(1);
  });

  it('on ios WITHOUT app ID → silent no-op, AdMob.initialize NEVER called (env gate)', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    // Explicitly empty (do NOT rely on absence — guards against ambient env).
    vi.stubEnv('VITE_ADMOB_APP_ID_IOS', '');
    const { initAdNetwork } = await import('./ads');
    await expect(initAdNetwork()).resolves.toBeUndefined(); // no throw — benign skip
    const { AdMob } = await import('@capacitor-community/admob');
    expect(AdMob.initialize).not.toHaveBeenCalled();
  });

  it('idempotency — two boot calls on ios → AdMob.initialize called once', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    vi.stubEnv('VITE_ADMOB_APP_ID_IOS', 'ca-app-pub-test~ios');
    const { initAdNetwork } = await import('./ads');
    await initAdNetwork();
    await initAdNetwork();
    const { AdMob } = await import('@capacitor-community/admob');
    expect(AdMob.initialize).toHaveBeenCalledTimes(1);
  });
});
