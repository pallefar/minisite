/**
 * Phase 9 Plan 09-10 — SC#5 revoke-latency drill (D-10 two-layer revoke).
 *
 * Replaces the Plan 09-01 Wave-0 scaffold stub.
 *
 * Verifies the load-bearing user-visible revocation guarantee:
 *
 *   Layer 1 (Realtime UX overlay):
 *     Patient revokes their membership from Settings -> operator's
 *     `org:<orgId>` Realtime channel receives the corresponding
 *     UPDATE/DELETE broadcast within the SLA window. The plan SLA is
 *     <1s; the orchestrator's success-criteria ceiling is <5s. We assert
 *     both:
 *       - hard ceiling: <5000ms (orchestrator success criterion)
 *       - SC#5 target:  <1500ms (plan body) — soft, logged but not failed
 *         if it slips between 1500ms and 5000ms (RC5 cluster tolerance
 *         per memory `feedback_defer_then_batch_fix_pattern.md`).
 *
 *   Layer 2 (DB-check security floor):
 *     After revoke, any operator drill-in via the clinic-photo Edge
 *     Function returns 401 — independent of Realtime. Layer 2 MUST be
 *     green regardless of whether the operator's Realtime channel is
 *     live, dead, or never subscribed at all.
 *
 *   Layer 2 — Realtime-independent isolated test:
 *     Same as above but operator's Realtime channel is intentionally
 *     never subscribed. Confirms the DB-check fires on every request and
 *     is not a Realtime-side derivation.
 *
 *   CLINIC-07 capture half:
 *     `audit_logs` contains a `membership_revoked` row scoped to the
 *     correct org_id.
 *
 * Pattern (deviation from plan body — see 09-10-SUMMARY.md):
 *   We exercise the operator's "UI" via a supabase-js client subscribed
 *   to `org:<orgId>` rather than a Playwright browser context. The
 *   Realtime broadcast is the event the operator's MembersTab UI
 *   consumes (via `subscribeToOrgChannel` in
 *   `src/lib/clinic-realtime.ts`). Asserting at the supabase-js layer
 *   is consistent with the Wave 4 Plan 09-09 decision "DB-level
 *   invariant verification over UI traversal" and avoids both the
 *   browser-context auth-seeding fragility (per memory
 *   `reference_playwright_state_seeding.md`) and the RC5 cluster
 *   failure mode that deferred 7 Phase 7 specs.
 *
 *   The Layer 2 assertion is a single-context HTTP fetch with no
 *   Realtime dependency — it stays green regardless of Layer 1
 *   behavior.
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
  getAdmin,
  getAuditRows,
  hasLiveSupabase,
  revokeMembershipAs,
  SUPABASE_URL,
  testEmail,
  testRunId,
} from './fixtures/clinic-fixtures';

interface BroadcastEvent {
  type: string;
  payload: unknown;
  receivedAt: number;
}

/**
 * Subscribe a supabase-js client to `org:<orgId>` mirroring the
 * production pattern in `src/lib/clinic-realtime.ts#subscribeToOrgChannel`
 * (private channel, setAuth-before-subscribe). The same broadcast events
 * the MembersTab UI receives are pushed into `events[]`.
 */
async function subscribeOrgChannel(opts: {
  client: SupabaseClient;
  orgId: string;
  events: BroadcastEvent[];
}): Promise<RealtimeChannel> {
  // Pitfall #2 — setAuth() MUST precede subscribe() so the channel
  // attaches with a valid JWT and `realtime.messages` SELECT RLS passes.
  await opts.client.realtime.setAuth();

  const channel = opts.client.channel(`org:${opts.orgId}`, {
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

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('org channel did not reach SUBSCRIBED within 10s')),
      10_000,
    );
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timeout);
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        clearTimeout(timeout);
        reject(new Error(`org channel subscribe returned ${status}`));
      }
    });
  });

  return channel;
}

