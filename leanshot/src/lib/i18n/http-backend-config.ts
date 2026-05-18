/**
 * Phase 32 Plan 32-01 — i18next-http-backend config.
 *
 * Per 32-CONTEXT D-04: lazy-loaded /locales/{lng}/{ns}.json fetched from
 * Vercel-served static assets (public/locales/** in this repo). The path
 * pattern matches the Vercel anycast layout — no rewrites required.
 *
 * Plan 32-04 will replace the override seam (see override-backend.ts) but
 * leaves THIS module untouched. The http-backend stays the primary
 * source-of-truth backend.
 */

import type { HttpBackendOptions } from 'i18next-http-backend';

export const httpBackendOptions: HttpBackendOptions = {
  loadPath: '/locales/{{lng}}/{{ns}}.json',
  // Keep requests credential-less so the same /locales/* paths cache cleanly
  // across authenticated + anonymous visitors. profiles.locale wiring (Plan
  // 32-03) and override merge (Plan 32-04) flow through separate paths and
  // do not affect this static fetch.
  requestOptions: { credentials: 'omit', cache: 'default' },
};
