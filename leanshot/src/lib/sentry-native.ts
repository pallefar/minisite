/**
 * Native-only Sentry dual-init entry point (Phase 16 — MOBILE-09 init half).
 *
 * The WEB build NEVER reaches this code path: `main.tsx` forks on
 * `detectPlatform()` and the deferred web init in `telemetry-defer.ts`
 * handles the SPA case. Keeping `@sentry/capacitor` imports isolated here
 * keeps the entry chunk free of @sentry/* — only the native build's static
 * graph pulls this module in (its `webDir` bundle is loaded by
 * WKWebView/WebView; the entry-chunk weight budget is different from web's
 * Lighthouse budget, which is why static-imported Sentry is acceptable on
 * native but a regression on web).
 *
 * The exact options shape MUST match `16-04-VERIFIED-SIGNATURE.md`
 * § "Verified Signature (v4)" — D-11 errors-only (no Replay/Tracing/Feedback).
 *
 * Pinned upstream contract (verified 2026-05-16):
 *   Sentry.init({ dsn, release, beforeSend, integrations: [] }, SentryReact.init)
 *
 * SECURITY: never log `args.dsn` to console. The DSN is a low-sensitivity
 * send-only credential, but our convention (per stripe-webhook) is to never
 * echo secret args.
 */

import { Capacitor } from '@capacitor/core';
import { init as sentryCapacitorInit } from '@sentry/capacitor';
import { init as sentryReactInit } from '@sentry/react';

import type { beforeSend as BeforeSendFn } from './sentry';

export interface InitSentryNativeArgs {
  /** Sentry DSN. Same Phase 1 project per D-17 (separate releases for symbolication routing). */
  dsn: string;
  /** Per-platform release tag, shape `ios@<ver>` or `android@<ver>` per D-17. */
  release: string;
  /** D-10 PHI scrubber from `./sentry` — reused unchanged so native crashes get the same redaction as web errors. */
  beforeSend: typeof BeforeSendFn;
}

let _initialized = false;

/**
 * Native-only Sentry dual-init.
 * - No-op on `web` platform (caller in main.tsx already guards; this is a defensive double-guard).
 * - Early-return if DSN is empty (mirrors `telemetry-defer.ts` line 58 behavior — silent skip).
 * - Idempotent — second call returns immediately if already initialized (guards against React
 *   StrictMode double-invoke side effects if anyone moves the call out of main.tsx).
 * - Synchronous from caller's perspective (Sentry.init returns void; the actual native bridge
 *   call resolves async but the JS layer is set up before this function returns).
 */
export function initSentryNative(args: InitSentryNativeArgs): void {
  if (_initialized) return;
  if (!args.dsn) return;

  const platform = Capacitor.getPlatform();
  if (platform !== 'ios' && platform !== 'android') return;

  // Version-skew nominal-type bridge (one-place tax, runtime-identical):
  // @sentry/capacitor@4.0.0 nests its own @sentry/core@10.43.0 copy, so its
  // Integration/ErrorEvent/Client types are nominally distinct from our root
  // @sentry/core@10.52.0 types (used by @sentry/react in the rest of the app).
  // The shapes are structurally identical — Sentry 10.x kept these stable
  // across patches — so the cast at the call boundary is safe. Tracked for
  // re-removal when @sentry/capacitor relaxes the peer-pin in a future patch.
  // See 16-04-VERIFIED-SIGNATURE.md § Compatibility Waiver.
  type CapInit = typeof sentryCapacitorInit;
  type CapOptions = Parameters<CapInit>[0];
  type CapSecondArg = Parameters<CapInit>[1];
  sentryCapacitorInit(
    {
      dsn: args.dsn,
      release: args.release,
      beforeSend: args.beforeSend,
      // D-11: errors-only — no Replay, Tracing, Profiling, or Feedback.
      // Mirrors `telemetry-defer.ts` line 68 web init.
      integrations: [],
    } as unknown as CapOptions,
    sentryReactInit as unknown as CapSecondArg,
  );

  _initialized = true;
}

/**
 * Test-only reset helper — clears the module-level `_initialized` flag between
 * test cases. NOT part of the public surface. Runtime no-op outside test mode so
 * a tree-shaker preserves it under vitest but the production native build is
 * defensive if anyone accidentally calls it.
 */
/* istanbul ignore next */
export function __resetSentryNativeForTests(): void {
  if (import.meta.env.MODE !== 'test') return;
  _initialized = false;
}
