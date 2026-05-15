// Phase 15 Plan 15-10 — full /pricing checkout happy path e2e.
//
// Two tests:
//   (a) editor → publish → render: staff publishes the pricing page and a
//       fresh (logged-out) visitor sees the published page at /pricing with
//       a Checkout <a> whose href carries the upgrade= deep-link.
//   (b) checkout redirect: a signed-in user clicks the monthly Checkout <a>
//       and the SPA `?upgrade=` handler reaches Stripe Checkout.
//
// Gate: skipped unless HAS_LIVE (SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL +
// SUPABASE_ANON_KEY + STRIPE_SECRET_KEY + STRIPE_PUBLIC_KEY). Mirrors the
// HAS_LIVE pattern from checkout-trial-flow.spec.ts.
//
// Memory references applied:
//   - [[reference_playwright_state_seeding]] — addInitScript ONLY for
//     localStorage seeding (NEVER goto+evaluate+reload).
//   - [[reference_supabase_auth_traps]] — admin.createUser, never public auth-email.

import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import { seedStaffAndPricingPage, type SeedPricingPageResult } from './fixtures/page-builder/seed-pricing-page';

// ─── HAS_LIVE gate ────────────────────────────────────────────────────────────
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_PUBLIC_KEY =
  process.env.STRIPE_PUBLIC_KEY ?? process.env.VITE_STRIPE_PUBLIC_KEY;

const HAS_LIVE = Boolean(
  SERVICE_ROLE && SUPABASE_URL && ANON_KEY && STRIPE_SECRET_KEY && STRIPE_PUBLIC_KEY,
);

// ─── Onboarded-user blob (so the SPA lands signed-in users on dashboard) ─────
const SEEDED_USER = {
  name: 'Pricing Checkout Test',
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
};

const SEEDED_BLOB = JSON.stringify({
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
    pendingOps: [],
    acknowledgedDisclaimer: 'v1',
  },
  version: 7,
});

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('@phase15 pricing-checkout-flow', () => {
  test.skip(!HAS_LIVE, 'requires HAS_LIVE env vars (SUPABASE + STRIPE)');
  test.setTimeout(180_000);

  let seed: SeedPricingPageResult | undefined;

  test.afterAll(async () => {
    if (seed) {
      await seed.cleanup();
    }
  });

  test.beforeAll(async () => {
    if (!HAS_LIVE) return;
    seed = await seedStaffAndPricingPage();
  });

  test('editor->publish->render: staff publishes pricing page and visitor sees it at /pricing', async ({
    browser,
  }) => {
    if (!seed) {
      test.skip(true, 'seed not available');
      return;
    }

    // Visit the rendered /pricing page in a fresh (logged-out) browser
    // context — published pages must be reachable anonymously.
    const anonContext = await browser.newContext();
    const page = await anonContext.newPage();
    try {
      const response = await page.goto('/pricing', { waitUntil: 'domcontentloaded' });
      expect(response, '/pricing should resolve').not.toBeNull();
      const status = response!.status();
      expect(status, `/pricing HTTP status (got ${status})`).toBeLessThan(400);

      // Heading text from PRICING_PAGE_BLOCKS — at minimum the page must
      // contain "Pricing" copy in the rendered HTML.
      const html = await page.content();
      expect(html).toMatch(/pricing/i);

      // The Checkout <a> must carry the upgrade= deep-link for at least one
      // plan (monthly OR yearly). The href is interpolated by render.ts from
      // the validated checkoutPlan enum (T-15-10-01 mitigation).
      const checkoutHref = await page
        .locator('a[href*="upgrade="]')
        .first()
        .getAttribute('href');
      expect(checkoutHref, 'rendered Checkout link should carry upgrade=').toBeTruthy();
      expect(checkoutHref!).toMatch(/upgrade=(plus_monthly|plus_yearly)/);
    } finally {
      await anonContext.close();
    }
  });

  test('checkout redirect: clicking the Checkout button reaches Stripe Checkout', async ({
    browser,
  }) => {
    if (!seed || !SUPABASE_URL || !SERVICE_ROLE) {
      test.skip(true, 'seed or env not available');
      return;
    }

    // Create a separate non-staff signed-in user so the e2e simulates a real
    // visitor (rather than the seeded staff user who may not need to upgrade).
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });
    const ts = Date.now();
    const buyerEmail = `pw-buyer-${ts}@leanshot.test`;
    const buyerPassword = `Pass1234-${ts}`;
    const { data: created } = await admin.auth.admin.createUser({
      email: buyerEmail,
      password: buyerPassword,
      email_confirm: true,
    });
    const buyerId = created.user?.id;

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // Seed onboarded localStorage BEFORE first JS execution.
      // NEVER goto+evaluate+reload (races supabase-js INITIAL_SESSION).
      await page.addInitScript((blob: string) => {
        try {
          if (!localStorage.getItem('leanshot_v4')) {
            localStorage.setItem('leanshot_v4', blob);
            localStorage.setItem('leanshot_tour_seen_v4', '1');
          }
        } catch {
          // private-mode noop
        }
      }, SEEDED_BLOB);

      // Sign in via the real auth view.
      await page.goto('/#/auth/signin');
      await page.getByLabel(/email/i).fill(buyerEmail);
      await page.getByLabel(/password/i).fill(buyerPassword);
      await page.getByRole('button', { name: /^sign in$/i }).click();
      await expect(page).not.toHaveURL(/#\/auth/, { timeout: 30_000 });

      // Now visit the rendered /pricing page (still signed in via session).
      await page.goto('/pricing', { waitUntil: 'domcontentloaded' });

      // Watch for the eventual Stripe Checkout redirect.
      const navigationPromise = page.waitForURL(
        /checkout\.stripe\.com|api\.stripe\.com/,
        { timeout: 60_000 },
      );

      // Click the monthly Checkout button (first upgrade= link).
      const checkoutLink = page.locator('a[href*="upgrade=plus_monthly"]').first();
      await expect(checkoutLink).toBeVisible({ timeout: 10_000 });
      await checkoutLink.click();

      // After the deep-link, the SPA's `?upgrade=` handler invokes
      // stripe-checkout/session and redirects to checkout.stripe.com.
      try {
        await navigationPromise;
        const currentUrl = page.url();
        expect(currentUrl).toMatch(/checkout\.stripe\.com|api\.stripe\.com/);
        test.info().annotations.push({
          type: 'live-result',
          description: `Redirected to Stripe Checkout: ${currentUrl.slice(0, 80)}`,
        });
      } catch {
        // Edge function may not be deployed in this environment; annotate.
        test.info().annotations.push({
          type: 'deviation',
          description:
            'Checkout redirect did not reach stripe.com — stripe-checkout Edge Function may not be deployed in this environment',
        });
        // Sanity: the SPA should not have crashed.
        await expect(page.locator('body')).toBeVisible();
        // Re-throw to surface as a fail when running under HAS_LIVE — the
        // checkpoint exists to confirm this works.
        throw new Error('Stripe Checkout redirect did not occur');
      }
    } finally {
      await context.close();
      if (buyerId) {
        try {
          await admin.auth.admin.deleteUser(buyerId);
        } catch {
          // best-effort
        }
      }
    }
  });
});
