/**
 * Phase 31 Plan 04 — Cross-tenant proof test for `change_member_role` SECDEF.
 *
 * Test cases (per D-13 SECDEF contract):
 *   TC1: Owner of Org X CAN change a member's role within Org X.
 *   TC2: Owner of Org X CANNOT change a member's role in Org Y (insufficient_privilege).
 *   TC3: Clinician of Org X CANNOT change any member's role (lacks members.role.edit).
 *   TC4: Owner CANNOT demote themselves when they are the LAST owner (LAST_OWNER_DEMOTE_DENIED).
 *   TC5: Owner CAN demote themselves when a second owner exists.
 *   TC6: Action writes an audit_logs row with action='org_member.role_changed'.
 *
 * Environment: requires SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY.
 * Skipped automatically when env not set.
 *
 * Per [[feedback_rls_per_file_slug_prefix]]: file-scoped TEST_SLUG_PREFIX.
 * Per [[reference_rls_fixture_gotrueclient_flake]]: uses sessionFor (generateLink + verifyOtp).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  SHOULD_RUN,
  cleanupByPrefix,
  createTwoOrgsTwoUsers,
  getAdmin,
  makeSlugPrefix,
  sessionFor,
  type TwoOrgsTwoUsers,
} from './_fixtures/p28-rls-fixture';

// File-scoped prefix per [[feedback_rls_per_file_slug_prefix]]
const TEST_SLUG_PREFIX = makeSlugPrefix(__filename);

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';

const describeIfLive = SHOULD_RUN ? describe : describe.skip;

describeIfLive('P31-04 RLS — change_member_role SECDEF', () => {
  let fixture: TwoOrgsTwoUsers;
  let userAClient: SupabaseClient; // owner of orgX
  let clinicianUserIdX: string;   // a clinician member seeded into orgX for TC3
  let clinicianClientX: SupabaseClient;
  let secondOwnerUserIdX: string;  // second owner of orgX for TC5
  let admin: SupabaseClient;

  beforeAll(async () => {
    admin = getAdmin();
    fixture = await createTwoOrgsTwoUsers(TEST_SLUG_PREFIX);

    // User A client (owner of Org X)
    userAClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${fixture.sessA.access_token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Seed a clinician member into Org X for TC3 (clinician cannot change roles)
    const clinicianEmail = `${TEST_SLUG_PREFIX}-c@leanshot.test`;
    const { data: clinicianData, error: clinicianCreateErr } = await admin.auth.admin.createUser({
      email: clinicianEmail,
      email_confirm: true,
      password: `P31-${crypto.randomUUID()}`,
    });
    if (clinicianCreateErr || !clinicianData.user) {
      throw new Error(`createUser clinician failed: ${clinicianCreateErr?.message}`);
    }
    clinicianUserIdX = clinicianData.user.id;

    const { error: memberInsertErr } = await admin.from('org_members').insert({
      org_id: fixture.orgX,
      user_id: clinicianUserIdX,
      role: 'clinician',
    });
    if (memberInsertErr) {
      throw new Error(`org_members clinician insert failed: ${memberInsertErr.message}`);
    }

    const clinicianSess = await sessionFor(clinicianEmail);
    clinicianClientX = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${clinicianSess.access_token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Seed a second owner into Org X for TC5 (allows User A to demote self)
    const secondOwnerEmail = `${TEST_SLUG_PREFIX}-o2@leanshot.test`;
    const { data: ownerData, error: ownerCreateErr } = await admin.auth.admin.createUser({
      email: secondOwnerEmail,
      email_confirm: true,
      password: `P31-${crypto.randomUUID()}`,
    });
    if (ownerCreateErr || !ownerData.user) {
      throw new Error(`createUser secondOwner failed: ${ownerCreateErr?.message}`);
    }
    secondOwnerUserIdX = ownerData.user.id;

    const { error: ownerMemberErr } = await admin.from('org_members').insert({
      org_id: fixture.orgX,
      user_id: secondOwnerUserIdX,
      role: 'owner',
    });
    if (ownerMemberErr) {
      throw new Error(`org_members secondOwner insert failed: ${ownerMemberErr.message}`);
    }
  }, 90_000);

  afterAll(async () => {
    // Clean up extra members
    if (clinicianUserIdX) {
      await admin.auth.admin.deleteUser(clinicianUserIdX).catch(() => {});
    }
    if (secondOwnerUserIdX) {
      await admin.auth.admin.deleteUser(secondOwnerUserIdX).catch(() => {});
    }
    await cleanupByPrefix(TEST_SLUG_PREFIX);
  });

  it('TC1: Owner of Org X CAN change clinician to staff within Org X', async () => {
    const { error } = await userAClient.rpc('change_member_role', {
      p_org_id:  fixture.orgX,
      p_user_id: clinicianUserIdX,
      p_role:    'staff',
    });
    expect(error).toBeNull();

    // Verify via service-role that the update landed
    const { data: memberRow } = await admin
      .from('org_members')
      .select('role')
      .eq('org_id', fixture.orgX)
      .eq('user_id', clinicianUserIdX)
      .single();
    expect(memberRow?.role).toBe('staff');

    // Restore to clinician for subsequent tests
    await admin.from('org_members').update({ role: 'clinician' })
      .eq('org_id', fixture.orgX)
      .eq('user_id', clinicianUserIdX);
  }, 30_000);

  it('TC2: Owner of Org X CANNOT change_member_role in Org Y (insufficient_privilege)', async () => {
    const { error } = await userAClient.rpc('change_member_role', {
      p_org_id:  fixture.orgY,
      p_user_id: fixture.userB,
      p_role:    'staff',
    });
    expect(error).not.toBeNull();
    expect((error as { message: string }).message).toMatch(/insufficient_privilege|caller lacks/);
  }, 30_000);

  it('TC3: Clinician of Org X CANNOT change_member_role within Org X (lacks members.role.edit)', async () => {
    const { error } = await clinicianClientX.rpc('change_member_role', {
      p_org_id:  fixture.orgX,
      p_user_id: fixture.userA,
      p_role:    'staff',
    });
    expect(error).not.toBeNull();
    expect((error as { message: string }).message).toMatch(/insufficient_privilege|caller lacks/);
  }, 30_000);

  it('TC4: Owner CANNOT demote themselves when they are the LAST owner (LAST_OWNER_DEMOTE_DENIED)', async () => {
    // Remove secondOwner temporarily so userA is the only owner
    await admin.from('org_members').delete()
      .eq('org_id', fixture.orgX)
      .eq('user_id', secondOwnerUserIdX);

    const { error } = await userAClient.rpc('change_member_role', {
      p_org_id:  fixture.orgX,
      p_user_id: fixture.userA,
      p_role:    'clinician',
    });
    expect(error).not.toBeNull();
    expect((error as { message: string }).message).toMatch(/LAST_OWNER_DEMOTE_DENIED/);

    // Restore secondOwner
    await admin.from('org_members').insert({
      org_id:  fixture.orgX,
      user_id: secondOwnerUserIdX,
      role:    'owner',
    });
  }, 30_000);

  it('TC5: Owner CAN demote themselves when a second owner exists', async () => {
    // secondOwnerUserIdX is now restored (owner) so userA can safely demote self
    const { error } = await userAClient.rpc('change_member_role', {
      p_org_id:  fixture.orgX,
      p_user_id: fixture.userA,
      p_role:    'clinician',
    });
    expect(error).toBeNull();

    // Restore userA to owner for afterAll cleanup
    await admin.from('org_members').update({ role: 'owner' })
      .eq('org_id', fixture.orgX)
      .eq('user_id', fixture.userA);
  }, 30_000);

  it('TC6: change_member_role writes audit_logs row with action=org_member.role_changed', async () => {
    // Trigger a role change (clinician → staff)
    const { error } = await userAClient.rpc('change_member_role', {
      p_org_id:  fixture.orgX,
      p_user_id: clinicianUserIdX,
      p_role:    'staff',
    });
    expect(error).toBeNull();

    // Verify audit log entry via service-role (most recent matching action)
    const { data: logs, error: logErr } = await admin
      .from('audit_logs')
      .select('action, metadata')
      .eq('action', 'org_member.role_changed')
      .order('created_at', { ascending: false })
      .limit(5);

    expect(logErr).toBeNull();
    const relevantLog = (logs ?? []).find(
      (l: { metadata: { org_id?: string; user_id?: string; new_role?: string } }) =>
        l.metadata?.org_id === fixture.orgX &&
        l.metadata?.user_id === clinicianUserIdX
    );
    expect(relevantLog).not.toBeUndefined();
    expect(relevantLog?.metadata?.new_role).toBe('staff');
  }, 30_000);
});

describe('P31-04 change_member_role — env gating check', () => {
  it('skips live DB tests when SUPABASE_SERVICE_ROLE_KEY is not set', () => {
    if (!SHOULD_RUN) {
      console.warn('[rls-change-member-role.test] SKIPPED — env not set.');
    }
    expect(true).toBe(true);
  });
});
