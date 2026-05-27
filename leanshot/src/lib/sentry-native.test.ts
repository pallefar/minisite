/**
 * Phase 16 MOBILE-09 — Sentry Capacitor dual-init unit tests.
 *
 * Mirrors PATTERNS.md §"vi.mock for Capacitor plugins" (lines 698-712).
 * Covers:
 *  1. No-op on web platform (defensive double-guard — main.tsx already gates).
 *  2. ios path — single Sentry.init call with dsn/release/beforeSend + SentryReact.init second-arg.
 *  3. android path — identical wiring as ios (no per-platform branch inside the module).
 *  4. Idempotency — second invocation is suppressed via module-level _initialized flag.
 *  5. Missing-DSN early return — no init call.
 */

import { Capacitor } from '@capacitor/core';
import * as SentryCapacitor from '@sentry/capacitor';
import * as SentryReact from '@sentry/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beforeSend } from './sentry';
import { __resetSentryNativeForTests, initSentryNative } from './sentry-native';

// Hoisted mock state — vi.mock factories run BEFORE imports per vitest hoist rules,
// so we use vi.hoisted to share mutable platform state with the factory.
const platformState = vi.hoisted(() => ({ current: 'web' as 'web' | 'ios' | 'android' }));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(() => platformState.current),
    isNativePlatform: vi.fn(() => platformState.current !== 'web'),
  },
}));

vi.mock('@sentry/capacitor', () => ({
  init: vi.fn(),
}));

vi.mock('@sentry/react', () => ({
  init: vi.fn(),
}));

// Import AFTER mocks are registered.

const VALID_DSN = 'https://abc@o0.ingest.sentry.io/1';

describe('initSentryNative', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformState.current = 'web';
    __resetSentryNativeForTests();
  });

  afterEach(() => {
    __resetSentryNativeForTests();
  });

  it('is a no-op on web platform (defensive double-guard)', () => {
    platformState.current = 'web';
    initSentryNative({ dsn: VALID_DSN, release: 'web@1.0.0', beforeSend });
    expect(SentryCapacitor.init).not.toHaveBeenCalled();
    expect(Capacitor.getPlatform).toHaveBeenCalled();
  });

  it('calls Sentry.init exactly once on ios with dsn+release+beforeSend and SentryReact.init as second arg', () => {
    platformState.current = 'ios';
    initSentryNative({ dsn: VALID_DSN, release: 'ios@1.0.0', beforeSend });
    expect(SentryCapacitor.init).toHaveBeenCalledTimes(1);
    const [optionsArg, secondArg] = (SentryCapacitor.init as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(optionsArg).toMatchObject({
      dsn: VALID_DSN,
      release: 'ios@1.0.0',
      beforeSend,
    });
    // D-11 errors-only — no Replay/Tracing/Feedback integrations.
    expect(optionsArg.integrations).toEqual([]);
    // Verified-signature contract: second arg is the React init FUNCTION REFERENCE.
    expect(secondArg).toBe(SentryReact.init);
  });

  it('calls Sentry.init identically on android (no per-platform branch inside the module)', () => {
    platformState.current = 'android';
    initSentryNative({ dsn: VALID_DSN, release: 'android@2.5.0', beforeSend });
    expect(SentryCapacitor.init).toHaveBeenCalledTimes(1);
    const [optionsArg, secondArg] = (SentryCapacitor.init as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(optionsArg).toMatchObject({
      dsn: VALID_DSN,
      release: 'android@2.5.0',
      beforeSend,
    });
    expect(secondArg).toBe(SentryReact.init);
  });

  it('is idempotent — second call on the same platform does NOT re-init', () => {
    platformState.current = 'ios';
    initSentryNative({ dsn: VALID_DSN, release: 'ios@1.0.0', beforeSend });
    initSentryNative({ dsn: VALID_DSN, release: 'ios@1.0.0', beforeSend });
    expect(SentryCapacitor.init).toHaveBeenCalledTimes(1);
  });

  it('early-returns when DSN is empty (no init call, no console noise)', () => {
    platformState.current = 'ios';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    initSentryNative({ dsn: '', release: 'ios@1.0.0', beforeSend });
    expect(SentryCapacitor.init).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });
});
