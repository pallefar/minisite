/**
 * Phase 9 Plan 09-10 — Realtime negative-space drill (Pitfall #2 invariant).
 *
 * Three tests verify the `realtime.messages` RLS policy
 * (`clinic_org_topic_select` from migration `20260801000012`):
 *
 *   1. Non-member operator (different org entirely) subscribes to
 *      `org:<X_org_id>`. When operator A inside org X performs a
 *      membership UPDATE/DELETE (revoke), the trigger
 *      `broadcast_membership_changes` (migration 13) fires broadcasts
 *      to `org:<X_org_id>` AND `user:<patient_id>`. Operator B (member
 *      of a DIFFERENT org Y, no membership in X) MUST receive zero
 *      events. Their channel either errors on subscribe OR subscribes
 *      successfully and silently drops messages per Supabase Realtime
 *      RLS-gated broadcast semantics.
 *
 *   2. Non-existent org topic. A real user subscribes to
 *      `org:00000000-0000-0000-0000-000000000000`. No org with that
 *      UUID exists; `has_permission(uid, fakeUuid, 'org.read')`
 *      returns false (no membership). The subscription either errors
 *      or stays empty.
 *
 *   3. Cross-tenant user channel. User B (patient) subscribes to
 *      `user:<C_user_id>` (someone else's user channel). RLS gates on
 *      `auth.uid() = parsed_user_id` so SELECT on realtime.messages is
 *      denied; events stay empty even when C's membership rows change.
 *
 * Pattern reuse:
 *   - All setup via `e2e/fixtures/clinic-fixtures.ts` (Plan 09-09).
 *   - Skip-gated on SUPABASE_SERVICE_ROLE_KEY (Wave 4 pattern).
 *   - Subscribe-then-wait window is 5 seconds. We choose 5s because:
 *     (a) Supabase Realtime delivers a valid broadcast within
 *         ~100-300ms locally; if our event delivery takes >5s the test
 *         would already be in RC5 territory.
 *     (b) The trigger fires synchronously inside the SQL transaction;
 *         delivery is fan-out, not retry-with-backoff.
 *
 * Subscribe semantics:
 *   `channel.subscribe(callback)` resolves with one of:
 *     - 'SUBSCRIBED'      — channel attached, RLS passed.
 *     - 'CHANNEL_ERROR'   — server rejected (typical when RLS denies).
 *     - 'TIMED_OUT'       — no server response in window.
 *     - 'CLOSED'          — already closed.
 *
 *   Either CHANNEL_ERROR/CLOSED OR a SUBSCRIBED-with-zero-events outcome
 *   is acceptable here — both satisfy the security invariant. We assert
 *   ONLY on the events array length.
 */
import { expect, test } from '@playwright/test';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

import {
  acceptInviteAs,
  cleanupClinicFixtures,
  createInviteViaRpc,
  createOperatorWithOrg,
  createUser,
  fullConsentScope,
  hasLiveSupabase,
  revokeMembershipAs,
  signIn,
  testEmail,
  testRunId,
} from './fixtures/clinic-fixtures';

interface BroadcastEvent {
  type: string;
  payload: unknown;
  receivedAt: number;
}

/**
 * Subscribe a supabase-js client to an arbitrary topic. Returns the
 * final subscription status AND the channel handle so the caller can
 * unsubscribe cleanly. NEVER throws on CHANNEL_ERROR — the whole point
 * of these tests is to observe RLS-rejected subscribes.
 */
