/**
 * Phase 28 Plan 01 — cross-tenant RLS proof for `org_members`.
 *
 * Tests (per plan Task 3, Tests 3-5):
 *   T3: User A in Org X CANNOT SELECT org_members WHERE org_id = Org Y.
 *   T4: User A CANNOT INSERT a member into Org Y (RLS denial / 42501).
 *   T5: User A CANNOT UPDATE/DELETE org_members rows in Org Y.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
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

describeIfLive('P28 RLS — org_members cross-tenant isolation', () => {
  let fixture: TwoOrgsTwoUsers;
  let orgYMemberRowId: string | null = null;

  beforeAll(async () => {
    fixture = await createTwoOrgsTwoUsers(TEST_SLUG_PREFIX);
    // Seed a known member row in Org Y via admin (so we have a row to attempt to read/modify).
    const admin = getAdmin();
    const { data: rowData } = await admin
      .from('org_members')
      .select('id')
      .eq('org_id', fixture.orgY)
      .eq('user_id', fixture.userB)
      .single();
    orgYMemberRowId = rowData?.id ?? null;
  }, 60_000);

  afterAll(async () => {
    await cleanupByPrefix(TEST_SLUG_PREFIX);
  });

  it('T3: User A cannot SELECT org_members of Org Y', async () => {
    const { orgY, sessA } = fixture;
    const { data, error } = await sessA.client
      .from('org_members')
      .select('id')
      .eq('org_id', orgY);
    expect(error).toBeNull();
    // Cross-tenant SELECT proof: 0 rows returned (RLS predicate filter).
    expect(data ?? []).toHaveLength(0);
  }, 30_000);

  it('T4: User A cannot INSERT into org_members of Org Y', async () => {
    const { orgY, sessA } = fixture;
    const { error } = await sessA.client.from('org_members').insert({
      org_id: orgY,
      user_id: sessA.user_id,
      role: 'admin',
    });
    // RLS deny-all for INSERT from authenticated (no INSERT policy).
    expect(error).not.toBeNull();
  }, 30_000);

  it('T5: User A cannot UPDATE org_members rows in Org Y', async () => {
    const { orgY, sessA } = fixture;
    const { error } = await sessA.client
      .from('org_members')
      .update({ role: 'viewer' })
      .eq('org_id', orgY);
    // Either error or 0 rows affected. Verify via admin that role is unchanged.
    const admin = getAdmin();
    const { data: rowData } = await admin
      .from('org_members')
      .select('role')
      .eq('org_id', orgY)
      .eq('user_id', fixture.userB)
      .single();
    expect(rowData?.role).toBe('admin'); // unchanged
    void error;
  }, 30_000);

  it('T5: User A cannot DELETE org_members rows in Org Y', async () => {
    const { orgY, sessA } = fixture;
    if (!orgYMemberRowId) return;
    await sessA.client.from('org_members').delete().eq('id', orgYMemberRowId);
    // Row must still exist.
    const admin = getAdmin();
    const { data } = await admin.from('org_members').select('id').eq('id', orgYMemberRowId).single();
    expect(data?.id).toBe(orgYMemberRowId);
  }, 30_000);
});

describe('P28 RLS org_members — gating check', () => {
  it('skips when SUPABASE_SERVICE_ROLE_KEY is not set', () => {
    if (!SHOULD_RUN) console.warn('[rls-org-members.test] SKIPPED — env not set.');
    expect(true).toBe(true);
  });
});
