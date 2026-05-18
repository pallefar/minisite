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
 * In DEV mode the failure is logged; in PROD it is swallowed silently so a
 * PostHog outage doesn't blank the page.
 */

import type { i18n as I18n } from 'i18next';
import { capture } from '../analytics/capture';
import { EVENTS } from '../analytics/events';

const sentReport = new Set<string>();

/** Visible for tests. Resets the dedup cache between test runs. */
export function _resetMissingKeyCacheForTests(): void {
  sentReport.clear();
}

export function installMissingKeyHandler(i18n: I18n): void {
  i18n.on('missingKey', (lngs, namespace, key) => {
    const lng = (Array.isArray(lngs) ? lngs[0] : lngs) ?? 'unknown';
    const dedupKey = `${lng}/${namespace}/${key}`;
    if (sentReport.has(dedupKey)) return;
    sentReport.add(dedupKey);
    try {
      capture(EVENTS.i18n_missing_key.name, { lng, ns: namespace, key });
    } catch {
      // Analytics outage must NEVER crash the runtime. The dedup Set still
      // holds the key so a retry storm can't compound.
      if (import.meta.env.DEV) {

        console.warn('[i18n] missingKey capture failed', { lng, ns: namespace, key });
      }
    }
  });
}
