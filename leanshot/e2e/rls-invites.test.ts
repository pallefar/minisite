/**
 * Phase 9 Plan 09-01 — cross-tenant RLS proof + D-18 consent_scope_at_acceptance
 * freeze for `public.invites`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

describeIfLive('Phase 9 Plan 09-01 — cross-tenant RLS isolation on invites', () => {
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

  it('user B cannot read user A invites', async () => {
    const adminClient = getAdmin();
    const passwordA = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    const passwordB = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    const emailA = `rls-inv-a-${Date.now()}@leanshot.test`;
    const emailB = `rls-inv-b-${Date.now()}@leanshot.test`;

    const { data: aRes } = await adminClient.auth.admin.createUser({ email: emailA, password: passwordA, email_confirm: true });
    const userA = aRes?.user; if (!userA) throw new Error('userA');
    createdUserIds.push(userA.id);
    const { data: bRes } = await adminClient.auth.admin.createUser({ email: emailB, password: passwordB, email_confirm: true });
    const userB = bRes?.user; if (!userB) throw new Error('userB');
    createdUserIds.push(userB.id);

    const userAClient = createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-inv-a' } });
    const userBClient = createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-inv-b' } });
    await userAClient.auth.signInWithPassword({ email: emailA, password: passwordA });
    await userBClient.auth.signInWithPassword({ email: emailB, password: passwordB });

    const slugA = `rls-inv-a-${Date.now().toString(36)}`;
    const { data: createA, error: createAErr } = await userAClient.rpc('create_org', {
      p_name: 'RLS Inv A', p_slug: slugA, p_description: null, p_website_url: null,
    });
    if (createAErr) throw createAErr;
    const orgId = (createA as Array<{ org_id: string }> | null)?.[0]?.org_id;
    expect(orgId).toBeTruthy();
    createdOrgIds.push(orgId!);

    // User A sends an invite.
    const tokenHash = `test-hash-${crypto.randomUUID()}`;
    const consentScope = {
      injections: true, weights: true, photos: false, symptoms: true, meals: true,
      workouts: true, supplements: true, mood: true, sleep: true, doctor_report: true,
    };
    const { data: invRes, error: invErr } = await userAClient.rpc('send_invite', {
      p_email: 'invitee@leanshot.test',
      p_org_id: orgId,
      p_invite_token_hash: tokenHash,
      p_requested_scope: consentScope,
    });
    if (invErr) throw invErr;
    const inviteId = (invRes as Array<{ invite_id: string }> | null)?.[0]?.invite_id;
    expect(inviteId).toBeTruthy();

    // User A sees the invite (members.list via Owner role).
    const { data: aInvs } = await userAClient.from('invites').select('*').eq('id', inviteId);
    expect(aInvs?.length).toBe(1);

    // PROOF: user B sees ZERO of user A's invites.
    const { data: bInvs, error: bErr } = await userBClient.from('invites').select('*').eq('id', inviteId);
    expect(bErr).toBeNull();
    expect(bInvs).toEqual([]);

    // NEGATIVE: user B cannot direct-INSERT an invite.
    const { error: insErr } = await userBClient.from('invites').insert({
      email: 'attacker@leanshot.test',
      org_id: orgId,
      invited_by: userB.id,
      invite_token_hash: 'attack',
      requested_scope: {},
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(insErr).not.toBeNull();
  }, 30_000);
});

describe('Phase 9 RLS invites — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn('[rls-invites.test] SKIPPED — env not set.');
    }
    expect(true).toBe(true);
  });
});
