/**
 * Phase 10 Plan 10-07 — clinic-drill-in.spec.ts
 *
 * End-to-end spec: drill in to a patient → assert all permitted sections render
 * → assert one log_clinic_view audit_logs row per visible section in DB.
 *
 * Flow:
 *   1. Seed 1 patient with full consent_scope (all 10 data types) via admin Supabase client.
 *   2. Insert synthetic injections, weights, and symptoms for the patient.
 *   3. Operator signs in and navigates to /clinic/{slug}/patient/{patient_user_id}.
 *   4. Assert ReadOnlyPatientView renders all 6 sections (chart + injections + weights
 *      + symptoms + photos + doctor_report are visible).
 *   5. Query DB audit_logs for action='section_view' WHERE org_id=orgId AND
 *      row_id starts with patient_user_id → assert 6 rows (one per section name).
 *
 * Per memory reference_playwright_state_seeding.md:
 *   Uses page.addInitScript to seed session (not evaluate + reload).
 *
 * Per memory feedback_realtime_layer_e2e_pattern.md:
 *   DB audit assertion uses admin supabase-js client directly — not UI traversal.
 *
 * Sections that trigger audit rows (D-21):
 *   chart, injections, weights, symptoms, photos, doctor_report
 *
 * Note: The ClinicDrillInPage calls log_clinic_view RPC for each mounted section.
 * The RPC's audit row uses row_id = '{target_user_id}/{section_name}' (Plan 10-04 pattern).
 *
 * Skips when SUPABASE_SERVICE_ROLE_KEY is absent (no live DB).
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

// ── Constants ──────────────────────────────────────────────────────────────────

// The 6 section names as defined by D-21 / the log_clinic_view RPC
const EXPECTED_SECTIONS = ['chart', 'injections', 'weights', 'symptoms', 'photos', 'doctor_report'];

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Count audit_logs rows for section_view events scoped to a target user.
 * Mirrors the helper in rls-log-clinic-view.test.ts.
 * row_id is encoded as '{target_user_id}/{section_name}' (Plan 10-04 pattern).
 */
async function getSectionViewAuditRows(opts: {
  orgId: string;
  targetUserId: string;
}): Promise<Array<{ row_id: string; action: string }>> {
  const admin = getAdmin();
  const since = new Date(Date.now() - 300_000).toISOString(); // last 5 min
  const { data, error } = await admin
    .from('audit_logs')
    .select('row_id, action')
    .eq('action', 'section_view')
    .eq('org_id', opts.orgId)
    .like('row_id', `${opts.targetUserId}/%`)
    .gte('timestamp', since);
  if (error) throw new Error(`getSectionViewAuditRows failed: ${error.message}`);
  return (data ?? []) as Array<{ row_id: string; action: string }>;
}

// ── Test suite ─────────────────────────────────────────────────────────────────

test.describe('@phase10 Drill-in → section render + audit rows', () => {
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
    const { operator, orgId: oid, slug, client } = await createOperatorWithOrg(`drill-${runId}`);
    operatorEmail = operator.email;
    operatorPassword = operator.password;
    orgSlug = slug;
    orgId = oid;

    // Create patient
    const patientEmail = testEmail(`drill-pat`, runId);
    const patient = await createUser({ email: patientEmail });
    patientUserId = patient.id;

    // Set a display name for assertions
    await admin.auth.admin.updateUserById(patient.id, {
      user_metadata: { display_name: 'David Lemon' },
    });

    // Invite + accept with full consent scope
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

    // Insert synthetic patient data so sections are non-empty
    const now = new Date().toISOString();
    await admin.from('injections').insert({
      user_id: patient.id,
      site: 'abdomen',
      dose_mg: 1.0,
      created_at: now,
    });
    await admin.from('weights').insert({
      user_id: patient.id,
      weight_kg: 85.5,
      recorded_at: now,
    });
    await admin.from('symptoms').insert({
      user_id: patient.id,
      name: 'nausea',
      severity: 2,
      recorded_at: now,
    });
  });

  test.afterAll(async () => {
    await cleanupClinicFixtures({
      emailPattern: `drill-${runId}`,
      slugPattern: `drill-${runId}`,
    });
    await cleanupClinicFixtures({ emailPattern: `drill-pat-${runId}` });
  });

  test('drill-in renders visible sections and writes one audit row per section', async ({ page }) => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      test.skip();
      return;
    }

    // ── Step 1: Sign in as operator via supabase-js (test-side, not UI) ─────────
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

    // ── Step 2: Seed session into browser localStorage via addInitScript ─────────
    // Project rule: use page.addInitScript (NOT evaluate + reload) to avoid
    // supabase-js INITIAL_SESSION race that wipes the seed (ref: reference_playwright_state_seeding.md).
    await page.addInitScript(
      ({ storageKey, sessionJson }: { storageKey: string; sessionJson: object }) => {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(sessionJson));
        } catch {
          // Private mode / jsdom — silently ignore
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

    // ── Step 3: Navigate directly to the drill-in URL ────────────────────────────
    await page.goto(`/clinic/${orgSlug}/patient/${patientUserId}`);

    // ── Step 4: Assert drill-in page renders (loading skeleton resolves) ─────────
    await expect(page.getByTestId('drill-in-page')).toBeVisible({ timeout: 30_000 });

    // ── Step 5: Assert ClinicContextBar and sub-bar are rendered ─────────────────
    await expect(page.getByTestId('clinic-context-bar')).toBeVisible();
    await expect(page.getByTestId('drill-in-sub-bar')).toBeVisible();

    // ── Step 6: Assert ReadOnlyPatientView rendered ───────────────────────────────
    // The page should render the read-only-patient-view shared chunk with sections.
    // We assert the presence of the ReadOnlyPatientView container.
    await expect(page.getByTestId('read-only-patient-view')).toBeVisible({ timeout: 20_000 });

    // ── Step 7: Assert each permitted section renders ─────────────────────────────
    // Full consent_scope → all 6 sections should be present.
    // Sections are rendered as data-testid="section-{name}" by ReadOnlyPatientView.
    for (const sectionName of EXPECTED_SECTIONS) {
      await expect(
        page.getByTestId(`section-${sectionName}`),
      ).toBeVisible({ timeout: 15_000 });
    }

    // ── Step 8: Wait for onSectionMount callbacks to fire and RPC calls to complete ─
    // Give the page a moment for the async log_clinic_view RPC calls to complete.
    await page.waitForTimeout(3_000);

    // ── Step 9: Assert audit_logs rows in DB (one per visible section) ───────────
    // Project rule (reference_supabase_project.md): DB-level invariant verification
    // over UI traversal (feedback_realtime_layer_e2e_pattern.md).
    const auditRows = await getSectionViewAuditRows({ orgId, targetUserId: patientUserId });

    // Extract section names from row_id = '{patientUserId}/{sectionName}'
    const auditedSections = auditRows
      .map((r) => r.row_id?.split('/')[1])
      .filter(Boolean);

    // One audit row per expected section
    for (const sectionName of EXPECTED_SECTIONS) {
      expect(auditedSections).toContain(sectionName);
    }

    // No more than one row per section (fire-once guarantee from useRef Map)
    const sectionCounts: Record<string, number> = {};
    for (const sec of auditedSections) {
      if (sec) sectionCounts[sec] = (sectionCounts[sec] ?? 0) + 1;
    }
    for (const sectionName of EXPECTED_SECTIONS) {
      expect(sectionCounts[sectionName]).toBe(1);
    }
  });
});
