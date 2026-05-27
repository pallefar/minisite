/**
 * Phase 30 Plan 00 — clinician_alerts debounce UNIQUE constraint test.
 *
 * Tests:
 *   (1) UNIQUE (org_id, debounce_key) constraint: inserting two alerts with the same
 *       (org_id, debounce_key) via ON CONFLICT DO NOTHING results in only 1 row.
 *       The second INSERT is silently ignored.
 *   (2) Verify count: SELECT count(*) for the debounce_key returns exactly 1.
 *
 * Uses service-role admin client (no authenticated user INSERT policy — append-only).
 * ES256-compat fixture used for org creation; inserts via admin for append-only tables.
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

describeIfLive('P30 — clinician_alerts debounce UNIQUE constraint', () => {
  let fixture: TwoOrgsTwoUsers;
  const DEBOUNCE_KEY = `dose_adherence:test-patient:${new Date().toISOString().slice(0, 10)}-debounce-${Date.now()}`;

  beforeAll(async () => {
    fixture = await createTwoOrgsTwoUsers(TEST_SLUG_PREFIX);
  }, 120_000);

  afterAll(async () => {
    // Clean up the test alert rows
    const admin = getAdmin();
    await admin
      .from('clinician_alerts')
      .delete()
      .eq('org_id', fixture.orgX)
      .eq('debounce_key', DEBOUNCE_KEY);

    await cleanupByPrefix(TEST_SLUG_PREFIX);
  });

  it('(1) Second INSERT with same (org_id, debounce_key) is silently ignored via ON CONFLICT DO NOTHING', async () => {
    const admin = getAdmin();

    const baseAlert = {
      org_id: fixture.orgX,
      patient_user_id: fixture.userA,
      alert_type: 'dose_adherence' as const,
      severity: 1,
      threshold_snapshot: { missed_doses_n: 2, window_days_m: 14 },
      debounce_key: DEBOUNCE_KEY,
    };

    // First INSERT — should succeed
    const { data: first, error: firstErr } = await admin
      .from('clinician_alerts')
      .insert(baseAlert)
      .select('id');

    expect(firstErr).toBeNull();
    expect(first).not.toBeNull();
    expect(first!.length).toBe(1);
    const firstId = first![0].id;

    // Second INSERT with identical (org_id, debounce_key)
    // Using .upsert with onConflict to test ON CONFLICT DO NOTHING behavior.
    // PostgreSQL ON CONFLICT DO NOTHING returns 0 rows when conflict occurs.
    const { data: second, error: secondErr } = await admin
      .from('clinician_alerts')
      .upsert(baseAlert, { onConflict: 'org_id,debounce_key', ignoreDuplicates: true })
      .select('id');

    // ignoreDuplicates: true maps to ON CONFLICT DO NOTHING — no error, 0 rows returned
    expect(secondErr).toBeNull();
    // 0 rows returned because the row was ignored (conflict on unique constraint)
    expect(second?.length ?? 0).toBe(0);
  });

  it('(2) count(*) for debounce_key returns exactly 1 after 2 attempted inserts', async () => {
    const admin = getAdmin();

    const { data, error } = await admin
      .from('clinician_alerts')
      .select('id', { count: 'exact' })
      .eq('org_id', fixture.orgX)
      .eq('debounce_key', DEBOUNCE_KEY);

    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });
});
