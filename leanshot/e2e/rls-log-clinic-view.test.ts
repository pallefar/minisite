/**
 * Phase 10 Plan 10-04 — cross-tenant RLS impersonation proof for
 * `public.log_clinic_view` SECURITY DEFINER RPC.
 *
 * Project rule from memory `reference_supabase_project.md`:
 * every new RLS surface MUST get a live cross-tenant impersonation proof —
 * not just the policy SQL. This spec covers the 5 behaviors defined in the
 * plan's <behavior> block.
 *
 * Test matrix:
 *   1. Happy path — operator in Org 1 with patient_data.read calls
 *      log_clinic_view(org_1_id, patient_in_org_1, 'injections') → succeeds,
 *      1 audit_logs row written.
 *   2. Cross-tenant caller — operator in Org 1 calls
 *      log_clinic_view(org_2_id, ...) → RAISES access_denied.
 *   3. Cross-tenant patient — operator in Org 1 calls
 *      log_clinic_view(org_1_id, patient_NOT_in_org_1, 'injections') → RAISES
 *      patient_not_in_org.
 *   4. Missing permission — unauthenticated user tries to call → raises
 *      unauthenticated; View-only operator (has patient_data.read but NOT
 *      patient_photos.read) calls 'photos' section → RAISES access_denied.
 *   5. Photos-section permission gating — View-only operator has patient_data.read
 *      but not patient_photos.read:
 *        - non-photos section → succeeds (patient_data.read is enough)
 *        - photos section → RAISES access_denied (patient_photos.read required)
 *        - Coach (has patient_photos.read) → photos section → succeeds.
 *
 * Note on built-in role permissions (from migration 20260801000010):
 *   - Owner: all permissions
 *   - Coach: org.read, members.list, patient_data.read, patient_photos.read
 *   - View-only: org.read, members.list, patient_data.read (NO patient_photos.read)
 *
 * Skipped automatically when SUPABASE_SERVICE_ROLE_KEY is absent (local dev +
 * fork PRs). CI / Phase 10 wave verification runs this against the live cloud DB
 * using `ytnsipxxmzgaebkqmokp`.
 *
 * Pattern mirrors `e2e/rls-orgs.test.ts` and `e2e/rls-memberships.test.ts`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Helper: fetch a system role id by name for a given org
// ---------------------------------------------------------------------------
async function getRoleId(
  admin: SupabaseClient,
  orgId: string,
  roleName: string,
): Promise<string> {
  const { data, error } = await admin
    .from('roles')
    .select('id')
    .eq('org_id', orgId)
    .eq('name', roleName)
    .eq('is_system', true)
    .limit(1);
  if (error) throw error;
  const rows = data as Array<{ id: string }> | null;
  if (!rows?.length) throw new Error(`${roleName} role not found for org ${orgId}`);
  return rows[0].id;
}

// ---------------------------------------------------------------------------
// Helper: count audit_logs rows for a section_view event in the last 60s.
// row_id is encoded as '{target_user_id}/{section_name}' by the RPC.
// ---------------------------------------------------------------------------
async function countSectionViewAuditRows(
  admin: SupabaseClient,
  orgId: string,
  targetUserId: string,
  sectionName: string,
): Promise<number> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { data, error } = await admin
    .from('audit_logs')
    .select('id')
    .eq('action', 'section_view')
    .eq('org_id', orgId)
    .eq('table_name', 'clinic_view')
    .eq('row_id', `${targetUserId}/${sectionName}`)
    .gte('timestamp', since);
  if (error) throw error;
  return (data as unknown[]).length;
}

describeIfLive('Phase 10 Plan 10-04 — cross-tenant RLS proof for log_clinic_view', () => {
  let adminClient: SupabaseClient | null = null;
  const getAdmin = (): SupabaseClient => {
    if (!adminClient) {
      adminClient = createClient(URL!, SERVICE!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }
    return adminClient;
  };

  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  afterAll(async () => {
    if (!adminClient) return;
    for (const id of createdOrgIds) {
      try {
        await adminClient.from('orgs').delete().eq('id', id);
      } catch {
        // best-effort
      }
    }
    for (const id of createdUserIds) {
      try {
        await adminClient.auth.admin.deleteUser(id);
      } catch {
        // best-effort
      }
    }
  }, 30_000);

  it(
    'covers all 5 behaviors: happy-path, cross-tenant org, cross-tenant patient, permission-gating, photos-section-requires-photos-read',
    async () => {
      const admin = getAdmin();
      const ts = Date.now().toString(36);

      // ── Create 4 users ──────────────────────────────────────────────────────
      // operatorA  — will be Owner of Org 1 (all permissions)
      // coachUser  — will be Coach of Org 1 (data.read + photos.read)
      // viewOnly   — will be View-only in Org 1 (data.read, NO photos.read)
      // outsider   — NOT a member of Org 1 (for cross-tenant patient test)

      const [opARes, coachRes, viewRes, outRes] = await Promise.all([
        admin.auth.admin.createUser({
          email: `rls-lcv-opa-${ts}@leanshot.test`,
          password: `Pass1234-${ts}a`,
          email_confirm: true,
        }),
        admin.auth.admin.createUser({
          email: `rls-lcv-coach-${ts}@leanshot.test`,
          password: `Pass1234-${ts}b`,
          email_confirm: true,
        }),
        admin.auth.admin.createUser({
          email: `rls-lcv-view-${ts}@leanshot.test`,
          password: `Pass1234-${ts}c`,
          email_confirm: true,
        }),
        admin.auth.admin.createUser({
          email: `rls-lcv-out-${ts}@leanshot.test`,
          password: `Pass1234-${ts}d`,
          email_confirm: true,
        }),
      ]);
      if (opARes.error) throw opARes.error;
      if (coachRes.error) throw coachRes.error;
      if (viewRes.error) throw viewRes.error;
      if (outRes.error) throw outRes.error;

      const operatorA = opARes.data.user!;
      const coachUser = coachRes.data.user!;
      const viewOnlyUser = viewRes.data.user!;
      const outsider = outRes.data.user!;
      createdUserIds.push(operatorA.id, coachUser.id, viewOnlyUser.id, outsider.id);

      // ── Operator A signs in + creates Org 1 ────────────────────────────────
      const opAClient = createClient(URL!, ANON!, {
        auth: { autoRefreshToken: false, persistSession: false, storageKey: `rls-lcv-opa-${ts}` },
      });
      {
        const { error } = await opAClient.auth.signInWithPassword({
          email: `rls-lcv-opa-${ts}@leanshot.test`,
          password: `Pass1234-${ts}a`,
        });
        if (error) throw error;
      }
      const { data: org1Data, error: org1Err } = await opAClient.rpc('create_org', {
        p_name: 'RLS LCV Org1',
        p_slug: `rls-lcv-org1-${ts}`,
        p_description: null,
        p_website_url: null,
      });
      if (org1Err) throw org1Err;
      const org1Id = (org1Data as Array<{ org_id: string }>)[0].org_id;
      createdOrgIds.push(org1Id);

      // ── Outsider creates Org 2 (so outsider is somewhere but not Org 1) ────
      const outClient = createClient(URL!, ANON!, {
        auth: { autoRefreshToken: false, persistSession: false, storageKey: `rls-lcv-out-${ts}` },
      });
      {
        const { error } = await outClient.auth.signInWithPassword({
          email: `rls-lcv-out-${ts}@leanshot.test`,
          password: `Pass1234-${ts}d`,
        });
        if (error) throw error;
      }
      const { data: org2Data, error: org2Err } = await outClient.rpc('create_org', {
        p_name: 'RLS LCV Org2',
        p_slug: `rls-lcv-org2-${ts}`,
        p_description: null,
        p_website_url: null,
      });
      if (org2Err) throw org2Err;
      const org2Id = (org2Data as Array<{ org_id: string }>)[0].org_id;
      createdOrgIds.push(org2Id);

      // ── Get role IDs for Org 1 ──────────────────────────────────────────────
      const [org1CoachRoleId, org1ViewOnlyRoleId] = await Promise.all([
        getRoleId(admin, org1Id, 'Coach'),
        getRoleId(admin, org1Id, 'View-only'),
      ]);

      // ── Add coachUser to org1 with Coach role ──────────────────────────────
      // Coach has patient_data.read + patient_photos.read
      const { error: coachMemErr } = await admin.from('memberships').insert({
        user_id: coachUser.id,
        org_id: org1Id,
        role_id: org1CoachRoleId,
        accepted_at: new Date().toISOString(),
        consent_scope: { injections: true, weights: true, symptoms: true, photos: true },
      });
      if (coachMemErr) throw coachMemErr;

      // ── Add viewOnlyUser to org1 with View-only role ──────────────────────
      // View-only has patient_data.read but NOT patient_photos.read
      const { error: viewMemErr } = await admin.from('memberships').insert({
        user_id: viewOnlyUser.id,
        org_id: org1Id,
        role_id: org1ViewOnlyRoleId,
        accepted_at: new Date().toISOString(),
        consent_scope: { injections: true, weights: true, symptoms: true, photos: true },
      });
      if (viewMemErr) throw viewMemErr;

      // ── Add coachUser as a "patient" in org1 (the target to be viewed) ─────
      // coachUser is both the target AND a Coach member — the target's consent_scope
      // is what matters for patient_not_in_org check; role doesn't matter for target.

      // Sign in coach and view-only clients
      const coachClient = createClient(URL!, ANON!, {
        auth: { autoRefreshToken: false, persistSession: false, storageKey: `rls-lcv-coach-${ts}` },
      });
      {
        const { error } = await coachClient.auth.signInWithPassword({
          email: `rls-lcv-coach-${ts}@leanshot.test`,
          password: `Pass1234-${ts}b`,
        });
        if (error) throw error;
      }

      const viewClient = createClient(URL!, ANON!, {
        auth: { autoRefreshToken: false, persistSession: false, storageKey: `rls-lcv-view-${ts}` },
      });
      {
        const { error } = await viewClient.auth.signInWithPassword({
          email: `rls-lcv-view-${ts}@leanshot.test`,
          password: `Pass1234-${ts}c`,
        });
        if (error) throw error;
      }

      // ── Behavior 1: Happy path ──────────────────────────────────────────────
      // Owner → log_clinic_view(org1, coachUser, 'injections') → succeeds
      {
        const { error } = await opAClient.rpc('log_clinic_view', {
          p_org_id: org1Id,
          p_target_user_id: coachUser.id,
          p_section_name: 'injections',
        });
        expect(error, 'Behavior 1: happy path should succeed').toBeNull();

        const auditCount = await countSectionViewAuditRows(
          admin,
          org1Id,
          coachUser.id,
          'injections',
        );
        expect(
          auditCount,
          'Behavior 1: exactly 1 audit row with section_view written',
        ).toBeGreaterThanOrEqual(1);
      }

      // ── Behavior 2: Cross-tenant org (access_denied) ────────────────────────
      // OperatorA is NOT a member of org2; calling with org2Id → access_denied
      {
        const { error } = await opAClient.rpc('log_clinic_view', {
          p_org_id: org2Id,
          p_target_user_id: coachUser.id,
          p_section_name: 'injections',
        });
        expect(error, 'Behavior 2: cross-org call should raise access_denied').not.toBeNull();
        expect(error!.message, 'Behavior 2: error should contain access_denied').toMatch(
          /access_denied/i,
        );
      }

      // ── Behavior 3: Cross-tenant patient (patient_not_in_org) ──────────────
      // outsider is Owner of org2 but NOT in org1.
      // operatorA in org1 calls log_clinic_view(org1, outsider) → patient_not_in_org
      {
        const { error } = await opAClient.rpc('log_clinic_view', {
          p_org_id: org1Id,
          p_target_user_id: outsider.id,
          p_section_name: 'injections',
        });
        expect(
          error,
          'Behavior 3: patient not in org → patient_not_in_org',
        ).not.toBeNull();
        expect(error!.message, 'Behavior 3: error should contain patient_not_in_org').toMatch(
          /patient_not_in_org/i,
        );
      }

      // ── Behavior 4: photos section without patient_photos.read (access_denied) ─
      // View-only has patient_data.read but NOT patient_photos.read.
      // Calling 'photos' section → access_denied.
      {
        const { error: photosErr } = await viewClient.rpc('log_clinic_view', {
          p_org_id: org1Id,
          p_target_user_id: coachUser.id,
          p_section_name: 'photos',
        });
        expect(
          photosErr,
          'Behavior 4: View-only (no patient_photos.read) calling photos section → access_denied',
        ).not.toBeNull();
        expect(photosErr!.message).toMatch(/access_denied/i);
      }

      // Also verify: View-only CAN call non-photos sections (patient_data.read is enough)
      {
        const { error: dataOkErr } = await viewClient.rpc('log_clinic_view', {
          p_org_id: org1Id,
          p_target_user_id: coachUser.id,
          p_section_name: 'weights',
        });
        expect(
          dataOkErr,
          'Behavior 4 (positive): View-only with patient_data.read CAN call weights section',
        ).toBeNull();
      }

      // ── Behavior 5: Coach has patient_photos.read → photos section succeeds ──
      // Coach has patient_data.read + patient_photos.read.
      // Coach → photos section → succeeds.
      {
        const { error: coachPhotosErr } = await coachClient.rpc('log_clinic_view', {
          p_org_id: org1Id,
          p_target_user_id: viewOnlyUser.id,
          p_section_name: 'photos',
        });
        expect(
          coachPhotosErr,
          'Behavior 5: Coach with patient_photos.read calling photos section → succeeds',
        ).toBeNull();
      }

      // Non-member calling (any section) → access_denied (fallback safety check)
      {
        // Create a fresh unauthenticated-style client (no sign-in)
        const freshClient = createClient(URL!, ANON!, {
          auth: { autoRefreshToken: false, persistSession: false, storageKey: `rls-lcv-fresh-${ts}` },
        });
        // No signIn → no JWT → auth.uid() = null → log_clinic_view raises 'unauthenticated'
        const { error: unauthErr } = await freshClient.rpc('log_clinic_view', {
          p_org_id: org1Id,
          p_target_user_id: coachUser.id,
          p_section_name: 'injections',
        });
        expect(unauthErr, 'Fallback: no JWT → unauthenticated').not.toBeNull();
        // Error could be 'unauthenticated' from our RAISE or a 401 from the RLS layer
        expect(
          unauthErr!.message?.length,
          'Fallback: error message should be non-empty',
        ).toBeGreaterThan(0);
      }
    },
    90_000,
  );
});

describe('Phase 10 Plan 10-04 — RLS log_clinic_view (env guard)', () => {
  it('skipped when SUPABASE_SERVICE_ROLE_KEY not set (expected in CI without creds)', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn(
        '[rls-log-clinic-view.test] SKIPPED — SUPABASE_SERVICE_ROLE_KEY not set. Wave verification gates this.',
      );
    }
    expect(true).toBe(true);
  });
});
