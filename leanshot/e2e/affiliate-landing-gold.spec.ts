/**
 * Phase 26 Plan 26-04 (AFFTIER-06) — affiliate landing screenshot baselines.
 *
 * Two tests:
 *   1. Standard tier (std-test-aff) renders LandingTemplateCoach
 *   2. Gold tier (gold-test-aff, with legacy template_choice='coach')
 *      renders LandingTemplateGold via the resolver's tier override.
 *
 * The Gold test includes a sanity assertion (`Premium partner` text visible)
 * BEFORE the screenshot diff so a routing regression fails fast with a
 * meaningful message rather than a 100-px-diff noise.
 *
 * Baselines live at e2e/visual/__screenshots__/affiliate-landing-gold.spec.ts/
 * per the project-wide snapshotPathTemplate in playwright.config.ts. The
 * baseline PNGs are generated on the first run after Plan 26-07 Task 4 has
 * pushed the migration that exposes `tier` on affiliates_public_view:
 *
 *     PLAYWRIGHT_RUN_P26=1 npx playwright test e2e/affiliate-landing-gold.spec.ts \
 *       --update-snapshots
 *
 * Dependencies:
 *   - VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars (fixture seed)
 *   - Plan 26-01 migrations pushed (affiliates.tier column exists)
 *   - This plan's migration pushed (view exposes `tier`)
 *   - Dev or preview server running on the baseURL configured in playwright.config.ts
 *
 * Anti-patterns avoided:
 *   - page.evaluate(seed) + reload (races supabase-js INITIAL_SESSION per
 *     [[reference_playwright_state_seeding]]) — we seed via service-role
 *     OUTSIDE the browser context in test.beforeAll.
 *   - Per-partner template assertions (D-12: shared premium variant only).
 *   - Committing failing baselines (regenerate after the migration ships).
 */
import { test, expect } from '@playwright/test';
import { seedLandingFixture } from './fixtures/affiliate-landing-seed';

test.describe('AFFTIER-06 — Affiliate landing tier variants', () => {
  let stdCode: string;
  let goldCode: string;

  test.beforeAll(async () => {
    const seed = await seedLandingFixture();
    stdCode = seed.stdCode;
    goldCode = seed.goldCode;
  });

  test('Standard tier renders Coach template baseline', async ({ page }) => {
    await page.goto(`/r/${stdCode}/landing`);
    await page.waitForLoadState('networkidle');
    // Sanity assertion BEFORE screenshot — Coach template has data-template="coach"
    await expect(page.locator('[data-template="coach"]')).toBeVisible();
    await expect(page).toHaveScreenshot('landing-standard-coach.png', { fullPage: true });
  });

  test('Gold tier renders premium template baseline (tier override)', async ({ page }) => {
    await page.goto(`/r/${goldCode}/landing`);
    await page.waitForLoadState('networkidle');
    // Sanity assertion BEFORE screenshot — fails fast if the resolver routed
    // gold-test-aff to its legacy template_choice='coach' instead of overriding.
    await expect(page.locator('[data-template="gold"]')).toBeVisible();
    await expect(page.getByText(/Premium partner/).first()).toBeVisible();
    await expect(page).toHaveScreenshot('landing-gold-premium.png', { fullPage: true });
  });
});