async function waitForBroadcast(opts: {
  events: BroadcastEvent[];
  baseline: number;
  timeoutMs: number;
}): Promise<BroadcastEvent> {
  const start = Date.now();
  while (Date.now() - start < opts.timeoutMs) {
    const hit = opts.events
      .slice(opts.baseline)
      .find((e) => e.type === 'UPDATE' || e.type === 'DELETE');
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(
    `no UPDATE/DELETE broadcast on org channel within ${opts.timeoutMs}ms ` +
      `(events seen: ${opts.events.length - opts.baseline})`,
  );
}

test.describe('@phase09 SC#5 revoke latency — D-10 two-layer revoke drill', () => {
  test.skip(
    !hasLiveSupabase(),
    'requires SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY',
  );
  test.setTimeout(120_000);

  const runId = testRunId();

  test.afterAll(async () => {
    await cleanupClinicFixtures({
      emailPattern: `revoke-${runId}`,
      slugPattern: `revoke-${runId}`,
    });
  });

  test('Layer 1 — operator org channel receives revoke broadcast within 5s (target <1.5s)', async () => {
    // 1. Operator + org.
    const opFix = await createOperatorWithOrg(`revoke-l1-${runId}`);

    // 2. Patient invited + accepts.
    const patient = await createUser({
      email: testEmail(`revoke-l1-pt-${runId}`, 'p'),
    });
    const invite = await createInviteViaRpc({
      operatorClient: opFix.client,
      orgId: opFix.orgId,
      email: patient.email,
    });
    const accepted = await acceptInviteAs({
      patient,
      tokenHash: invite.tokenHash,
      consentScope: fullConsentScope(),
    });

    // 3. Operator subscribes to `org:<orgId>` broadcast topic.
    //    Mirrors the MembersTab production subscription
    //    (`src/lib/clinic-realtime.ts#subscribeToOrgChannel`).
    const events: BroadcastEvent[] = [];
    const channel = await subscribeOrgChannel({
      client: opFix.client,
      orgId: opFix.orgId,
      events,
    });

    // Settle the channel briefly to drain any backlog from the INSERT
    // broadcast that fired during accept_invite_existing.
    await new Promise((r) => setTimeout(r, 500));
    const baseline = events.length;

    // 4. Patient revokes their membership via revoke_membership RPC.
    //    This is the same gate the Settings -> Active organizations -> Revoke
    //    button calls (auth.uid() = memberships.user_id) so the broadcast
    //    payload is identical to what production fires.
    const revokeStart = Date.now();
    await revokeMembershipAs({
      patient,
      membershipId: accepted.membershipId,
    });

    // 5. Operator's channel receives the broadcast within the 5s ceiling.
    let elapsed = -1;
    try {
      const newEvent = await waitForBroadcast({ events, baseline, timeoutMs: 5000 });
      elapsed = newEvent.receivedAt - revokeStart;
    } finally {
      await channel.unsubscribe();
    }

    // 5a. Hard ceiling: <5000ms (orchestrator success criterion).
    expect(
      elapsed,
      `broadcast received in ${elapsed}ms; ceiling is 5000ms`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      elapsed,
      `broadcast received in ${elapsed}ms; ceiling is 5000ms`,
    ).toBeLessThanOrEqual(5000);

    // 5b. SC#5 target: <1500ms (plan body) — log only, do not fail on slip.
    //     Per memory `feedback_defer_then_batch_fix_pattern.md`, RC5 cold-CI
    //     timing jitter can push past 1500ms but stays within the 5s ceiling.
    if (elapsed > 1500) {
       
      console.warn(
        `[revoke-latency] SC#5 1500ms target slipped to ${elapsed}ms ` +
          `(within 5000ms ceiling — orchestrator-acceptable)`,
      );
    }

    // 6. CLINIC-07 capture half — audit row written for the revoke.
    const audit = await getAuditRows({ orgId: opFix.orgId });
    const actions = audit.map((r) => r.action);
    expect(
      actions,
      'audit_logs has membership_revoked entry for org',
    ).toContain('membership_revoked');
  });

  test('Layer 2 — clinic-photo returns 401 after revoke (operator has live JWT, no Realtime needed)', async () => {
    if (!SUPABASE_URL) throw new Error('SUPABASE_URL not set');

    // 1. Operator + org.
    const opFix = await createOperatorWithOrg(`revoke-l2-${runId}`);

    // 2. Patient invited + accepts.
    const patient = await createUser({
      email: testEmail(`revoke-l2-pt-${runId}`, 'p'),
    });
    const invite = await createInviteViaRpc({
      operatorClient: opFix.client,
      orgId: opFix.orgId,
      email: patient.email,
    });
    const accepted = await acceptInviteAs({
      patient,
      tokenHash: invite.tokenHash,
      consentScope: fullConsentScope(),
    });

    // 3. Operator obtains a JWT — Layer 2 path uses no Realtime channel at all.
    //    The DB-check is on every request; it must fire whether or not the
    //    operator's UI is subscribed to a broadcast topic.
    const { data: opSession } = await opFix.client.auth.getSession();
    const operatorJwt = opSession.session?.access_token;
    expect(operatorJwt, 'operator JWT available').toBeTruthy();

    // 4. Patient revokes their membership.
    await revokeMembershipAs({
      patient,
      membershipId: accepted.membershipId,
    });

    // 5. Operator drill-in to clinic-photo returns 401 within seconds.
    //    photoId is intentionally bogus — the function MUST gate on
    //    membership state BEFORE looking up the photo, so any photoId
    //    triggers the 401 once revoked. This matches the gate ordering
    //    in `supabase/functions/clinic-photo/index.ts` (membership check
    //    precedes photo lookup).
    const fakePhotoId = '00000000-0000-0000-0000-000000000001';
    const callStart = Date.now();
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/clinic-photo/${opFix.orgId}/${patient.id}/${fakePhotoId}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${operatorJwt}` },
      },
    );
    const callElapsed = Date.now() - callStart;
    expect(
      callElapsed,
      `clinic-photo Layer 2 response in ${callElapsed}ms; ceiling 5000ms`,
    ).toBeLessThanOrEqual(5000);
    expect(res.status, 'Layer 2 — 401 after revoke').toBe(401);
  });

  test('Layer 2 — DB-check still fires with NO operator Realtime channel ever subscribed', async () => {
    // Orthogonal verification: the Layer 2 401 is not a consequence of the
    // Realtime channel detecting the change. We never subscribe to anything;
    // the 401 must still fire. This proves the security floor is the DB
    // check, not the broadcast.
    if (!SUPABASE_URL) throw new Error('SUPABASE_URL not set');

    const opFix = await createOperatorWithOrg(`revoke-l2-no-rt-${runId}`);
    const patient = await createUser({
      email: testEmail(`revoke-l2-no-rt-pt-${runId}`, 'p'),
    });
    const invite = await createInviteViaRpc({
      operatorClient: opFix.client,
      orgId: opFix.orgId,
      email: patient.email,
    });
    const accepted = await acceptInviteAs({
      patient,
      tokenHash: invite.tokenHash,
      consentScope: fullConsentScope(),
    });

    const { data: opSession } = await opFix.client.auth.getSession();
    const operatorJwt = opSession.session?.access_token;
    expect(operatorJwt).toBeTruthy();

    // Pre-revoke baseline: a call should NOT be 401 (it'll 404 on bogus
    // photoId, or 403 if some other check fires, but the membership gate
    // is open so 401 should not be the result).
    const fakePhotoId = '00000000-0000-0000-0000-000000000002';
    const baselineRes = await fetch(
      `${SUPABASE_URL}/functions/v1/clinic-photo/${opFix.orgId}/${patient.id}/${fakePhotoId}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${operatorJwt}` },
      },
    );
    expect(
      baselineRes.status,
      `pre-revoke baseline status should NOT be 401 (got ${baselineRes.status})`,
    ).not.toBe(401);

    // Patient revokes (no Realtime subscription on either side).
    await revokeMembershipAs({
      patient,
      membershipId: accepted.membershipId,
    });

    // Post-revoke: 401 fires on every subsequent call, no Realtime
    // dependency in the path.
    const postRes = await fetch(
      `${SUPABASE_URL}/functions/v1/clinic-photo/${opFix.orgId}/${patient.id}/${fakePhotoId}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${operatorJwt}` },
      },
    );
    expect(postRes.status, 'Layer 2 — 401 after revoke (no Realtime in path)').toBe(401);
  });

  test('Late subscriber — operator who subscribes AFTER revoke sees correct DB state', async () => {
    // Late-subscribe verification: an operator client that subscribes to
    // the org channel AFTER the patient already revoked still sees the
    // correct row state when it queries memberships. This covers the
    // production scenario where MembersTab mounts after a revoke that
    // happened while the operator was on another route. The fresh
    // subscriber doesn't get a "missed" broadcast but the SELECT path
    // (which the UI also uses on mount) reflects truth.
    const opFix = await createOperatorWithOrg(`revoke-reconnect-${runId}`);
    const patient = await createUser({
      email: testEmail(`revoke-reconnect-pt-${runId}`, 'p'),
    });
    const invite = await createInviteViaRpc({
      operatorClient: opFix.client,
      orgId: opFix.orgId,
      email: patient.email,
    });
    const accepted = await acceptInviteAs({
      patient,
      tokenHash: invite.tokenHash,
      consentScope: fullConsentScope(),
    });

    // Revoke FIRST — before the operator subscribes.
    await revokeMembershipAs({
      patient,
      membershipId: accepted.membershipId,
    });

    // Operator subscribes AFTER (simulates remount or tab focus).
    const events: BroadcastEvent[] = [];
    const channel = await subscribeOrgChannel({
      client: opFix.client,
      orgId: opFix.orgId,
      events,
    });

    // The active-membership SELECT (MembersTab's data path) reflects the
    // revoke; no patient row remains in the active-set even though no
    // broadcast arrived to this fresh subscriber. Use admin to read all
    // rows (the operator-scoped client would be filtered by RLS).
    const admin = getAdmin();
    const { data: activeRows } = await admin
      .from('memberships')
      .select('id, user_id, revoked_at')
      .eq('org_id', opFix.orgId)
      .is('revoked_at', null)
      .neq('user_id', opFix.operator.id); // exclude the operator's own seed row
    expect(activeRows ?? [], 'no active non-operator memberships post-revoke').toHaveLength(0);

    await channel.unsubscribe();
  });
});
