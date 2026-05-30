/// <reference types="vitest/globals" />
import '@testing-library/jest-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { afterAll } from 'vitest';

// Phase 70-07 cascade-54 — flush in-flight dynamic imports before the jsdom
// environment is torn down.
//
// Admin/clinic components lazy-load chunks via React.lazy()/`await import()`
// (e.g. AdminShell → admin modules → AdminLayout → StepUpTotpPage,
// ComplianceModule → SubprocessorDiffFeed, cohort/api → rule-tree-to-sql). A
// test can complete and trigger RTL unmount while one of those imports is
// still resolving. When the import lands AFTER Vitest tears down the file's
// environment, the module runner throws an UNHANDLED
// `EnvironmentTeardownError: Cannot load '…' after the environment was torn
// down`. That fires no failed assertion but still exits the run non-zero —
// and only manifests under full-suite load (CI runs `--maxWorkers=1`, so
// files share one worker and the race is real), never when a file runs alone.
//
// Yielding to the macrotask queue a couple of times at file teardown lets any
// near-complete import settle into a live environment first. afterAll (not
// afterEach) keeps this to one flush per file — negligible cost, no per-test
// latency.
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
});

// jsdom does not implement ResizeObserver — required by Radix Command (cmdk)
// and any layout-aware primitive (framer-motion's useMeasure, etc.). Without
// this stub, SearchModal / Command.Dialog mount throws.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

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
  const filePath = resolve(__dirname, '../public/locales', lang, `${ns}.json`);
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

// Phase 60 Plan 60-10: 'rag' namespace added for RAG citation UI components.
const NAMESPACES = [
  'common',
  'nav',
  'admin',
  'onboarding',
  'patient',
  'settings',
  'kb',
  'clinic',
  'rag',
] as const;

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

i18nForTests.use(initReactI18next).init({
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
