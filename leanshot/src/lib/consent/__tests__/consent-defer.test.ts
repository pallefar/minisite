/**
 * Phase 22 plan 22-10 — Pattern 4: idle-deferred dynamic-import gate for
 * vanilla-cookieconsent (GDPR-01 bundle budget).
 *
 * Behaviors covered:
 *   1. scheduleConsentInit() with requestIdleCallback support fires via rIC once.
 *   2. scheduleConsentInit() without rIC support falls back to setTimeout(100).
 *   3. Subsequent scheduleConsentInit() calls are no-ops (idempotent).
 *   4. The consent-config dynamic-import resolves to initCookieConsent() invocation.
 *
 * Build-time chunk-separation assertion is covered in Task 4 (bundle verification),
 * not here — vitest cannot inspect rollup chunk graph.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetConsentDeferForTests, scheduleConsentInit } from '@/lib/consent/consent-defer';

// Mock the dynamic-import target so we can assert init was called without
// pulling in the real vanilla-cookieconsent SDK at test time.
const initCookieConsentSpy = vi.fn();
vi.mock('@/components/consent/consent-config', () => ({
  initCookieConsent: () => initCookieConsentSpy(),
}));

describe('consent-defer (Phase 22 GDPR-01 Pattern 4 bundle gate)', () => {
  let rICSpy: ReturnType<typeof vi.fn>;
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetConsentDeferForTests();
    initCookieConsentSpy.mockReset();
    // Restore native requestIdleCallback in jsdom — jsdom does NOT ship one
    // natively, so we install a controllable spy.
    rICSpy = vi.fn((cb: IdleRequestCallback) => {
      // synchronously invoke to drive the dynamic import
      cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
      return 1 as unknown as number;
    });
    (
      globalThis as unknown as { requestIdleCallback?: typeof window.requestIdleCallback }
    ).requestIdleCallback = rICSpy as unknown as typeof window.requestIdleCallback;
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
  });

  afterEach(() => {
    delete (globalThis as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
    setTimeoutSpy.mockRestore();
  });

  it('schedules via requestIdleCallback when available + invokes initCookieConsent once', async () => {
    scheduleConsentInit();
    // requestIdleCallback was called once with a timeout option.
    expect(rICSpy).toHaveBeenCalledTimes(1);
    const opts = rICSpy.mock.calls[0]?.[1] as { timeout?: number } | undefined;
    expect(opts?.timeout).toBe(2000);
    // Allow the awaited dynamic-import + initCookieConsent invocation to flush.
    await new Promise((r) => setTimeout(r, 0));
    expect(initCookieConsentSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to setTimeout(100) when requestIdleCallback is unavailable', async () => {
    delete (globalThis as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
    scheduleConsentInit();
    // setTimeout was called with delay 100 (the fallback path).
    const sawFallback = setTimeoutSpy.mock.calls.some((c) => c[1] === 100);
    expect(sawFallback).toBe(true);
    // Drain the fallback timer + dynamic import.
    await new Promise((r) => setTimeout(r, 150));
    expect(initCookieConsentSpy).toHaveBeenCalledTimes(1);
  });

  it('subsequent scheduleConsentInit() calls are no-ops once loading is in flight', async () => {
    scheduleConsentInit();
    scheduleConsentInit();
    scheduleConsentInit();
    expect(rICSpy).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(initCookieConsentSpy).toHaveBeenCalledTimes(1);
  });

  it('subsequent scheduleConsentInit() calls are no-ops after load completes', async () => {
    scheduleConsentInit();
    await new Promise((r) => setTimeout(r, 0));
    expect(initCookieConsentSpy).toHaveBeenCalledTimes(1);
    // Second call after load: should not schedule another rIC OR re-init.
    scheduleConsentInit();
    expect(rICSpy).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(initCookieConsentSpy).toHaveBeenCalledTimes(1);
  });
});
