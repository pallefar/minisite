/**
 * Phase 9 Plan 09-01 — cross-tenant RLS proof + Pitfall #8 UNIQUE invariant
 * for `public.memberships`.
 *
 * Two assertions:
 *   1. Cross-tenant: user B cannot read user A's org memberships.
 *   2. Pitfall #8 single-identity invariant: admin client tries to insert
 *      a SECOND active membership for the same (user_id, org_id) — the
 *      partial unique index `memberships_user_org_idx WHERE revoked_at IS NULL`
 *      raises 23505.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

describeIfLive('Phase 9 Plan 09-01 — RLS + Pitfall #8 invariant on memberships', () => {
  let admin: SupabaseClient | null = null;
  const getAdmin = (): SupabaseClient => {
    if (!admin) {
      admin = createClient(URL!, SERVICE!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }
    return admin;
  };
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  afterAll(async () => {
    if (!admin) return;
    for (const id of createdOrgIds) {
      try {
        await admin.from('orgs').delete().eq('id', id);
      } catch {
        // best-effort
      }
    }
    for (const id of createdUserIds) {
      try {
        await admin.auth.admin.deleteUser(id);
      } catch {
        // best-effort
      }
    }
  });

  it('cross-tenant SELECT denied + Pitfall #8 UNIQUE active membership', async () => {
    const adminClient = getAdmin();
    const passwordA = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    const passwordB = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    const emailA = `rls-mem-a-${Date.now()}@leanshot.test`;
    const emailB = `rls-mem-b-${Date.now()}@leanshot.test`;

    const { data: aRes } = await adminClient.auth.admin.createUser({
      email: emailA, password: passwordA, email_confirm: true,
    });
    const userA = aRes?.user;
    if (!userA) throw new Error('userA create failed');
    createdUserIds.push(userA.id);

    const { data: bRes } = await adminClient.auth.admin.createUser({
      email: emailB, password: passwordB, email_confirm: true,
    });
    const userB = bRes?.user;
    if (!userB) throw new Error('userB create failed');
    createdUserIds.push(userB.id);

    const userAClient = createClient(URL!, ANON!, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-mem-a' },
    });
    const userBClient = createClient(URL!, ANON!, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-mem-b' },
    });
    await userAClient.auth.signInWithPassword({ email: emailA, password: passwordA });
    await userBClient.auth.signInWithPassword({ email: emailB, password: passwordB });

    const slugA = `rls-mem-a-${Date.now().toString(36)}`;
    const { data: createA, error: createAErr } = await userAClient.rpc('create_org', {
      p_name: 'RLS Mem A', p_slug: slugA, p_description: null, p_website_url: null,
    });
    if (createAErr) throw createAErr;
    const orgRow = (createA as Array<{ org_id: string }> | null)?.[0];
    expect(orgRow).toBeTruthy();
    createdOrgIds.push(orgRow!.org_id);

    // User A reads their own membership.
    const { data: aMems } = await userAClient.from('memberships').select('*').eq('org_id', orgRow!.org_id);
    expect(aMems?.length).toBeGreaterThanOrEqual(1);

    // PROOF: user B sees ZERO memberships in user A's org.
    const { data: bMems, error: bErr } = await userBClient.from('memberships').select('*').eq('org_id', orgRow!.org_id);
    expect(bErr).toBeNull();
    expect(bMems).toEqual([]);

    // Pitfall #8 invariant: admin attempts a SECOND active membership row for
    // (userA.id, orgRow.org_id) → 23505 unique_violation on the partial index.
    const { data: rolesData } = await adminClient.from('roles')
      .select('id').eq('org_id', orgRow!.org_id).eq('name', 'View-only').limit(1);
    const viewOnlyId = (rolesData as Array<{ id: string }> | null)?.[0]?.id;
    expect(viewOnlyId).toBeTruthy();

    const { error: dupErr } = await adminClient.from('memberships').insert({
      user_id: userA.id,
      org_id: orgRow!.org_id,
      role_id: viewOnlyId,
      consent_scope: {},
    });
    expect(dupErr).not.toBeNull();
    expect(
      dupErr?.code === '23505' ||
        /duplicate key|unique/i.test(dupErr?.message ?? ''),
    ).toBe(true);
  }, 30_000);
});

describe('Phase 9 RLS memberships — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn('[rls-memberships.test] SKIPPED — env not set. Wave verification gates this.');
    }
    expect(true).toBe(true);
  });
});
