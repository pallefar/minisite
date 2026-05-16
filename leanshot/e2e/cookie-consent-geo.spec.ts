/**
 * Phase 22 Plan 22-12 — geo-based default consent (GDPR-01 / D-07).
 *
 * The `?force_geo=eu|us` query helper (added in this plan to
 * src/components/consent/consent-config.ts) overrides the Vercel geo header
 * for deterministic test runs.
 *
 *   T1 ?force_geo=eu → Customize → Analytics toggle defaults OFF (privacy default).
 *   T2 ?force_geo=us → Customize → Analytics toggle defaults ON (CCPA opt-out).
 *
 * Pattern:
 *   - addInitScript (NOT goto+evaluate) per reference_playwright_state_seeding.md
 *     — but the query param is the primary driver; the addInitScript clears
 *     any pre-existing cc_cookie so the banner re-evaluates defaults.
 */
import { expect, test } from '@playwright/test';

async function clearConsentState(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      document.cookie = 'cc_cookie=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
      window.localStorage.removeItem('cc_cookie');
    } catch {
      /* noop */
    }
  });
}

test.describe('Phase 22 plan 22-12 — geo-default cookie consent', () => {
  test('?force_geo=eu → Analytics defaults OFF (privacy-default)', async ({ page }) => {
    await clearConsentState(page);
    await page.goto('/?force_geo=eu');

    // Open Customize panel to expose the Analytics toggle.
    const customize = page.getByRole('button', { name: /customize|customise/i }).first();
    await expect(customize).toBeVisible({ timeout: 15_000 });
    await customize.click();

    // Analytics toggle: vanilla-cookieconsent renders <input type="checkbox">
    // with name matching the category key ("analytics"). The toggle is
    // unchecked when analytics is denied.
    //
    // Wait for the preferences modal to render.
    // vanilla-cookieconsent v3 renders category toggles as
    // `<input type="checkbox" class="section__toggle" value="{category}">`
    // (NOT `name=`). Anchor by `value` + the category-toggle class so we
    // don't pick up a per-service toggle (which has `data-category="..."`).
    const analyticsToggle = page
      .locator('input.section__toggle[value="analytics"]:not([data-category])')
      .first();
    await expect(analyticsToggle).toBeAttached({ timeout: 5_000 });
    await expect(analyticsToggle).not.toBeChecked();
  });

  test('?force_geo=us → Analytics defaults ON (CCPA opt-out model)', async ({ page }) => {
    await clearConsentState(page);
    await page.goto('/?force_geo=us');

    const customize = page.getByRole('button', { name: /customize|customise/i }).first();
    await expect(customize).toBeVisible({ timeout: 15_000 });
    await customize.click();

    // vanilla-cookieconsent v3 renders category toggles as
    // `<input type="checkbox" class="section__toggle" value="{category}">`
    // (NOT `name=`). Anchor by `value` + the category-toggle class so we
    // don't pick up a per-service toggle (which has `data-category="..."`).
    const analyticsToggle = page
      .locator('input.section__toggle[value="analytics"]:not([data-category])')
      .first();
    await expect(analyticsToggle).toBeAttached({ timeout: 5_000 });
    await expect(analyticsToggle).toBeChecked();
  });
});