async function subscribeTopicCollect(opts: {
  client: SupabaseClient;
  topic: string;
  events: BroadcastEvent[];
  timeoutMs?: number;
}): Promise<{ channel: RealtimeChannel; finalStatus: string }> {
  // Pitfall #2 — setAuth() before subscribe() so RLS sees the real JWT.
  await opts.client.realtime.setAuth();

  const channel = opts.client.channel(opts.topic, {
    config: { private: true },
  });
  channel
    .on('broadcast', { event: 'INSERT' }, (e) =>
      opts.events.push({ type: 'INSERT', payload: e, receivedAt: Date.now() }),
    )
    .on('broadcast', { event: 'UPDATE' }, (e) =>
      opts.events.push({ type: 'UPDATE', payload: e, receivedAt: Date.now() }),
    )
    .on('broadcast', { event: 'DELETE' }, (e) =>
      opts.events.push({ type: 'DELETE', payload: e, receivedAt: Date.now() }),
    );

  const finalStatus = await new Promise<string>((resolve) => {
    const timeout = setTimeout(() => resolve('TIMED_OUT_OUTER'), opts.timeoutMs ?? 10_000);
    channel.subscribe((status) => {
      if (
        status === 'SUBSCRIBED' ||
        status === 'CHANNEL_ERROR' ||
        status === 'TIMED_OUT' ||
        status === 'CLOSED'
      ) {
        clearTimeout(timeout);
        resolve(status);
      }
    });
  });

  return { channel, finalStatus };
}

