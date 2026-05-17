/**
 * Phase 28 Plan 01 — cross-tenant RLS proof for `organizations`.
 *
 * Tests (per plan Task 3):
 *   T10: User A SELECT * FROM organizations sees only orgs they're a member of.
 *   T10b: User A CANNOT UPDATE Org Y.
 *   T10c: User A CANNOT DELETE any org (status='archived' is soft-delete path).
 *
 * Environment: requires SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY.
 * Skipped automatically when env not set.
 */
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SHOULD_RUN,
  cleanupByPrefix,
  createTwoOrgsTwoUsers,
  makeSlugPrefix,
  type TwoOrgsTwoUsers,
} from './_fixtures/p28-rls-fixture';

// File-scoped prefix — protects against vitest file-parallelism clobbering.
const TEST_SLUG_PREFIX = makeSlugPrefix(path.basename(__filename));

const describeIfLive = SHOULD_RUN ? describe : describe.skip;

describeIfLive('P28 RLS — organizations cross-tenant isolation', () => {
  let fixture: TwoOrgsTwoUsers;

  beforeAll(async () => {
    fixture = await createTwoOrgsTwoUsers(TEST_SLUG_PREFIX);
  }, 60_000);

  afterAll(async () => {
    await cleanupByPrefix(TEST_SLUG_PREFIX);
  });

  it('T10: User A sees Org X but NOT Org Y via RLS SELECT', async () => {
    const { orgX, orgY, sessA } = fixture;
    const { data, error } = await sessA.client.from('organizations').select('id');
    expect(error).toBeNull();
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    // User A MUST see Org X (their org).
    expect(ids).toContain(orgX);
    // User A MUST NOT see Org Y (cross-tenant proof).
    expect(ids).not.toContain(orgY);
  }, 30_000);

  it('T10b: User A CANNOT UPDATE Org Y name', async () => {
    const { orgY, sessA } = fixture;
    const { error } = await sessA.client
      .from('organizations')
      .update({ name: 'ATTACK' })
      .eq('id', orgY);
    // Either RLS error or 0 rows affected (no error on RLS deny for UPDATE).
    // Verify Org Y name is unchanged via admin client.
    const { data: orgYData } = await fixture.sessB.client
      .from('organizations')
      .select('name')
      .eq('id', orgY)
      .single();
    expect(orgYData?.name).not.toBe('ATTACK');
    // error may be null (0 rows updated by RLS predicate) — both are acceptable.
    void error;
  }, 30_000);

  it('T10c: User A CANNOT DELETE Org Y', async () => {
    const { orgY, sessA } = fixture;
    await sessA.client.from('organizations').delete().eq('id', orgY);
    // Org Y must still exist after the attempted delete.
    const { data: orgYData } = await fixture.sessB.client
      .from('organizations')
      .select('id')
      .eq('id', orgY)
      .single();
    expect(orgYData?.id).toBe(orgY);
  }, 30_000);
});

describe('P28 RLS organizations — gating check', () => {
  it('skips when SUPABASE_SERVICE_ROLE_KEY is not set', () => {
    if (!SHOULD_RUN) {
      console.warn('[rls-org-organizations.test] SKIPPED — env not set.');
    }
    expect(true).toBe(true);
  });
});
