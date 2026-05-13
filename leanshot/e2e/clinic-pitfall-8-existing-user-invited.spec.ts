/**
 * Phase 9 Plan 09-09 — Pitfall #8 scenario (a): existing personal user invited.
 *
 * Flow:
 *   1. Patient A already exists in auth.users (personal/B2C signup).
 *   2. Operator at org X invites patient_a@test.leanshot.app via send_invite RPC.
 *   3. Patient A signs in + calls accept_invite_existing with full consent_scope.
 *   4. Assertions (Pitfall #8 single-identity invariant):
 *      - exactly 1 auth.users row for patient_a@test.leanshot.app
 *      - exactly 1 memberships row (user_id=A, org_id=X, revoked_at IS NULL)
 *      - invite has consent_scope_at_acceptance frozen (D-18) + consumed_at set
 *      - audit_logs has membership_invite_sent + membership_invite_accepted rows
 *
 * Test scope (UI vs DB): the UI portion (patient clicks email URL → ConsentDialog
 * → Accept button) is exercised by Plan 09-04 RTL component tests. This spec
 * verifies the DB-side single-identity invariant — the load-bearing part of
 * Pitfall #8 — via admin SELECTs against the live project. The email-click
 * UI traversal is intentionally bypassed because Resend dispatch is sandbox-mode
 * (RESEND_FROM=onboarding@resend.dev) and we'd just be testing Playwright's URL
 * handling, not the security invariant.
 *
 * Pattern reference: memory `reference_supabase_auth_traps.md` — never call public
 * auth-email endpoints from e2e; use admin.generateLink + RPC paths.
 */
import { expect, test } from '@playwright/test';

import {
  acceptInviteAs,
  cleanupClinicFixtures,
  countAuthUsersWithEmail,
  countMemberships,
  createInviteViaRpc,
  createOperatorWithOrg,
  createUser,
  fullConsentScope,
  getAuditRows,
  getInvite,
  getMembership,
  hasLiveSupabase,
  testEmail,
  testRunId,
} from './fixtures/clinic-fixtures';

test.describe('@phase09 Pitfall #8 scenario (a): existing personal user invited', () => {
  test.skip(
    !hasLiveSupabase(),
    'requires SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY',
  );
  test.setTimeout(60_000);

  const runId = testRunId();
  const patientEmail = testEmail('p8a-patient', runId);

  test.afterAll(async () => {
    await cleanupClinicFixtures({
      emailPattern: `p8a-${runId}`,
      slugPattern: `p8a-${runId}`,
    });
    // Also clean up the standalone patient (different slug pattern).
    await cleanupClinicFixtures({
      emailPattern: patientEmail,
    });
  });

  test('existing user accepts org invite — single auth.users + single membership + audit rows', async () => {
    // 1. Patient A exists in auth.users (pre-invite).
    const patient = await createUser({ email: patientEmail });

    // 2. Operator creates org + sends invite.
    const opFixture = await createOperatorWithOrg(`p8a-${runId}`);
    const invite = await createInviteViaRpc({
      operatorClient: opFixture.client,
      orgId: opFixture.orgId,
      email: patient.email,
    });

    // 3. Patient accepts (DB-side flow; UI traversal in Plan 09-04 RTL tests).
    const consent = fullConsentScope();
    const accept = await acceptInviteAs({
      patient,
      tokenHash: invite.tokenHash,
      consentScope: consent,
    });
    expect(accept.orgId).toBe(opFixture.orgId);

    // 4a. Pitfall #8 single-identity invariant.
    const userCount = await countAuthUsersWithEmail(patient.email);
    expect(userCount, 'exactly one auth.users row for patient email').toBe(1);

    // 4b. Memberships count is 1 (active, no revoked dupes).
    const memCount = await countMemberships({
      userId: patient.id,
      orgId: opFixture.orgId,
      activeOnly: true,
    });
    expect(memCount, 'exactly one active membership').toBe(1);

    const mem = await getMembership({ userId: patient.id, orgId: opFixture.orgId });
    expect(mem, 'membership row exists').toBeTruthy();
    expect(mem?.revoked_at, 'membership not revoked').toBeNull();
    // Consent_scope round-trip — strict shape.
    expect(mem?.consent_scope).toEqual(consent);

    // 4c. Invite lifecycle: consumed + frozen consent_scope_at_acceptance (D-18).
    const inviteRow = await getInvite(invite.inviteId);
    expect(inviteRow, 'invite row still selectable').toBeTruthy();
    expect(inviteRow?.accepted_at, 'invite.accepted_at set').toBeTruthy();
    expect(inviteRow?.consumed_at, 'invite.consumed_at set').toBeTruthy();
    expect(inviteRow?.rejected_at, 'invite.rejected_at null').toBeNull();
    expect(
      inviteRow?.consent_scope_at_acceptance,
      'D-18: consent_scope_at_acceptance frozen at acceptance',
    ).toEqual(consent);

    // 4d. Audit log (CLINIC-07 capture half): membership_invite_sent + _accepted.
    const audit = await getAuditRows({ orgId: opFixture.orgId });
    const actions = audit.map((r) => r.action);
    expect(actions, 'audit row for invite sent').toContain('membership_invite_sent');
    expect(actions, 'audit row for invite accepted').toContain('membership_invite_accepted');
  });
});
