/**
 * Phase 9 Plan 09-09 — Pitfall #8 scenario (b): no personal user, invited.
 *
 * Flow:
 *   1. Operator invites a NEW email (no prior auth.users row) via send_invite RPC.
 *   2. Patient signs up via admin.createUser (simulating the email-link → State D
 *      signup form path; the SPA's State D ultimately calls supabase.auth.signUp
 *      which creates the same auth.users row).
 *   3. Patient calls accept_invite_existing (Plan 09-06 Edge Function notes:
 *      Pitfall #1 collapse — _existing variant works for both states once the
 *      user record exists).
 *   4. Assertions:
 *      - exactly 1 auth.users row for the email (the signup path didn't duplicate)
 *      - exactly 1 memberships row
 *      - invite consumed_at set + consent_scope_at_acceptance frozen
 *      - audit_logs has the two invite-lifecycle rows
 *
 * Pitfall #1 race-collapse — the single-identity invariant is upheld by the
 * UNIQUE(email) constraint on auth.users; if a parallel marketing-page signup
 * tried to also create the user, the second call would fail. This spec asserts
 * the steady-state (post-collapse): exactly 1 auth.users row.
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
  hasLiveSupabase,
  testEmail,
  testRunId,
} from './fixtures/clinic-fixtures';

test.describe('@phase09 Pitfall #8 scenario (b): no personal user, invited', () => {
  test.skip(
    !hasLiveSupabase(),
    'requires SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY',
  );
  test.setTimeout(60_000);

  const runId = testRunId();
  const patientEmail = testEmail('p8b-patient', runId);

  test.afterAll(async () => {
    await cleanupClinicFixtures({
      emailPattern: `p8b-${runId}`,
      slugPattern: `p8b-${runId}`,
    });
    await cleanupClinicFixtures({ emailPattern: patientEmail });
  });

  test('new-user signup-from-invite produces exactly ONE auth.users row + ONE membership', async () => {
    // 1. Operator creates org + invites a brand-new email (no auth.users yet).
    const opFixture = await createOperatorWithOrg(`p8b-${runId}`);
    const invite = await createInviteViaRpc({
      operatorClient: opFixture.client,
      orgId: opFixture.orgId,
      email: patientEmail,
    });

    // Pre-invariant: ZERO auth.users rows exist for this email.
    const preCount = await countAuthUsersWithEmail(patientEmail);
    expect(preCount, 'no auth.users row pre-signup').toBe(0);

    // 2. Patient completes the signup-from-invite path. The State D form in
    //    InviteSignupForm.tsx (Plan 09-04) ultimately calls supabase.auth.signUp;
    //    admin.createUser is the deterministic e2e equivalent.
    const patient = await createUser({ email: patientEmail });

    // 3. Patient accepts the invite.
    const consent = fullConsentScope();
    const accept = await acceptInviteAs({
      patient,
      tokenHash: invite.tokenHash,
      consentScope: consent,
    });
    expect(accept.orgId).toBe(opFixture.orgId);

    // 4a. Single-identity invariant: exactly 1 auth.users for this email
    //     (despite signup-from-invite being a creation path).
    const userCount = await countAuthUsersWithEmail(patientEmail);
    expect(userCount, 'single auth.users post-signup-and-accept').toBe(1);

    // 4b. Memberships count == 1.
    const memCount = await countMemberships({
      userId: patient.id,
      orgId: opFixture.orgId,
      activeOnly: true,
    });
    expect(memCount).toBe(1);

    // 4c. Invite consumed + consent frozen.
    const inviteRow = await getInvite(invite.inviteId);
    expect(inviteRow?.consumed_at).toBeTruthy();
    expect(inviteRow?.accepted_at).toBeTruthy();
    expect(inviteRow?.consent_scope_at_acceptance).toEqual(consent);

    // 4d. Audit rows.
    const audit = await getAuditRows({ orgId: opFixture.orgId });
    const actions = audit.map((r) => r.action);
    expect(actions).toContain('membership_invite_sent');
    expect(actions).toContain('membership_invite_accepted');
  });
});
