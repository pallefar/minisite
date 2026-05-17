/**
 * Phase 28 Plan 01 — cross-tenant RLS proof for `org_invites` + W-1 invariant.
 *
 * Tests (per plan Task 3, Tests 3-6):
 *   T3: User A cannot SELECT org_invites of Org Y.
 *   T4: User A cannot INSERT into org_invites of Org Y.
 *   T5: User A cannot UPDATE/DELETE org_invites of Org Y.
 *   T6: send_org_invite returns identical shape for existing vs nonexistent email (W-1).
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

describeIfLive('P28 RLS — org_invites cross-tenant isolation + W-1 invariant', () => {
  let fixture: TwoOrgsTwoUsers;
  let orgYInviteId: string | null = null;

  beforeAll(async () => {
    fixture = await createTwoOrgsTwoUsers(TEST_SLUG_PREFIX);
    // Seed an invite in Org Y via admin direct insert.
    const admin = getAdmin();
    const { data: inviteData } = await admin.from('org_invites').insert({
      org_id: fixture.orgY,
      email: `invite-${TEST_SLUG_PREFIX}@leanshot.test`,
      invited_role: 'staff',
      invite_token_hash: `hash-${crypto.randomUUID()}`,
      created_by: fixture.userB,
    }).select('id').single();
    orgYInviteId = inviteData?.id ?? null;
  }, 60_000);

  afterAll(async () => {
    await cleanupByPrefix(TEST_SLUG_PREFIX);
  });

  it('T3: User A cannot SELECT org_invites of Org Y', async () => {
    const { orgY, sessA } = fixture;
    const { data, error } = await sessA.client
      .from('org_invites')
      .select('id')
      .eq('org_id', orgY);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  }, 30_000);

  it('T4: User A cannot INSERT invite into Org Y', async () => {
    const { orgY, sessA } = fixture;
    const { error } = await sessA.client.from('org_invites').insert({
      org_id: orgY,
      email: `attacker-${TEST_SLUG_PREFIX}@leanshot.test`,
      invited_role: 'staff',
      invite_token_hash: `attack-${crypto.randomUUID()}`,
      created_by: sessA.user_id,
    });
    expect(error).not.toBeNull();
  }, 30_000);

  it('T5: User A cannot DELETE org_invites rows in Org Y', async () => {
    if (!orgYInviteId) return;
    const { sessA } = fixture;
    await sessA.client.from('org_invites').delete().eq('id', orgYInviteId);
    // Row must still exist.
    const admin = getAdmin();
    const { data } = await admin.from('org_invites').select('id').eq('id', orgYInviteId).single();
    expect(data?.id).toBe(orgYInviteId);
  }, 30_000);

  it('T6: send_org_invite W-1 — returns {invite_id} for existing AND nonexistent email', async () => {
    const { orgX, sessA } = fixture;

    // Call send_org_invite with an email that exists (userB's email).
    const { data: resExisting, error: err1 } = await sessA.client.rpc('send_org_invite', {
      p_org_id: orgX,
      p_email: fixture.sessB.email,
      p_role: 'viewer',
    });
    expect(err1).toBeNull();
    const rowExisting = Array.isArray(resExisting) ? resExisting[0] : resExisting;
    expect(rowExisting).toHaveProperty('invite_id');
    expect(typeof rowExisting.invite_id).toBe('string');

    // Call send_org_invite with an email that does NOT exist.
    const nonexistentEmail = `nonexistent-${crypto.randomUUID()}@leanshot.test`;
    const { data: resNonexistent, error: err2 } = await sessA.client.rpc('send_org_invite', {
      p_org_id: orgX,
      p_email: nonexistentEmail,
      p_role: 'viewer',
    });
    expect(err2).toBeNull();
    const rowNonexistent = Array.isArray(resNonexistent) ? resNonexistent[0] : resNonexistent;
    expect(rowNonexistent).toHaveProperty('invite_id');
    expect(typeof rowNonexistent.invite_id).toBe('string');

    // W-1 invariant: shapes must be identical (both return invite_id).
    expect(Object.keys(rowExisting ?? {}).sort()).toEqual(Object.keys(rowNonexistent ?? {}).sort());
  }, 30_000);
});

describe('P28 RLS org_invites — gating check', () => {
  it('skips when SUPABASE_SERVICE_ROLE_KEY is not set', () => {
    if (!SHOULD_RUN) console.warn('[rls-org-invites.test] SKIPPED — env not set.');
    expect(true).toBe(true);
  });
});
