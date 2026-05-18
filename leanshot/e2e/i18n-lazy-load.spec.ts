/**
 * Phase 32 Plan 32-01 — lazy-load contract e2e (I18N-03).
 *
 * Asserts that:
 *   - Cold load `/` (anonymous EN) fires `/locales/en/{common,nav}.json`
 *     but NEVER `/locales/es/*` (Spanish bundle does not download).
 *   - Visiting `/?lang=es` directly fires `/locales/es/{common,nav}.json`
 *     (the ES bundle loads on demand, not the EN one as default).
 *
 * Per the 15 kB i18n-runtime chunk ceiling (32-CONTEXT D-04 + Phase 24
 * assert-bundle-budget.sh): catalogs MUST live outside the chunk and load
 * via http-backend, not via eager `import` of locales JSON.
 */
import { expect, test } from '@playwright/test';

test.describe('Phase 32 Plan 32-01 — i18n http-backend lazy load', () => {
  test('cold load `/` fetches only EN namespaces, never ES', async ({ page }) => {
    const localeRequests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      const m = url.match(/\/locales\/(en|es)\/([^/?#]+)\.json/);
      if (m) localeRequests.push(`${m[1]}/${m[2]}`);
    });

    await page.goto('/');
    // Wait for initI18n() Promise to resolve — proxied by html[lang] being set.
    await expect(page.locator('html')).toHaveAttribute('lang', /^en/, { timeout: 5000 });

    expect(localeRequests, 'EN namespaces must load on cold visit').toEqual(
      expect.arrayContaining(['en/common', 'en/nav']),
    );
    expect(localeRequests.filter((r) => r.startsWith('es/'))).toEqual([]);
  });

  test('visiting `?lang=es` fetches ES namespaces', async ({ page }) => {
    const localeRequests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      const m = url.match(/\/locales\/(en|es)\/([^/?#]+)\.json/);
      if (m) localeRequests.push(`${m[1]}/${m[2]}`);
    });

    await page.goto('/?lang=es');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es', { timeout: 5000 });

    expect(localeRequests, 'ES namespaces must load when ?lang=es is set').toEqual(
      expect.arrayContaining(['es/common', 'es/nav']),
    );
  });
});
