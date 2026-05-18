/**
 * Phase 32 Plan 32-01 — `i18n_missing_key` PostHog bridge.
 *
 * Per 32-RESEARCH Open Item #2 (lines 397-405): dedup-cached PostHog
 * `i18n_missing_key` capture for i18next's `missingKey` event. The cache
 * is module-scoped (one Set per page load) so a single missing key fires
 * at most ONE PostHog event per session — protects analytics quota when
 * the same key path renders in a render-heavy list.
 *
 * Analytics failures NEVER crash i18n — capture() is wrapped in try/catch.
 *
 * BUNDLE NOTE (Phase 24 D-18 ceiling): `capture.ts` + `events.ts` pull in
 * `zod` (~25 kB gz including locales). Importing them at top level would
 * inflate the `i18n-runtime` chunk past the 15 kB ceiling because
 * vite.config.ts manualChunks routes i18n-runtime as the first consumer of
 * any transitive dep. We dynamic-import the analytics module on first miss
 * instead — production miss rates are LOW (i18next-parser + ESLint catch
 * most at CI time), so the one-time cost is acceptable. The import is
 * cached after first resolution so subsequent misses are sync.
 */

import type { i18n as I18n } from 'i18next';
import type { capture as Capture } from '../analytics/capture';

const sentReport = new Set<string>();
let analyticsModule: Promise<{ capture: typeof Capture; eventName: string }> | undefined;

function loadAnalytics() {
  if (!analyticsModule) {
    analyticsModule = Promise.all([
      import('../analytics/capture'),
      import('../analytics/events'),
    ]).then(([{ capture }, { EVENTS }]) => ({
      capture,
      eventName: EVENTS.i18n_missing_key.name,
    }));
  }
  return analyticsModule;
}

/** Visible for tests. Resets the dedup cache between test runs. */
export function _resetMissingKeyCacheForTests(): void {
  sentReport.clear();
  analyticsModule = undefined;
}

export function installMissingKeyHandler(i18n: I18n): void {
  i18n.on('missingKey', (lngs, namespace, key) => {
    const lng = (Array.isArray(lngs) ? lngs[0] : lngs) ?? 'unknown';
    const dedupKey = `${lng}/${namespace}/${key}`;
    if (sentReport.has(dedupKey)) return;
    sentReport.add(dedupKey);

    // Fire-and-forget. Analytics outage MUST NEVER crash the runtime —
    // try/catch on the dynamic import + on the capture call covers the
    // posthog-down and registry-mismatch cases.
    void loadAnalytics()
      .then(({ capture, eventName }) => {
        try {
          // Cast to bypass the union narrowing — eventName is the canonical
          // string registered in the EVENTS map at module-load time.
          (capture as (n: string, p: { lng: string; ns: string; key: string }) => void)(
            eventName,
            { lng, ns: namespace, key },
          );
        } catch {
          if (import.meta.env.DEV) {

            console.warn('[i18n] missingKey capture failed', { lng, ns: namespace, key });
          }
        }
      })
      .catch(() => {
        if (import.meta.env.DEV) {

          console.warn('[i18n] missingKey analytics module load failed', {
            lng,
            ns: namespace,
            key,
          });
        }
      });
  });
}
