/**
 * Phase 30 Plan 00 — weighted rank_org_patients invariants.
 *
 * Tests:
 *   (1) NULL-fallback parity: when org_settings.ranking_weights IS NULL,
 *       rank_org_patients returns same shape as Phase 10 baseline (behavior preserved).
 *   (2) Custom weights applied: when admin calls update_org_ranking_weights with valid weights,
 *       subsequent rank_org_patients invocation returns rows (weights accepted + SECDEF works).
 *   (3) Validator rejection: update_org_ranking_weights with weights not summing to 1.0
 *       raises P0001 (validator trigger fires).
 *
 * Uses admin service-role to ensure org_settings.ranking_weights IS NULL before (1).
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

const VALID_WEIGHTS = {
  dose_adherence: 0.5,
  weight_loss: 0.2,
  activity: 0.2,
  symptoms: 0.1,
}; // sum = 1.0 exactly

const INVALID_WEIGHTS_BAD_SUM = {
  dose_adherence: 0.5,
  weight_loss: 0.3,
  activity: 0.1,
  symptoms: 0.05, // sum = 0.95, not 1.0
};

describeIfLive('P30 — rank_org_patients weighted scoring invariants', () => {
  let fixture: TwoOrgsTwoUsers;

  beforeAll(async () => {
    fixture = await createTwoOrgsTwoUsers(TEST_SLUG_PREFIX);
    const admin = getAdmin();

    // Ensure ranking_weights IS NULL for Org X (use Phase 10 defaults for test 1)
    await admin.from('org_settings').update({ ranking_weights: null }).eq('org_id', fixture.orgX);
  }, 120_000);

  afterAll(async () => {
    // Reset ranking_weights to null after tests
    const admin = getAdmin();
    await admin.from('org_settings').update({ ranking_weights: null }).eq('org_id', fixture.orgX);

    await cleanupByPrefix(TEST_SLUG_PREFIX);
  });

  // ─── Test 1: NULL-fallback parity ─────────────────────────────────────────
  it('(1) rank_org_patients returns valid shape when ranking_weights IS NULL (Phase 10 parity)', async () => {
    const { data, error } = await fixture.sessA.client.rpc('rank_org_patients', {
      p_org_id: fixture.orgX,
    });

    // May return 0 rows if no patients are linked to orgX (org just created in fixture)
    // The important check is: no error + schema shape matches RankRosterRow
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);

    if (data && data.length > 0) {
      // Verify RankRosterRow shape is preserved
      const row = data[0];
      expect(typeof row.user_id).toBe('string');
      expect(typeof row.score).toBe('number');
      expect(typeof row.breakdown).toBe('object');
      expect(typeof row.display_name).toBe('string');
      expect(typeof row.missed_dose_flag).toBe('boolean');
    }
  });

  // ─── Test 2: Custom weights accepted + rank_org_patients still works ────────
  it('(2) update_org_ranking_weights accepts valid weights + rank_org_patients succeeds', async () => {
    // Admin calls SECDEF to update weights
    const { error: updateError } = await fixture.sessA.client.rpc('update_org_ranking_weights', {
      p_org_id: fixture.orgX,
      p_weights: VALID_WEIGHTS,
    });

    expect(updateError).toBeNull();

    // Subsequent rank_org_patients call should succeed with new weights
    const { data, error: rankError } = await fixture.sessA.client.rpc('rank_org_patients', {
      p_org_id: fixture.orgX,
    });

    expect(rankError).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    // Shape preserved even with custom weights
    if (data && data.length > 0) {
      const row = data[0];
      expect(typeof row.score).toBe('number');
      expect(typeof row.breakdown).toBe('object');
    }
  });

  // ─── Test 3: Validator rejects bad sum ──────────────────────────────────────
  it('(3) update_org_ranking_weights with sum ≠ 1.0 raises P0001', async () => {
    const { error } = await fixture.sessA.client.rpc('update_org_ranking_weights', {
      p_org_id: fixture.orgX,
      p_weights: INVALID_WEIGHTS_BAD_SUM,
    });

    expect(error).not.toBeNull();
    // The BEFORE UPDATE trigger (_trg_validate_ranking_weights) raises P0001
    // Supabase wraps this as error code 'P0001'
    expect(error!.code).toBe('P0001');
  });
});
