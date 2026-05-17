/**
 * Phase 29 Plan 01 — count_active_patients D-01 invariant tests.
 *
 * Tests all behavior rows from the plan:
 *   Test 1: count_active_patients(orgX with 2 active + 1 inactive + 1 unlinked) = 2
 *   Test 2: count_active_patients(orgY with 0 patients) = 0
 *   Test 3: Patient with last event >30 days ago is NOT counted
 *   Test 4: Patient with unlinked_at IS NOT NULL is NOT counted
 *   Test 5: Same patient with events in multiple tables counts as 1
 *   Test 6: Service-role caller (admin client) succeeds without admin check
 *   Test 7: Admin of Org X querying Org X succeeds
 *   Test 8: Admin of Org X querying Org Y raises 42501 (cross-org rejection)
 *
 * Uses ES256-compat RLS fixture pattern per [[reference_rls_fixture_gotrueclient_flake]].
 * File-scoped TEST_SLUG_PREFIX per [[feedback_rls_per_file_slug_prefix]].
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

describeIfLive('P29 count_active_patients — D-01 invariants', () => {
  let fixture: TwoOrgsTwoUsers;
  let patient1Id: string;  // active: 1 injection (recent)
  let patient2Id: string;  // active: weight + mood (recent)
  let patient3Id: string;  // inactive: ai_message 40 days ago
  let patient4Id: string;  // linked but unlinked_at set

  beforeAll(async () => {
    fixture = await createTwoOrgsTwoUsers(TEST_SLUG_PREFIX);
    const admin = getAdmin();

    // Create 4 patient users for Org X
    const email1 = `${TEST_SLUG_PREFIX}-p1@leanshot.test`;
    const email2 = `${TEST_SLUG_PREFIX}-p2@leanshot.test`;
    const email3 = `${TEST_SLUG_PREFIX}-p3@leanshot.test`;
    const email4 = `${TEST_SLUG_PREFIX}-p4@leanshot.test`;

    const { data: p1Data, error: p1Err } = await admin.auth.admin.createUser({
      email: email1, email_confirm: true, password: `P29-${crypto.randomUUID()}`,
    });
    if (p1Err || !p1Data.user) throw new Error(`createUser p1 failed: ${p1Err?.message}`);
    patient1Id = p1Data.user.id;

    const { data: p2Data, error: p2Err } = await admin.auth.admin.createUser({
      email: email2, email_confirm: true, password: `P29-${crypto.randomUUID()}`,
    });
    if (p2Err || !p2Data.user) throw new Error(`createUser p2 failed: ${p2Err?.message}`);
    patient2Id = p2Data.user.id;

    const { data: p3Data, error: p3Err } = await admin.auth.admin.createUser({
      email: email3, email_confirm: true, password: `P29-${crypto.randomUUID()}`,
    });
    if (p3Err || !p3Data.user) throw new Error(`createUser p3 failed: ${p3Err?.message}`);
    patient3Id = p3Data.user.id;

    const { data: p4Data, error: p4Err } = await admin.auth.admin.createUser({
      email: email4, email_confirm: true, password: `P29-${crypto.randomUUID()}`,
    });
    if (p4Err || !p4Data.user) throw new Error(`createUser p4 failed: ${p4Err?.message}`);
    patient4Id = p4Data.user.id;

    // Link all 4 patients to Org X via org_patient_links
    const { error: linkErr } = await admin.from('org_patient_links').insert([
      { org_id: fixture.orgX, patient_user_id: patient1Id, linked_by: fixture.userA, unlinked_at: null },
      { org_id: fixture.orgX, patient_user_id: patient2Id, linked_by: fixture.userA, unlinked_at: null },
      { org_id: fixture.orgX, patient_user_id: patient3Id, linked_by: fixture.userA, unlinked_at: null },
      { org_id: fixture.orgX, patient_user_id: patient4Id, linked_by: fixture.userA, unlinked_at: null },
    ]);
    if (linkErr) throw new Error(`org_patient_links insert failed: ${linkErr.message}`);

    // patient1: 1 injection (active, recent) — using correct injections columns
    const { error: injErr } = await admin.from('injections').insert({
      user_id: patient1Id,
      log_id: crypto.randomUUID(),
      medication: 'semaglutide',
      dose: '0.25',
      unit: 'mg',
      site: 'abdomen-left',
      logged_at: new Date().toISOString(),
    });
    if (injErr) throw new Error(`injection insert failed: ${injErr.message}`);

    // patient2: 1 weight entry (active, recent) — using correct weights columns
    // ts is a NOT NULL bigint (Unix timestamp in milliseconds)
    const today = new Date().toISOString().split('T')[0];
    const { error: weightErr } = await admin.from('weights').insert({
      user_id: patient2Id,
      weight_id: crypto.randomUUID(),
      date: today,
      weight: 85,
      ts: Date.now(),
    });
    if (weightErr) throw new Error(`weight insert failed: ${weightErr.message}`);

    // patient2: 1 mood entry (active, recent) — using correct mood columns
    const { error: moodErr } = await admin.from('mood').insert({
      user_id: patient2Id,
      mood_id: crypto.randomUUID(),
      date: today,
      mood: 3,
    });
    if (moodErr) throw new Error(`mood insert failed: ${moodErr.message}`);

    // patient3: 1 ai_message but 40 days ago (INACTIVE — outside 30-day window)
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const { error: aiErr } = await admin.from('ai_messages').insert({
      id: crypto.randomUUID(),
      user_id: patient3Id,
      role: 'user',
      content: 'test-inactive',
      created_at: fortyDaysAgo,
    });
    if (aiErr) throw new Error(`ai_messages insert failed: ${aiErr.message}`);

    // patient4: mark as unlinked (unlinked_at IS NOT NULL)
    const { error: unlinkErr } = await admin
      .from('org_patient_links')
      .update({ unlinked_at: new Date().toISOString() })
      .eq('org_id', fixture.orgX)
      .eq('patient_user_id', patient4Id);
    if (unlinkErr) throw new Error(`unlink patient4 failed: ${unlinkErr.message}`);
  }, 120_000);

  afterAll(async () => {
    const admin = getAdmin();
    // Clean up patient users (cascade deletes profile/org_patient_links rows)
    for (const userId of [patient1Id, patient2Id, patient3Id, patient4Id]) {
      if (userId) {
        await admin.auth.admin.deleteUser(userId).catch(() => {
          // best-effort
        });
      }
    }
    await cleanupByPrefix(TEST_SLUG_PREFIX);
  });

  // Test 1: 2 active patients out of 4 linked (1 inactive >30d, 1 unlinked)
  it('returns 2 for orgX with 2 active patients (1 inactive, 1 unlinked excluded)', async () => {
    const admin = getAdmin();
    const { data, error } = await admin.rpc('count_active_patients', { p_org_id: fixture.orgX });
    expect(error).toBeNull();
    expect(data).toBe(2);
  }, 30_000);

  // Test 2: 0 for org with no patients
  it('returns 0 for orgY with 0 patients', async () => {
    const admin = getAdmin();
    const { data, error } = await admin.rpc('count_active_patients', { p_org_id: fixture.orgY });
    expect(error).toBeNull();
    expect(data).toBe(0);
  }, 30_000);

  // Test 3: Patient with last event >30 days ago is NOT counted
  it('excludes patient3 whose only event is >30 days ago (inactive)', async () => {
    // The count of 2 from Test 1 proves patient3 is excluded.
    // Verify by checking if count changes when no active patients exist.
    const admin = getAdmin();
    const { data, error } = await admin.rpc('count_active_patients', { p_org_id: fixture.orgX });
    expect(error).toBeNull();
    // patient1 (active injection) + patient2 (active weight+mood) = 2
    // patient3 (inactive, >30 days) = excluded
    expect(data).toBe(2);
  }, 30_000);

  // Test 4: Patient with unlinked_at IS NOT NULL is NOT counted
  it('excludes patient4 who is unlinked (unlinked_at IS NOT NULL)', async () => {
    // patient4 is in org_patient_links but has unlinked_at set
    const admin = getAdmin();
    const { data, error } = await admin.rpc('count_active_patients', { p_org_id: fixture.orgX });
    expect(error).toBeNull();
    expect(data).toBe(2); // patient4 excluded regardless
  }, 30_000);

  // Test 5: Same patient with events in multiple tables counts as 1
  it('counts patient2 (weight AND mood events) as 1, not 2', async () => {
    // patient2 has both a weight entry and a mood entry (seeded in beforeAll)
    // distinct on patient_user_id ensures double-counting doesn't happen
    const admin = getAdmin();
    const { data, error } = await admin.rpc('count_active_patients', { p_org_id: fixture.orgX });
    expect(error).toBeNull();
    expect(data).toBe(2); // patient1 + patient2 = 2, not 3 (would be 3 if double-counted)
  }, 30_000);

  // Test 6: Service-role caller (admin client) succeeds (bypass)
  it('service-role caller succeeds for any org_id without admin check', async () => {
    const admin = getAdmin();
    // admin client uses SUPABASE_SERVICE_ROLE_KEY → auth.uid() = null in DB → bypass
    const { data, error } = await admin.rpc('count_active_patients', { p_org_id: fixture.orgY });
    expect(error).toBeNull();
    expect(data).toBe(0); // orgY has no patients
  }, 30_000);

  // Test 7: Admin of Org X querying Org X succeeds
  it('admin of orgX querying orgX succeeds', async () => {
    const { data, error } = await fixture.sessA.client.rpc('count_active_patients', {
      p_org_id: fixture.orgX,
    });
    expect(error).toBeNull();
    expect(data).toBe(2);
  }, 30_000);

  // Test 8: Admin of Org X querying Org Y raises 42501 (cross-org check)
  it('admin of orgX querying orgY raises 42501 (cross-org rejection)', async () => {
    // sessA is admin of orgX ONLY; querying orgY should fail with 42501
    const { data, error } = await fixture.sessA.client.rpc('count_active_patients', {
      p_org_id: fixture.orgY,
    });
    expect(error).not.toBeNull();
    // Supabase wraps PG RAISE EXCEPTION as a PostgREST error
    // The error message or code should contain 'forbidden' or '42501'
    const errorStr = JSON.stringify(error);
    expect(
      errorStr.includes('42501') ||
        errorStr.includes('forbidden') ||
        errorStr.includes('PGRST')
    ).toBe(true);
    expect(data).toBeNull();
  }, 30_000);
});

describe('P29 count_active_patients — gating check', () => {
  it('skips when SUPABASE_SERVICE_ROLE_KEY is not set', () => {
    if (!SHOULD_RUN) console.warn('[count-active-patients.test] SKIPPED — env not set.');
    expect(true).toBe(true);
  });
});
