/**
 * Phase 9 Plan 09-01 — cross-tenant RLS proof + system-role-delete-forbidden
 * for `public.role_permissions`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

describeIfLive('Phase 9 Plan 09-01 — RLS + system-role immutability on role_permissions', () => {
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

  it('cross-tenant denied + delete_role rejects is_system=true', async () => {
    const adminClient = getAdmin();
    const passwordA = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    const passwordB = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    const emailA = `rls-rp-a-${Date.now()}@leanshot.test`;
    const emailB = `rls-rp-b-${Date.now()}@leanshot.test`;

    const { data: aRes } = await adminClient.auth.admin.createUser({ email: emailA, password: passwordA, email_confirm: true });
    const userA = aRes?.user; if (!userA) throw new Error('userA');
    createdUserIds.push(userA.id);
    const { data: bRes } = await adminClient.auth.admin.createUser({ email: emailB, password: passwordB, email_confirm: true });
    const userB = bRes?.user; if (!userB) throw new Error('userB');
    createdUserIds.push(userB.id);

    const userAClient = createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-rp-a' } });
    const userBClient = createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-rp-b' } });
    await userAClient.auth.signInWithPassword({ email: emailA, password: passwordA });
    await userBClient.auth.signInWithPassword({ email: emailB, password: passwordB });

    const slugA = `rls-rp-a-${Date.now().toString(36)}`;
    const { data: createA, error: createAErr } = await userAClient.rpc('create_org', {
      p_name: 'RLS RP A', p_slug: slugA, p_description: null, p_website_url: null,
    });
    if (createAErr) throw createAErr;
    const orgId = (createA as Array<{ org_id: string }> | null)?.[0]?.org_id;
    expect(orgId).toBeTruthy();
    createdOrgIds.push(orgId!);

    // Owner role has all 10 permissions.
    const { data: ownerRoleData } = await adminClient.from('roles').select('id').eq('org_id', orgId).eq('name', 'Owner').limit(1);
    const ownerRoleId = (ownerRoleData as Array<{ id: string }> | null)?.[0]?.id;
    expect(ownerRoleId).toBeTruthy();
    const { data: ownerPerms } = await adminClient.from('role_permissions').select('*').eq('role_id', ownerRoleId);
    expect(ownerPerms?.length).toBe(10);

    // User A (Owner) can SELECT role_permissions for their org.
    const { data: aRP } = await userAClient.from('role_permissions').select('*').eq('role_id', ownerRoleId);
    expect(aRP?.length).toBe(10);

    // PROOF: user B sees ZERO role_permissions for user A's roles.
    const { data: bRP, error: bErr } = await userBClient.from('role_permissions').select('*').eq('role_id', ownerRoleId);
    expect(bErr).toBeNull();
    expect(bRP).toEqual([]);

    // delete_role rejects is_system=true even for the Owner.
    const { error: delErr } = await userAClient.rpc('delete_role', { p_role_id: ownerRoleId });
    expect(delErr).not.toBeNull();
    expect(/system_role_immutable|forbidden/i.test(delErr?.message ?? '')).toBe(true);
  }, 30_000);
});

describe('Phase 9 RLS role_permissions — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn('[rls-role-permissions.test] SKIPPED — env not set.');
    }
    expect(true).toBe(true);
  });
});
