/**
 * Phase 32 Plan 32-01 — i18next initialization (awaitable, lazy-imported).
 *
 * Per 32-RESEARCH Pattern 2 (lines 280-329): boots i18next with
 * HttpBackend + overrideBackend (stub) + LanguageDetector + initReactI18next
 * BEFORE first React render so `/?lang=es` paints Spanish without an EN
 * flash. main.tsx dynamic-imports this module so the i18next runtime stays
 * inside the `i18n-runtime` lazy chunk (Phase 24 manualChunks routing).
 *
 * Plugin chain order matters:
 *   .use(HttpBackend)        // primary catalog source: /locales/{lng}/{ns}.json
 *   .use(overrideBackend)    // postProcessor STUB — Plan 32-04 fills body
 *   .use(LanguageDetector)   // querystring > cookie > localStorage > navigator
 *   .use(initReactI18next)   // wires useTranslation / <Trans>
 *
 * D-10 single `es` namespace via `load: 'languageOnly'` (es-MX → es).
 * D-06 no codegen — parser + lint are the type-safety gates.
 */

import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';
import { initReactI18next } from 'react-i18next';
import { detectionOptions } from './detector-config';
import { httpBackendOptions } from './http-backend-config';
import { installMissingKeyHandler } from './missing-key-handler';
import { overrideBackend } from './override-backend';
import { DEFAULT_LOCALE, LOCALE_CHOICES } from './types';

export async function initI18n(): Promise<void> {
  if (i18next.isInitialized) return;

  await i18next
    .use(HttpBackend)
    .use(overrideBackend)
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: [...LOCALE_CHOICES],
      // D-10: 'es-MX' / 'es-419' / 'es-ES' all map to 'es'
      load: 'languageOnly',
      // Entry namespaces (always loaded). Surface-specific namespaces
      // load on-demand via useTranslation([...]) in their components.
      ns: ['common', 'nav'],
      defaultNS: 'common',
      backend: httpBackendOptions,
      detection: detectionOptions,
      // React escapes JSX text nodes; double-escaping would mangle UTF-8.
      // Plan 32-04 will explicitly enable escapeValue on the override path.
      interpolation: { escapeValue: false },
      react: { useSuspense: true, bindI18n: 'languageChanged loaded' },
      saveMissing: true,
      missingKeyNoValueFallbackToKey: false,
      parseMissingKeyHandler: import.meta.env.DEV
        ? (key: string) => `[MISSING:${key}]`
        : undefined,
    });

  installMissingKeyHandler(i18next);

  // Reflect current language on <html lang="…"> for a11y + crawlers.
  i18next.on('languageChanged', (lng: string) => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lng;
    }
  });
  if (typeof document !== 'undefined') {
    document.documentElement.lang = i18next.resolvedLanguage ?? DEFAULT_LOCALE;
  }
}
