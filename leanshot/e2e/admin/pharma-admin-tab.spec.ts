/**
 * @phase39 Plan 39-08 — admin views the Pharma sub-tab and observes the
 * difference between an ACTIVE and an ARCHIVED variant
 * (PHARMA-03 + PHARMA-08 admin metrics + lifecycle visibility).
 *
 * Split per page-variant-create.spec.ts:
 *   • Interaction surface — pharma tab reachable, data-tab attribute flips
 *   • Live round-trip (2 seeded variants — 1 active + 1 archived) fixme'd
 *     until Phase 39 close-out deploys the SECDEF migrations.
 */
import { expect, test } from '@playwright/test';

const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const HAS_LIVE_BACKEND = Boolean(SERVICE_ROLE && SUPABASE_URL && ANON_KEY);

test.describe('@phase39 39-08 — Pharma admin tab renders active + archived rows', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const persisted = {
        state: {
          user: {
            id: 'pw-test-admin',
            name: 'Test Admin',
            sex: 'female',
            heightCm: 170,
            startWeightKg: 80,
            goalWeightKg: 70,
            medication: 'tirzepatide',
            startDose: 2.5,
            currentDose: 5,
            doseSchedule: 'weekly',
            createdAt: new Date().toISOString(),
          },
          acknowledgedDisclaimer: 'v1',
        },
        version: 1,
      };
      window.localStorage.setItem('leanshot_v4', JSON.stringify(persisted));
    });
  });

  test('PHARMA-08: Pharma tab pill is reachable + experiment-tab-content data-tab flips to "pharma"', async ({
    page,
  }) => {
    await page.goto('/admin/growth/experiments');

    const pharmaPill = page.getByRole('button', { name: 'Pharma' });
    await expect(pharmaPill).toBeVisible({ timeout: 10_000 });
    await pharmaPill.click();

    const slot = page.getByTestId('experiment-tab-content');
    await expect(slot).toHaveAttribute('data-tab', 'pharma');
  });

  test.describe('@live live backend round-trip', () => {
    test.skip(
      !HAS_LIVE_BACKEND,
      'requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (live admin role + 2 seeded pharma variant_config rows)',
    );

    test('PHARMA-08: 2 pharma variants (1 active, 1 archived) → both rows render; archived has muted styling + no Disable button', async ({
      page,
    }) => {
      // Full live loop:
      //   1. Seed live admin user (profiles.admin_role='admin')
      //   2. Seed 2 pharma variant_config rows (active + archived)
      //   3. addInitScript seeds supabase-js storageKey 'sb-leanshot-auth'
      //      with the live admin JWT
      //   4. goto /admin/growth/experiments
      //   5. click Pharma tab
      //   6. assert both rows render (variant_name visible)
      //   7. assert the archived row carries the 'Disabled' badge
      //   8. assert the archived row has no [data-action="disable-variant"]
      //   9. assert the active row HAS [data-action="disable-variant"]
      //  10. assert the page does NOT make a 'get_experiment_results' RPC
      //      call with surface='pharma' (Plan 39-08 contract — pharma uses
      //      its dedicated get_pharma_experiments RPC)

      await page.goto('/admin/growth/experiments');
      // see deferred-tests.md#phase-39-pharma-variant-live-orchestrator
      test.fixme(
        true,
        'Full live round-trip pends Phase 39 close-out: 3 SECDEF migration push + live admin role + 2-variant seed (tracked in 39-08-SUMMARY.md deferred-issues)',
      );
    });
  });
});
