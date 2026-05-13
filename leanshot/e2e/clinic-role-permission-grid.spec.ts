/**
 * Phase 9 Plan 09-09 — D-07 custom role + permission grid (SC#6) + W-4 actual
 * RLS enforcement.
 *
 * Six tests against the live project:
 *   1. Owner creates custom 'Triage' role with subset of permissions
 *      (patient_data.read + audit_log.read; NO members.invite).
 *      Asserts: roles row + role_permissions rows (1 per permission key).
 *   2. Owner assigns Triage to a member.
 *      Asserts: memberships.role_id updated.
 *   3. has_permission() helper unit check:
 *      - patient_data.read for the Triage user → true
 *      - members.invite for the Triage user → false
 *      Note: this is a UNIT test of the helper boolean — the real security
 *      gate is Test 3a below (W-4 fix per plan-checker iter 1).
 *   3a. (W-4) ACTUAL RLS enforcement: Triage user invokes send_invite RPC →
 *       expects PG error 42501 (insufficient_privilege). ALSO Triage user
 *       attempts direct INSERT into invites table → expects RLS denial.
 *       Without this test, a regression that disables the RPC's permission
 *       check could leave Test 3 green while the security gate is open.
 *   4. Permission grid persistence: update Triage to add members.invite via
 *       update_role; re-fetch role_permissions; assert new key present.
 *   5. Delete role with members assigned: members reassigned to View-only
 *       (system fallback role).
 *   6. System-role delete forbidden: delete_role on the Owner role rejected
 *       with 42501 / forbidden.
 *
 * Iteration on PERMISSION_KEYS × 3 default roles:
 *   - Owner: has all 10 keys.
 *   - Coach: 4 keys per Plan 09-01 migration 10 trigger seed.
 *   - View-only: 3 keys.
 *   For each (role, key) pair, has_permission returns the expected boolean.
 */
import { expect, test } from '@playwright/test';

import { PERMISSION_KEYS } from '@/types/clinic';

import {
  acceptInviteAs,
  cleanupClinicFixtures,
  createInviteViaRpc,
  createOperatorWithOrg,
  createRoleAs,
  createUser,
  fullConsentScope,
  getAdmin,
  hasLiveSupabase,
  signIn,
  testEmail,
  testRunId,
  updateMemberRoleAs,
} from './fixtures/clinic-fixtures';

// Per Plan 09-01 migration 10 trigger:
//   - Owner    → all 10 keys
//   - Coach    → members.list + patient_data.read + patient_photos.read + audit_log.read
//   - View-only → members.list + patient_data.read + audit_log.read
const COACH_KEYS = new Set<string>([
  'members.list',
  'patient_data.read',
  'patient_photos.read',
  'audit_log.read',
]);
const VIEW_ONLY_KEYS = new Set<string>(['members.list', 'patient_data.read', 'audit_log.read']);

