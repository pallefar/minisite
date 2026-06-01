/**
 * Telemetry deferral helper (Phase 2.1 perf fix).
 *
 * Phase 1 (D-12) wanted Sentry to init FIRST so it captures errors during
 * theme read, hydrate(), and lazy chunks. Phase 2 shipped this as a static
 * `import * as Sentry from '@sentry/react'` at the top of main.tsx — which
 * dragged @sentry/* (~116 kB gz) onto the entry static graph and made
 * `vendor-telemetry` (93 kB gz combined w/ posthog-js) auto-preload via
 * Vite's modulepreload. That parser cost dominated cold-load FCP/LCP and
 * pinned SPA Lighthouse Performance at ~0.76 (SC#1 needs ≥ 0.90).
 *
 * This helper preserves D-12's error-capture contract WITHOUT a static
 * import: install lightweight `error` + `unhandledrejection` listeners
 * that buffer events into an array, then drain the buffer once Sentry's
 * dynamic import + init resolve. The pre-init window is bounded by
 * `requestIdleCallback`'s deadline (or a 200ms setTimeout fallback on
 * Safari/Firefox) so the buffer almost always flushes within 1 paint.
 */

import { detectPlatform } from './native/platform';
import type { beforeSend as BeforeSendFn } from './sentry';

interface BufferedError {
  kind: 'error' | 'unhandledrejection';
  payload: ErrorEvent | PromiseRejectionEvent;
  timestamp: number;
}

const buffer: BufferedError[] = [];
let onErrorListener: ((e: ErrorEvent) => void) | null = null;
let onRejectionListener: ((e: PromiseRejectionEvent) => void) | null = null;
// True once the web Sentry dynamic import + init has resolved (the buffer is
// drained at that point). Lets reportError() pick the live capture path vs.
// the pre-init buffer without a second Sentry import elsewhere.
let sentryInitialized = false;

function installPreInitListeners(): void {
  onErrorListener = (e) => buffer.push({ kind: 'error', payload: e, timestamp: Date.now() });
  onRejectionListener = (e) =>
    buffer.push({ kind: 'unhandledrejection', payload: e, timestamp: Date.now() });
  window.addEventListener('error', onErrorListener);
  window.addEventListener('unhandledrejection', onRejectionListener);
}

function uninstallPreInitListeners(): void {
  if (onErrorListener) window.removeEventListener('error', onErrorListener);
  if (onRejectionListener) window.removeEventListener('unhandledrejection', onRejectionListener);
  onErrorListener = null;
  onRejectionListener = null;
}

/**
 * Schedule Sentry init after first paint without blocking the entry chunk.
 *
 * DSN routing: see 16-CONTEXT-ADDENDUM-sentry-per-platform-projects.md
 * (supersedes D-17 single-project decision 2026-05-16). Per-platform
 * VITE_SENTRY_DSN_WEB takes precedence; legacy VITE_SENTRY_DSN stays as a
 * safety fallback so any deploy that hasn't migrated env vars still works.
 *
 * If neither is set we skip entirely (silent no-op — same pre-addendum
 * behavior).
 *
 * @param beforeSend  Pure scrubber from `./sentry` (type-only import, doesn't
 *                    drag @sentry/react into this module's chunk).
 */
export function deferSentryInit(beforeSend: typeof BeforeSendFn): void {
  const dsn =
    (import.meta.env.VITE_SENTRY_DSN_WEB as string | undefined) ||
    (import.meta.env.VITE_SENTRY_DSN as string | undefined);
  if (!dsn) return;

  // Phase 16 MOBILE-09: on native platforms, the synchronous dual-init in
  // `src/lib/sentry-native.ts` (called from main.tsx BEFORE first render)
  // owns Sentry init. The deferred web path stays no-op on ios/android so
  // we don't double-init and double-send events. See `16-04-SUMMARY.md` for
  // the dual-init contract.
  if (detectPlatform() !== 'web') return;

  installPreInitListeners();

  const initFn = (): void => {
    void import('@sentry/react').then(({ init, captureException }) => {
      init({
        dsn,
        environment: import.meta.env.MODE,
        // Tie web events to the uploaded source maps so frames symbolicate.
        // The @sentry/vite-plugin (vite.config.ts) uploads maps under the
        // VERCEL_GIT_COMMIT_SHA release name; set VITE_SENTRY_RELEASE to the
        // same value at build time so the two line up. Undefined is tolerated
        // (Sentry falls back to no release association).
        release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
        enabled: true,
        integrations: [], // D-11: errors-only — no Replay, Tracing, Profiling
        beforeSend,
      });
      // Drain pre-init buffer
      for (const item of buffer) {
        if (item.kind === 'error') {
          const errEvent = item.payload as ErrorEvent;
          captureException(errEvent.error ?? new Error(errEvent.message));
        } else {
          const rejEvent = item.payload as PromiseRejectionEvent;
          captureException(rejEvent.reason);
        }
      }
      buffer.length = 0;
      uninstallPreInitListeners();
      sentryInitialized = true;
    });
  };

  // requestIdleCallback is supported in Chrome/Edge/Opera but not Safari < 17 / Firefox.
  // Fall back to setTimeout(0) which queues after first render (microtask + paint).
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(initFn, { timeout: 2000 });
  } else {
    setTimeout(initFn, 100);
  }
}

/**
 * Report a caught error (e.g. from a React error boundary) through the SAME
 * deferred capture path used for window `error` / `unhandledrejection` events —
 * no second static `@sentry/react` import, so the boundary stays off the entry
 * static graph.
 *
 * - If web Sentry has already initialized, dynamic-import `captureException`
 *   (the import is already cached at that point) and send directly.
 * - If init is still pending (or `deferSentryInit` was skipped because no DSN
 *   is set), dispatch a synthetic `error` event so the pre-init listeners
 *   buffer it; the drain on init replays it. When no DSN is configured this is
 *   a silent no-op, matching the rest of the module's behavior.
 */
export function reportError(error: unknown): void {
  if (sentryInitialized) {
    void import('@sentry/react').then(({ captureException }) => {
      captureException(error);
    });
    return;
  }
  // Pre-init (or no-DSN) path: route through the existing window-error buffer.
  try {
    const errObj = error instanceof Error ? error : new Error(String(error));
    window.dispatchEvent(new ErrorEvent('error', { error: errObj, message: errObj.message }));
  } catch {
    /* environments without ErrorEvent ctor — best-effort, drop silently */
  }
}

/**
 * Schedule PostHog init after first paint without blocking the entry chunk.
 * The `initAnalytics()` function in `./analytics` already does the dynamic
 * import internally; this helper just wraps the timing call so main.tsx
 * doesn't have to know the schedule policy.
 */
export function deferAnalyticsInit(initFn: () => void): void {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(initFn, { timeout: 2000 });
  } else {
    setTimeout(initFn, 100);
  }
}
