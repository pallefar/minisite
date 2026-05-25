/**
 * Phase 58 Plan 58-01 (I18N-15) — ES smoke: critical patient flow in Spanish.
 *
 * RED scaffold: test.fixme() placeholders for each I18N-15 flow step.
 * Real ES string assertions are wired by Wave-4 plan 58-08 after all
 * namespaces are keyed (onboarding, patient, settings, kb, clinic).
 *
 * Opt-in via: PLAYWRIGHT_RUN_ES_SMOKE=1 npx playwright test --project=p58-es-smoke
 *
 * Consumer surface has NO router (see CLAUDE.md + ARCHITECTURE.md).
 * Navigation must use Zustand tab clicks — never navigate to /dashboard,
 * /medication, /settings, /kb etc. as URL routes. Entry point is
 * `/?lang=es` only, which triggers i18next-browser-languagedetector.
 *
 * Pattern: addInitScript seeds localStorage so main.tsx hydrate() lands
 * an onboarded user BEFORE first React render (no onboarding flash, no
 * auth required). Mirrors e2e/i18n-profile-locale-persistence.spec.ts.
 */
import { test, expect } from '@playwright/test';

// Opt-in gate — mirrors the playwright.config.ts project condition.
// test.skip() inside the describe block fires before any test body runs,
// so even fixme() placeholder tests are skipped when the env var is absent.
const ES_SMOKE_OPT_IN = process.env.PLAYWRIGHT_RUN_ES_SMOKE === '1';

const STORAGE_KEY = 'leanshot_v4';
const TOUR_KEY = 'leanshot_tour_seen_v4';

// Minimal onboarded user state for tab-navigation smoke.
// Mirrors the SEEDED_PERSISTED_STATE shape from i18n-profile-locale-persistence.spec.ts.
// locale: 'es' ensures the profilesLocale detector resolves Spanish on hydration.
const SMOKE_STATE = {
  state: {
    user: {
      name: 'ES Smoke User',
      medication: 'semaglutide',
      startDate: '2026-01-01',
      startWeight: 90,
      height: 170,
      age: 40,
      sex: 'female',
      bodyFat: null,
      goalWeight: 75,
      goal: 'fat-loss',
      dose: '0.25',
      doseUnit: 'mg',
      units: 'metric',
      proteinTarget: 120,
      calorieTarget: 1600,
      fiberTarget: 25,
      waterTarget: 8,
      injectionDay: 3,
      activityLevel: 'light',
      liftingLevel: 'beginner',
      createdAt: '2026-01-01T00:00:00.000Z',
      locale: 'es',
    },
    injections: [],
    symptoms: [],
    weights: [],
    measurements: [],
    meals: [],
    water: {},
    foodNoise: {},
    workouts: [],
    steps: {},
    supplements: {},
    mood: [],
    sleep: [],
    nsvs: [],
    photos: [],
    vials: [],
    aiHistory: [],
    costs: [],
    acknowledgedDisclaimer: 'v1',
    pendingOps: [],
    verificationBannerDismissedUntil: null,
    migration_state: null,
  },
  version: 7,
};

