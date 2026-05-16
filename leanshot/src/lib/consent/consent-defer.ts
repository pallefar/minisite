/**
 * Phase 22 Plan 22-10 — Pattern 4: idle-deferred dynamic-import gate for
 * vanilla-cookieconsent (GDPR-01 bundle budget).
 *
 * Mirrors `src/lib/sync-defer.ts` (Phase 6 D-12) and `src/lib/telemetry-defer.ts`
 * (Phase 2.1 D-22): the heavy module loads AFTER first paint via
 * `requestIdleCallback` (setTimeout fallback on Safari < 17 / Firefox).
 *
 * Bundle-budget contract (memory `project_phase5_bundle_regression.md`):
 *   - This module imports `vanilla-cookieconsent` ONLY via a value-less type
 *     reference (no `import type` needed here — there is no symbol from the
 *     library used in this file). The library lands on the chunk graph ONLY
 *     when `loadConsent()` calls `await import('@/components/consent/consent-config')`,
 *     which in turn `import * as CookieConsent from 'vanilla-cookieconsent'`.
 *   - Result: vanilla-cookieconsent sits in a separate lazy chunk; the index
 *     entry chunk stays under the 50 kB gz ceiling (baseline ~15 kB).
 *   - Task 4 verifies the chunk-separation invariant on `npm run build`.
 *
 * Idempotency contract:
 *   - First call schedules an idle callback.
 *   - Subsequent calls before the load resolves are no-ops (loadingPromise guard).
 *   - Subsequent calls after the load resolves are no-ops (initialized guard).
 */

let initialized = false;
let loadingPromise: Promise<void> | null = null;

async function loadConsent(): Promise<void> {
  if (initialized) return;
  initialized = true;
  // Dynamic-import is the bundle-budget gate. Keep this `import(...)`
  // expression literal (no template strings) so Vite/Rollup can statically
  // analyze it into a separate chunk per the manualChunks rules in
  // vite.config.ts.
  const { initCookieConsent } = await import('@/components/consent/consent-config');
  initCookieConsent();
}

/**
 * Phase 22 GDPR-01 — schedule the cookie consent banner init after first paint.
 *
 * Caller pattern (mirrors src/main.tsx scheduleSyncInit invocation):
 *   useEffect(() => { scheduleConsentInit(); }, []);
 *
 * The CookieConsentBootstrap component owns the single call site so the
 * library never lands on App.tsx's static graph. Idempotent — safe to call
 * multiple times from React StrictMode double-invoke.
 */
export function scheduleConsentInit(): void {
  if (initialized || loadingPromise) return;

  const startLoad = (): void => {
    if (initialized || loadingPromise) return;
    loadingPromise = loadConsent().catch((e: unknown) => {
      // Don't block app boot on banner failure; log + reset so a later retry
      // can re-attempt. Banner is non-blocking per UI-SPEC §banner.
      console.warn('[leanshot] consent banner load failed', e);
      initialized = false;
      loadingPromise = null;
    });
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(startLoad, { timeout: 2000 });
  } else {
    setTimeout(startLoad, 100);
  }
}

/** Test-only reset hook (mirrors sync-defer._resetForTests). */
export function _resetConsentDeferForTests(): void {
  initialized = false;
  loadingPromise = null;
}
