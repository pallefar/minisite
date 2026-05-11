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

import type { beforeSend as BeforeSendFn } from './sentry';

interface BufferedError {
  kind: 'error' | 'unhandledrejection';
  payload: ErrorEvent | PromiseRejectionEvent;
  timestamp: number;
}

const buffer: BufferedError[] = [];
let onErrorListener: ((e: ErrorEvent) => void) | null = null;
let onRejectionListener: ((e: PromiseRejectionEvent) => void) | null = null;

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
 * If `VITE_SENTRY_DSN` is unset we skip entirely (matches the static-init
 * `enabled: !!VITE_SENTRY_DSN` short-circuit).
 *
 * @param beforeSend  Pure scrubber from `./sentry` (type-only import, doesn't
 *                    drag @sentry/react into this module's chunk).
 */
export function deferSentryInit(beforeSend: typeof BeforeSendFn): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  installPreInitListeners();

  const initFn = (): void => {
    void import('@sentry/react').then(({ init, captureException }) => {
      init({
        dsn,
        environment: import.meta.env.MODE,
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
