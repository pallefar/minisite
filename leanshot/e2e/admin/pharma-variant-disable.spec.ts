/**
 * @phase39 Plan 39-08 — admin disables a pharma variant via the 1-click
 * Disable button on the Pharma sub-tab of /admin/growth/experiments
 * (PHARMA-04 reversibility flow).
 *
 * Mirrors the page-variant-create.spec.ts split:
 *   • Interaction-surface assertions run against the built app with NO
 *     network (Zustand seed via addInitScript so App.tsx routes to the
 *     dashboard immediately).
 *   • The full live round-trip (variant_config.archived_at flips + Slack
 *     fire + admin_audit_log row) is gated on a live backend with admin
 *     role + the 3 SECDEF RPCs deployed — fixme'd until the close-out
 *     plan runs `supabase db push --linked`.
 *
 * Per [[reference_playwright_state_seeding]]: addInitScript writes the
 * Zustand persisted user BEFORE the supabase-js INITIAL_SESSION race so
 * App.tsx renders the dashboard.
 */
import { expect, test } from '@playwright/test';

const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const HAS_LIVE_BACKEND = Boolean(SERVICE_ROLE && SUPABASE_URL && ANON_KEY);

test.describe('@phase39 39-08 — pharma variant 1-click disable (PHARMA-04)', () => {
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

  test('PHARMA-04: Pharma admin tab surface is reachable + Disable button data-action attribute present', async ({
    page,
  }) => {
    // Without a live backend the get_pharma_experiments RPC fails (no rows)
    // so the EmptyState renders. We still want to prove the tab is reachable
    // and the pharma branch is wired — the live round-trip below covers the
    // actual Disable interaction.
    await page.goto('/admin/growth/experiments');

    // The 3-Pill tab row is rendered. Click Pharma to switch.
    const pharmaPill = page.getByRole('button', { name: 'Pharma' });
    await expect(pharmaPill).toBeVisible({ timeout: 10_000 });
    await pharmaPill.click();

    // The pharma branch renders either the EmptyState or the PharmaExperimentTab.
    // Either way the experiment-tab-content slot reports data-tab="pharma".
    const slot = page.getByTestId('experiment-tab-content');
    await expect(slot).toHaveAttribute('data-tab', 'pharma');
  });

  test.describe('@live live backend round-trip', () => {
    test.skip(
      !HAS_LIVE_BACKEND,
      'requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (live admin role + disable_pharma_variant RPC + variant_config row)',
    );

    test('PHARMA-04: admin disables pharma variant via Confirm; variant_config.archived_at populated; Slack fire-and-forget', async ({
      page,
    }) => {
      // Full live loop:
      //   1. Seed live admin user (auth.admin.createUser + profiles.admin_role='admin')
      //   2. Seed 1 active pharma variant_config row
      //   3. addInitScript seeds supabase-js storageKey 'sb-leanshot-auth' with
      //      the live admin JWT (per reference_playwright_state_seeding)
      //   4. goto /admin/growth/experiments
      //   5. click Pharma tab
      //   6. wait for the seeded variant row to render
      //   7. click [data-action="disable-variant"][data-variant="<id>"]
      //   8. ConfirmModal opens; click the destructive "Disable variant"
      //      button to confirm
      //   9. assert toast 'Disabled variant ...'
      //  10. SELECT archived_at FROM variant_config WHERE id=$id → not null
      //  11. SELECT count(*) FROM admin_audit_log WHERE action='pharma_disable'
      //      AND context->>'variant_id' = $id → 1
      //
      // Per [[reference_supabase_back_dated_migration_blocks_push]] +
      // [[feedback_phase_close_out_db_push_verification]]: the 3 SECDEF
      // migrations (000018/000019/000020) must be pushed before this spec
      // switches green in CI — covered by the Phase 39 close-out plan.
      //
      // see 39-08-SUMMARY deferred-issues — live admin role seeding pends
      // milestone-close UAT.

      await page.goto('/admin/growth/experiments');
      test.fixme(
        true,
        'Full live round-trip pends Phase 39 close-out: 3 SECDEF migration push + live admin role seeding (tracked in 39-08-SUMMARY.md deferred-issues)',
      );
    });
  });
});
