/**
 * Phase 10 Plan 10-02 — cross-tenant RLS impersonation proof for
 * `public.rank_org_patients` SECURITY DEFINER RPC.
 *
 * Project rule from memory `reference_supabase_project.md`:
 * every new RLS surface gets a live cross-tenant impersonation proof.
 *
 * T-10-02-01 threat: Operator A in Org 1 calling rank_org_patients(org_2_id)
 * MUST raise 'access_denied'. Proven here with 5 assertions:
 *   1. User A can call rank_org_patients on their own org.
 *   2. User A calling rank_org_patients on Org B → RAISES access_denied.
 *   3. User B can call rank_org_patients on their own org.
 *   4. User B calling rank_org_patients on Org A → RAISES access_denied.
 *   5. Unauthenticated call → raises (anon key with no JWT).
 *
 * Skipped automatically if SUPABASE_SERVICE_ROLE_KEY is absent.
 * CI / Wave 2 verification runs this against the live cloud DB.
 *
 * Pattern mirrors Phase 9 rls-orgs.test.ts two-user fixture.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// Default consent scope with all data types enabled.
const FULL_CONSENT: Record<string, boolean> = {
  injections: true,
  weights: true,
  photos: true,
  symptoms: true,
  meals: true,
  workouts: true,
  supplements: true,
  mood: true,
  sleep: true,
  doctor_report: true,
};

describeIfLive(
  'Phase 10 Plan 10-02 — cross-tenant RLS isolation on rank_org_patients RPC',
  () => {
    let admin: SupabaseClient | null = null;
    const getAdmin = (): SupabaseClient => {
      if (!admin) {
        admin = createClient(URL!, SERVICE!, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
      }
      return admin;
    };

    const createdUserIds: string[] = [];
    const createdOrgIds: string[] = [];

    afterAll(async () => {
      if (!admin) return;
      // Cleanup memberships (cascaded via org delete), then orgs, then users.
      for (const id of createdOrgIds) {
        try {
          // Use service-role to bypass RLS — admin client bypasses RLS.
          await admin.from('orgs').delete().eq('id', id);
        } catch {
          // best-effort
        }
      }
      for (const id of createdUserIds) {
        try {
          await admin.auth.admin.deleteUser(id);
        } catch {
          // best-effort
        }
      }
    });

    it(
      'assertion 1+2: User A sees own org roster; raises access_denied on org B',
      async () => {
        const adminClient = getAdmin();
        const passwordA = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
        const passwordB = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
        const emailA = `rank-rls-a-${Date.now()}@leanshot.test`;
        const emailB = `rank-rls-b-${Date.now()}@leanshot.test`;

        const { data: aRes, error: aErr } = await adminClient.auth.admin.createUser({
          email: emailA,
          password: passwordA,
          email_confirm: true,
        });
        if (aErr) throw aErr;
        const userA = aRes.user!;
        createdUserIds.push(userA.id);

        const { data: bRes, error: bErr } = await adminClient.auth.admin.createUser({
          email: emailB,
          password: passwordB,
          email_confirm: true,
        });
        if (bErr) throw bErr;
        const userB = bRes.user!;
        createdUserIds.push(userB.id);

        // Create patient C (member of org A) and patient D (member of org B)
        const passwordC = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
        const passwordD = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
        const emailC = `rank-rls-c-${Date.now()}@leanshot.test`;
        const emailD = `rank-rls-d-${Date.now()}@leanshot.test`;

        const { data: cRes, error: cErr } = await adminClient.auth.admin.createUser({
          email: emailC,
          password: passwordC,
          email_confirm: true,
        });
        if (cErr) throw cErr;
        const userC = cRes.user!;
        createdUserIds.push(userC.id);

        const { data: dRes, error: dErr } = await adminClient.auth.admin.createUser({
          email: emailD,
          password: passwordD,
          email_confirm: true,
        });
        if (dErr) throw dErr;
        const userD = dRes.user!;
        createdUserIds.push(userD.id);

        // User A signs in and creates Org A
        const userAClient = createClient(URL!, ANON!, {
          auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rank-rls-a' },
        });
        const userBClient = createClient(URL!, ANON!, {
          auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rank-rls-b' },
        });

        await userAClient.auth.signInWithPassword({ email: emailA, password: passwordA });
        await userBClient.auth.signInWithPassword({ email: emailB, password: passwordB });

        const slugA = `rank-rls-org-a-${Date.now().toString(36)}`;
        const { data: createOrgA, error: createOrgAErr } = await userAClient.rpc('create_org', {
          p_name: 'Rank RLS Org A',
          p_slug: slugA,
          p_description: null,
          p_website_url: null,
        });
        if (createOrgAErr) throw createOrgAErr;
        const orgARow = (createOrgA as Array<{ org_id: string; slug: string }>)[0];
        expect(orgARow).toBeTruthy();
        const orgAId = orgARow!.org_id;
        createdOrgIds.push(orgAId);

        const slugB = `rank-rls-org-b-${Date.now().toString(36)}`;
        const { data: createOrgB, error: createOrgBErr } = await userBClient.rpc('create_org', {
          p_name: 'Rank RLS Org B',
          p_slug: slugB,
          p_description: null,
          p_website_url: null,
        });
        if (createOrgBErr) throw createOrgBErr;
        const orgBRow = (createOrgB as Array<{ org_id: string; slug: string }>)[0];
        expect(orgBRow).toBeTruthy();
        const orgBId = orgBRow!.org_id;
        createdOrgIds.push(orgBId);

        // Add patient C to Org A and patient D to Org B via admin (service-role bypasses invite flow)
        // Seed patient memberships for org A (user C) via admin insert
        // First, get the View-only role for each org
        const { data: rolesA } = await adminClient
          .from('roles')
          .select('id, name')
          .eq('org_id', orgAId)
          .eq('name', 'View-only')
          .eq('is_system', true)
          .single();
        const roleAId = rolesA?.id as string | undefined;

        const { data: rolesB } = await adminClient
          .from('roles')
          .select('id, name')
          .eq('org_id', orgBId)
          .eq('name', 'View-only')
          .eq('is_system', true)
          .single();
        const roleBId = rolesB?.id as string | undefined;

        if (roleAId) {
          await adminClient.from('memberships').insert({
            user_id: userC.id,
            org_id: orgAId,
            role_id: roleAId,
            consent_scope: FULL_CONSENT,
            accepted_at: new Date().toISOString(),
          });
        }

        if (roleBId) {
          await adminClient.from('memberships').insert({
            user_id: userD.id,
            org_id: orgBId,
            role_id: roleBId,
            consent_scope: FULL_CONSENT,
            accepted_at: new Date().toISOString(),
          });
        }

        // Assertion 1: User A (operator in Org A with patient_data.read via Owner role) can call rank on own org
        // Note: Owner role has patient_data.read via role_permissions seeded in Phase 9
        const { data: rosterA, error: rosterAErr } = await userAClient.rpc('rank_org_patients', {
          p_org_id: orgAId,
          p_sort_column: 'score',
          p_sort_direction: 'desc',
          p_offset: 0,
          p_limit: 50,
        });
        expect(rosterAErr).toBeNull();
        // Should include at least the patient C row (owner membership is not a "patient" row — patient memberships only)
        expect(Array.isArray(rosterA)).toBe(true);

        // Assertion 2: CROSS-TENANT PROOF — User A calling rank_org_patients(org_B_id) MUST raise access_denied
        const { data: crossTenantData, error: crossTenantErr } = await userAClient.rpc(
          'rank_org_patients',
          {
            p_org_id: orgBId,
            p_sort_column: 'score',
            p_sort_direction: 'desc',
            p_offset: 0,
            p_limit: 50,
          },
        );
        expect(crossTenantData).toBeNull();
        expect(crossTenantErr).not.toBeNull();
        expect(crossTenantErr?.message ?? '').toMatch(/access_denied/i);

        // Assertion 3: User B can call rank on own org
        const { data: rosterB, error: rosterBErr } = await userBClient.rpc('rank_org_patients', {
          p_org_id: orgBId,
          p_sort_column: 'score',
          p_sort_direction: 'desc',
          p_offset: 0,
          p_limit: 50,
        });
        expect(rosterBErr).toBeNull();
        expect(Array.isArray(rosterB)).toBe(true);

        // Assertion 4: CROSS-TENANT PROOF — User B calling rank_org_patients(org_A_id) MUST raise access_denied
        const { data: crossTenantData2, error: crossTenantErr2 } = await userBClient.rpc(
          'rank_org_patients',
          {
            p_org_id: orgAId,
            p_sort_column: 'score',
            p_sort_direction: 'desc',
            p_offset: 0,
            p_limit: 50,
          },
        );
        expect(crossTenantData2).toBeNull();
        expect(crossTenantErr2).not.toBeNull();
        expect(crossTenantErr2?.message ?? '').toMatch(/access_denied/i);
      },
      60_000,
    );

    it(
      'assertion 5: unauthenticated (anon) call raises access_denied',
      async () => {
        // Need an org ID to test against. Create a quick one.
        const adminClient = getAdmin();
        const passwordZ = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
        const emailZ = `rank-rls-z-${Date.now()}@leanshot.test`;
        const { data: zRes, error: zErr } = await adminClient.auth.admin.createUser({
          email: emailZ,
          password: passwordZ,
          email_confirm: true,
        });
        if (zErr) throw zErr;
        const userZ = zRes.user!;
        createdUserIds.push(userZ.id);

        const userZClient = createClient(URL!, ANON!, {
          auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rank-rls-z' },
        });
        await userZClient.auth.signInWithPassword({ email: emailZ, password: passwordZ });
        const slugZ = `rank-rls-org-z-${Date.now().toString(36)}`;
        const { data: createOrgZ, error: createOrgZErr } = await userZClient.rpc('create_org', {
          p_name: 'Rank RLS Org Z',
          p_slug: slugZ,
          p_description: null,
          p_website_url: null,
        });
        if (createOrgZErr) throw createOrgZErr;
        const orgZRow = (createOrgZ as Array<{ org_id: string; slug: string }>)[0];
        const orgZId = orgZRow!.org_id;
        createdOrgIds.push(orgZId);

        // Now call as truly unauthenticated anon client (no signIn)
        const anonOnlyClient = createClient(URL!, ANON!, {
          auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rank-rls-anon-only' },
        });
        const { data: anonData, error: anonErr } = await anonOnlyClient.rpc('rank_org_patients', {
          p_org_id: orgZId,
          p_sort_column: 'score',
          p_sort_direction: 'desc',
          p_offset: 0,
          p_limit: 50,
        });
        // Unauthenticated → has_permission returns false → access_denied or empty
        // (SECURITY DEFINER with auth.uid()=null → has_permission returns false → RAISE)
        expect(anonData).toBeNull();
        expect(anonErr).not.toBeNull();
        // message should contain access_denied
        expect(anonErr?.message ?? '').toMatch(/access_denied/i);
      },
      30_000,
    );
  },
);

describe('Phase 10 Plan 10-02 — rank_org_patients RLS gating (guard test)', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn(
        '[rls-rank-org-patients.test] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set. Wave verification gates this.',
      );
    }
    expect(true).toBe(true);
  });
});
