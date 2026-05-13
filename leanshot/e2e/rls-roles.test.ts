/**
 * Phase 9 Plan 09-01 — cross-tenant RLS proof + system roles seeded test
 * for `public.roles`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

describeIfLive('Phase 9 Plan 09-01 — cross-tenant RLS isolation on roles', () => {
  let admin: SupabaseClient | null = null;
  const getAdmin = (): SupabaseClient => {
    if (!admin) admin = createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
    return admin;
  };
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  afterAll(async () => {
    if (!admin) return;
    for (const id of createdOrgIds) try { await admin.from('orgs').delete().eq('id', id); } catch {/* */}
    for (const id of createdUserIds) try { await admin.auth.admin.deleteUser(id); } catch {/* */}
  });

  it('user B cannot read user A roles + system roles seeded by trigger', async () => {
    const adminClient = getAdmin();
    const passwordA = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    const passwordB = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    const emailA = `rls-roles-a-${Date.now()}@leanshot.test`;
    const emailB = `rls-roles-b-${Date.now()}@leanshot.test`;

    const { data: aRes } = await adminClient.auth.admin.createUser({ email: emailA, password: passwordA, email_confirm: true });
    const userA = aRes?.user; if (!userA) throw new Error('userA');
    createdUserIds.push(userA.id);
    const { data: bRes } = await adminClient.auth.admin.createUser({ email: emailB, password: passwordB, email_confirm: true });
    const userB = bRes?.user; if (!userB) throw new Error('userB');
    createdUserIds.push(userB.id);

    const userAClient = createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-roles-a' } });
    const userBClient = createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-roles-b' } });
    await userAClient.auth.signInWithPassword({ email: emailA, password: passwordA });
    await userBClient.auth.signInWithPassword({ email: emailB, password: passwordB });

    const slugA = `rls-roles-a-${Date.now().toString(36)}`;
    const { data: createA, error: createAErr } = await userAClient.rpc('create_org', {
      p_name: 'RLS Roles A', p_slug: slugA, p_description: null, p_website_url: null,
    });
    if (createAErr) throw createAErr;
    const orgId = (createA as Array<{ org_id: string }> | null)?.[0]?.org_id;
    expect(orgId).toBeTruthy();
    createdOrgIds.push(orgId!);

    // Trigger should have seeded EXACTLY 3 system roles (Owner, Coach, View-only).
    const { data: adminRoles } = await adminClient.from('roles').select('*').eq('org_id', orgId);
    expect(adminRoles?.length).toBe(3);
    const names = (adminRoles as Array<{ name: string; is_system: boolean }> | null)?.map((r) => r.name).sort();
    expect(names).toEqual(['Coach', 'Owner', 'View-only']);
    expect(adminRoles?.every((r: { is_system: boolean }) => r.is_system === true)).toBe(true);

    // User A reads roles for their own org.
    const { data: aRoles } = await userAClient.from('roles').select('*').eq('org_id', orgId);
    expect(aRoles?.length).toBe(3);

    // PROOF: user B sees ZERO roles for user A's org.
    const { data: bRoles, error: bErr } = await userBClient.from('roles').select('*').eq('org_id', orgId);
    expect(bErr).toBeNull();
    expect(bRoles).toEqual([]);

    // NEGATIVE: user B cannot direct-INSERT a role.
    const { error: insErr } = await userBClient.from('roles').insert({
      org_id: orgId, name: 'Attacker', is_system: false,
    });
    expect(insErr).not.toBeNull();
  }, 30_000);
});

describe('Phase 9 RLS roles — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn('[rls-roles.test] SKIPPED — env not set.');
    }
    expect(true).toBe(true);
  });
});
