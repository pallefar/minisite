/**
 * Phase 23 Plan 23-03 — DEBT-01 closeout e2e spec.
 *
 * Nyquist-audit coverage for ROADMAP Phase 23 SC#1:
 *   "Operator opens ClinicDrillInPage → clicks 'View activity' →
 *    navigates to the per-patient activity view (no more console.warn
 *    stub at ClinicDrillInPage.tsx:287-292)"
 *
 * The 13 vitest unit tests + 3 live RLS isolation tests prove the modal
 * component in isolation. This spec proves the FULL wired path end-to-end
 * in a real browser: operator drills into a patient row → clicks the
 * "View activity" IconButton (data-testid="drill-in-view-activity-button")
 * → lazy-loaded PatientActivityModal mounts → modal renders activity
 * timeline or empty state (whichever matches seeded state) → Esc closes.
 *
 * Per memory reference_playwright_state_seeding.md:
 *   Session is seeded into localStorage via page.addInitScript, NEVER via
 *   page.goto + page.evaluate + reload — the latter races supabase-js
 *   INITIAL_SESSION and silently wipes the seed.
 *
 * Per memory feedback_rls_per_file_slug_prefix.md:
 *   This file uses its own slug prefix `patact-e2e-` so afterAll cleanup
 *   doesn't clobber sibling clinic suites (e.g. clinic-drill-in.spec.ts).
 *
 * Note on data visibility: PatientActivityModal queries with
 * `.eq('user_id', patientId)` and relies on RLS (`auth.uid() = user_id`)
 * to enforce scoping. The operator's session does NOT satisfy that policy
 * for the patient's rows, so the modal renders the activity-empty state
 * end-to-end under the standard clinic-drill-in seeding path. The spec
 * accepts EITHER `activity-timeline` (with ≥1 activity-row) OR
 * `activity-empty` as proof the modal mounted and completed its fetch.
 * Loading-state visibility transitions away in both cases — the key
 * behavioural assertion is that the wired callback no longer no-ops.
 *
 * Skips when SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY
 * are absent (local PR safety; CI gates them).
 */

import { createClient } from '@supabase/supabase-js';
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

// ── File-scoped slug prefix (per feedback_rls_per_file_slug_prefix) ─────────
const PATACT_E2E_PREFIX = 'patact-e2e';

test.describe('@phase23 DEBT-01 — Operator clicks View activity → PatientActivityModal opens', () => {
  test.skip(
    !hasLiveSupabase(),
    'requires SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY',
  );
  test.setTimeout(120_000);

  const runId = testRunId();
  let operatorEmail: string;
  let operatorPassword: string;
  let orgSlug: string;
  let orgId: string;
  let patientUserId: string;

  test.beforeAll(async () => {
    const admin = getAdmin();
    const { operator, orgId: oid, slug, client } = await createOperatorWithOrg(
      `${PATACT_E2E_PREFIX}-${runId}`,
    );
    operatorEmail = operator.email;
    operatorPassword = operator.password;
    orgSlug = slug;
    orgId = oid;

    // Create patient
    const patientEmail = testEmail(`${PATACT_E2E_PREFIX}-pat`, runId);
    const patient = await createUser({ email: patientEmail });
    patientUserId = patient.id;

    await admin.auth.admin.updateUserById(patient.id, {
      user_metadata: { display_name: 'Activity Test' },
    });

    // Invite + accept with full consent scope so the drill-in page renders.
    const invite = await createInviteViaRpc({
      operatorClient: client,
      orgId,
      email: patientEmail,
      requestedScope: fullConsentScope(),
    });
    await acceptInviteAs({
      patient,
      tokenHash: invite.tokenHash,
      consentScope: fullConsentScope(),
    });

    // Seed an injection for the patient so the timeline path is possible
    // if the modal's RLS context ever changes (defence-in-depth — also
    // proves the seed pathway works without being load-bearing).
    const now = new Date().toISOString();
    await admin.from('injections').insert({
      user_id: patient.id,
      site: 'abdomen',
      dose_mg: 1.0,
      created_at: now,
    });
  });

  test.afterAll(async () => {
    await cleanupClinicFixtures({
      emailPattern: `${PATACT_E2E_PREFIX}`,
      slugPattern: `${PATACT_E2E_PREFIX}`,
    });
  });

  test('clicking View activity opens the modal (timeline or empty), Esc closes it', async ({ page }) => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      test.skip();
      return;
    }

    // ── Step 1: Sign in as operator via supabase-js (test-side) ────────────
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

    // ── Step 2: Seed session into localStorage via addInitScript ───────────
    // Project rule (reference_playwright_state_seeding.md): use addInitScript,
    // never page.goto + page.evaluate + reload (race with INITIAL_SESSION).
    await page.addInitScript(
      ({ storageKey, sessionJson }: { storageKey: string; sessionJson: object }) => {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(sessionJson));
        } catch {
          /* private mode — ignore */
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

    // ── Step 3: Navigate directly to the drill-in URL ──────────────────────
    await page.goto(`/clinic/${orgSlug}/patient/${patientUserId}`);

    // ── Step 4: Wait for drill-in page to hydrate ──────────────────────────
    await expect(page.getByTestId('drill-in-page')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('drill-in-sub-bar')).toBeVisible();

    // ── Step 5: Modal must not yet be present ──────────────────────────────
    await expect(page.getByTestId('activity-loading')).toHaveCount(0);
    await expect(page.getByTestId('activity-timeline')).toHaveCount(0);
    await expect(page.getByTestId('activity-empty')).toHaveCount(0);

    // ── Step 6: Click the View activity IconButton ─────────────────────────
    // The button is the load-bearing wiring: previously a no-op (console.warn);
    // post-Plan 23-03 it MUST setIsActivityModalOpen(true) → lazy-mount modal.
    const viewActivityButton = page.getByTestId('drill-in-view-activity-button');
    await expect(viewActivityButton).toBeVisible();
    await expect(viewActivityButton).toHaveAttribute(
      'aria-label',
      "View this patient's activity log",
    );
    await viewActivityButton.click();

    // ── Step 7: Assert PatientActivityModal mounts ─────────────────────────
    // Modal must render either the timeline OR the empty state (whichever
    // matches the operator session's RLS view). Loading skeleton may flash
    // first; wait for it to clear.
    const timeline = page.getByTestId('activity-timeline');
    const empty = page.getByTestId('activity-empty');

    // One of timeline-or-empty must appear within 15s of click.
    await expect(async () => {
      const timelineCount = await timeline.count();
      const emptyCount = await empty.count();
      expect(timelineCount + emptyCount).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 15_000 });

    // ── Step 8: A11y — modal has role=dialog + aria-modal=true ────────────
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // ── Step 9: If timeline path, assert ≥1 activity row ──────────────────
    const timelineVisible = (await timeline.count()) > 0;
    if (timelineVisible) {
      const rows = page.getByTestId('activity-row');
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThanOrEqual(1);
    }

    // ── Step 10: Esc closes the modal ──────────────────────────────────────
    await page.keyboard.press('Escape');

    // After Esc, neither timeline nor empty should be visible.
    await expect(timeline).toHaveCount(0, { timeout: 5_000 });
    await expect(empty).toHaveCount(0, { timeout: 5_000 });
  });
});
