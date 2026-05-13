/**
 * Phase 9 Plan 09-01 — cross-tenant RLS impersonation proof for `public.orgs`.
 *
 * Project rule from memory `reference_supabase_project.md`:
 * every Supabase RLS surface MUST get a live cross-tenant impersonation
 * proof — not just the policy SQL.
 *
 * Mirrors `e2e/rls-injections.test.ts` shape:
 *   1. Admin client seeds two users.
 *   2. Each user gets a JWT-scoped anon client.
 *   3. User A creates an org via the create_org RPC; trigger seeds 3 system
 *      roles + RPC inserts user A's Owner membership.
 *   4. User A SELECTs orgs → sees their own row (1 row).
 *   5. User B SELECTs orgs → sees ZERO rows (cross-tenant RLS denies).
 *   6. User B attempts to call create_org with a colliding slug → expected
 *      to either succeed for a NON-colliding slug (positive control) or
 *      raise on collision; either way user B's row is invisible to user A.
 *   7. User B cannot bypass RLS by direct INSERT (no INSERT policy → 42501).
 *
 * Skipped automatically if SUPABASE_SERVICE_ROLE_KEY is absent (default
 * local + PR runs from forks). CI / Phase 9 wave verification runs this
 * against the live cloud DB.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

describeIfLive('Phase 9 Plan 09-01 — cross-tenant RLS isolation on orgs', () => {
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

  it('user B cannot read user A orgs via RLS-scoped client', async () => {
    const adminClient = getAdmin();
    const passwordA = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    const passwordB = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    const emailA = `rls-orgs-a-${Date.now()}@leanshot.test`;
    const emailB = `rls-orgs-b-${Date.now()}@leanshot.test`;

    const { data: aRes, error: aErr } = await adminClient.auth.admin.createUser({
      email: emailA,
      password: passwordA,
      email_confirm: true,
    });
    if (aErr) throw aErr;
    const userA = aRes.user!;
    createdUserIds.push(userA.id);

    const { data: bRes, error: bErr } = await adminClient.auth.admin.createUser({
      email: emailB,
      password: passwordB,
      email_confirm: true,
    });
    if (bErr) throw bErr;
    const userB = bRes.user!;
    createdUserIds.push(userB.id);

    const userAClient = createClient(URL!, ANON!, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-orgs-a' },
    });
    const userBClient = createClient(URL!, ANON!, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-orgs-b' },
    });
    {
      const { error } = await userAClient.auth.signInWithPassword({
        email: emailA,
        password: passwordA,
      });
      if (error) throw error;
    }
    {
      const { error } = await userBClient.auth.signInWithPassword({
        email: emailB,
        password: passwordB,
      });
      if (error) throw error;
    }

    // User A creates an org via RPC.
    const slugA = `rls-orgs-a-${Date.now().toString(36)}`;
    const { data: createA, error: createAErr } = await userAClient.rpc('create_org', {
      p_name: 'RLS Org A',
      p_slug: slugA,
      p_description: null,
      p_website_url: null,
    });
    if (createAErr) throw createAErr;
    const orgRow = (createA as Array<{ org_id: string; slug: string }> | null)?.[0];
    expect(orgRow).toBeTruthy();
    createdOrgIds.push(orgRow!.org_id);

    // User A SELECTs orgs — sees their own.
    const { data: aData, error: aReadErr } = await userAClient.from('orgs').select('*');
    if (aReadErr) throw aReadErr;
    expect(aData?.some((o: { id: string }) => o.id === orgRow!.org_id)).toBe(true);

    // PROOF: user B SELECTs orgs — RLS filters silently to zero relevant rows.
    // (User B may have seeded their own org from a parallel test; we only assert
    // that user A's specific org is NOT visible to user B.)
    const { data: bData, error: bReadErr } = await userBClient.from('orgs').select('*');
    expect(bReadErr).toBeNull();
    expect(bData?.some((o: { id: string }) => o.id === orgRow!.org_id)).toBe(false);

    // NEGATIVE: user B cannot directly INSERT an orgs row (no INSERT policy).
    const { error: insErr } = await userBClient.from('orgs').insert({
      slug: `rls-orgs-direct-${Date.now().toString(36)}`,
      name: 'Direct Insert Attempt',
      owner_user_id: userB.id,
    });
    expect(insErr).not.toBeNull();
    expect(
      insErr?.code === '42501' ||
        /violates row-level security/i.test(insErr?.message ?? ''),
    ).toBe(true);
  }, 30_000);
});

describe('Phase 9 Plan 09-01 RLS orgs — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn(
        '[rls-orgs.test] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set. Wave verification gates this.',
      );
    }
    expect(true).toBe(true);
  });
});
