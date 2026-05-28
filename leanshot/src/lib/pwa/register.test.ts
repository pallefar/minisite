/**
 * Phase 42 Plan 04 Task 2 — unit tests for the lazy SW registration helper.
 *
 * Behavior (Plan 42-04 Task 2 <behavior>):
 *  1. initializePWA returns undefined and DOES NOT call registerSW when
 *     Capacitor.isNativePlatform() === true (D-18).
 *  2. initializePWA calls registerSW with onNeedRefresh handler when
 *     Capacitor.isNativePlatform() === false (D-17).
 *  3. The onUpdate callback fires when registerSW's onNeedRefresh fires.
 *  4. install-prompt state machine: 'Maybe later' sets snoozed-until = now + 30d
 *     (D-16); appinstalled event sets installed=true (Pitfall 2); cannot
 *     transition installed → snoozed.
 *  5. Card displays only when dashboard-visit-count >= 3 AND state !== installed
 *     AND state !== dismissed AND (state !== snoozed OR snoozed-until < now).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mock for virtual:pwa-register (the vite-plugin-pwa virtual module).
// Tests below override `registerSWImpl` to control behavior.
const registerSWImpl = vi.fn();
vi.mock('virtual:pwa-register', () => ({
  registerSW: (opts: { onNeedRefresh?: () => void; onOfflineReady?: () => void }) =>
    registerSWImpl(opts),
}));

// Mock the Capacitor shim (separate module) so tests can flip
// isNativePlatform() per-test.
const isNativePlatformImpl = vi.fn();
vi.mock('@/lib/native/capacitor-shim', () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatformImpl(),
  },
}));

describe('initializePWA (D-17 / D-18)', () => {
  beforeEach(() => {
    vi.resetModules();
    registerSWImpl.mockReset();
    isNativePlatformImpl.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Test 1: returns undefined and does NOT call registerSW inside Capacitor (D-18)', async () => {
    isNativePlatformImpl.mockReturnValue(true);
    const { initializePWA } = await import('./register');
    const onUpdate = vi.fn();
    const result = initializePWA(onUpdate);
    expect(result).toBeUndefined();
    expect(registerSWImpl).not.toHaveBeenCalled();
  });

  it('Test 2: calls registerSW with onNeedRefresh + onOfflineReady on web (D-17)', async () => {
    isNativePlatformImpl.mockReturnValue(false);
    const { initializePWA } = await import('./register');
    const onUpdate = vi.fn();
    initializePWA(onUpdate);
    expect(registerSWImpl).toHaveBeenCalledTimes(1);
    const opts = registerSWImpl.mock.calls[0]?.[0] as {
      onNeedRefresh?: () => void;
      onOfflineReady?: () => void;
    };
    expect(typeof opts.onNeedRefresh).toBe('function');
    expect(typeof opts.onOfflineReady).toBe('function');
  });

  it('Test 3: onUpdate callback fires when registerSW onNeedRefresh fires', async () => {
    isNativePlatformImpl.mockReturnValue(false);
    const { initializePWA } = await import('./register');
    const onUpdate = vi.fn();
    initializePWA(onUpdate);
    const opts = registerSWImpl.mock.calls[0]?.[0] as { onNeedRefresh?: () => void };
    expect(onUpdate).not.toHaveBeenCalled();
    opts.onNeedRefresh?.();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('install-prompt state machine (D-16 / Pitfall 2)', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    // jsdom does not implement matchMedia for '(display-mode: standalone)';
    // default the mock to non-match so 'installed' is opt-in per test.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  });

  it('Test 4a: maybeLater() sets snoozed-until = now + 30d', async () => {
    const { initializeInstallPromptModule, getInstallPromptState, maybeLater } =
      await import('./install-prompt');
    initializeInstallPromptModule();
    const before = Date.now();
    maybeLater();
    const state = getInstallPromptState();
    expect(state.state).toBe('snoozed');
    expect(state.snoozed_until).toBeDefined();
    const snoozedUntilMs = new Date(state.snoozed_until!).getTime();
    const expectedMs = before + 30 * 24 * 60 * 60 * 1000;
    // Allow 5s of test-run drift.
    expect(Math.abs(snoozedUntilMs - expectedMs)).toBeLessThan(5_000);
  });

  it('Test 4b: appinstalled event sets installed=true; cannot transition installed → snoozed', async () => {
    const { initializeInstallPromptModule, getInstallPromptState, maybeLater } =
      await import('./install-prompt');
    initializeInstallPromptModule();
    window.dispatchEvent(new Event('appinstalled'));
    expect(getInstallPromptState().state).toBe('installed');
    // Attempt to snooze after installed; module must reject the transition.
    maybeLater();
    expect(getInstallPromptState().state).toBe('installed');
  });

  it('Test 5: shouldShowCard requires visits >=3, non-installed/dismissed, snooze expired', async () => {
    const { initializeInstallPromptModule, shouldShowCard, recordDashboardVisit, maybeLater } =
      await import('./install-prompt');
    initializeInstallPromptModule();

    // 1 visit → false
    recordDashboardVisit();
    expect(shouldShowCard()).toBe(false);

    // 2 visits → still false
    recordDashboardVisit();
    expect(shouldShowCard()).toBe(false);

    // 3 visits, no install event captured yet → still false (need
    // beforeinstallprompt to have fired so card knows there's something to prompt).
    recordDashboardVisit();
    // Fire a synthetic beforeinstallprompt with a stub prompt() so the module
    // captures it. The default Event constructor in jsdom suffices.
    const evt = new Event('beforeinstallprompt') as Event & {
      prompt?: () => Promise<void>;
      userChoice?: Promise<{ outcome: string }>;
      preventDefault?: () => void;
    };
    evt.prompt = () => Promise.resolve();
    evt.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(evt);
    expect(shouldShowCard()).toBe(true);

    // Maybe-later → snoozed; card hidden until snooze expires.
    maybeLater();
    expect(shouldShowCard()).toBe(false);
  });
});
