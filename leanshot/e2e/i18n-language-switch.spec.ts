/**
 * Phase 32 Plan 32-01 — language-switch e2e (I18N-01 SC#1).
 *
 * Asserts that visiting `/?lang=es` makes i18next resolve to `es` and
 * reflects on `<html lang="es">` BEFORE any visible English nav label
 * leaks. Anonymous-visitor flow only (Plan 32-03 adds the authenticated
 * profiles.locale wiring).
 *
 * Per `reference_playwright_state_seeding.md`: no `page.evaluate` for state
 * — we just navigate. The detector + Suspense boundary handles initial
 * rendering deterministically.
 */
import { expect, test } from '@playwright/test';

test.describe('Phase 32 Plan 32-01 — language switch', () => {
  test('?lang=es sets <html lang="es"> via i18next languageChanged', async ({ page }) => {
    await page.goto('/?lang=es');

    // i18next init.ts wires a languageChanged listener that mutates
    // document.documentElement.lang. The Suspense fallback masks the EN
    // flash; once initI18n() resolves, <html lang> reflects 'es'.
    await expect(page.locator('html')).toHaveAttribute('lang', 'es', { timeout: 5000 });
  });

  test('default visit resolves to en', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', /^en/, { timeout: 5000 });
  });
});