test.describe('@phase09 D-07 + SC#6 custom role + W-4 actual RLS enforcement', () => {
  test.skip(
    !hasLiveSupabase(),
    'requires SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY',
  );
  test.setTimeout(180_000);

  const runId = testRunId();

  test.afterAll(async () => {
    await cleanupClinicFixtures({
      emailPattern: `roles-${runId}`,
      slugPattern: `roles-${runId}`,
    });
  });

  test('Tests 1-2 + 3 + 3a (W-4) + 4 + 5 + 6 + role × permission grid', async () => {
    const admin = getAdmin();

    // ─── Setup: Owner + Coach-currently member ─────────────────────────
    const opFix = await createOperatorWithOrg(`roles-${runId}`);

    // Lookup the 3 system roles auto-seeded by the trigger.
    const { data: rolesData, error: rolesErr } = await admin
      .from('roles')
      .select('id, name')
      .eq('org_id', opFix.orgId);
    expect(rolesErr).toBeNull();
    const roleByName = Object.fromEntries(
      (rolesData ?? []).map((r) => [r.name, r.id as string]),
    );
    expect(roleByName['Owner'], 'Owner system role seeded').toBeTruthy();
    expect(roleByName['Coach'], 'Coach system role seeded').toBeTruthy();
    expect(roleByName['View-only'], 'View-only system role seeded').toBeTruthy();

    // Mint a "Coach-currently" member who will be downgraded to Triage in Test 2.
    const triageUser = await createUser({
      email: testEmail(`roles-triage-${runId}`, 'u'),
    });
    const triageInvite = await createInviteViaRpc({
      operatorClient: opFix.client,
      orgId: opFix.orgId,
      email: triageUser.email,
    });
    const triageAccept = await acceptInviteAs({
      patient: triageUser,
      tokenHash: triageInvite.tokenHash,
      consentScope: fullConsentScope(),
    });

    // ─── Test 1: Owner creates 'Triage' role ──────────────────────────
    const triageRole = await createRoleAs({
      operatorClient: opFix.client,
      orgId: opFix.orgId,
      name: `Triage-${runId}`,
      permissionKeys: ['patient_data.read', 'audit_log.read'],
    });
    expect(triageRole.roleId).toBeTruthy();

    const { data: triagePerms } = await admin
      .from('role_permissions')
      .select('permission_key')
      .eq('role_id', triageRole.roleId);
    const triagePermSet = new Set((triagePerms ?? []).map((r) => r.permission_key as string));
    expect(triagePermSet.has('patient_data.read'), 'Triage has patient_data.read').toBe(true);
    expect(triagePermSet.has('audit_log.read'), 'Triage has audit_log.read').toBe(true);
    expect(triagePermSet.has('members.invite'), 'Triage does NOT have members.invite').toBe(
      false,
    );

    // ─── Test 2: Assign Triage to the member ──────────────────────────
    await updateMemberRoleAs({
      operatorClient: opFix.client,
      membershipId: triageAccept.membershipId,
      roleId: triageRole.roleId,
    });
    const { data: memAfterUpdate } = await admin
      .from('memberships')
      .select('role_id')
      .eq('id', triageAccept.membershipId)
      .maybeSingle();
    expect(memAfterUpdate?.role_id, 'membership.role_id updated to Triage').toBe(
      triageRole.roleId,
    );

    // ─── Test 3: has_permission helper unit check (supplements 3a) ────
    const triageClient = await signIn(triageUser);
    {
      const { data: canRead, error: errRead } = await triageClient.rpc('has_permission', {
        p_user_id: triageUser.id,
        p_org_id: opFix.orgId,
        p_permission_key: 'patient_data.read',
      });
      expect(errRead, 'has_permission call did not error').toBeNull();
      expect(canRead, 'Triage has patient_data.read').toBe(true);

      const { data: canInvite, error: errInvite } = await triageClient.rpc('has_permission', {
        p_user_id: triageUser.id,
        p_org_id: opFix.orgId,
        p_permission_key: 'members.invite',
      });
      expect(errInvite).toBeNull();
      expect(canInvite, 'Triage does NOT have members.invite').toBe(false);
    }

    // ─── Test 3a (W-4): ACTUAL RLS enforcement on send_invite ─────────
    // Per plan-checker iter 1: the helper boolean is supplementary; the real
    // security floor is the RPC raising 42501 when the operator lacks the
    // permission key. Without this test, a regression that disables the
    // RPC's has_permission check could leave Test 3 green while the gate
    // is silently open.
    {
      const newEmail = testEmail(`roles-w4-victim-${runId}`, 'v');
      const { data: invData, error: invErr } = await triageClient.rpc('send_invite', {
        p_email: newEmail,
        p_org_id: opFix.orgId,
        p_invite_token_hash: 'a'.repeat(64),
        p_requested_scope: fullConsentScope(),
      });
      expect(invData, 'send_invite as Triage returns no data').toBeNull();
      expect(invErr, 'send_invite as Triage raises an error').toBeTruthy();
      // The RPC raises insufficient_privilege via has_permission gate. Postgres
      // codes/messages on the wire from supabase-js can vary depending on whether
      // the RAISE EXCEPTION carries SQLSTATE 42501 or a custom code with the
      // message 'forbidden'. We accept either signal.
      const sig = `${invErr?.code ?? ''} ${invErr?.message ?? ''}`.toLowerCase();
      expect(
        /42501|forbidden|insufficient|permission.*denied|members\.invite/.test(sig),
        `Triage send_invite error should be 42501/forbidden-shaped, got: ${sig}`,
      ).toBe(true);
    }

    // ─── Test 3a (W-4) belt-and-suspenders: direct INSERT denied by RLS ──
    {
      const { error: insErr } = await triageClient.from('invites').insert({
        email: testEmail(`roles-w4-direct-${runId}`, 'd'),
        org_id: opFix.orgId,
        invited_by: triageUser.id,
        invite_token_hash: 'b'.repeat(64),
        requested_scope: fullConsentScope(),
        expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
      });
      // RLS has NO insert policy for invites (writes are via SECURITY DEFINER
      // RPC only) — direct INSERT returns either RLS error or 42501.
      expect(insErr, 'direct INSERT on invites denied by RLS').toBeTruthy();
    }

    // ─── Test 4: permission-grid persistence (update_role adds members.invite) ─
    {
      const { error: upErr } = await opFix.client.rpc('update_role', {
        p_role_id: triageRole.roleId,
        p_name: `Triage-${runId}`,
        p_description: null,
        p_permission_keys: ['patient_data.read', 'audit_log.read', 'members.invite'],
      });
      expect(upErr, 'update_role succeeded').toBeNull();
      const { data: permsAfter } = await admin
        .from('role_permissions')
        .select('permission_key')
        .eq('role_id', triageRole.roleId);
      const setAfter = new Set((permsAfter ?? []).map((r) => r.permission_key as string));
      expect(setAfter.has('members.invite'), 'members.invite added to Triage').toBe(true);
      expect(setAfter.has('patient_data.read')).toBe(true);
      expect(setAfter.has('audit_log.read')).toBe(true);
    }

    // ─── Test 5: delete role with members assigned → reassign to View-only ─
    {
      // First, downgrade Triage user role back to a fresh role we'll delete.
      const deletableRole = await createRoleAs({
        operatorClient: opFix.client,
        orgId: opFix.orgId,
        name: `Deletable-${runId}`,
        permissionKeys: ['patient_data.read'],
      });
      await updateMemberRoleAs({
        operatorClient: opFix.client,
        membershipId: triageAccept.membershipId,
        roleId: deletableRole.roleId,
      });
      const { error: delErr } = await opFix.client.rpc('delete_role', {
        p_role_id: deletableRole.roleId,
      });
      expect(delErr, 'delete_role on custom role succeeds').toBeNull();
      // Member reassigned to View-only.
      const { data: memAfterDelete } = await admin
        .from('memberships')
        .select('role_id')
        .eq('id', triageAccept.membershipId)
        .maybeSingle();
      expect(memAfterDelete?.role_id, 'member reassigned to View-only').toBe(
        roleByName['View-only'],
      );
    }

    // ─── Test 6: system-role delete forbidden ─────────────────────────
    {
      const { error: sysDelErr } = await opFix.client.rpc('delete_role', {
        p_role_id: roleByName['Owner'],
      });
      expect(sysDelErr, 'delete_role on system Owner role rejected').toBeTruthy();
      const sig = `${sysDelErr?.code ?? ''} ${sysDelErr?.message ?? ''}`.toLowerCase();
      expect(
        /42501|forbidden|system|insufficient|is_system/.test(sig),
        `delete_role on Owner should be forbidden, got: ${sig}`,
      ).toBe(true);
    }
  });

  test('Permission grid walk: 10 PERMISSION_KEYS × 3 default roles', async () => {
    // For each of the 3 system roles, mint a user assigned to that role and
    // verify has_permission() returns the expected boolean for ALL 10 keys.
    const opFix = await createOperatorWithOrg(`roles-grid-${runId}`);
    const admin = getAdmin();
    const { data: rolesData } = await admin
      .from('roles')
      .select('id, name')
      .eq('org_id', opFix.orgId);
    const roleByName = Object.fromEntries(
      (rolesData ?? []).map((r) => [r.name, r.id as string]),
    );

    // Owner is already opFix.operator with Owner role.
    const expectations: Array<{ roleName: string; keys: Set<string>; userId?: string }> = [
      { roleName: 'Owner', keys: new Set(PERMISSION_KEYS) },
      { roleName: 'Coach', keys: COACH_KEYS },
      { roleName: 'View-only', keys: VIEW_ONLY_KEYS },
    ];

    // Mint Coach + View-only members.
    for (const exp of expectations) {
      if (exp.roleName === 'Owner') {
        exp.userId = opFix.operator.id;
        continue;
      }
      const u = await createUser({
        email: testEmail(`roles-grid-${exp.roleName.toLowerCase()}-${runId}`, 'u'),
      });
      const inv = await createInviteViaRpc({
        operatorClient: opFix.client,
        orgId: opFix.orgId,
        email: u.email,
      });
      const acc = await acceptInviteAs({
        patient: u,
        tokenHash: inv.tokenHash,
        consentScope: fullConsentScope(),
      });
      await updateMemberRoleAs({
        operatorClient: opFix.client,
        membershipId: acc.membershipId,
        roleId: roleByName[exp.roleName],
      });
      exp.userId = u.id;
    }

    // Walk the grid. Use admin client to call has_permission — it's a SECURITY
    // DEFINER function so caller identity doesn't matter for the calculation.
    for (const exp of expectations) {
      for (const key of PERMISSION_KEYS) {
        const { data, error } = await admin.rpc('has_permission', {
          p_user_id: exp.userId!,
          p_org_id: opFix.orgId,
          p_permission_key: key,
        });
        expect(error, `has_permission(${exp.roleName}, ${key}) errored`).toBeNull();
        const expected = exp.keys.has(key);
        expect(
          data,
          `${exp.roleName} should ${expected ? 'have' : 'NOT have'} ${key}`,
        ).toBe(expected);
      }
    }
  });
});
