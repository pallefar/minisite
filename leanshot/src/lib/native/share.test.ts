// Phase 16 Plan 16-02 Task 3 — unit tests for share.ts.
//
// Runs under `vitest-mobile.config.ts` which aliases:
//   - `@capacitor/share` → __mocks__/capacitor-share.ts (exposes Share.share as vi.fn())
//   - `@capacitor/core` → __mocks__/capacitor-core.ts (consumed via ./platform)
//
// Web-fallback testing requires stubbing `navigator.share` and
// `navigator.clipboard.writeText`. jsdom's `navigator` is a getter on the
// global, so we use Object.defineProperty to redefine per-case.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('nativeShare()', () => {
  let origNavigator: typeof navigator;
  beforeEach(() => {
    vi.resetModules();
    origNavigator = navigator;
  });

  afterEach(() => {
    vi.resetModules();
    // Restore navigator if any test mutated it
    Object.defineProperty(globalThis, 'navigator', {
      value: origNavigator,
      writable: true,
      configurable: true,
    });
  });

  it('ios → Share.share called', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { Share } = await import('@capacitor/share');
    Share.share.mockResolvedValue({ activityType: 'com.apple.UIKit.activity.Mail' });
    const { nativeShare } = await import('./share');
    await nativeShare({ title: 't', text: 'x', url: 'https://leanshot.app/share/abc' });
    expect(Share.share).toHaveBeenCalledWith({
      title: 't',
      text: 'x',
      url: 'https://leanshot.app/share/abc',
    });
  });

  it('android → Share.share called', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('android');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { Share } = await import('@capacitor/share');
    Share.share.mockResolvedValue({ activityType: 'android.intent.action.SEND' });
    const { nativeShare } = await import('./share');
    await nativeShare({ title: 't', text: 'x', url: 'https://leanshot.app/share/abc' });
    expect(Share.share).toHaveBeenCalledTimes(1);
  });

  it('web with navigator.share available → navigator.share called, Share.share NOT called', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('web');
    Capacitor.isNativePlatform.mockReturnValue(false);
    const { Share } = await import('@capacitor/share');
    const webShare = vi.fn(async () => undefined);
    Object.defineProperty(globalThis, 'navigator', {
      value: { share: webShare, clipboard: { writeText: vi.fn() } },
      writable: true,
      configurable: true,
    });
    const { nativeShare } = await import('./share');
    await nativeShare({ title: 't', text: 'x', url: 'https://leanshot.app/share/abc' });
    expect(webShare).toHaveBeenCalledWith({
      title: 't',
      text: 'x',
      url: 'https://leanshot.app/share/abc',
    });
    expect(Share.share).not.toHaveBeenCalled();
  });

  it('web without navigator.share → clipboard.writeText fallback called', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('web');
    Capacitor.isNativePlatform.mockReturnValue(false);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText } },
      writable: true,
      configurable: true,
    });
    const { nativeShare } = await import('./share');
    await nativeShare({ title: 't', text: 'x', url: 'https://leanshot.app/share/abc' });
    expect(writeText).toHaveBeenCalledWith('https://leanshot.app/share/abc');
  });

  it('native Share.share throws (user cancel) → resolves without rethrow', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { Share } = await import('@capacitor/share');
    Share.share.mockRejectedValue(new Error('Share canceled'));
    const { nativeShare } = await import('./share');
    await expect(
      nativeShare({ title: 't', text: 'x', url: 'https://leanshot.app/share/abc' }),
    ).resolves.toBeUndefined();
  });
});
