/**
 * Phase 30 Plan 00 — cross-tenant RLS proof for `clinician_alerts` (BLOCKER R1).
 * P30 RLS
 *
 * Proves EXTENSION-CONTRACT §3b invariants:
 *   T3:  User A cannot SELECT clinician_alerts of Org Y (cross-tenant SELECT returns 0 rows).
 *   T4:  User A cannot INSERT into clinician_alerts of Org Y (RLS denies — no INSERT policy).
 *   T5a: User A cannot UPDATE clinician_alerts rows in Org Y (0 rows affected).
 *   T5b: User A cannot DELETE clinician_alerts rows in Org Y (0 rows affected).
 *   T3b: User A CAN SELECT clinician_alerts of Org X (same org, own rows).
 *   T6:  User A (Org X admin) calling acknowledge_clinician_alert on Org Y alert raises 42501
 *        (cross-tenant SECDEF re-check T-30-00-03 mitigation).
 *
 * ES256-compat: uses generateLink + verifyOtp (NOT signInWithPassword).
 * File-scoped prefix: avoids vitest file-parallelism slug clobbering.
 * Per [[reference_rls_fixture_gotrueclient_flake]] + [[feedback_rls_per_file_slug_prefix]].
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

describeIfLive('P30 RLS — clinician_alerts cross-tenant isolation', () => {
  let fixture: TwoOrgsTwoUsers;
  let orgYAlertId: string | null = null;
  let orgXAlertId: string | null = null;

  beforeAll(async () => {
    fixture = await createTwoOrgsTwoUsers(TEST_SLUG_PREFIX);
    const admin = getAdmin();

    // Seed 1 alert in Org Y (User B's org) via service-role bypass
    // so T3/T5a/T5b can prove User A cannot see/mutate Org Y's alerts.
    const debounceKeyY = `dose_adherence:${fixture.userB}:${new Date().toISOString().slice(0, 10)}-rlsy`;
    const { data: alertYData, error: errY } = await admin
      .from('clinician_alerts')
      .insert({
        org_id: fixture.orgY,
        patient_user_id: fixture.userB,
        alert_type: 'dose_adherence',
        severity: 1,
        threshold_snapshot: { missed_doses_n: 2, window_days_m: 14 },
        debounce_key: debounceKeyY,
      })
      .select('id')
      .single();

    if (errY) throw new Error(`Seed Org Y alert failed: ${errY.message}`);
    orgYAlertId = alertYData?.id ?? null;

    // Seed 1 alert in Org X (User A's org) via service-role bypass
    // so T3b can prove User A CAN read own org's alerts.
    const debounceKeyX = `dose_adherence:${fixture.userA}:${new Date().toISOString().slice(0, 10)}-rlsx`;
    const { data: alertXData, error: errX } = await admin
      .from('clinician_alerts')
      .insert({
        org_id: fixture.orgX,
        patient_user_id: fixture.userA,
        alert_type: 'dose_adherence',
        severity: 1,
        threshold_snapshot: { missed_doses_n: 2, window_days_m: 14 },
        debounce_key: debounceKeyX,
      })
      .select('id')
      .single();

    if (errX) throw new Error(`Seed Org X alert failed: ${errX.message}`);
    orgXAlertId = alertXData?.id ?? null;
  }, 120_000);

  afterAll(async () => {
    await cleanupByPrefix(TEST_SLUG_PREFIX);
  });

  // ─── T3: Cross-tenant SELECT returns 0 rows ─────────────────────────────────
  it('T3: User A cannot SELECT clinician_alerts of Org Y', async () => {
    const { data, error } = await fixture.sessA.client
      .from('clinician_alerts')
      .select('id')
      .eq('org_id', fixture.orgY);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  // ─── T4: Cross-tenant INSERT returns error (no INSERT policy) ───────────────
  it('T4: User A cannot INSERT into clinician_alerts of Org Y', async () => {
    const debounceKey = `dose_adherence:${fixture.userB}:${new Date().toISOString().slice(0, 10)}-t4insert`;
    const { error } = await fixture.sessA.client
      .from('clinician_alerts')
      .insert({
        org_id: fixture.orgY,
        patient_user_id: fixture.userB,
        alert_type: 'dose_adherence',
        severity: 1,
        threshold_snapshot: { missed_doses_n: 2, window_days_m: 14 },
        debounce_key: debounceKey,
      });

    expect(error).not.toBeNull();
  });

  // ─── T5a: Cross-tenant UPDATE returns 0 rows affected ───────────────────────
  it('T5a: User A cannot UPDATE clinician_alerts of Org Y', async () => {
    const { data, error } = await fixture.sessA.client
      .from('clinician_alerts')
      .update({ retry_count: 99 })
      .eq('org_id', fixture.orgY)
      .select('id');

    // RLS prevents seeing Org Y rows — either error or 0 rows returned
    const rowsAffected = data?.length ?? 0;
    expect(rowsAffected).toBe(0);
    // error may be null (RLS silently returns 0 rows) — either way, no modification
  });

  // ─── T5b: Cross-tenant DELETE returns 0 rows affected ───────────────────────
  it('T5b: User A cannot DELETE clinician_alerts of Org Y', async () => {
    const { data, error } = await fixture.sessA.client
      .from('clinician_alerts')
      .delete()
      .eq('org_id', fixture.orgY)
      .select('id');

    const rowsAffected = data?.length ?? 0;
    expect(rowsAffected).toBe(0);
  });

  // ─── T3b: Same-org SELECT succeeds ──────────────────────────────────────────
  it('T3b: User A CAN SELECT clinician_alerts of Org X (own org)', async () => {
    if (!orgXAlertId) {
      throw new Error('orgXAlertId not seeded — beforeAll failed');
    }

    const { data, error } = await fixture.sessA.client
      .from('clinician_alerts')
      .select('id, org_id, alert_type')
      .eq('org_id', fixture.orgX);

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(data!.some((row) => row.id === orgXAlertId)).toBe(true);
  });

  // ─── T6: Cross-tenant SECDEF call raises 42501 ──────────────────────────────
  // T-30-00-03 mitigation: SECDEF re-checks org membership for alert.org_id,
  // not just the alert ID — User A calling acknowledge on Org Y's alert raises 42501.
  it('T6: User A calling acknowledge_clinician_alert on Org Y alert raises 42501', async () => {
    if (!orgYAlertId) {
      throw new Error('orgYAlertId not seeded — beforeAll failed');
    }

    const { data, error } = await fixture.sessA.client.rpc('acknowledge_clinician_alert', {
      p_alert_id: orgYAlertId,
    });

    expect(error).not.toBeNull();
    // SECDEF raises '42501' (insufficient privilege) when caller not in alert's org
    expect(error!.code).toBe('42501');
  });
});
