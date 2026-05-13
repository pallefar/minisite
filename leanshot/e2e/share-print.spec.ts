/**
 * Phase 8 Plan 08-06 Task 1 — Print-mode e2e spec (SC#5).
 *
 * Drives the doctor read-share view under Playwright `emulateMedia({ media:
 * 'print' })` and asserts:
 *
 *   - Chart canvas is visible (Phase 3 PK-04 watermark plugin renders INTO
 *     the canvas, so the disclaimer copy survives `window.print()`).
 *   - The above-chart disclaimer banner is visible.
 *   - The print-only footer is visible AND references the opaque share_id
 *     (first 8 chars) — NEVER the patient user_id (BL-1 / D-02(c)).
 *   - The print DOM contains zero `ai_*` substrings (SC#3 carries through
 *     to print).
 *   - The reduced-motion media-query suppresses the initial-mount fade-in.
 *
 * Reuses the e2e/fixtures/shares.ts fixture (HI-6 afterAll cleanup carries
 * over from Plan 08-05 — `cleanupTestShares()` admin-DELETEs every share
 * row created by this spec). Skip-gates on the same env triple as Plans
 * 08-04 / 08-05.
 */

import { expect, test } from '@playwright/test';
import {
  cleanupTestShares,
  createTestShare,
  hasLiveSupabase,
  impersonateAsRecipient,
} from './fixtures/shares';

test.describe('@phase08 SC#5 — share print mode', () => {
  test.skip(
    !hasLiveSupabase(),
    'requires SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL + SUPABASE_ANON_KEY',
  );
  test.setTimeout(60_000);

  test.afterAll(async () => {
    // HI-6 — admin-DELETE every share row this spec created. Inherited from
    // Plan 08-05's fixture extension.
    await cleanupTestShares();
  });

  test('chart watermark survives print emulation; print footer uses opaque share_id (BL-1)', async ({
    browser,
  }) => {
    const share = await createTestShare({
      patientEmail: 'alice@test.com',
      label: 'print-watermark',
      expiresInHours: 24,
    });
    const ctx = await browser.newContext();
    // Programmatically redeem so the test skips the code-entry UI surface
    // (covered by share-happy-path.spec.ts and the drill spec already).
    await impersonateAsRecipient(ctx, share.raw_token, share.raw_code);
    const page = await ctx.newPage();
    await page.goto(`/#/share/${share.raw_token}`);

    // Wait for the rendering state — heading is present only in State C.
    await expect(page.getByRole('heading', { name: /LeanShot record/ })).toBeVisible({
      timeout: 15_000,
    });

    // Switch the page into print media — CSS @media print rules + class
    // toggles fire. This is the moment we verify SC#5 survival.
    await page.emulateMedia({ media: 'print' });

    // Chart canvas is present and visible. The watermark plugin
    // (medLevelWatermark-v2) paints "estimate, not measured serum level"
    // DIRECTLY onto the canvas in afterDraw, so the text survives print
    // regardless of CSS overrides. We assert the canvas's aria-label since
    // canvas pixels aren't queryable from Playwright.
    const chart = page.locator('canvas[aria-label*="estimate"]');
    await expect(chart).toBeVisible();

    // The above-chart disclaimer banner is visible (role="note" wraps the
    // copy). Print should NEVER strip this — verified by the absence of a
    // .no-print or print:hidden class on the banner element.
    await expect(page.getByText(/modeled estimate of medication levels/)).toBeVisible();

    // Print-only footer (UI-SPEC §"Print flow" step 4) — uses BL-1's opaque
    // share_id from /snapshot, NEVER the patient user_id.
    await expect(page.getByText(/Shared via LeanShot/)).toBeVisible();
    await expect(page.getByText(/Patient ID redacted/)).toBeVisible();
    await expect(page.getByText(`share id ${share.share_id.slice(0, 8)}`)).toBeVisible();

    // Defense in depth: the print DOM must NOT contain the full opaque
    // share_id (we only print the first 8 chars). If a refactor ever
    // pastes the full uuid into the footer this catches it.
    const html = await page.content();
    expect(html).not.toContain(share.share_id);
    // …but the 8-char prefix SHOULD be present.
    expect(html).toContain(share.share_id.slice(0, 8));

    await ctx.close();
  });

  test('SC#3 — print DOM contains zero ai_* substrings', async ({ browser }) => {
    const share = await createTestShare({
      patientEmail: 'alice@test.com',
      label: 'print-ai-exclusion',
      expiresInHours: 24,
    });
    const ctx = await browser.newContext();
    await impersonateAsRecipient(ctx, share.raw_token, share.raw_code);
    const page = await ctx.newPage();
    await page.goto(`/#/share/${share.raw_token}`);
    await expect(page.getByRole('heading', { name: /LeanShot record/ })).toBeVisible({
      timeout: 15_000,
    });

    await page.emulateMedia({ media: 'print' });

    const html = (await page.content()).toLowerCase();
    // SC#3 — no AI conversation history in the doctor view, including print.
    // Covered redundantly: chunk-level (share_snapshot_view migration),
    // unit-level (SharePage.test.tsx), and now print-DOM-level.
    expect(html).not.toMatch(/ai_/);
    expect(html).not.toMatch(/ai-history/);
    expect(html).not.toMatch(/aichat/);
    expect(html).not.toMatch(/aimessage/);

    await ctx.close();
  });

  test('reduced-motion: initial-mount fade is suppressed', async ({ browser }) => {
    const share = await createTestShare({
      patientEmail: 'alice@test.com',
      label: 'print-reduced-motion',
      expiresInHours: 24,
    });
    const ctx = await browser.newContext();
    await impersonateAsRecipient(ctx, share.raw_token, share.raw_code);
    const page = await ctx.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/#/share/${share.raw_token}`);

    // Wait for State C so we're querying the actual rendered surface, not
    // the skeleton/loading view.
    await expect(page.getByRole('heading', { name: /LeanShot record/ })).toBeVisible({
      timeout: 15_000,
    });

    const mainSection = page.locator('main, [role="main"]').first();
    await expect(mainSection).toBeVisible({ timeout: 5_000 });

    // If any animation is in flight on the main mount surface, reduced-motion
    // must collapse its duration to 0 (or 0.01ms — common shim). The repo's
    // index.css uses CSS-only transitions on share routes; this asserts
    // browser-level honoring of prefers-reduced-motion.
    const animationName = await mainSection.evaluate((el) => getComputedStyle(el).animationName);
    if (animationName !== 'none') {
      const duration = await mainSection.evaluate(
        (el) => getComputedStyle(el).animationDuration,
      );
      expect(duration === '0s' || duration === '0.01ms' || duration === '0').toBe(true);
    }

    await ctx.close();
  });
});
