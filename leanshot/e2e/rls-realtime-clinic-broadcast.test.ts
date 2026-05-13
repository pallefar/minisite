/**
 * Phase 10 Plan 10-03 — Realtime broadcast_patient_signal_change proofs.
 *
 * Verifies the AFTER INSERT trigger on injections / weights / symptoms:
 *
 *   Test 1 (in-org happy path):
 *     Patient A is member of Org 1 with consent_scope.injections=true.
 *     Operator B subscribes to `org:{org_1_id}`.
 *     Patient A inserts injection → Operator B receives broadcast within 5s
 *     with payload.section='injections'.
 *
 *   Test 2 (cross-org isolation):
 *     Patient A is NOT a member of Org 2.
 *     Operator C subscribes to `org:{org_2_id}`.
 *     Patient A inserts injection → Operator C receives ZERO broadcasts
 *     (server-side filter: no active membership in Org 2).
 *
 *   Test 3 (consent_scope filter — false):
 *     Patient A is member of Org 1 with consent_scope.injections=false.
 *     Operator B subscribes to `org:{org_1_id}`.
 *     Patient A inserts injection → no broadcast for Org 1 (COALESCE default=false).
 *
 *   Test 4 (revoked membership):
 *     Patient A had membership in Org 1 but revoked_at IS NOT NULL.
 *     Patient A inserts injection → no broadcast for Org 1.
 *
 *   Test 5 (multi-org):
 *     Patient A is member of Org 1 AND Org 3 (both consent_scope.injections=true).
 *     Operators B (Org 1) and D (Org 3) both subscribe.
 *     Patient A inserts injection → both receive separate broadcasts on their
 *     respective channels.
 *
 *   Test 6 (weights table):
 *     Patient A inserts weight → broadcast section='weights'.
 *
 *   Test 7 (symptoms table):
 *     Patient A inserts symptom → broadcast section='symptoms'.
 *
 * Pattern notes:
 *   - Realtime e2e pattern from Phase 9 Plan 09-10: instantiate the receiving
 *     channel.subscribe() directly in the test file — no Playwright UI traversal.
 *   - Topic format 'org:{uuid}' (colon) matches Phase 9 RLS policy
 *     (20260801000012_realtime_messages_rls.sql).
 *   - realtime.setAuth() called before subscribe() per Pitfall #2.
 *   - All setup/teardown via clinic-fixtures.ts admin helpers.
 *   - Skip-gated on SUPABASE_SERVICE_ROLE_KEY (live DB only).
 *   - _validate_consent_scope requires all 10 keys present — use fullConsentScope()
 *     for invite/accept, then patch individual keys via admin setConsentScope().
 */

