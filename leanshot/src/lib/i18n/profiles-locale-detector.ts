/**
 * Phase 32 Plan 32-03 (I18N-02) — profilesLocale custom i18next detector.
 *
 * Read-only lookup against the Zustand store: when an authenticated user
 * has `user.locale` populated (mirrored from `profiles.locale`, default 'en'),
 * we return it and i18next resolves to that language. Otherwise we return
 * `undefined` and i18next falls through to the next detector in
 * `detection.order` (querystring > cookie > localStorage > navigator —
 * Plan 32-01 default chain).
 *
 * Wired in `init.ts` via:
 *   const ld = new LanguageDetector();
 *   ld.addDetector(profilesLocaleDetector);
 *   detection.order = ['profilesLocale', ...detector-config default chain]
 *
 * Write-back path is owned by `SettingsPage` (Plan 32-03 Task 3); the
 * `cacheUserLanguage` hook is intentionally a no-op so the detector never
 * fires a DB write on its own (Pitfall 4 — locale/unit decoupling).
 *
 * Defensive try/catch: i18next's awaited init runs BEFORE main.tsx finishes
 * Zustand hydrate, so a thrown error here would crash the first paint. Per
 * `feedback_planner_iter1_anti_patterns.md` no-hedge rule the catch is
 * deliberate — store-not-yet-hydrated is a known race, not a hidden bug.
 */
import type { CustomDetector } from 'i18next-browser-languagedetector';
import { useStore } from '@/lib/store';
import type { Locale } from './types';

export const profilesLocaleDetector: CustomDetector = {
  name: 'profilesLocale',
  lookup(): Locale | undefined {
    try {
      const state = useStore.getState();
      const locale = state.user?.locale;
      // Narrow to the Locale union. The CHECK constraint on profiles.locale
      // guarantees the DB never stores anything else, but the persisted
      // Zustand snapshot could (in theory) hold a stale value from a
      // hand-edited storage payload — defend by rejecting unknowns.
      if (locale === 'en' || locale === 'es') return locale;
      return undefined;
    } catch {
      // Store not yet hydrated, or a selector threw — fall through to the
      // next detector. Never propagate.
      return undefined;
    }
  },
  cacheUserLanguage(): void {
    // No-op: writes are owned by SettingsPage's onChange handler (one place;
    // explicit error handling + rollback). See Pitfall 4 in 32-RESEARCH.
  },
};
