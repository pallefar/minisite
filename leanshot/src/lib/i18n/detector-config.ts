/**
 * Phase 32 Plan 32-01 — i18next-browser-languagedetector config.
 *
 * Per 32-RESEARCH Pattern 2 (lines 304-310): anonymous-visitor detection
 * chain ordered querystring > cookie > localStorage > navigator. The
 * `?lang=es` URL parameter (D-04 routing) always wins; Accept-Language /
 * `navigator.languages` is the last-resort fallback.
 *
 * Per 32-CONTEXT D-10: `load: 'languageOnly'` (set in init.ts) maps
 * `es-MX` / `es-ES` / `es-419` browser preferences to the single `es`
 * namespace.
 *
 * NOTE: A `profiles.locale` custom detector is NOT registered here. That is
 * Plan 32-03's contract — it will install an ADDITIVE detector at position 0
 * via `LanguageDetector.addDetector(...)` so the authenticated-user override
 * runs BEFORE the anonymous chain below. Keeping this module additive-safe
 * is part of the integration seam guardrail
 * (`feedback_chunked_planning_integration_seam_blindspot.md`).
 */

import type { DetectorOptions } from 'i18next-browser-languagedetector';

export const detectionOptions: DetectorOptions = {
  order: ['querystring', 'cookie', 'localStorage', 'navigator'],
  lookupQuerystring: 'lang',
  lookupCookie: 'leanshot_locale',
  lookupLocalStorage: 'leanshot_locale',
  caches: ['cookie', 'localStorage'],
  // Mirror cookie path for app-wide visibility (no clinic-slug subpath scoping).
  cookieOptions: { path: '/', sameSite: 'lax' },
};
