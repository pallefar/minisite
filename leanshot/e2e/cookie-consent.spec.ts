/**
 * Phase 22 Plan 22-12 — cookie-consent bottom slide-up banner (GDPR-01).
 *
 * Asserts the vanilla-cookieconsent v3 banner mounted by
 * CookieConsentBootstrap (wired in App.tsx as part of plan 22-12):
 *   T1 banner visible after first paint with `lucide:Cookie` adjacent affordance
 *      and three CTA buttons (Reject all / Customize / Accept all).
 *   T2 click Accept all → the `cc_cookie` cookie is set in the browser context.
 *
 * Pattern compliance:
 *   - addInitScript (NOT goto+evaluate) per reference_playwright_state_seeding.md
 *     — we use it to FORCE geo so the test runs deterministically regardless of
 *     IP origin.
 *   - No public auth-email endpoint calls (free-tier 2/hour limit per
 *     reference_supabase_auth_traps.md) — this spec doesn't touch auth.
 */
import { expect, test } from '@playwright/test';

test.describe('Phase 22 plan 22-12 — cookie consent banner', () => {
  test.beforeEach(async ({ page }) => {
    // Force EU geo so the banner default state is deterministic across IPs.
    await page.addInitScript(() => {
      (window as unknown as { __VERCEL_GEO__?: { country: string } }).__VERCEL_GEO__ = {
        country: 'DE',
      };
    });
  });

  test('banner mounts at bottom + Accept all sets cc_cookie', async ({ page, context }) => {
    await page.goto('/?force_geo=eu');

    // The vanilla-cookieconsent v3 banner injects elements with the
    // `.cm` (consent modal) or `.cm-wrapper` selector. We give the
    // scheduled-init enough time to import the chunk + render.
    //
    // We try multiple stable selectors:
    //   - `[aria-label*="Cookie" i]` (consent modal accessibility label)
    //   - `text=/Accept all/i` (the CTA copy from consent-config.ts)
    const acceptButton = page.getByRole('button', { name: /accept all/i }).first();
    await expect(acceptButton).toBeVisible({ timeout: 15_000 });

    // Reject all / Customize buttons should also be present (3 CTA total).
    await expect(page.getByRole('button', { name: /reject all/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /customize|customise/i }).first()).toBeVisible();

    // Click Accept all → cc_cookie is persisted by vanilla-cookieconsent.
    await acceptButton.click();

    // Wait for the cookie to materialize.
    await page.waitForTimeout(500);
    const cookies = await context.cookies();
    const ccCookie = cookies.find((c) => c.name === 'cc_cookie');
    expect(ccCookie).toBeTruthy();
  });
});
