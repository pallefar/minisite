/**
 * Phase 28 Plan 01 — cross-tenant RLS proof for `org_patient_links`.
 *
 * Tests (per plan Task 3, Tests 3-5 + Test 7):
 *   T3: User A cannot SELECT org_patient_links of Org Y.
 *   T4: User A cannot INSERT into org_patient_links of Org Y.
 *   T5: User A cannot DELETE org_patient_links of Org Y.
 *   T7: Patient (auth.uid() = patient_user_id) CAN read their own link rows
 *       (patient-self-read path per CONTEXT D-17).
 */
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SHOULD_RUN,
  cleanupByPrefix,
  createTwoOrgsTwoUsers,
  getAdmin,
  makeSlugPrefix,
  sessionFor,
  type TwoOrgsTwoUsers,
} from './_fixtures/p28-rls-fixture';

const TEST_SLUG_PREFIX = makeSlugPrefix(path.basename(__filename));
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

describeIfLive('P28 RLS — org_patient_links cross-tenant isolation + patient-self-read', () => {
  let fixture: TwoOrgsTwoUsers;
  let orgYLinkId: string | null = null;
  let patientEmail: string;
  let patientUserId: string;

  beforeAll(async () => {
    fixture = await createTwoOrgsTwoUsers(TEST_SLUG_PREFIX);
    const admin = getAdmin();

    // Create a patient user for T7.
    patientEmail = `${TEST_SLUG_PREFIX}-patient@leanshot.test`;
    const { data: pData, error: pErr } = await admin.auth.admin.createUser({
      email: patientEmail,
      email_confirm: true,
      password: `P28-${crypto.randomUUID()}`,
    });
    if (pErr || !pData.user) throw new Error(`createUser patient failed: ${pErr?.message}`);
    patientUserId = pData.user.id;

    // Seed a consent grant for the patient in Org Y (needed for link FK).
    const validScope = {
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
    const { data: grantData, error: grantErr } = await admin
      .from('org_consent_grants')
      .insert({
        org_id: fixture.orgY,
        patient_user_id: patientUserId,
        scope: validScope,
        granted_via: 'manual',
      })
      .select('id')
      .single();
    if (grantErr) throw new Error(`consent grant insert failed: ${grantErr.message}`);
    const consentGrantId = grantData?.id;

    // Seed an org_patient_link row in Org Y.
    const { data: linkData, error: linkErr } = await admin
      .from('org_patient_links')
      .insert({
        org_id: fixture.orgY,
        patient_user_id: patientUserId,
        linked_by: fixture.userB,
        consent_grant_id: consentGrantId,
      })
      .select('id')
      .single();
    if (linkErr) throw new Error(`patient link insert failed: ${linkErr.message}`);
    orgYLinkId = linkData?.id ?? null;
  }, 60_000);

  afterAll(async () => {
    // Cleanup patient user.
    const admin = getAdmin();
    try {
      await admin.auth.admin.deleteUser(patientUserId);
    } catch {
      /* best-effort */
    }
    await cleanupByPrefix(TEST_SLUG_PREFIX);
  });

  it('T3: User A cannot SELECT org_patient_links of Org Y', async () => {
    const { orgY, sessA } = fixture;
    const { data, error } = await sessA.client
      .from('org_patient_links')
      .select('id')
      .eq('org_id', orgY);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  }, 30_000);

  it('T4: User A cannot INSERT into org_patient_links of Org Y', async () => {
    const { orgY, sessA } = fixture;
    const { error } = await sessA.client.from('org_patient_links').insert({
      org_id: orgY,
      patient_user_id: crypto.randomUUID(),
      linked_by: sessA.user_id,
    });
    expect(error).not.toBeNull();
  }, 30_000);

  it('T5: User A cannot DELETE org_patient_links of Org Y', async () => {
    if (!orgYLinkId) return;
    const { sessA } = fixture;
    await sessA.client.from('org_patient_links').delete().eq('id', orgYLinkId);
    // Row must still exist.
    const admin = getAdmin();
    const { data } = await admin
      .from('org_patient_links')
      .select('id')
      .eq('id', orgYLinkId)
      .single();
    expect(data?.id).toBe(orgYLinkId);
  }, 30_000);

  it('T7: Patient can SELECT their own org_patient_link row (patient-self-read)', async () => {
    if (!orgYLinkId) return;
    // Mint session for patient user.
    const patientSess = await sessionFor(patientEmail);
    const { data, error } = await patientSess.client
      .from('org_patient_links')
      .select('id')
      .eq('id', orgYLinkId);
    expect(error).toBeNull();
    // Patient sees their own link (patient_user_id = auth.uid() path).
    expect((data ?? []).length).toBe(1);
    expect((data ?? [])[0]?.id).toBe(orgYLinkId);
  }, 30_000);
});

describe('P28 RLS org_patient_links — gating check', () => {
  it('skips when SUPABASE_SERVICE_ROLE_KEY is not set', () => {
    if (!SHOULD_RUN) console.warn('[rls-org-patient-links.test] SKIPPED — env not set.');
    expect(true).toBe(true);
  });
});
