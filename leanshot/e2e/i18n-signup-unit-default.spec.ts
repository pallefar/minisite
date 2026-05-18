/**
 * Phase 32 Plan 32-03 (I18N-02 / D-12) — signup-time locale + unit-default.
 *
 * Asserts the D-12 contract at signup completion:
 *   - `Accept-Language: es-*` → user.units = 'metric' (kg) AND user.locale = 'es'
 *   - `Accept-Language: en-US` → user.units = draft choice (default 'metric')
 *                                AND user.locale = 'en'
 *   - Existing users (pre-seeded) are UNTOUCHED — no migration overwrite.
 *
 * Driver strategy: rather than walk the 8-step onboarding flow through
 * brittle Playwright clicks, we exercise the exported pure helper
 * `deriveSignupLocaleAndUnits` directly via page.evaluate(). The helper
 * is the single source of truth for the D-12 branch in BOTH the consumer
 * `OnboardingFlow` complete() AND the org-flow `OrgOnboardingFlowRenderer`
 * complete() (Plan 32-03 Task 3). Asserting the helper covers both call
 * sites.
 *
 * Full DB-level assertion (profiles.locale row written) is deferred to a
 * CI-only variant that gates on SUPABASE_URL + service-role key per the
 * existing `e2e/fixtures/clinic-fixtures.ts` pattern (Plan 32-01 SUMMARY
 * precedent — e2e specs that need live Supabase are committed today and
 * run in the next CI cycle).
 *
 * Per `reference_playwright_state_seeding.md`: addInitScript seeds locale
 * BEFORE i18next.init runs, so i18next.language resolves correctly on
 * first React paint.
 *
 * Per `reference_supabase_auth_traps.md`: we explicitly do NOT call
 * supabase.auth.signUp from this spec — the free-tier 2/hour email
 * rate-limit would block CI re-runs. The live-Supabase CI variant uses
 * admin.generateLink + /auth/v1/verify direct fetch per the 2026-05-16 fix.
 */
import { test, expect } from '@playwright/test';

test.describe('Onboarding: signup-time locale + unit-default (D-12)', () => {
  test.setTimeout(45_000);

  test('Accept-Language: es-MX → helper returns { locale: "es", units: "metric" }', async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale: 'es-MX' });
    const page = await context.newPage();

    // No seeded user — anonymous landing. Mark tour seen to avoid overlays.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('leanshot_tour_seen_v4', '1');
      } catch {
        /* noop */
      }
    });

    await page.goto('/');

    // Wait for i18next to settle on the detected language (es-MX → 'es').
    await expect(page.locator('html')).toHaveAttribute('lang', /^es/);

    // Drive the D-12 helper directly via the test seam. The helper is
    // module-exported by OnboardingFlow.tsx; we re-import via dynamic
    // import in the page context.
    const result = await page.evaluate(async () => {
      const mod = await import('/src/components/onboarding/OnboardingFlow.tsx');
      const { deriveSignupLocaleAndUnits } = mod as {
        deriveSignupLocaleAndUnits: (
          u: 'metric' | 'imperial',
        ) => { locale: 'en' | 'es'; units: 'metric' | 'imperial' };
      };
      // Pass a deliberately wrong draft (imperial) to prove D-12 forces metric for ES.
      return deriveSignupLocaleAndUnits('imperial');
    });

    expect(result).toEqual({ locale: 'es', units: 'metric' });

    await context.close();
  });

  test('Accept-Language: en-US → helper returns { locale: "en", units: draft }', async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();

    await page.addInitScript(() => {
      try {
        localStorage.setItem('leanshot_tour_seen_v4', '1');
      } catch {
        /* noop */
      }
    });

    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', /^en/);

    // EN signup preserves the user's draft choice (D-12 default-path).
    const metric = await page.evaluate(async () => {
      const mod = await import('/src/components/onboarding/OnboardingFlow.tsx');
      const { deriveSignupLocaleAndUnits } = mod as {
        deriveSignupLocaleAndUnits: (
          u: 'metric' | 'imperial',
        ) => { locale: 'en' | 'es'; units: 'metric' | 'imperial' };
      };
      return deriveSignupLocaleAndUnits('metric');
    });
    expect(metric).toEqual({ locale: 'en', units: 'metric' });

    const imperial = await page.evaluate(async () => {
      const mod = await import('/src/components/onboarding/OnboardingFlow.tsx');
      const { deriveSignupLocaleAndUnits } = mod as {
        deriveSignupLocaleAndUnits: (
          u: 'metric' | 'imperial',
        ) => { locale: 'en' | 'es'; units: 'metric' | 'imperial' };
      };
      return deriveSignupLocaleAndUnits('imperial');
    });
    expect(imperial).toEqual({ locale: 'en', units: 'imperial' });

    await context.close();
  });

  test('Existing-user invariant: pre-seeded user.units is NEVER touched by helper', async ({
    page,
  }) => {
    // Seed an existing user with units='imperial' + locale=undefined (pre-32-03 state).
    const SEEDED = {
      state: {
        user: {
          name: 'Pre-32-03 User',
          medication: 'tirzepatide',
          startDate: '2025-01-01',
          startWeight: 200,
          height: 175,
          age: 35,
          sex: 'male',
          bodyFat: null,
          goalWeight: 180,
          goal: 'fat-loss',
          dose: '2.5',
          doseUnit: 'mg',
          units: 'imperial', // <— sentinel: must survive
          proteinTarget: 160,
          calorieTarget: 2000,
          fiberTarget: 30,
          waterTarget: 8,
          injectionDay: 1,
          activityLevel: 'moderate',
          liftingLevel: 'beginner',
          createdAt: '2025-01-01T00:00:00.000Z',
          // locale intentionally absent — pre-32-03 persisted shape.
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

    await page.addInitScript(
      ([key, val, tourKey]) => {
        try {
          localStorage.setItem(key as string, val as string);
          localStorage.setItem(tourKey as string, '1');
        } catch {
          /* noop */
        }
      },
      ['leanshot_v4', JSON.stringify(SEEDED), 'leanshot_tour_seen_v4'],
    );

    await page.goto('/');

    // The existing user lands directly in the dashboard (not onboarding) —
    // the helper is signup-time-only and is never invoked. Read the
    // persisted store back and confirm units sentinel survives.
    const persisted = await page.evaluate(() => localStorage.getItem('leanshot_v4'));
    expect(persisted).toBeTruthy();
    const parsed = JSON.parse(persisted as string) as {
      state?: { user?: { units?: string; locale?: string } };
    };
    expect(parsed.state?.user?.units).toBe('imperial');
    // locale was undefined → the migration default ('en' from the DB column
    // default) only applies server-side; the local mirror remains undefined
    // until the next Settings → Language flip or a profile refetch.
    expect(parsed.state?.user?.locale).toBeUndefined();
  });
});
