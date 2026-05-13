/**
 * Phase 10 Plan 10-10 — cross-tenant RLS impersonation proof for
 * `public.log_bulk_export_inclusion` SECURITY DEFINER RPC.
 *
 * Project rule from memory `reference_supabase_project.md`:
 * every new RLS surface MUST get a live cross-tenant impersonation proof —
 * not just the policy SQL. This spec covers the 4 behaviors defined in the
 * plan's <behavior> block for the RPC.
 *
 * Test matrix:
 *   1. Happy path — operator in Org 1 calls
 *      log_bulk_export_inclusion(org_1_id, patient_in_org_1, 'pdf') → succeeds,
 *      1 audit_logs row written with action='bulk_pdf_export'.
 *   2. Cross-tenant caller — operator in Org 1 calls for Org 2 → access_denied.
 *   3. Cross-tenant patient — operator in Org 1 calls for patient in Org 2 → patient_not_in_org.
 *   4. Export type: 'csv' → 'bulk_csv_export'; 'pdf' → 'bulk_pdf_export'; other → invalid_export_type.
 *
 * Skipped automatically when SUPABASE_SERVICE_ROLE_KEY is absent.
 * Pattern mirrors `e2e/rls-log-clinic-view.test.ts`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Helper: count audit_logs rows for a bulk export event in the last 60s.
// ---------------------------------------------------------------------------
async function countBulkExportAuditRows(
  admin: SupabaseClient,
  orgId: string,
  targetUserId: string,
  action: 'bulk_pdf_export' | 'bulk_csv_export',
): Promise<number> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { data, error } = await admin
    .from('audit_logs')
    .select('id')
    .eq('action', action)
    .eq('org_id', orgId)
    .eq('table_name', 'bulk_export')
    .eq('row_id', targetUserId)
    .gte('timestamp', since);
  if (error) throw error;
  return (data as unknown[]).length;
}

describeIfLive(
  'Phase 10 Plan 10-10 — cross-tenant RLS proof for log_bulk_export_inclusion',
  () => {
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
          // best-effort cleanup
        }
      }
      for (const id of createdUserIds) {
        try {
          await adminClient.auth.admin.deleteUser(id);
        } catch {
          // best-effort cleanup
        }
      }
    }, 30_000);

    it(
      'covers all 4 behaviors: happy-path pdf, cross-tenant org, cross-tenant patient, export-type enum',
      async () => {
        const admin = getAdmin();
        const ts = Date.now().toString(36);

        // ── Create 3 users ──────────────────────────────────────────────────
        // operatorA  — Owner of Org 1 (all permissions)
        // patientA   — active member of Org 1
        // outsider   — NOT a member of Org 1, used for cross-tenant patient test

        const [opARes, patARes, outRes] = await Promise.all([
          admin.auth.admin.createUser({
            email: `rls-be-opa-${ts}@leanshot.test`,
            password: `Pass1234-${ts}a`,
            email_confirm: true,
          }),
          admin.auth.admin.createUser({
            email: `rls-be-pata-${ts}@leanshot.test`,
            password: `Pass1234-${ts}b`,
            email_confirm: true,
          }),
          admin.auth.admin.createUser({
            email: `rls-be-out-${ts}@leanshot.test`,
            password: `Pass1234-${ts}c`,
            email_confirm: true,
          }),
        ]);

        expect(opARes.error).toBeNull();
        expect(patARes.error).toBeNull();
        expect(outRes.error).toBeNull();

        const opAId = opARes.data.user!.id;
        const patAId = patARes.data.user!.id;
        const outsiderId = outRes.data.user!.id;

        createdUserIds.push(opAId, patAId, outsiderId);

        // ── Create Org 1 (operatorA is owner via DB trigger) ───────────────
        const org1Res = await admin
          .from('orgs')
          .insert({ name: `rls-be-org1-${ts}`, slug: `rls-be-org1-${ts}`, owner_id: opAId })
          .select('id')
          .single();
        expect(org1Res.error).toBeNull();
        const org1Id = org1Res.data!.id as string;
        createdOrgIds.push(org1Id);

        // ── Get Owner role id for Org 1 ────────────────────────────────────
        const ownerRoleRes = await admin
          .from('roles')
          .select('id')
          .eq('org_id', org1Id)
          .eq('name', 'Owner')
          .eq('is_system', true)
          .limit(1);
        expect(ownerRoleRes.error).toBeNull();
        const ownerRoleId = (ownerRoleRes.data as Array<{ id: string }>)[0].id;

        // ── Add operatorA membership in Org 1 (Owner role) ─────────────────
        // The org trigger may auto-create membership for owner_id; upsert to be safe.
        const opAMemberRes = await admin
          .from('memberships')
          .upsert(
            {
              org_id: org1Id,
              user_id: opAId,
              role_id: ownerRoleId,
              invited_by: opAId,
              joined_at: new Date().toISOString(),
            },
            { onConflict: 'org_id,user_id' },
          );
        expect(opAMemberRes.error).toBeNull();

        // ── Add patientA as active member of Org 1 ─────────────────────────
        const patientRoleRes = await admin
          .from('roles')
          .select('id')
          .eq('org_id', org1Id)
          .eq('name', 'View-only')
          .eq('is_system', true)
          .limit(1);
        const patientRoleId = patientRoleRes.data?.length
          ? (patientRoleRes.data as Array<{ id: string }>)[0].id
          : ownerRoleId;

        const patAMemberRes = await admin.from('memberships').insert({
          org_id: org1Id,
          user_id: patAId,
          role_id: patientRoleId,
          invited_by: opAId,
          joined_at: new Date().toISOString(),
        });
        expect(patAMemberRes.error).toBeNull();

        // ── Get operator A's user client (signed-in) ───────────────────────
        const opAClient = createClient(URL!, ANON!, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const signInRes = await opAClient.auth.signInWithPassword({
          email: `rls-be-opa-${ts}@leanshot.test`,
          password: `Pass1234-${ts}a`,
        });
        expect(signInRes.error).toBeNull();

        // ── Behavior 1: happy-path pdf ─────────────────────────────────────
        const happyRes = await opAClient.rpc('log_bulk_export_inclusion', {
          p_org_id: org1Id,
          p_target_user_id: patAId,
          p_export_type: 'pdf',
        });
        expect(happyRes.error).toBeNull();

        // Verify 1 audit row was written
        const pdfRowCount = await countBulkExportAuditRows(
          admin,
          org1Id,
          patAId,
          'bulk_pdf_export',
        );
        expect(pdfRowCount).toBeGreaterThanOrEqual(1);

        // ── Behavior 2: cross-tenant org → access_denied ───────────────────
        // Create Org 2 (outsider is owner) to have a valid target org_id
        const org2Res = await admin
          .from('orgs')
          .insert({
            name: `rls-be-org2-${ts}`,
            slug: `rls-be-org2-${ts}`,
            owner_id: outsiderId,
          })
          .select('id')
          .single();
        expect(org2Res.error).toBeNull();
        const org2Id = org2Res.data!.id as string;
        createdOrgIds.push(org2Id);

        const crossTenantOrgRes = await opAClient.rpc('log_bulk_export_inclusion', {
          p_org_id: org2Id,
          p_target_user_id: patAId,
          p_export_type: 'pdf',
        });
        expect(crossTenantOrgRes.error).not.toBeNull();
        expect(crossTenantOrgRes.error?.message).toMatch(/access_denied/);

        // ── Behavior 3: cross-tenant patient → patient_not_in_org ──────────
        const crossTenantPatientRes = await opAClient.rpc('log_bulk_export_inclusion', {
          p_org_id: org1Id,
          p_target_user_id: outsiderId, // outsider is NOT in org1
          p_export_type: 'pdf',
        });
        expect(crossTenantPatientRes.error).not.toBeNull();
        expect(crossTenantPatientRes.error?.message).toMatch(/patient_not_in_org/);

        // ── Behavior 4a: csv export type writes bulk_csv_export action ──────
        const csvRes = await opAClient.rpc('log_bulk_export_inclusion', {
          p_org_id: org1Id,
          p_target_user_id: patAId,
          p_export_type: 'csv',
        });
        expect(csvRes.error).toBeNull();

        const csvRowCount = await countBulkExportAuditRows(
          admin,
          org1Id,
          patAId,
          'bulk_csv_export',
        );
        expect(csvRowCount).toBeGreaterThanOrEqual(1);

        // ── Behavior 4b: invalid export type → invalid_export_type ─────────
        const invalidTypeRes = await opAClient.rpc('log_bulk_export_inclusion', {
          p_org_id: org1Id,
          p_target_user_id: patAId,
          p_export_type: 'excel', // invalid
        });
        expect(invalidTypeRes.error).not.toBeNull();
        expect(invalidTypeRes.error?.message).toMatch(/invalid_export_type/);
      },
      60_000,
    );
  },
);
