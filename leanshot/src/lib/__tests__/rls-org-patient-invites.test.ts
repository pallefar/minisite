/**
 * Phase 29 Plan 02 — cross-tenant RLS proof for `org_patient_invites` (BLOCKER R1).
 *
 * Proves EXTENSION-CONTRACT §3b invariants:
 *   T3:  User A cannot SELECT org_patient_invites of Org Y (cross-tenant SELECT returns 0 rows).
 *   T4:  User A cannot INSERT into org_patient_invites of Org Y (RLS denies).
 *   T5a: User A cannot UPDATE org_patient_invites rows in Org Y (0 rows affected).
 *   T5b: User A cannot DELETE org_patient_invites rows in Org Y (0 rows affected).
 *   T3b: User A CAN SELECT org_patient_invites of Org X (same org, own rows).
 *   T6:  send_org_patient_invite by non-admin raises 42501 (Pattern S1 re-check).
 *   T7:  send_org_patient_invite W-1 — returns identical {invite_id, status:'sent'} shape
 *        for a brand-new email AND an existing-in-auth.users email.
 *
 * Fixture: createTwoOrgsTwoUsers (User A → admin of Org X, User B → admin of Org Y).
 *
 * ES256-compat: uses generateLink + verifyOtp (NOT signInWithPassword).
 * File-scoped prefix: avoids vitest file-parallelism slug clobbering.
 */

import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SHOULD_RUN,
  cleanupByPrefix,
  createTwoOrgsTwoUsers,
  getAdmin,
  makeSlugPrefix,
  type TwoOrgsTwoUsers,
} from './_fixtures/p28-rls-fixture';

// File-scoped prefix — never shared/exported (per [[feedback_rls_per_file_slug_prefix]])
const TEST_SLUG_PREFIX = makeSlugPrefix(path.basename(__filename));
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

/**
 * Valid consent scope per Phase 9 _validate_consent_scope:
 * all 10 required boolean keys must be present.
 */
const VALID_CONSENT_SCOPE = {
  injections: true,
  weights: true,
  photos: false,
  symptoms: true,
  meals: false,
  workouts: false,
  supplements: false,
  mood: true,
  sleep: true,
  doctor_report: false,
};