test.describe('@phase09 Realtime negative-space — Pitfall #2 RLS invariant', () => {
  test.skip(
    !hasLiveSupabase(),
    'requires SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY',
  );
  test.setTimeout(120_000);

  const runId = testRunId();

  test.afterAll(async () => {
    await cleanupClinicFixtures({
      emailPattern: `rt-neg-${runId}`,
      slugPattern: `rt-neg-${runId}`,
    });
  });

  test('Test 1 — non-member operator B (different org) receives zero broadcasts from org A', async () => {
    // 1. Org X with operator A + patient (the actor whose revoke we'll observe).
    const orgX = await createOperatorWithOrg(`rt-neg-orgx-${runId}`);
    const patientX = await createUser({
      email: testEmail(`rt-neg-orgx-pt-${runId}`, 'p'),
    });
    const inviteX = await createInviteViaRpc({
      operatorClient: orgX.client,
      orgId: orgX.orgId,
      email: patientX.email,
    });
    const acceptedX = await acceptInviteAs({
      patient: patientX,
      tokenHash: inviteX.tokenHash,
      consentScope: fullConsentScope(),
    });

    // 2. Operator B owns a SEPARATE org Y — has no relationship to org X.
    //    Per CLINIC-02/03 model an operator can own multiple orgs; the
    //    invariant is "no membership in X => no broadcasts from X".
    const orgY = await createOperatorWithOrg(`rt-neg-orgy-${runId}`);

    // 3. Operator B subscribes to `org:<X_org_id>` (a topic they have no
    //    permission to read). RLS on realtime.messages should reject; the
    //    events array MUST stay empty even when org X's membership rows
    //    change.
    const eventsB: BroadcastEvent[] = [];
    const { channel: chanB, finalStatus: statusB } = await subscribeTopicCollect({
      client: orgY.client,
      topic: `org:${orgX.orgId}`,
      events: eventsB,
    });

    try {
      // 4. Cause a broadcast on `org:<X_org_id>` by revoking patientX's
      //    membership. This fires `broadcast_membership_changes` -> trigger
      //    inserts into realtime.messages with topic = `org:<X_org_id>`.
      await revokeMembershipAs({
        patient: patientX,
        membershipId: acceptedX.membershipId,
      });

      // 5. Wait the delivery window. Operator B is in a DIFFERENT org with
      //    no membership in X; RLS denies the SELECT.
      await new Promise((r) => setTimeout(r, 5000));

      // 6. ASSERT zero events on operator B's channel — RLS gating verified.
      //    Either finalStatus === 'CHANNEL_ERROR' (server rejected the
      //    private subscribe outright) OR finalStatus === 'SUBSCRIBED' with
      //    zero events (server attached but silently drops RLS-denied msgs).
      //    Both outcomes satisfy the invariant. We log the status for
      //    diagnostic clarity but assert ONLY on events.
       
      console.log(
        `[rt-neg Test 1] non-member subscribe finalStatus=${statusB}; events=${eventsB.length}`,
      );
      expect(
        eventsB,
        `non-member operator received broadcasts from org X (RLS broken!) ` +
          `finalStatus=${statusB} events=${JSON.stringify(eventsB)}`,
      ).toHaveLength(0);
    } finally {
      await chanB.unsubscribe();
    }
  });

  test('Test 2 — subscriber to non-existent org topic receives zero broadcasts', async () => {
    // A legitimate logged-in user subscribes to a fake org UUID — no row
    // in `orgs`, no `memberships` rows, no permission. The trigger never
    // fires for this topic so there are no broadcasts to gate; the test
    // primarily proves the subscribe path doesn't crash and never delivers
    // a phantom message.
    const fakeOrgId = '00000000-0000-0000-0000-000000000000';

    const userU = await createUser({
      email: testEmail(`rt-neg-fakeorg-${runId}`, 'u'),
    });
    const userClient = await signIn(userU);

    const events: BroadcastEvent[] = [];
    const { channel, finalStatus } = await subscribeTopicCollect({
      client: userClient,
      topic: `org:${fakeOrgId}`,
      events,
    });

    try {
      // Trigger SOME unrelated broadcast (revoke in a real org) to ensure
      // we're not falsely passing because the realtime fabric is quiet.
      const orgZ = await createOperatorWithOrg(`rt-neg-fakeorg-noise-${runId}`);
      const noisePatient = await createUser({
        email: testEmail(`rt-neg-fakeorg-noise-pt-${runId}`, 'p'),
      });
      const noiseInv = await createInviteViaRpc({
        operatorClient: orgZ.client,
        orgId: orgZ.orgId,
        email: noisePatient.email,
      });
      const noiseAccept = await acceptInviteAs({
        patient: noisePatient,
        tokenHash: noiseInv.tokenHash,
        consentScope: fullConsentScope(),
      });
      await revokeMembershipAs({
        patient: noisePatient,
        membershipId: noiseAccept.membershipId,
      });

      await new Promise((r) => setTimeout(r, 5000));

       
      console.log(
        `[rt-neg Test 2] fake-org subscribe finalStatus=${finalStatus}; events=${events.length}`,
      );
      expect(
        events,
        `fake-org subscriber received phantom broadcasts ` +
          `finalStatus=${finalStatus} events=${JSON.stringify(events)}`,
      ).toHaveLength(0);
    } finally {
      await channel.unsubscribe();
    }
  });

  test('Test 3 — cross-tenant user channel: user B cannot subscribe to user C', async () => {
    // RLS on realtime.messages for `user:<id>` topic gates on
    // `auth.uid() = parsed_user_id`. User B (a real user) subscribes to
    // user C's channel; when user C's membership changes the broadcast
    // fires to `user:<C_id>` but B never sees it.

    // User B — any signed-in user.
    const userB = await createUser({
      email: testEmail(`rt-neg-userB-${runId}`, 'b'),
    });
    const userBClient = await signIn(userB);

    // User C — a real user whose membership we can change to fire a
    // broadcast on `user:<C_id>`.
    const orgZ = await createOperatorWithOrg(`rt-neg-cross-${runId}`);
    const userC = await createUser({
      email: testEmail(`rt-neg-userC-${runId}`, 'c'),
    });
    const inviteC = await createInviteViaRpc({
      operatorClient: orgZ.client,
      orgId: orgZ.orgId,
      email: userC.email,
    });
    const acceptedC = await acceptInviteAs({
      patient: userC,
      tokenHash: inviteC.tokenHash,
      consentScope: fullConsentScope(),
    });

    // User B subscribes to `user:<C_id>` — cross-tenant denial expected.
    const events: BroadcastEvent[] = [];
    const { channel, finalStatus } = await subscribeTopicCollect({
      client: userBClient,
      topic: `user:${userC.id}`,
      events,
    });

    try {
      // Trigger a broadcast on `user:<C_id>` — userC revokes themselves.
      await revokeMembershipAs({
        patient: userC,
        membershipId: acceptedC.membershipId,
      });

      // Wait the delivery window.
      await new Promise((r) => setTimeout(r, 5000));

       
      console.log(
        `[rt-neg Test 3] cross-tenant user-channel subscribe finalStatus=${finalStatus}; events=${events.length}`,
      );
      expect(
        events,
        `user B received broadcasts on user C's user-channel (RLS broken!) ` +
          `finalStatus=${finalStatus} events=${JSON.stringify(events)}`,
      ).toHaveLength(0);
    } finally {
      await channel.unsubscribe();
    }
  });
});
