/**
 * Phase 28 Plan 01 — cross-tenant RLS proof for `org_consent_grants`.
 *
 * Tests (per plan Task 3, Tests 3-5 + Test 8):
 *   T3: User A cannot SELECT org_consent_grants of Org Y.
 *   T4: User A cannot INSERT into org_consent_grants of Org Y.
 *   T5: User A cannot UPDATE org_consent_grants of Org Y.
 *   T8: _validate_consent_scope re-use proven:
 *       - INSERT with invalid scope fails with check_violation / 22023.
 *       - INSERT with valid Phase 9 ConsentScope succeeds.
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

const TEST_SLUG_PREFIX = makeSlugPrefix(path.basename(__filename));
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const VALID_SCOPE = {
  injections: true,
  weights: true,
  photos: false,
  symptoms: true,
  meals: true,
  workouts: true,
  supplements: true,
  mood: true,
  sleep: true,
  doctor_report: true,
};

describeIfLive('P28 RLS — org_consent_grants cross-tenant isolation + scope validator', () => {
  let fixture: TwoOrgsTwoUsers;
  let orgYGrantId: string | null = null;
  let patientUserId: string;

  beforeAll(async () => {
    fixture = await createTwoOrgsTwoUsers(TEST_SLUG_PREFIX);
    const admin = getAdmin();

    // Create a patient user for testing.
    const { data: pData, error: pErr } = await admin.auth.admin.createUser({
      email: `${TEST_SLUG_PREFIX}-patient@leanshot.test`,
      email_confirm: true,
      password: `P28-${crypto.randomUUID()}`,
    });
    if (pErr || !pData.user) throw new Error(`createUser patient failed: ${pErr?.message}`);
    patientUserId = pData.user.id;

    // Seed a consent grant in Org Y via admin (bypasses RLS).
    const { data: grantData, error: grantErr } = await admin.from('org_consent_grants').insert({
      org_id: fixture.orgY,
      patient_user_id: patientUserId,
      scope: VALID_SCOPE,
      granted_via: 'manual',
    }).select('id').single();
    if (grantErr) throw new Error(`consent grant insert failed: ${grantErr.message}`);
    orgYGrantId = grantData?.id ?? null;
  }, 60_000);

  afterAll(async () => {
    const admin = getAdmin();
    try {
      await admin.auth.admin.deleteUser(patientUserId);
    } catch { /* best-effort */ }
    await cleanupByPrefix(TEST_SLUG_PREFIX);
  });

  it('T3: User A cannot SELECT org_consent_grants of Org Y', async () => {
    const { orgY, sessA } = fixture;
    const { data, error } = await sessA.client
      .from('org_consent_grants')
      .select('id')
      .eq('org_id', orgY);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  }, 30_000);

  it('T4: User A cannot INSERT into org_consent_grants of Org Y', async () => {
    const { orgY, sessA } = fixture;
    const { error } = await sessA.client.from('org_consent_grants').insert({
      org_id: orgY,
      patient_user_id: patientUserId,
      scope: VALID_SCOPE,
      granted_via: 'manual',
    });
    expect(error).not.toBeNull();
  }, 30_000);

  it('T5: User A cannot UPDATE org_consent_grants of Org Y', async () => {
    if (!orgYGrantId) return;
    const { sessA } = fixture;
    await sessA.client
      .from('org_consent_grants')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', orgYGrantId);
    // Row must be unchanged.
    const admin = getAdmin();
    const { data } = await admin.from('org_consent_grants').select('revoked_at').eq('id', orgYGrantId).single();
    expect(data?.revoked_at).toBeNull(); // unchanged
  }, 30_000);

  it('T8: INSERT with invalid scope fails (Phase 9 _validate_consent_scope re-use)', async () => {
    const admin = getAdmin();
    const invalidScope = { injections: 'not-a-boolean', weights: true }; // missing keys + wrong type
    const { error } = await admin.from('org_consent_grants').insert({
      org_id: fixture.orgX,
      patient_user_id: patientUserId,
      scope: invalidScope,
      granted_via: 'manual',
    });
    // Should fail with errcode 22023 (consent_scope validation via trigger).
    expect(error).not.toBeNull();
    expect(error?.code === '22023' || error?.message?.includes('consent_scope')).toBe(true);
  }, 30_000);

  it('T8: INSERT with valid Phase 9 ConsentScope succeeds', async () => {
    const admin = getAdmin();
    const { error } = await admin.from('org_consent_grants').insert({
      org_id: fixture.orgX,
      patient_user_id: patientUserId,
      scope: VALID_SCOPE,
      granted_via: 'manual',
    });
    expect(error).toBeNull();
  }, 30_000);
});

describe('P28 RLS org_consent_grants — gating check', () => {
  it('skips when SUPABASE_SERVICE_ROLE_KEY is not set', () => {
    if (!SHOULD_RUN) console.warn('[rls-org-consent-grants.test] SKIPPED — env not set.');
    expect(true).toBe(true);
  });
});
