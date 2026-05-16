// Phase 16 Plan 16-02 Task 1 — unit tests for detectPlatform().
//
// Runs under `vitest-mobile.config.ts` which aliases `@capacitor/core` to
// the manual mock at `src/lib/native/__mocks__/capacitor-core.ts` (exposes
// `Capacitor.getPlatform` + `Capacitor.isNativePlatform` as `vi.fn()`).
//
// vi.resetModules() between cases re-evaluates both `@capacitor/core`
// (the aliased mock module) AND `./platform`, giving us a fresh Capacitor
// stub per case. We therefore RE-import the mock after each reset so we
// configure the same Capacitor instance that `./platform` captures on its
// own re-import.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('detectPlatform()', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns 'ios' when Capacitor.getPlatform() returns 'ios'", async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { detectPlatform } = await import('./platform');
    expect(detectPlatform()).toBe('ios');
  });

  it("returns 'android' when Capacitor.getPlatform() returns 'android'", async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('android');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { detectPlatform } = await import('./platform');
    expect(detectPlatform()).toBe('android');
  });

  it("returns 'capacitor-web' when getPlatform='web' AND isNativePlatform=true", async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('web');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { detectPlatform } = await import('./platform');
    expect(detectPlatform()).toBe('capacitor-web');
  });

  it("returns 'web' when getPlatform='web' AND isNativePlatform=false", async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('web');
    Capacitor.isNativePlatform.mockReturnValue(false);
    const { detectPlatform } = await import('./platform');
    expect(detectPlatform()).toBe('web');
  });
});
