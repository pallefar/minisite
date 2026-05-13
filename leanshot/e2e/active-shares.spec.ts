// Phase 8 Plan 08-03 Task 2 — Active shares patient flow e2e.
//
// Three Playwright tests covering the SHARE-01 + SHARE-05 critical path:
//   1. Empty state on first visit (no shares ever created).
//   2. Happy path: open Settings → Active shares → Create share modal →
//      submit form → see post-creation state with link + code → close →
//      see active-shares row → Revoke via typed-confirm → row disappears.
//   3. Copy buttons trigger their respective toasts and call the clipboard.
//
// Skip-gates on SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL +
// VITE_SUPABASE_ANON_KEY (Phase 5 fixture pattern from
// auth-signup-verify-signin.spec.ts / account-delete.spec.ts).
//
// State seeding rule (memory `reference_playwright_state_seeding.md`):
// localStorage seed MUST happen via `page.addInitScript` BEFORE first JS
// execution. The "goto + evaluate + reload" pattern races supabase-js
// INITIAL_SESSION(null) against the seed write.

import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const HAS_LIVE = Boolean(SERVICE_ROLE && SUPABASE_URL && ANON_KEY);

const SEEDED_USER = {
  name: 'Active Shares Test',
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
    migration_state: {
      startedAt: '2026-01-01T00:00:00Z',
      complete: true,
      snapshotKey: 'leanshot_v4_pre_cloud_backup',
      photos: 'complete',
      injections: 'complete',
      weights: 'complete',
      meals: 'complete',
      workouts: 'complete',
      supplements: 'complete',
      mood: 'complete',
      sleep: 'complete',
      symptoms: 'complete',
      vials: 'complete',
      settings: 'complete',
    },
  },
  version: 7,
});

test.describe('@phase08 active-shares — patient happy path', () => {
  test.skip(
    !HAS_LIVE,
    'requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY',
  );
  test.setTimeout(120_000);

  const email = `pw-shares-${Date.now()}@leanshot.test`;
  const password = `Pass1234-${Date.now()}`;
  let userId: string | undefined;

  test.afterAll(async () => {
    if (!SERVICE_ROLE || !SUPABASE_URL) return;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });
    if (userId) {
      try {
        await admin.auth.admin.deleteUser(userId);
      } catch {
        /* best-effort */
      }
    }
  });

  test.beforeEach(async ({ page }) => {
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, {
      auth: { persistSession: false },
    });
    if (!userId) {
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(created.error).toBeNull();
      userId = created.data.user?.id;
      expect(userId).toBeTruthy();
    }

    // Seed Zustand state BEFORE first JS execution (memory
    // reference_playwright_state_seeding.md). The post-signin namespace
    // rename (leanshot_v4 → leanshot_v4:<hash>) is handled by the "if empty"
    // guard so this is idempotent across nav.
    await page.addInitScript((blob: string) => {
      try {
        if (!localStorage.getItem('leanshot_v4')) {
          localStorage.setItem('leanshot_v4', blob);
          localStorage.setItem('leanshot_tour_seen_v4', '1');
        }
      } catch {
        /* private-mode noop */
      }
    }, SEEDED_BLOB);

    await page.goto('/#/auth/signin');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page).not.toHaveURL(/#\/auth/, { timeout: 30_000 });

    // Migration modal may auto-dismiss; click "Continue to dashboard" if
    // present (best-effort).
    const continueBtn = page.getByRole('button', { name: /continue to dashboard/i });
    try {
      await continueBtn.waitFor({ state: 'visible', timeout: 5_000 });
      await continueBtn.click();
    } catch {
      /* no migration modal — already on dashboard */
    }
  });

  test('empty state on first visit', async ({ page }) => {
    await page
      .getByRole('button', { name: /open settings/i })
      .first()
      .click({ timeout: 30_000 });
    await page.getByRole('button', { name: /^Active shares$/i }).click();

    await expect(
      page.getByRole('heading', { name: /^No active shares$/i }),
    ).toBeVisible();
    await expect(
      page.getByText(
        /When you share your data with a doctor, the link and code will appear here so you can revoke it later\./i,
      ),
    ).toBeVisible();
  });

  test('create share → see row → revoke via typed-confirm → row disappears', async ({
    page,
  }) => {
    await page
      .getByRole('button', { name: /open settings/i })
      .first()
      .click({ timeout: 30_000 });
    await page.getByRole('button', { name: /^Active shares$/i }).click();
    await expect(
      page.getByRole('heading', { name: /^No active shares$/i }),
    ).toBeVisible();

    // Open Create share modal.
    await page
      .getByRole('button', { name: /^Create share link$/i })
      .first()
      .click();
    await page.getByLabel(/Who is this for\?/i).fill('Dr. Smith — Q2 review');
    // Default 7-day radio is selected; submit.
    await page.getByRole('button', { name: /^Generate share$/i }).click();

    // Post-creation state.
    await expect(page.getByRole('heading', { name: /^Share ready$/i })).toBeVisible({
      timeout: 15_000,
    });
    // Link + Code copy buttons are present.
    await expect(page.getByRole('button', { name: /^Copy link$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Copy code$/i })).toBeVisible();
    await page.getByRole('button', { name: /^Done$/i }).click();

    // Active-shares row appears.
    const row = page.locator('li', { hasText: 'Dr. Smith — Q2 review' });
    await expect(row).toBeVisible();

    // Revoke via typed-confirm.
    await row.getByRole('button', { name: /Revoke share for Dr\. Smith/i }).click();
    await expect(
      page.getByRole('heading', { name: /^Revoke this share\?$/i }),
    ).toBeVisible();

    // Destructive button starts disabled.
    const revokeBtn = page.getByRole('button', { name: /^Revoke share$/i });
    await expect(revokeBtn).toBeDisabled();

    await page.getByLabel(/Type Dr\. Smith.*to revoke/i).fill('dr. smith — q2 review');
    await expect(revokeBtn).toBeEnabled();
    await revokeBtn.click();

    // Toast surfaces + row disappears.
    await expect(
      page.getByText(/Share revoked\. Doctor's page is now disabled\./i),
    ).toBeVisible();
    await expect(row).toHaveCount(0);
  });

  test('copy buttons trigger toasts', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page
      .getByRole('button', { name: /open settings/i })
      .first()
      .click({ timeout: 30_000 });
    await page.getByRole('button', { name: /^Active shares$/i }).click();
    await page
      .getByRole('button', { name: /^Create share link$/i })
      .first()
      .click();
    await page.getByLabel(/Who is this for\?/i).fill('Copy Test');
    await page.getByRole('button', { name: /^Generate share$/i }).click();
    await expect(page.getByRole('heading', { name: /^Share ready$/i })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: /^Copy link$/i }).click();
    await expect(page.getByText(/^Link copied$/i)).toBeVisible();

    await page.getByRole('button', { name: /^Copy code$/i }).click();
    await expect(page.getByText(/^Code copied$/i)).toBeVisible();
  });
});
