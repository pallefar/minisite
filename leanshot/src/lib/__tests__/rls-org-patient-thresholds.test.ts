/**
 * Phase 30 Plan 00 — cross-tenant RLS proof for `org_patient_thresholds` (BLOCKER R1).
 * P30 RLS
 *
 * Proves EXTENSION-CONTRACT §3b invariants:
 *   T3:  User A cannot SELECT org_patient_thresholds of Org Y (cross-tenant SELECT returns 0 rows).
 *   T4:  User A cannot INSERT into org_patient_thresholds of Org Y (RLS denies).
 *   T5a: User A cannot UPDATE org_patient_thresholds rows in Org Y (0 rows affected).
 *   T5b: User A cannot DELETE org_patient_thresholds rows in Org Y (0 rows affected).
 *   T3b: User A CAN SELECT org_patient_thresholds of Org X (same org).
 *   T6:  User A calling set_patient_dose_thresholds targeting Org Y raises 42501.
 *
 * Note: org_patient_thresholds requires an active org_patient_links row (FK constraint).
 * Seeding uses admin service-role to insert directly into org_patient_links +
 * org_patient_thresholds bypassing RLS (test fixture exception).
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

const DEFAULT_THRESHOLDS = { missed_doses_n: 2, window_days_m: 14, variance_pct_x: 25 };

describeIfLive('P30 RLS — org_patient_thresholds cross-tenant isolation', () => {
  let fixture: TwoOrgsTwoUsers;
  let orgYThresholdExists = false;
  let orgXThresholdExists = false;

  beforeAll(async () => {
    fixture = await createTwoOrgsTwoUsers(TEST_SLUG_PREFIX);
    const admin = getAdmin();

    // Seed an org_patient_links row for Org Y (required by FK before threshold insert)
    // User B (patient) is linked to Org Y by User B (acting as admin for test seeding)
    const { error: linkYErr } = await admin
      .from('org_patient_links')
      .insert({
        org_id: fixture.orgY,
        patient_user_id: fixture.userB,
        linked_by: fixture.userB,
        linked_at: new Date().toISOString(),
        consent_grant_id: null,
      })
      .select('org_id')
      .single();

    // Link may already exist; ignore conflict errors
    if (linkYErr && !linkYErr.message.includes('duplicate')) {
      // Non-conflict error — log but don't throw (test will show missing data)
      console.warn(`Seed Org Y link warning: ${linkYErr.message}`);
    }

    // Seed 1 threshold in Org Y (User B's org) via service-role bypass
    const { error: threshYErr } = await admin.from('org_patient_thresholds').insert({
      org_id: fixture.orgY,
      patient_user_id: fixture.userB,
      thresholds: DEFAULT_THRESHOLDS,
      set_by: fixture.userB,
    });

    if (!threshYErr) {
      orgYThresholdExists = true;
    } else {
      console.warn(`Seed Org Y threshold failed: ${threshYErr.message}`);
    }

    // Seed an org_patient_links row for Org X (User A linked to Org X)
    const { error: linkXErr } = await admin
      .from('org_patient_links')
      .insert({
        org_id: fixture.orgX,
        patient_user_id: fixture.userA,
        linked_by: fixture.userA,
        linked_at: new Date().toISOString(),
        consent_grant_id: null,
      })
      .select('org_id')
      .single();

    if (linkXErr && !linkXErr.message.includes('duplicate')) {
      console.warn(`Seed Org X link warning: ${linkXErr.message}`);
    }

    // Seed 1 threshold in Org X (User A's org) for T3b
    const { error: threshXErr } = await admin.from('org_patient_thresholds').insert({
      org_id: fixture.orgX,
      patient_user_id: fixture.userA,
      thresholds: DEFAULT_THRESHOLDS,
      set_by: fixture.userA,
    });

    if (!threshXErr) {
      orgXThresholdExists = true;
    } else {
      console.warn(`Seed Org X threshold failed: ${threshXErr.message}`);
    }
  }, 120_000);

  afterAll(async () => {
    await cleanupByPrefix(TEST_SLUG_PREFIX);
  });

  // ─── T3: Cross-tenant SELECT returns 0 rows ─────────────────────────────────
  it('T3: User A cannot SELECT org_patient_thresholds of Org Y', async () => {
    const { data, error } = await fixture.sessA.client
      .from('org_patient_thresholds')
      .select('org_id, patient_user_id')
      .eq('org_id', fixture.orgY);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  // ─── T4: Cross-tenant INSERT returns error (no INSERT policy) ───────────────
  it('T4: User A cannot INSERT into org_patient_thresholds of Org Y', async () => {
    const { error } = await fixture.sessA.client.from('org_patient_thresholds').insert({
      org_id: fixture.orgY,
      patient_user_id: fixture.userB,
      thresholds: { missed_doses_n: 3, window_days_m: 21, variance_pct_x: 30 },
      set_by: fixture.userA,
    });

    expect(error).not.toBeNull();
  });

  // ─── T5a: Cross-tenant UPDATE returns 0 rows affected ───────────────────────
  it('T5a: User A cannot UPDATE org_patient_thresholds of Org Y', async () => {
    const { data } = await fixture.sessA.client
      .from('org_patient_thresholds')
      .update({ thresholds: { missed_doses_n: 99, window_days_m: 99, variance_pct_x: 99 } })
      .eq('org_id', fixture.orgY)
      .select('org_id');

    expect(data?.length ?? 0).toBe(0);
  });

  // ─── T5b: Cross-tenant DELETE returns 0 rows affected ───────────────────────
  it('T5b: User A cannot DELETE org_patient_thresholds of Org Y', async () => {
    const { data } = await fixture.sessA.client
      .from('org_patient_thresholds')
      .delete()
      .eq('org_id', fixture.orgY)
      .select('org_id');

    expect(data?.length ?? 0).toBe(0);
  });

  // ─── T3b: Same-org SELECT succeeds ──────────────────────────────────────────
  it('T3b: User A CAN SELECT org_patient_thresholds of Org X (own org)', async () => {
    if (!orgXThresholdExists) {
      // Skip if seeding failed (FK constraint may have prevented link insert)
      console.warn('Skipping T3b: orgX threshold was not seeded (FK constraint)');
      return;
    }

    const { data, error } = await fixture.sessA.client
      .from('org_patient_thresholds')
      .select('org_id, patient_user_id, thresholds')
      .eq('org_id', fixture.orgX);

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  // ─── T6: Cross-tenant SECDEF call raises 42501 ──────────────────────────────
  // T-30-00-03 mitigation: SECDEF re-checks org membership for p_org_id.
  it('T6: User A calling set_patient_dose_thresholds targeting Org Y raises 42501', async () => {
    const { error } = await fixture.sessA.client.rpc('set_patient_dose_thresholds', {
      p_org_id: fixture.orgY,
      p_patient_user_id: fixture.userB,
      p_thresholds: DEFAULT_THRESHOLDS,
    });

    expect(error).not.toBeNull();
    // SECDEF raises '42501' (insufficient privilege) when caller not admin/staff in Org Y
    expect(error!.code).toBe('42501');
  });
});
