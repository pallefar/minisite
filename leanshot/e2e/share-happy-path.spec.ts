/**
 * Phase 8 Plan 08-04 Task 2b — share happy-path e2e spec.
 *
 * Supersedes the Plan 08-01 Wave-0 scaffold. Drives the full doctor flow
 * against the deployed Plan 08-02 Edge Function: open share link, enter
 * 6-digit code, see snapshot with all 6 section headings, assert zero
 * AI substrings in the rendered DOM.
 *
 * Skip-gates on the same env triple as Plan 05's auth specs. CI sets these
 * via repository secrets; locally export them before `npm run test:e2e`.
 *
 * State seeding: this spec talks to the live Edge Function and does NOT
 * seed localStorage, so no `page.addInitScript` is needed (the doctor view
 * is anonymous — it has no Supabase session of its own; the cookie set by
 * /share/redeem IS the auth).
 */

import { expect, test } from '@playwright/test';
import { createTestShare, hasLiveSupabase, type TestShare } from './fixtures/shares';

test.describe('@phase08 SHARE-01 / SHARE-02 / SC#3 — happy path', () => {
  test.skip(
    !hasLiveSupabase(),
    'requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY',
  );
  test.setTimeout(60_000);

  let share: TestShare;

  test.beforeAll(async () => {
    share = await createTestShare({
      label: 'Phase 8 e2e doctor',
      expiresInHours: 24,
    });
  });

  test.afterAll(async () => {
    if (share) {
      await share.admin.auth.admin.deleteUser(share.user_id).catch(() => {
        /* best-effort */
      });
    }
  });

  test('opens share link → enters code → sees snapshot', async ({ page }) => {
    await page.goto(`/#/share/${share.raw_token}`);
    // State B — code entry screen rendered after the initial /snapshot 401
    await expect(page.getByText('Enter the 6-digit code')).toBeVisible();
    // Auto-submit fires when 6 digits are entered
    await page.getByLabel('6-digit access code').fill(share.raw_code);
    // State C — patient snapshot rendered after /redeem 200 + /snapshot 200
    await expect(page.getByRole('heading', { name: /LeanShot record/ })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('snapshot renders all 6 verbatim UI-SPEC section headings', async ({ page }) => {
    await page.goto(`/#/share/${share.raw_token}`);
    await page.getByLabel('6-digit access code').fill(share.raw_code);
    await expect(page.getByRole('heading', { name: /LeanShot record/ })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('heading', { name: 'Drug-level estimate' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent injections' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Symptoms' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Body photos' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Weight log' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Doctor report' })).toBeVisible();
  });

  test('SC#3 — DOM has zero AI-history substrings', async ({ page }) => {
    await page.goto(`/#/share/${share.raw_token}`);
    await page.getByLabel('6-digit access code').fill(share.raw_code);
    await expect(page.getByRole('heading', { name: /LeanShot record/ })).toBeVisible({
      timeout: 15_000,
    });
    const html = (await page.content()).toLowerCase();
    expect(html).not.toMatch(/ai_/);
    expect(html).not.toMatch(/ai-history/);
    expect(html).not.toMatch(/aichat/);
    expect(html).not.toMatch(/aimessage/);
  });
});
