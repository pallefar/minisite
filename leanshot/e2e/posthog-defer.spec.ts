/**
 * Phase 22 Plan 22-12 — PostHog defer-until-consent gate (GDPR-02).
 *
 *   T1 page.goto('/') → window.posthog === undefined before any consent
 *      decision is made (analytics dynamic import gated on
 *      `acceptedCategory('analytics')`).
 *   T2 click Accept all → wait for analytics dynamic-import → window.posthog
 *      becomes defined.
 *
 * Pattern: addInitScript to FORCE the EU geo (so analytics defaults OFF and
 * the gate is meaningful) + clear cc_cookie so the banner re-prompts.
 */
import { expect, test } from '@playwright/test';

// Posthog SDK only loads when VITE_POSTHOG_KEY is configured. Without it
// the analytics.ts initAnalytics() early-returns (avoiding bogus /array
// + /flags requests). That is correct production behavior — but means
// the "window.posthog becomes defined" assertion is only meaningful when
// the key is present. Skip-gate accordingly.
const HAS_POSTHOG = Boolean(process.env.VITE_POSTHOG_KEY ?? process.env.POSTHOG_KEY);

test.describe('Phase 22 plan 22-12 — PostHog defer-until-consent', () => {
  test.skip(!HAS_POSTHOG, 'Skipped — VITE_POSTHOG_KEY not set (initAnalytics early-returns without it)');

  test('window.posthog is undefined before Accept; defined after', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        document.cookie = 'cc_cookie=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
        window.localStorage.removeItem('cc_cookie');
      } catch {
        /* noop */
      }
      (window as unknown as { __VERCEL_GEO__?: { country: string } }).__VERCEL_GEO__ = {
        country: 'DE',
      };
    });

    await page.goto('/?force_geo=eu');

    // Banner should appear; analytics SDK should NOT have loaded yet because
    // EU default = analytics denied + no Accept yet.
    const acceptAll = page.getByRole('button', { name: /accept all/i }).first();
    await expect(acceptAll).toBeVisible({ timeout: 15_000 });

    const posthogBeforeAccept = await page.evaluate(
      () => typeof (window as unknown as { posthog?: unknown }).posthog,
    );
    expect(posthogBeforeAccept).toBe('undefined');

    // Accept all → onConsent callback runs → telemetry-defer dynamically
    // imports posthog-js. Allow a generous timeout for the chunk to land.
    await acceptAll.click();

    await expect
      .poll(
        () =>
          page.evaluate(
            () => typeof (window as unknown as { posthog?: unknown }).posthog,
          ),
        { timeout: 15_000, intervals: [500, 1_000, 2_000] },
      )
      .not.toBe('undefined');
  });
});
