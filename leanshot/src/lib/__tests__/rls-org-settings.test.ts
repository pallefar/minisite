/**
 * Phase 28 Plan 01 — cross-tenant RLS proof for `org_settings`.
 *
 * Tests (per plan Task 3, Tests 3-5):
 *   T3: User A cannot SELECT org_settings of Org Y.
 *   T4: User A cannot INSERT into org_settings of Org Y.
 *   T5: User A cannot UPDATE org_settings of Org Y.
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

describeIfLive('P28 RLS — org_settings cross-tenant isolation', () => {
  let fixture: TwoOrgsTwoUsers;

  beforeAll(async () => {
    fixture = await createTwoOrgsTwoUsers(TEST_SLUG_PREFIX);
    // Seed org_settings for Org Y via admin.
    const admin = getAdmin();
    await admin.from('org_settings').upsert({ org_id: fixture.orgY });
  }, 60_000);

  afterAll(async () => {
    await cleanupByPrefix(TEST_SLUG_PREFIX);
  });

  it('T3: User A cannot SELECT org_settings of Org Y', async () => {
    const { orgY, sessA } = fixture;
    const { data, error } = await sessA.client
      .from('org_settings')
      .select('org_id')
      .eq('org_id', orgY);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  }, 30_000);

  it('T4: User A cannot INSERT into org_settings of Org Y', async () => {
    const { orgY, sessA } = fixture;
    const { error } = await sessA.client.from('org_settings').insert({ org_id: orgY });
    expect(error).not.toBeNull();
  }, 30_000);

  it('T5: User A cannot UPDATE org_settings of Org Y', async () => {
    const { orgY, sessA } = fixture;
    await sessA.client
      .from('org_settings')
      .update({ default_timezone: 'America/New_York' })
      .eq('org_id', orgY);
    // Verify Org Y settings unchanged via admin.
    const admin = getAdmin();
    const { data } = await admin
      .from('org_settings')
      .select('default_timezone')
      .eq('org_id', orgY)
      .single();
    expect(data?.default_timezone).toBe('UTC'); // unchanged from default
  }, 30_000);

  it('T: User B (member) CAN SELECT their own org_settings', async () => {
    const { orgY, sessB } = fixture;
    const admin = getAdmin();
    await admin.from('org_settings').upsert({ org_id: orgY });
    const { data, error } = await sessB.client
      .from('org_settings')
      .select('org_id')
      .eq('org_id', orgY);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  }, 30_000);
});

describe('P28 RLS org_settings — gating check', () => {
  it('skips when SUPABASE_SERVICE_ROLE_KEY is not set', () => {
    if (!SHOULD_RUN) console.warn('[rls-org-settings.test] SKIPPED — env not set.');
    expect(true).toBe(true);
  });
});