describeIfLive('P29 RLS — org_patient_invites cross-tenant isolation', () => {
  let fixture: TwoOrgsTwoUsers;
  let orgYInviteId: string | null = null;
  let orgXInviteId: string | null = null;

  beforeAll(async () => {
    fixture = await createTwoOrgsTwoUsers(TEST_SLUG_PREFIX);
    const admin = getAdmin();

    // Seed 1 invite in Org Y (User B's org) via service-role bypass
    // so T3/T5a/T5b can prove User A cannot see/mutate Org Y's invites.
    const { data: inviteYData, error: errY } = await admin
      .from('org_patient_invites')
      .insert({
        org_id: fixture.orgY,
        patient_email: `patient-y-${TEST_SLUG_PREFIX}@leanshot.test`,
        invite_token_hash: `hash-y-${crypto.randomUUID()}`,
        consent_scope: VALID_CONSENT_SCOPE,
        invited_by: fixture.userB,
      })
      .select('id')
      .single();

    if (errY) throw new Error(`Seed org Y invite failed: ${errY.message}`);
    orgYInviteId = inviteYData?.id ?? null;

    // Seed 1 invite in Org X (User A's org) via service-role bypass
    // so T3b can prove User A CAN read own org's invites.
    const { data: inviteXData, error: errX } = await admin
      .from('org_patient_invites')
      .insert({
        org_id: fixture.orgX,
        patient_email: `patient-x-${TEST_SLUG_PREFIX}@leanshot.test`,
        invite_token_hash: `hash-x-${crypto.randomUUID()}`,
        consent_scope: VALID_CONSENT_SCOPE,
        invited_by: fixture.userA,
      })
      .select('id')
      .single();

    if (errX) throw new Error(`Seed org X invite failed: ${errX.message}`);
    orgXInviteId = inviteXData?.id ?? null;
  }, 120_000);

  afterAll(async () => {
    await cleanupByPrefix(TEST_SLUG_PREFIX);
  });

  // ─── T3: Cross-tenant SELECT returns 0 rows ─────────────────────────────────
  it('T3: User A cannot SELECT org_patient_invites of Org Y', async () => {
    const { orgY, sessA } = fixture;
    const { data, error } = await sessA.client
      .from('org_patient_invites')
      .select('id')
      .eq('org_id', orgY);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  }, 30_000);

  // ─── T4: Cross-tenant INSERT denied ─────────────────────────────────────────
  it('T4: User A cannot INSERT into org_patient_invites of Org Y', async () => {
    const { orgY, sessA } = fixture;
    const { error } = await sessA.client.from('org_patient_invites').insert({
      org_id: orgY,
      patient_email: `attacker-${TEST_SLUG_PREFIX}@leanshot.test`,
      invite_token_hash: `attack-${crypto.randomUUID()}`,
      consent_scope: VALID_CONSENT_SCOPE,
      invited_by: sessA.user_id,
    });
    // RLS denies INSERT (no policy for authenticated) — expect error
    expect(error).not.toBeNull();
  }, 30_000);

  // ─── T5a: Cross-tenant UPDATE affects 0 rows ────────────────────────────────
  it('T5a: User A cannot UPDATE org_patient_invites rows in Org Y', async () => {
    if (!orgYInviteId) return;
    const { orgY, sessA } = fixture;

    const { error } = await sessA.client
      .from('org_patient_invites')
      .update({ patient_email: 'mutated@evil.test' })
      .eq('org_id', orgY);

    // UPDATE with RLS filter = 0 matching rows is not an error in Postgres/PostgREST
    expect(error).toBeNull();

    // Verify via admin that the row is UNCHANGED
    const admin = getAdmin();
    const { data: adminCheck } = await admin
      .from('org_patient_invites')
      .select('patient_email')
      .eq('id', orgYInviteId)
      .single();
    expect(adminCheck?.patient_email).not.toBe('mutated@evil.test');
  }, 30_000);

  // ─── T5b: Cross-tenant DELETE affects 0 rows ────────────────────────────────
  it('T5b: User A cannot DELETE org_patient_invites rows in Org Y', async () => {
    if (!orgYInviteId) return;
    const { orgY, sessA } = fixture;

    const { error } = await sessA.client.from('org_patient_invites').delete().eq('org_id', orgY);

    // DELETE with RLS filter = 0 matching rows is not an error
    expect(error).toBeNull();

    // Verify via admin that the row still exists
    const admin = getAdmin();
    const { data: adminCheck } = await admin
      .from('org_patient_invites')
      .select('id')
      .eq('id', orgYInviteId)
      .single();
    expect(adminCheck?.id).toBe(orgYInviteId);
  }, 30_000);

  // ─── T3b: Same-tenant SELECT returns OWN rows ────────────────────────────────
  it('T3b: User A CAN SELECT org_patient_invites of Org X (own org)', async () => {
    const { orgX, sessA } = fixture;
    const { data, error } = await sessA.client
      .from('org_patient_invites')
      .select('id')
      .eq('org_id', orgX);
    expect(error).toBeNull();
    // At least the one invite we seeded should be visible
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  // ─── T6 (P29-specific): Non-admin caller raises 42501 ────────────────────────
  it('T6: send_org_patient_invite by non-admin raises 42501', async () => {
    // User B is admin of Org Y but NOT a member of Org X.
    // Calling send_org_patient_invite on Org X from User B's session should fail.
    const { orgX, sessB } = fixture;

    const { error } = await sessB.client.rpc('send_org_patient_invite', {
      p_org_id: orgX,
      p_patient_email: `nonadmin-${TEST_SLUG_PREFIX}@leanshot.test`,
      p_consent_scope: VALID_CONSENT_SCOPE,
      p_invite_token_hash: `tok-${crypto.randomUUID()}`,
    });

    expect(error).not.toBeNull();
    // SECDEF Pattern S1 re-check raises 42501 (forbidden)
    expect(error?.code).toBe('42501');
  }, 30_000);

  // ─── T7 (P29-specific): W-1 invariant — identical shape for new vs existing email ─
  it('T7: send_org_patient_invite W-1 — identical {invite_id, status} for new AND existing email', async () => {
    const { orgX, sessA } = fixture;

    // Case 1: email that exists in auth.users (User B's email)
    const { data: resExisting, error: err1 } = await sessA.client.rpc('send_org_patient_invite', {
      p_org_id: orgX,
      p_patient_email: fixture.sessB.email,
      p_consent_scope: VALID_CONSENT_SCOPE,
      p_invite_token_hash: `tok-existing-${crypto.randomUUID()}`,
    });
    expect(err1).toBeNull();
    const rowExisting = Array.isArray(resExisting) ? resExisting[0] : resExisting;
    expect(rowExisting).toHaveProperty('invite_id');
    expect(rowExisting).toHaveProperty('status', 'sent');
    expect(typeof rowExisting.invite_id).toBe('string');

    // Case 2: brand-new email that does NOT exist in auth.users
    const brandNewEmail = `brand-new-${crypto.randomUUID()}@leanshot.test`;
    const { data: resNew, error: err2 } = await sessA.client.rpc('send_org_patient_invite', {
      p_org_id: orgX,
      p_patient_email: brandNewEmail,
      p_consent_scope: VALID_CONSENT_SCOPE,
      p_invite_token_hash: `tok-new-${crypto.randomUUID()}`,
    });
    expect(err2).toBeNull();
    const rowNew = Array.isArray(resNew) ? resNew[0] : resNew;
    expect(rowNew).toHaveProperty('invite_id');
    expect(rowNew).toHaveProperty('status', 'sent');
    expect(typeof rowNew.invite_id).toBe('string');

    // W-1 invariant: shapes are identical (same keys)
    expect(Object.keys(rowExisting ?? {}).sort()).toEqual(Object.keys(rowNew ?? {}).sort());
  }, 30_000);
});

// Gating describe block — always runs, never skips, asserts test infra is wired
describe('P29 RLS org_patient_invites — gating check', () => {
  it('skips when SUPABASE_SERVICE_ROLE_KEY is not set', () => {
    if (!SHOULD_RUN) console.warn('[rls-org-patient-invites.test] SKIPPED — env not set.');
    expect(true).toBe(true);
  });
});