test.describe('Phase 58 — ES smoke: critical patient flow in Spanish', () => {
  // Skip entire describe block when not running under the p58-es-smoke project.
  // This is the primary guard — test.fixme() placeholders inside still need
  // the describe-level skip so they don't accidentally execute under chromium.
  test.skip(!ES_SMOKE_OPT_IN, 'opt-in via PLAYWRIGHT_RUN_ES_SMOKE=1 --project=p58-es-smoke');

  test.beforeEach(async ({ page }) => {
    // Seed an onboarded user + dismiss the guided tour so specs start on the
    // dashboard without a tour overlay blocking tab navigation.
    await page.addInitScript(
      ([storageKey, state, tourKey]: [string, string, string]) => {
        try {
          localStorage.setItem(storageKey, state);
          localStorage.setItem(tourKey, '1');
        } catch {
          /* private-mode noop */
        }
      },
      [STORAGE_KEY, JSON.stringify(SMOKE_STATE), TOUR_KEY],
    );
  });

  // ── Flow 1: Onboarding renders Spanish ────────────────────────────────────
  // Verifies I18N-15 SC#1: a fresh (non-seeded) visitor sees the onboarding
  // surface in Spanish when ?lang=es is set.
  // Wire assertion in 58-08: check an onboarding.json key renders ES text
  // (e.g. the CTA button or step title) and NOT the EN fallthrough.
  test.fixme(
    'onboarding surface renders Spanish strings (I18N-15 SC#1 — wire in 58-08)',
    async ({ page }) => {
      // Navigate to entry point WITHOUT the seeded state to hit the onboarding flow.
      await page.goto('/?lang=es');
      await expect(page.locator('html')).toHaveAttribute('lang', 'es', { timeout: 5000 });
      // TODO(58-08): assert a specific ES string from onboarding.json
      // e.g. await expect(page.getByText(/Comenzar/i)).toBeVisible();
    },
  );

  // ── Flow 2: Dose-log tab renders Spanish ──────────────────────────────────
  // Verifies I18N-15 SC#2: the Medication tab clinical strings render in ES.
  // Wire assertion in 58-08: after seeding + ?lang=es, click to Medication tab
  // and assert patient.json clinical strings (dose titles, site labels, etc.)
  test.fixme(
    'dose-log (Medication tab) renders Spanish clinical strings (I18N-15 SC#2 — wire in 58-08)',
    async ({ page }) => {
      await page.goto('/?lang=es');
      await expect(page.locator('html')).toHaveAttribute('lang', 'es', { timeout: 5000 });
      // TODO(58-08): click Medication tab via Zustand tab switcher
      // e.g. await page.getByRole('button', { name: /medicación/i }).click();
      // assert patient.json key renders e.g. "Dosis actual"
    },
  );

  // ── Flow 3: AI chat panel renders Spanish ─────────────────────────────────
  // Verifies I18N-15 SC#3: the AI coach panel strings render in ES.
  // Wire assertion in 58-08: open AIChatPanel + assert patient.json AI strings.
  test.fixme(
    'AI chat panel renders Spanish strings (I18N-15 SC#3 — wire in 58-08)',
    async ({ page }) => {
      await page.goto('/?lang=es');
      await expect(page.locator('html')).toHaveAttribute('lang', 'es', { timeout: 5000 });
      // TODO(58-08): open AI panel + assert patient.json AI copy in ES
    },
  );

  // ── Flow 4: Cancellation flow renders Spanish ─────────────────────────────
  // Verifies I18N-15 SC#4: the cancellation modal strings render in ES.
  // Wire assertion in 58-08: open Settings → Cancellation + assert settings.json strings.
  test.fixme(
    'cancellation flow renders Spanish strings (I18N-15 SC#4 — wire in 58-08)',
    async ({ page }) => {
      await page.goto('/?lang=es');
      await expect(page.locator('html')).toHaveAttribute('lang', 'es', { timeout: 5000 });
      // TODO(58-08): open Settings drawer → cancellation modal
      // assert settings.json cancellation copy in ES
    },
  );

  // ── Flow 5: KB search renders Spanish ─────────────────────────────────────
  // Verifies I18N-15 SC#5: KB search + article titles render in ES.
  // Wire assertion in 58-08: open KB tab + assert kb.json strings + ES article titles.
  test.fixme(
    'KB search renders Spanish article results (I18N-15 SC#5 — wire in 58-08)',
    async ({ page }) => {
      await page.goto('/?lang=es');
      await expect(page.locator('html')).toHaveAttribute('lang', 'es', { timeout: 5000 });
      // TODO(58-08): navigate to KB tab via Zustand tab click
      // assert kb.json key renders in ES + kb_articles.title_es appears in results
    },
  );
});
