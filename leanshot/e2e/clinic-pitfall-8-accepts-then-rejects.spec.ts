/**
 * Phase 9 Plan 09-09 — Pitfall #8 scenario (e): accepts then revokes.
 *
 * Flow:
 *   1. Operator invites existing patient; patient accepts (membership active).
 *   2. Patient calls revoke_membership (Settings → Active orgs → Revoke).
 *   3. Assertions:
 *      - exactly 1 auth.users row (unchanged)
 *      - exactly 1 memberships row with revoked_at != null
 *      - count of active memberships (revoked_at IS NULL) is 0
 *      - audit_logs has membership_invite_sent + _accepted + membership_revoked
 *      - invite.consent_scope_at_acceptance is still frozen (D-18 survives revoke)
 *
 * SC#5-specific revoke-latency (Realtime → roster removed within 1s) is owned by
 * Plan 09-10; this spec covers the DB-state portion only.
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
  revokeMembershipAs,
  testEmail,
  testRunId,
} from './fixtures/clinic-fixtures';

test.describe('@phase09 Pitfall #8 scenario (e): accepts then patient self-revokes', () => {
  test.skip(
    !hasLiveSupabase(),
    'requires SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY',
  );
  test.setTimeout(60_000);

  const runId = testRunId();
  const patientEmail = testEmail('p8e-patient', runId);

  test.afterAll(async () => {
    await cleanupClinicFixtures({
      emailPattern: `p8e-${runId}`,
      slugPattern: `p8e-${runId}`,
    });
    await cleanupClinicFixtures({ emailPattern: patientEmail });
  });

  test('accept then revoke: one auth.users + one revoked membership + audit trail intact', async () => {
    const patient = await createUser({ email: patientEmail });
    const opFixture = await createOperatorWithOrg(`p8e-${runId}`);
    const invite = await createInviteViaRpc({
      operatorClient: opFixture.client,
      orgId: opFixture.orgId,
      email: patient.email,
    });

    const consent = fullConsentScope();
    const accept = await acceptInviteAs({
      patient,
      tokenHash: invite.tokenHash,
      consentScope: consent,
    });

    // Patient self-revokes.
    await revokeMembershipAs({ patient, membershipId: accept.membershipId });

    // 1. auth.users unchanged.
    const userCount = await countAuthUsersWithEmail(patient.email);
    expect(userCount).toBe(1);

    // 2. Active memberships count == 0 (the row exists but is revoked).
    const activeCount = await countMemberships({
      userId: patient.id,
      orgId: opFixture.orgId,
      activeOnly: true,
    });
    expect(activeCount, 'no active memberships after revoke').toBe(0);

    // The revoked row is still selectable for audit.
    const mem = await getMembership({ userId: patient.id, orgId: opFixture.orgId });
    expect(mem, 'membership row still present (revoked)').toBeTruthy();
    expect(mem?.revoked_at, 'revoked_at set').toBeTruthy();

    // 3. D-18 — consent_scope_at_acceptance on the invite survives revoke.
    const inviteRow = await getInvite(invite.inviteId);
    expect(inviteRow?.consent_scope_at_acceptance).toEqual(consent);

    // 4. Audit log: all three actions present.
    const audit = await getAuditRows({ orgId: opFixture.orgId });
    const actions = audit.map((r) => r.action);
    expect(actions).toContain('membership_invite_sent');
    expect(actions).toContain('membership_invite_accepted');
    expect(actions).toContain('membership_revoked');
  });
});
