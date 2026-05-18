/**
 * Phase 32 Plan 32-01 — `locale_overrides` integration seam (STUB).
 *
 * This module exists today as a no-op pass-through i18next postProcessor so
 * that `init.ts` registers it via `.use(overrideBackend)` from day one. Plan
 * 32-04 replaces the implementation (Supabase locale_overrides table merge +
 * Realtime invalidation per 32-RESEARCH Open Item #5); the init.ts call site
 * stays unchanged.
 *
 * Per `feedback_chunked_planning_integration_seam_blindspot.md`: claiming
 * the integration seam at scaffold time avoids the "nobody owns the wire"
 * blind spot — Plan 32-04 swaps the implementation, not the seam.
 *
 * TODO(Plan 32-04): replace stub with Supabase locale_overrides merge +
 * Realtime invalidation. Schema + admin "Publish" flow defined in
 * 32-RESEARCH Open Item #5.
 */

import type { PostProcessorModule } from 'i18next';

export const overrideBackend: PostProcessorModule = {
  type: 'postProcessor',
  name: 'localeOverrides',
  // Stub pass-through. Plan 32-04 will replace this body with the
  // locale_overrides table merge (deep + overwrite via addResourceBundle).
  process(value /*, key, options, translator */) {
    return value;
  },
};
