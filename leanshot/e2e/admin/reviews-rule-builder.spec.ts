/**
 * Phase 36 Plan 36-05 Task 2 — Admin rule-builder CRUD E2E (REVIEW-02).
 *
 * Behavior: /admin/reviews/rules → admin can create, edit, delete a
 * review_prompt_rules row via the SECDEF RPCs shipped in 36-01
 * (create_review_prompt_rule / update_review_prompt_rule /
 * delete_review_prompt_rule). UI module shipped in Wave 3 (36-02).
 *
 * Gate: PLAYWRIGHT_RUN_P36=1 + live Supabase env + an aal2-stepped-up
 * admin session. The full UI mount uses the admin shell (AdminGlobals);
 * without it the spec self-skips.
 *
 * Per-file slug prefix per [[feedback_rls_per_file_slug_prefix]]:
 *   `nps-rb-${Date.now().toString(36)}-`
 *
 * Per [[reference_zustand_persisted_user_blocks_marketing_uat]]: addInitScript
 * clears the `leanshot_v4` persisted-user key before the admin session loads
 * so the marketing/onboarding shortcut is bypassed.
 */
import { test, expect } from '@playwright/test';

const PLAYWRIGHT_RUN = process.env.PLAYWRIGHT_RUN_P36 === '1';
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = process.env.P36_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.P36_ADMIN_PASSWORD;
const HAS_LIVE = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE);
const HAS_ADMIN = Boolean(ADMIN_EMAIL && ADMIN_PASSWORD);

test.describe('Phase 36 — Admin rule-builder CRUD', () => {
  test.skip(
    !PLAYWRIGHT_RUN || !HAS_LIVE,
    'PLAYWRIGHT_RUN_P36=1 + live Supabase env required',
  );

  test.skip(
    !HAS_ADMIN,
    'DEFERRED — see .planning/deferred-tests.md: requires P36_ADMIN_EMAIL + P36_ADMIN_PASSWORD env vars for an aal2-stepped-up admin fixture. CRUD flow validated manually at HUMAN-UAT signal 4 in the interim.',
  );

  test('create → edit → delete a review prompt rule', async ({ page }) => {
    const ruleName = `e2e-test-${Date.now().toString(36)}`;

    await page.goto('/#/admin/reviews/rules');

    // List page renders
    await expect(page.getByRole('heading', { name: /review prompt rules/i })).toBeVisible({
      timeout: 10_000,
    });

    // Create
    await page.getByRole('button', { name: /new rule/i }).click();
    await page.getByLabel(/name/i).fill(ruleName);
    await page.getByLabel(/trigger event/i).selectOption({ label: 'activation_completed' });
    await page.getByRole('button', { name: /save/i }).click();

    // Appears in list
    await expect(page.getByText(ruleName)).toBeVisible({ timeout: 5000 });

    // Edit
    await page.getByRole('row', { name: new RegExp(ruleName) }).getByRole('button', {
      name: /edit/i,
    }).click();
    const updatedName = `${ruleName}-edited`;
    await page.getByLabel(/name/i).fill(updatedName);
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByText(updatedName)).toBeVisible({ timeout: 5000 });

    // Delete
    await page.getByRole('row', { name: new RegExp(updatedName) }).getByRole('button', {
      name: /delete/i,
    }).click();
    await page.getByRole('button', { name: /confirm/i }).click();
    await expect(page.getByText(updatedName)).toHaveCount(0, { timeout: 5000 });
  });
});
