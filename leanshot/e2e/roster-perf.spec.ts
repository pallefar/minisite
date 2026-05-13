/**
 * Phase 10 Plan 10-11 — roster-perf.spec.ts
 *
 * SC#5 verification: 50-patient roster renders within 2000ms on a Vercel
 * preview deploy, gated as a path-scoped PR CI check.
 *
 * Flow:
 *   beforeAll: seedOrg50() — creates 1 operator + 50 patients with 30 days
 *              of synthetic injections/weights/symptoms via Supabase admin client
 *   test:      sign in as operator → navigate to /clinic/{slug} →
 *              assert 50 roster rows visible → assert elapsed < 2000ms
 *   afterAll:  cleanupOrg50() — deletes all 51 auth.users + org
 *
 * Per memory reference_playwright_state_seeding.md:
 *   Uses page.addInitScript to seed the operator JWT into localStorage BEFORE
 *   page load (never evaluate + reload, which races supabase-js INITIAL_SESSION).
 *
 * Per memory feedback_realtime_layer_e2e_pattern.md:
 *   Realtime assertions are in Plan 10-03; this spec only tests the render path.
 *
 * Timeout: 180_000ms (3 min) — seedOrg50 is ~30-60s on free-tier Supabase.
 * Skip condition: SUPABASE_SERVICE_ROLE_KEY absent (no live DB, forks, etc.)
 */

import { expect, test } from '@playwright/test';

import { cleanupOrg50, hasLiveSupabase, seedOrg50 } from './fixtures/seed-org-50';
import type { Org50Fixture } from './fixtures/seed-org-50';

test.describe('@phase10 Roster perf SC#5 — 50-patient render < 2000ms', () => {
  test.skip(
    !hasLiveSupabase(),
    'requires SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY',
  );
  test.setTimeout(180_000);

  let fixture: Org50Fixture;

  test.beforeAll(async () => {
    fixture = await seedOrg50();
  });

  test.afterAll(async () => {
    if (fixture) {
      await cleanupOrg50(fixture);
    }
  });

  test('50-patient roster renders within 2000ms', async ({ page }) => {
    // Inject operator session into browser localStorage BEFORE page load.
    // This is the addInitScript pattern from reference_playwright_state_seeding.md —
    // evaluate() + reload() would race supabase-js INITIAL_SESSION and silently
    // wipe the seed.
    await page.addInitScript(
      ({ storageKey, sessionJson }) => {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(sessionJson));
        } catch {
          // Restrictive browser context — silently ignore
        }
      },
      {
        storageKey: fixture.storageKey,
        sessionJson: fixture.sessionJson,
      },
    );

    // Record wall-clock start before navigation
    const navStart = Date.now();

    // Navigate to the clinic roster page
    await page.goto(`/clinic/${fixture.slug}`);

    // Wait for the roster table container to appear
    await expect(page.getByTestId('roster-table-container')).toBeVisible({ timeout: 10_000 });

    // Wait until all 50 roster rows are rendered.
    // Row data-testid follows the pattern "roster-row-{userId}" (from Plan 10-06
    // RosterRow component's data-testid attribute).
    await expect(
      page.locator('[data-testid^="roster-row-"]'),
    ).toHaveCount(50, { timeout: 15_000 });

    const elapsed = Date.now() - navStart;

    // SC#5 assertion: all 50 rows must be visible within 2000ms of navigation start.
    // The 15s waitForSelector above ensures rows exist; elapsed validates the SLA.
    expect(elapsed, `Roster render took ${elapsed}ms (SC#5 limit: 2000ms)`).toBeLessThan(2000);

    // Sanity: verify the first row has the expected data-testid format
    const firstRow = page.locator('[data-testid^="roster-row-"]').first();
    const firstRowTestId = await firstRow.getAttribute('data-testid');
    expect(firstRowTestId).toMatch(/^roster-row-[0-9a-f-]{36}$/);
  });
});
