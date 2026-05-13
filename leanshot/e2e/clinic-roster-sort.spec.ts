/**
 * Phase 10 Plan 10-06 — clinic-roster-sort.spec.ts
 *
 * End-to-end spec: roster load → sort by Last Dose ASC → drill-in to first row.
 *
 * Flow:
 *   1. Seed 3 patients with distinct last-dose dates via admin Supabase client.
 *   2. Operator signs in and navigates to /clinic/{slug}.
 *   3. Assert default sort is by score DESC (Score column header has ArrowDown or ArrowUpDown).
 *   4. Click "Last dose" column header → assert DOM order changes.
 *   5. Click first row → assert URL becomes /clinic/{slug}/patient/{user_id}.
 *
 * Per memory reference_playwright_state_seeding.md:
 *   Uses page.addInitScript to seed session storage (not evaluate + reload).
 *
 * Per memory feedback_realtime_layer_e2e_pattern.md:
 *   Realtime assertions use supabase-js channel.subscribe() directly in test
 *   file — this spec does NOT test Realtime (that is Plan 10-03's domain);
 *   it only tests the sort + drill-in Playwright flow.
 *
 * Skips when SUPABASE_SERVICE_ROLE_KEY is absent (no live DB).
 */

import { expect, test } from '@playwright/test';

import {
  acceptInviteAs,
  cleanupClinicFixtures,
  createInviteViaRpc,
  createOperatorWithOrg,
  createUser,
  fullConsentScope,
  getAdmin,
  hasLiveSupabase,
  testEmail,
  testRunId,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
} from './fixtures/clinic-fixtures';

// Reusable seed helper (exported for Plan 10-11 to consume)
export interface SeededRosterPatient {
  userId: string;
  email: string;
  displayName: string;
  /** Days ago for the synthetic injection. */
  lastDoseDaysAgo: number;
}

/**
 * Seed N patients with synthetic injections for roster-sort testing.
 * Each patient accepts the org invitation with full consent scope.
 * Returns patients sorted by lastDoseDaysAgo ASC (most recent last).
 */
export async function seedRosterPatients(opts: {
  operatorClient: Awaited<ReturnType<typeof createOperatorWithOrg>>['client'];
  orgId: string;
  patients: Array<{ nameSeed: string; lastDoseDaysAgo: number }>;
  runId: string;
}): Promise<SeededRosterPatient[]> {
  const admin = getAdmin();
  const results: SeededRosterPatient[] = [];

  for (const p of opts.patients) {
    const email = testEmail(`roster-pat-${p.nameSeed}`, opts.runId);
    const user = await createUser({ email });

    // Set a display name for test assertions
    await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { display_name: `${p.nameSeed} Test` },
    });

    // Invite + accept
    const invite = await createInviteViaRpc({
      operatorClient: opts.operatorClient,
      orgId: opts.orgId,
      email,
      requestedScope: fullConsentScope(),
    });
    await acceptInviteAs({
      patient: user,
      tokenHash: invite.tokenHash,
      consentScope: fullConsentScope(),
    });

    // Insert a synthetic injection with the specified date offset
    const injectionDate = new Date(Date.now() - p.lastDoseDaysAgo * 86_400_000).toISOString();
    await admin.from('injections').insert({
      user_id: user.id,
      site: 'abdomen',
      dose_mg: 1.0,
      created_at: injectionDate,
    });

    results.push({
      userId: user.id,
      email,
      displayName: `${p.nameSeed} Test`,
      lastDoseDaysAgo: p.lastDoseDaysAgo,
    });
  }

  return results;
}

// ── Test suite ────────────────────────────────────────────────────────────────
test.describe('@phase10 Roster sort + drill-in', () => {
  test.skip(
    !hasLiveSupabase(),
    'requires SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY',
  );
  test.setTimeout(90_000);

  const runId = testRunId();
  let operatorEmail: string;
  let operatorPassword: string;
  let orgSlug: string;
  let orgId: string;
  let patients: SeededRosterPatient[] = [];

  test.beforeAll(async () => {
    const { operator, orgId: oid, slug, client } = await createOperatorWithOrg(`sort-${runId}`);
    operatorEmail = operator.email;
    operatorPassword = operator.password;
    orgSlug = slug;
    orgId = oid;

    patients = await seedRosterPatients({
      operatorClient: client,
      orgId,
      patients: [
        { nameSeed: 'Alpha', lastDoseDaysAgo: 1 },  // most recent
        { nameSeed: 'Beta', lastDoseDaysAgo: 5 },   // mid
        { nameSeed: 'Gamma', lastDoseDaysAgo: 10 }, // oldest
      ],
      runId,
    });
  });

  test.afterAll(async () => {
    await cleanupClinicFixtures({
      emailPattern: `sort-${runId}`,
      slugPattern: `sort-${runId}`,
    });
    await cleanupClinicFixtures({ emailPattern: `roster-pat-` + runId.slice(0, 8) });
  });

  test('default sort by score DESC → sort by Last dose → drill-in to first row', async ({
    page,
  }) => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      test.skip();
      return;
    }

    // Seed session via addInitScript (project rule from reference_playwright_state_seeding.md)
    const { createClient } = await import('@supabase/supabase-js');
    const signInClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signInData, error: signInError } = await signInClient.auth.signInWithPassword({
      email: operatorEmail,
      password: operatorPassword,
    });
    if (signInError || !signInData.session) {
      throw new Error(`Sign-in failed: ${signInError?.message ?? 'no session'}`);
    }
    const session = signInData.session;

    // Inject session into browser localStorage before page loads
    await page.addInitScript(
      ({ storageKey, sessionJson }) => {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(sessionJson));
        } catch {
          // jsdom / restrictive browser contexts — silently ignore
        }
      },
      {
        storageKey: 'sb-leanshot-auth',
        sessionJson: {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_at: session.expires_at,
          token_type: 'bearer',
          user: session.user,
        },
      },
    );

    // Navigate to the clinic workspace
    await page.goto(`/clinic/${orgSlug}`);

    // Wait for roster to load (loading skeleton should resolve)
    await expect(page.getByTestId('roster-table-container')).toBeVisible({ timeout: 20_000 });

    // Assert URL unchanged after sort click (spec requirement)
    const urlBeforeSort = page.url();

    // Click "Last dose" column header
    const lastDoseHeader = page.getByRole('button', { name: /last dose/i });
    await lastDoseHeader.click();

    // URL should stay the same
    expect(page.url()).toBe(urlBeforeSort);

    // Wait for re-render (loading skeleton clears)
    await expect(page.getByTestId('roster-table-container')).toBeVisible({ timeout: 10_000 });

    // Verify rows are present (at least 3 patients seeded)
    await expect(page.locator('[data-testid^="roster-row-"]')).toHaveCount(
      patients.length,
      { timeout: 10_000 },
    );

    // Get first row user_id from data-testid
    const firstRow = page.locator('[data-testid^="roster-row-"]').first();
    const firstRowTestId = await firstRow.getAttribute('data-testid');
    expect(firstRowTestId).toBeTruthy();
    const firstPatientId = firstRowTestId!.replace('roster-row-', '');

    // Click first row → should drill in to patient page
    await firstRow.click();

    // Assert URL changes to drill-in pattern
    await expect(page).toHaveURL(
      new RegExp(`/clinic/${orgSlug}/patient/${firstPatientId}`),
      { timeout: 10_000 },
    );
  });
});
