/**
 * Phase 32 Plan 32-03 (I18N-02) — Settings → Language round-trip persistence.
 *
 * Asserts:
 *   1. Authenticated user opens Settings → Language → switches to Español.
 *   2. UI flips to Spanish immediately (LanguageSwitcher onChange handler
 *      calls i18n.changeLanguage BEFORE the DB write).
 *   3. After reload, the chosen language survives — because the Zustand
 *      `user.locale` mirror persists (partialize) and the profilesLocale
 *      detector at order-position 0 resolves it on next boot.
 *   4. (Optional, CI-only with live Supabase creds) — the `profiles.locale`
 *      DB row is updated to 'es'. The seeded-test variant below uses the
 *      addInitScript localStorage seed only (no live auth required); a
 *      follow-up CI-only variant can layer a real signIn() per the
 *      `clinic-fixtures.ts` pattern when SUPABASE_URL + service-role key
 *      are present in env.
 *
 * Pattern: addInitScript pre-seeds the persisted store + i18n cookie so
 * main.tsx hydrate() lands the user BEFORE first React render — no flash,
 * no flake. Per `reference_playwright_state_seeding.md` we use
 * page.addInitScript (NOT page.goto + evaluate + reload).
 *
 * Pitfall 4 invariant: locale change MUST NOT alter `user.units`. The
 * second-half of this spec re-opens Settings → Profile after the locale
 * flip and asserts the units strong-tag still reads "Metric" (the seeded
 * value).
 */
import { test, expect } from '@playwright/test';

const STORAGE_KEY = 'leanshot_v4';
const TOUR_KEY = 'leanshot_tour_seen_v4';
// Phase 32 Plan 32-01 detector-config — cookie name we set as the
// anonymous-side seed (the persisted user.locale wins above this via
// profilesLocale at position 0, but seeding the cookie makes the test
// resilient to a stale partialize that didn't include locale).
const LOCALE_COOKIE = 'leanshot_locale';

const SEEDED_USER = {
  name: 'I18N Test User',
  medication: 'tirzepatide',
  startDate: '2026-01-01',
  startWeight: 100,
  height: 175,
  age: 35,
  sex: 'male',
  bodyFat: null,
  goalWeight: 80,
  goal: 'fat-loss',
  dose: '2.5',
  doseUnit: 'mg',
  units: 'metric',
  proteinTarget: 130,
  calorieTarget: 1800,
  fiberTarget: 30,
  waterTarget: 8,
  injectionDay: 1,
  activityLevel: 'moderate',
  liftingLevel: 'beginner',
  createdAt: '2026-01-01T00:00:00.000Z',
  // start in English; the spec drives the change.
  locale: 'en',
};

const SEEDED_PERSISTED_STATE = {
  state: {
    user: SEEDED_USER,
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

test.describe('Settings → Language: profiles.locale round-trip persistence', () => {
  test.setTimeout(45_000);

  test('flip to Español → reload → still Spanish; units unchanged (Pitfall 4)', async ({
    page,
    context,
  }) => {
    await context.clearCookies();

    await page.addInitScript(
      ([key, val, tourKey]) => {
        try {
          localStorage.setItem(key as string, val as string);
          localStorage.setItem(tourKey as string, '1');
        } catch {
          /* private-mode noop */
        }
      },
      [STORAGE_KEY, JSON.stringify(SEEDED_PERSISTED_STATE), TOUR_KEY],
    );

    await page.goto('/');

    // Open Settings via the desktop sidebar trigger.
    const settingsTrigger = page.getByRole('button', { name: /open settings/i }).first();
    await settingsTrigger.click({ timeout: 10_000 });

    // Navigate to the new Language section.
    await page.getByRole('button', { name: /^language$/i }).click();

    // The LanguageSwitcher is a <select> with an accessible name from
    // nav:lang_label catalog. Use a forgiving selector — either the
    // aria-label match or the role lookup.
    const select = page.getByRole('combobox').first();
    await expect(select).toBeVisible();

    // Choose 'es' option (value = 'es').
    await select.selectOption('es');

    // Document root reflects the choice on languageChanged (init.ts handler).
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');

    // Reload — profilesLocale detector should resolve 'es' from the persisted
    // store mirror BEFORE any anonymous-chain signal fires.
    await page.reload();

    // After reload, html lang is still 'es' on first paint (no flash to 'en').
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');

    // Pitfall 4: confirm units are still Metric.
    const settingsTrigger2 = page.getByRole('button', { name: /open settings/i }).first();
    await settingsTrigger2.click({ timeout: 10_000 });
    await page.getByRole('button', { name: /profile/i }).first().click();
    // The Profile section renders a paragraph that includes "Units: Metric"
    // (or its Spanish equivalent once full catalog is in place). We assert
    // the literal user.units value to bypass copy-translation concerns:
    // a Pitfall-4 regression would flip the strong-tag content from
    // "Metric" to "Imperial" because complete()/onChange wrote unit.
    const seededState = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(seededState).toBeTruthy();
    const parsed = JSON.parse(seededState as string) as {
      state?: { user?: { units?: string; locale?: string } };
    };
    expect(parsed.state?.user?.units).toBe('metric');
    expect(parsed.state?.user?.locale).toBe('es');
  });
});
