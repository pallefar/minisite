/// <reference types="vitest/globals" />
import '@testing-library/jest-dom';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// jsdom does not implement window.matchMedia — required by useReducedMotion + framer-motion
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Phase 42 Plan 42-02 (POLISH-09): @axe-core/react is wired into dev mode in
// the React tree (see RESEARCH §Project Structure src/lib/a11y/axe-dev.ts —
// stub-only here; the runtime registration ships in a future a11y dev plan).
// The vitest a11y baseline gate (tests/a11y/axe-baseline.test.ts) uses the
// `axe-core` ES module directly via `axe.run(document, ...)` so no
// React-tree registration is needed at test time.

// Phase 58 — Global i18n init for tests.
//
// Components now call t('ns:key') via useTranslation(). Without an initialized
// i18next instance, t() returns the raw key string and any test that asserts
// English text fails.
//
// Strategy: create a PRIVATE i18next instance (via createInstance()) and wire
// it to react-i18next via initReactI18next. This means:
//   1. useTranslation() in components gets the real English translations.
//   2. The GLOBAL i18next singleton stays untouched, so
//      src/lib/i18n/plurals.test.ts can freely init/changeLanguage without
//      conflicting with this setup.
//   3. Two test files (LocaleOverridesModule and settings-delete-reachability)
//      use local vi.mock('react-i18next', ...) which overrides the module —
//      they are unaffected by this global setup.

function loadLocale(lang: string, ns: string): Record<string, unknown> {
  const filePath = resolve(
    __dirname,
    '../public/locales',
    lang,
    `${ns}.json`,
  );
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

// Phase 60 Plan 60-10: 'rag' namespace added for RAG citation UI components.
const NAMESPACES = ['common', 'nav', 'admin', 'onboarding', 'patient', 'settings', 'kb', 'clinic', 'rag'] as const;

const enResources: Record<string, Record<string, unknown>> = {};
const esResources: Record<string, Record<string, unknown>> = {};

for (const ns of NAMESPACES) {
  enResources[ns] = loadLocale('en', ns);
  esResources[ns] = loadLocale('es', ns);
}

// Create a private instance so we don't pollute the global i18next singleton.
// This leaves the global singleton free for plurals.test.ts (and any other
// test that calls i18next.init() directly on the singleton).
const i18nForTests = i18next.createInstance();

i18nForTests
  .use(initReactI18next)
  .init({
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: ['en', 'es'],
    ns: NAMESPACES,
    defaultNS: 'common',
    resources: {
      en: enResources,
      es: esResources,
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