import { type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

import {
  acceptInviteAs,
  cleanupClinicFixtures,
  createInviteViaRpc,
  createOperatorWithOrg,
  createUser,
  fullConsentScope,
  getAdmin,
  hasLiveSupabase,
  signIn,
  testEmail,
  testRunId,
} from './fixtures/clinic-fixtures';

const SHOULD_RUN = hasLiveSupabase();
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// ─── wait-for-broadcast helper ───────────────────────────────────────────────

interface BroadcastPayload {
  event?: string;
  user_id?: string;
  section?: string;
  changed_at?: string;
  [key: string]: unknown;
}

interface CollectedEvent {
  payload: BroadcastPayload;
  receivedAt: number;
}

/**
 * Subscribe to an org-scoped Realtime channel and collect `patient_signal_change`
 * broadcast events. Returns channel handle + collected events array.
 *
 * Pitfall #2 guard: call setAuth() before subscribe() so RLS sees the real JWT.
 */
async function subscribeOrgChannel(opts: {
  client: SupabaseClient;
  orgId: string;
  events: CollectedEvent[];
  timeoutMs?: number;
}): Promise<{ channel: RealtimeChannel; finalStatus: string }> {
  await opts.client.realtime.setAuth();

  const channel = opts.client.channel(`org:${opts.orgId}`, {
    config: { private: true },
  });

  channel.on('broadcast', { event: 'patient_signal_change' }, (e) => {
    opts.events.push({
      payload: (e.payload ?? {}) as BroadcastPayload,
      receivedAt: Date.now(),
    });
  });

  const finalStatus = await new Promise<string>((resolve) => {
    const deadline = setTimeout(
      () => resolve('TIMED_OUT_OUTER'),
      opts.timeoutMs ?? 12_000,
    );
    channel.subscribe((status) => {
      if (
        status === 'SUBSCRIBED' ||
        status === 'CHANNEL_ERROR' ||
        status === 'TIMED_OUT' ||
        status === 'CLOSED'
      ) {
        clearTimeout(deadline);
        resolve(status);
      }
    });
  });

  return { channel, finalStatus };
}

/**
 * Wait up to `maxWaitMs` for `events` to accumulate at least `minCount` items.
 * Polls every 200ms.
 */
async function waitForEvents(
  events: CollectedEvent[],
  minCount: number,
  maxWaitMs = 5000,
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (events.length >= minCount) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

// ─── helpers to insert patient data ──────────────────────────────────────────

async function insertInjection(client: SupabaseClient, userId: string): Promise<void> {
  const { error } = await client.from('injections').insert({
    user_id: userId,
    log_id: crypto.randomUUID(),
    medication: 'ozempic',
    dose: '0.5',
    unit: 'mg',
    site: 'abdomen',
    notes: '',
    logged_at: new Date().toISOString(),
    pk_engine_version: 1,
  });
  if (error) throw new Error(`insertInjection failed: ${error.message}`);
}

async function insertWeight(client: SupabaseClient, userId: string): Promise<void> {
  const { error } = await client.from('weights').insert({
    user_id: userId,
    weight_id: crypto.randomUUID(),
    date: new Date().toISOString().slice(0, 10),
    weight: 80.5,
    body_fat: null,
    ts: Date.now(),
  });
  if (error) throw new Error(`insertWeight failed: ${error.message}`);
}

async function insertSymptom(client: SupabaseClient, userId: string): Promise<void> {
  const { error } = await client.from('symptoms').insert({
    user_id: userId,
    symptom_id: crypto.randomUUID(),
    date: new Date().toISOString().slice(0, 10),
    symptom: 'nausea',
    severity: 2,
    notes: '',
  });
  if (error) throw new Error(`insertSymptom failed: ${error.message}`);
}

// ─── consent_scope + membership admin helpers ─────────────────────────────────

/**
 * Update a single key in the membership's consent_scope via read-modify-write.
 * Uses the admin (service-role) client to bypass RLS.
 */
async function setConsentScopeKey(
  membershipId: string,
  key: string,
  value: boolean,
): Promise<void> {
  const admin = getAdmin();

  // Read current scope
  const { data: row, error: readErr } = await admin
    .from('memberships')
    .select('consent_scope')
    .eq('id', membershipId)
    .single();

  if (readErr) throw new Error(`setConsentScopeKey read failed: ${readErr.message}`);

  const existing = (row?.consent_scope as Record<string, boolean>) ?? {};
  const updated = { ...existing, [key]: value };

  const { error: writeErr } = await admin
    .from('memberships')
    .update({ consent_scope: updated })
    .eq('id', membershipId);

  if (writeErr) throw new Error(`setConsentScopeKey write failed: ${writeErr.message}`);
}

async function revokeMembership(membershipId: string): Promise<void> {
  const admin = getAdmin();
  const { error } = await admin
    .from('memberships')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', membershipId);
  if (error) throw new Error(`revokeMembership failed: ${error.message}`);
}

// ─── test suite ──────────────────────────────────────────────────────────────

describeIfLive(
  'Phase 10 Plan 10-03 — broadcast_patient_signal_change trigger proofs',
  () => {
    const runId = testRunId();

    afterAll(async () => {
      await cleanupClinicFixtures({
        emailPattern: `bc-${runId}`,
        slugPattern: `bc-${runId}`,
      });
    });

    // ─── Test 1: in-org happy path ─────────────────────────────────────────

    it(
      'Test 1 — in-org broadcast: patient injection reaches operator on correct org channel',
      async () => {
        // Setup: Org 1 with operator B (owner).
        const org1 = await createOperatorWithOrg(`bc-org1-${runId}`);

        // Patient A: use fullConsentScope() for invite/accept (validator requires all keys),
        // then no patch needed since injections=true is the default.
        const patientA = await createUser({
          email: testEmail(`bc-ptA-${runId}`, 'a'),
        });
        const invite1 = await createInviteViaRpc({
          operatorClient: org1.client,
          orgId: org1.orgId,
          email: patientA.email,
        });
        await acceptInviteAs({
          patient: patientA,
          tokenHash: invite1.tokenHash,
          consentScope: fullConsentScope(),
        });

        // Operator B subscribes to org:org_1_id.
        const eventsB: CollectedEvent[] = [];
        const { channel: chanB, finalStatus } = await subscribeOrgChannel({
          client: org1.client,
          orgId: org1.orgId,
          events: eventsB,
        });

        try {
          // Sanity check — subscription must not hard-fail.
          if (finalStatus === 'CHANNEL_ERROR') {
            throw new Error(
              `Operator B (org owner) could not subscribe to org:${org1.orgId} — RLS denied`,
            );
          }

          // Patient A inserts injection.
          const patientAClient = await signIn(patientA);
          await insertInjection(patientAClient, patientA.id);

          // Wait for broadcast (up to 5s).
          await waitForEvents(eventsB, 1, 5000);

          expect(
            eventsB.length,
            `Expected 1 broadcast event but got ${eventsB.length}; finalStatus=${finalStatus}`,
          ).toBeGreaterThanOrEqual(1);

          const evt = eventsB[0];
          expect(evt.payload.section).toBe('injections');
          expect(evt.payload.user_id).toBe(patientA.id);
          expect(typeof evt.payload.changed_at).toBe('string');
        } finally {
          await chanB.unsubscribe();
        }
      },
      30_000,
    );

    // ─── Test 2: cross-org isolation ───────────────────────────────────────

    it(
      'Test 2 — cross-org isolation: patient A not in Org 2, Operator C receives zero broadcasts',
      async () => {
        // Org 1 + patient A (member of Org 1 only).
        const org1 = await createOperatorWithOrg(`bc-xorg1-${runId}`);
        const patientA = await createUser({
          email: testEmail(`bc-xptA-${runId}`, 'a'),
        });
        const invite1 = await createInviteViaRpc({
          operatorClient: org1.client,
          orgId: org1.orgId,
          email: patientA.email,
        });
        await acceptInviteAs({
          patient: patientA,
          tokenHash: invite1.tokenHash,
          consentScope: fullConsentScope(),
        });

        // Org 2 — completely separate; patient A has NO membership here.
        const org2 = await createOperatorWithOrg(`bc-xorg2-${runId}`);

        // Operator C (org 2 owner) subscribes to org:org_2_id.
        const eventsC: CollectedEvent[] = [];
        const { channel: chanC, finalStatus: statusC } = await subscribeOrgChannel({
          client: org2.client,
          orgId: org2.orgId,
          events: eventsC,
        });

        try {
          // Patient A inserts injection — triggers broadcast on org:org_1_id only.
          const patientAClient = await signIn(patientA);
          await insertInjection(patientAClient, patientA.id);

          // Wait 3s for any errant broadcast to arrive.
          await new Promise((r) => setTimeout(r, 3000));

          console.log(
            `[Test 2] Operator C finalStatus=${statusC}; events received=${eventsC.length}`,
          );

          expect(
            eventsC,
            `Operator C in Org 2 received broadcasts that should be isolated to Org 1! ` +
              `events=${JSON.stringify(eventsC)}`,
          ).toHaveLength(0);
        } finally {
          await chanC.unsubscribe();
        }
      },
      30_000,
    );

    // ─── Test 3: consent_scope filter (false) ──────────────────────────────

    it(
      'Test 3 — consent_scope filter: injections=false suppresses broadcast at server',
      async () => {
        // Org 1 + operator B.
        const org1 = await createOperatorWithOrg(`bc-cs-${runId}`);

        // Patient A: accept with fullConsentScope (required by validator),
        // then patch injections=false via admin to set up the filter test.
        const patientA = await createUser({
          email: testEmail(`bc-csptA-${runId}`, 'a'),
        });
        const invite1 = await createInviteViaRpc({
          operatorClient: org1.client,
          orgId: org1.orgId,
          email: patientA.email,
        });
        const membership1 = await acceptInviteAs({
          patient: patientA,
          tokenHash: invite1.tokenHash,
          consentScope: fullConsentScope(),
        });

        // Now flip injections to false via admin (bypasses validator — we're testing
        // the trigger's COALESCE gate, not the validator).
        await setConsentScopeKey(membership1.membershipId, 'injections', false);

        // Operator B subscribes.
        const eventsB: CollectedEvent[] = [];
        const { channel: chanB } = await subscribeOrgChannel({
          client: org1.client,
          orgId: org1.orgId,
          events: eventsB,
        });

        try {
          // Patient A inserts injection — consent_scope.injections=false
          // so trigger MUST NOT broadcast to org:org_1_id.
          const patientAClient = await signIn(patientA);
          await insertInjection(patientAClient, patientA.id);

          // Wait for any errant broadcast.
          await new Promise((r) => setTimeout(r, 3000));

          expect(
            eventsB,
            `Operator B received a broadcast despite consent_scope.injections=false! ` +
              `events=${JSON.stringify(eventsB)}`,
          ).toHaveLength(0);
        } finally {
          await chanB.unsubscribe();
        }
      },
      30_000,
    );

    // ─── Test 4: revoked membership ────────────────────────────────────────

    it(
      'Test 4 — revoked membership: no broadcast when revoked_at IS NOT NULL',
      async () => {
        // Org 1 + patient with fullConsentScope (injections=true).
        const org1 = await createOperatorWithOrg(`bc-rev-${runId}`);
        const patientA = await createUser({
          email: testEmail(`bc-revptA-${runId}`, 'a'),
        });
        const invite1 = await createInviteViaRpc({
          operatorClient: org1.client,
          orgId: org1.orgId,
          email: patientA.email,
        });
        const membership1 = await acceptInviteAs({
          patient: patientA,
          tokenHash: invite1.tokenHash,
          consentScope: fullConsentScope(),
        });

        // Revoke the membership via admin update.
        await revokeMembership(membership1.membershipId);

        // Operator subscribes.
        const eventsB: CollectedEvent[] = [];
        const { channel: chanB } = await subscribeOrgChannel({
          client: org1.client,
          orgId: org1.orgId,
          events: eventsB,
        });

        try {
          // Patient A inserts injection — revoked_at IS NOT NULL so WHERE
          // clause in trigger body excludes this membership row.
          const patientAClient = await signIn(patientA);
          await insertInjection(patientAClient, patientA.id);

          await new Promise((r) => setTimeout(r, 3000));

          expect(
            eventsB,
            `Operator received a broadcast for a revoked membership! ` +
              `events=${JSON.stringify(eventsB)}`,
          ).toHaveLength(0);
        } finally {
          await chanB.unsubscribe();
        }
      },
      30_000,
    );

    // ─── Test 5: multi-org fan-out ─────────────────────────────────────────

    it(
      'Test 5 — multi-org: patient member of two orgs sends broadcasts to both channels',
      async () => {
        // Org 1 and Org 3 (two separate orgs for patient A to be a member of).
        const org1 = await createOperatorWithOrg(`bc-mo1-${runId}`);
        const org3 = await createOperatorWithOrg(`bc-mo3-${runId}`);

        // Patient A: member of BOTH orgs, fullConsentScope (injections=true in both).
        const patientA = await createUser({
          email: testEmail(`bc-moptA-${runId}`, 'a'),
        });

        const invite1 = await createInviteViaRpc({
          operatorClient: org1.client,
          orgId: org1.orgId,
          email: patientA.email,
        });
        await acceptInviteAs({
          patient: patientA,
          tokenHash: invite1.tokenHash,
          consentScope: fullConsentScope(),
        });

        const invite3 = await createInviteViaRpc({
          operatorClient: org3.client,
          orgId: org3.orgId,
          email: patientA.email,
        });
        await acceptInviteAs({
          patient: patientA,
          tokenHash: invite3.tokenHash,
          consentScope: fullConsentScope(),
        });

        // Operator B (Org 1) and Operator D (Org 3) subscribe.
        const eventsB: CollectedEvent[] = [];
        const eventsD: CollectedEvent[] = [];

        const { channel: chanB, finalStatus: statusB } = await subscribeOrgChannel({
          client: org1.client,
          orgId: org1.orgId,
          events: eventsB,
        });
        const { channel: chanD, finalStatus: statusD } = await subscribeOrgChannel({
          client: org3.client,
          orgId: org3.orgId,
          events: eventsD,
        });

        try {
          if (statusB === 'CHANNEL_ERROR') {
            throw new Error(`Operator B (Org 1) subscribe denied: ${statusB}`);
          }
          if (statusD === 'CHANNEL_ERROR') {
            throw new Error(`Operator D (Org 3) subscribe denied: ${statusD}`);
          }

          // Patient A inserts one injection — two orgs → two separate broadcasts.
          const patientAClient = await signIn(patientA);
          await insertInjection(patientAClient, patientA.id);

          // Wait for both channels to receive their events.
          await Promise.all([
            waitForEvents(eventsB, 1, 5000),
            waitForEvents(eventsD, 1, 5000),
          ]);

          expect(
            eventsB.length,
            `Operator B (Org 1) expected 1 event; got ${eventsB.length}`,
          ).toBeGreaterThanOrEqual(1);
          expect(
            eventsD.length,
            `Operator D (Org 3) expected 1 event; got ${eventsD.length}`,
          ).toBeGreaterThanOrEqual(1);

          // Both broadcasts carry the patient's user_id and section.
          expect(eventsB[0].payload.user_id).toBe(patientA.id);
          expect(eventsB[0].payload.section).toBe('injections');
          expect(eventsD[0].payload.user_id).toBe(patientA.id);
          expect(eventsD[0].payload.section).toBe('injections');
        } finally {
          await chanB.unsubscribe();
          await chanD.unsubscribe();
        }
      },
      45_000,
    );

    // ─── Test 6: weights table ─────────────────────────────────────────────

    it(
      'Test 6 — weights table: INSERT triggers broadcast with section=weights',
      async () => {
        const org1 = await createOperatorWithOrg(`bc-wt-${runId}`);
        const patientA = await createUser({
          email: testEmail(`bc-wtptA-${runId}`, 'a'),
        });
        const invite1 = await createInviteViaRpc({
          operatorClient: org1.client,
          orgId: org1.orgId,
          email: patientA.email,
        });
        await acceptInviteAs({
          patient: patientA,
          tokenHash: invite1.tokenHash,
          consentScope: fullConsentScope(),
        });

        const eventsB: CollectedEvent[] = [];
        const { channel: chanB, finalStatus } = await subscribeOrgChannel({
          client: org1.client,
          orgId: org1.orgId,
          events: eventsB,
        });

        try {
          if (finalStatus === 'CHANNEL_ERROR') {
            throw new Error(`Operator subscribe denied for weights test: ${finalStatus}`);
          }

          const patientAClient = await signIn(patientA);
          await insertWeight(patientAClient, patientA.id);

          await waitForEvents(eventsB, 1, 5000);

          expect(eventsB.length).toBeGreaterThanOrEqual(1);
          expect(eventsB[0].payload.section).toBe('weights');
          expect(eventsB[0].payload.user_id).toBe(patientA.id);
        } finally {
          await chanB.unsubscribe();
        }
      },
      30_000,
    );

    // ─── Test 7: symptoms table ────────────────────────────────────────────

    it(
      'Test 7 — symptoms table: INSERT triggers broadcast with section=symptoms',
      async () => {
        const org1 = await createOperatorWithOrg(`bc-sy-${runId}`);
        const patientA = await createUser({
          email: testEmail(`bc-syptA-${runId}`, 'a'),
        });
        const invite1 = await createInviteViaRpc({
          operatorClient: org1.client,
          orgId: org1.orgId,
          email: patientA.email,
        });
        await acceptInviteAs({
          patient: patientA,
          tokenHash: invite1.tokenHash,
          consentScope: fullConsentScope(),
        });

        const eventsB: CollectedEvent[] = [];
        const { channel: chanB, finalStatus } = await subscribeOrgChannel({
          client: org1.client,
          orgId: org1.orgId,
          events: eventsB,
        });

        try {
          if (finalStatus === 'CHANNEL_ERROR') {
            throw new Error(`Operator subscribe denied for symptoms test: ${finalStatus}`);
          }

          const patientAClient = await signIn(patientA);
          await insertSymptom(patientAClient, patientA.id);

          await waitForEvents(eventsB, 1, 5000);

          expect(eventsB.length).toBeGreaterThanOrEqual(1);
          expect(eventsB[0].payload.section).toBe('symptoms');
          expect(eventsB[0].payload.user_id).toBe(patientA.id);
        } finally {
          await chanB.unsubscribe();
        }
      },
      30_000,
    );
  },
);

// ─── static gate test (always passes when env not set) ───────────────────────

describe('Phase 10 Plan 10-03 — broadcast trigger gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn(
        '[rls-realtime-clinic-broadcast.test] SKIPPED — env not set. Wave verification gates this.',
      );
    }
    expect(true).toBe(true);
  });
});
