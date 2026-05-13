/**
 * Phase 9 Plan 09-09 — Pitfall #8 scenario (c): existing user, two invites.
 *
 * Flow:
 *   1. Patient already exists.
 *   2. Operator A at Clinic X invites; operator B at Clinic Y invites.
 *   3. Patient accepts BOTH.
 *   4. Assertions:
 *      - exactly 1 auth.users row
 *      - exactly 2 memberships rows (one per org_id), both active
 *      - both invites are consumed + have consent_scope_at_acceptance
 *
 * UNIQUE(user_id, org_id) WHERE revoked_at IS NULL allows (user, orgX) +
 * (user, orgY) because those are distinct (user, org) tuples. Verified live.
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

test.describe('@phase09 Pitfall #8 scenario (c): existing user accepts invites from 2 orgs', () => {
  test.skip(
    !hasLiveSupabase(),
    'requires SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY',
  );
  test.setTimeout(90_000);

  const runId = testRunId();
  const patientEmail = testEmail('p8c-patient', runId);

  test.afterAll(async () => {
    await cleanupClinicFixtures({
      emailPattern: `p8c-${runId}`,
      slugPattern: `p8c-${runId}`,
    });
    await cleanupClinicFixtures({ emailPattern: patientEmail });
  });

  test('one auth.users + two memberships across two orgs', async () => {
    const patient = await createUser({ email: patientEmail });

    const orgX = await createOperatorWithOrg(`p8c-x-${runId}`);
    const orgY = await createOperatorWithOrg(`p8c-y-${runId}`);

    const inviteX = await createInviteViaRpc({
      operatorClient: orgX.client,
      orgId: orgX.orgId,
      email: patient.email,
    });
    const inviteY = await createInviteViaRpc({
      operatorClient: orgY.client,
      orgId: orgY.orgId,
      email: patient.email,
    });

    const consent = fullConsentScope();
    const acceptX = await acceptInviteAs({
      patient,
      tokenHash: inviteX.tokenHash,
      consentScope: consent,
    });
    const acceptY = await acceptInviteAs({
      patient,
      tokenHash: inviteY.tokenHash,
      consentScope: consent,
    });
    expect(acceptX.orgId).toBe(orgX.orgId);
    expect(acceptY.orgId).toBe(orgY.orgId);

    // Pitfall #8 invariant: still ONE auth.users row.
    const userCount = await countAuthUsersWithEmail(patient.email);
    expect(userCount, 'single auth.users across two orgs').toBe(1);

    // TWO memberships rows total, one per org.
    const totalMems = await countMemberships({ userId: patient.id, activeOnly: true });
    expect(totalMems, 'two active memberships across two orgs').toBe(2);

    const memX = await getMembership({ userId: patient.id, orgId: orgX.orgId });
    const memY = await getMembership({ userId: patient.id, orgId: orgY.orgId });
    expect(memX?.revoked_at).toBeNull();
    expect(memY?.revoked_at).toBeNull();

    // Both invites consumed.
    const inviteRowX = await getInvite(inviteX.inviteId);
    const inviteRowY = await getInvite(inviteY.inviteId);
    expect(inviteRowX?.consumed_at).toBeTruthy();
    expect(inviteRowY?.consumed_at).toBeTruthy();
    expect(inviteRowX?.consent_scope_at_acceptance).toEqual(consent);
    expect(inviteRowY?.consent_scope_at_acceptance).toEqual(consent);

    // Audit rows in both orgs.
    const auditX = await getAuditRows({ orgId: orgX.orgId });
    const auditY = await getAuditRows({ orgId: orgY.orgId });
    expect(auditX.map((r) => r.action)).toContain('membership_invite_accepted');
    expect(auditY.map((r) => r.action)).toContain('membership_invite_accepted');
  });
});
