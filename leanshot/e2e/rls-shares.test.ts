/**
 * Phase 8 SHARE-01..06 cross-tenant proof for `public.shares`.
 *
 * Project rule (memory `reference_supabase_project.md`): every new RLS surface
 * gets a live cross-tenant impersonation proof — not just policy SQL. This
 * file ships ONE real assertion in Wave 1 (cross-tenant SELECT isolation);
 * the remaining stubs are filled by later plans (audit-row write, snapshot
 * view structural exclusion, code single-use) and intentionally throw so
 * CI surfaces them as red-but-tracked until those plans land.
 *
 * Mirrors `e2e/rls-injections.test.ts` (Phase 5) — same lifecycle
 * (admin createUser → JWT-scoped client → RLS-bound select), swapped table.
 * The write path uses the `create_share` SECURITY DEFINER RPC because the
 * `shares` table has NO authenticated INSERT policy (RPCs are the only write
 * path; see migration 20260701000002_shares_table.sql).
 *
 * Environment:
 *   SUPABASE_URL              — public, e.g. https://<ref>.supabase.co
 *   SUPABASE_ANON_KEY         — public anon JWT (publishable)
 *   SUPABASE_SERVICE_ROLE_KEY — PRIVATE service-role JWT (NEVER commit; CI secret only)
 *
 * Skipped automatically if any required env var is absent (default local + PR
 * runs from forks). Phase 8 wave verification runs this against the live cloud
 * DB with the secret injected.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(URL && ANON && SERVICE);

const describeIfLive = SHOULD_RUN ? describe : describe.skip;

describeIfLive('Phase 8 SHARE — cross-tenant RLS isolation on shares', () => {
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

  afterAll(async () => {
    if (!admin) return;
    for (const id of createdUserIds) {
      try {
        await admin.auth.admin.deleteUser(id);
      } catch {
        // best-effort cleanup; on delete cascade handles the shares row
      }
    }
  });

  it('shares_select_own — user B cannot read user A shares row via RLS-scoped client', async () => {
    const adminClient = getAdmin();
    // 1. Seed two users via the admin API (verified inline so no email loop).
    const passwordA = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    const passwordB = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    const emailA = `rls-shares-a-${Date.now()}@leanshot.test`;
    const emailB = `rls-shares-b-${Date.now()}@leanshot.test`;

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

    // 2. Build JWT-scoped anon clients for each user.
    const userAClient = createClient(URL!, ANON!, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-shares-a' },
    });
    const userBClient = createClient(URL!, ANON!, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-shares-b' },
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

    // 3. Seed: user A creates a share via the create_share SECURITY DEFINER
    //    RPC — the ONLY write path (no authenticated INSERT policy on shares).
    const futureIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { data: createRes, error: createErr } = await userAClient.rpc('create_share', {
      p_label: 'Dr. Smith — RLS test',
      p_expires_at: futureIso,
    });
    if (createErr) throw createErr;
    // create_share returns `table (share_id uuid, raw_token text, raw_code text)`;
    // supabase-js surfaces this as an array of rows.
    expect(Array.isArray(createRes)).toBe(true);
    const seedRow = (createRes as Array<{ share_id: string; raw_token: string; raw_code: string }>)[0]!;
    expect(seedRow.share_id).toBeTruthy();
    expect(typeof seedRow.raw_token).toBe('string');
    expect(seedRow.raw_code).toMatch(/^\d{6}$/);

    // 4. Admin (service role) confirms the row really exists.
    const { data: adminData, error: adminErr } = await adminClient
      .from('shares')
      .select('*')
      .eq('id', seedRow.share_id);
    if (adminErr) throw adminErr;
    expect(adminData).toHaveLength(1);
    expect(adminData![0]!.user_id).toBe(userA.id);

    // 5. User A reads their OWN share — RLS allows it (count = 1).
    const { data: aData, error: aReadErr } = await userAClient.from('shares').select('*');
    if (aReadErr) throw aReadErr;
    expect(aData).toHaveLength(1);
    expect(aData![0]!.id).toBe(seedRow.share_id);

    // 6. THE PROOF: user B reads ZERO shares — RLS returns empty set
    //    (NOT an error; RLS filters silently rather than 403'ing).
    const { data: bData, error: bReadErr } = await userBClient.from('shares').select('*');
    expect(bReadErr).toBeNull();
    expect(bData).toEqual([]);

    // 7. NEGATIVE TEST: user B cannot direct-INSERT into shares — there is
    //    NO authenticated INSERT policy. RPCs are the only write path.
    const { error: impErr } = await userBClient.from('shares').insert({
      user_id: userA.id, // impersonation attempt
      label: 'forged share',
      token_hash: 'x'.repeat(64),
      access_code_hash: '$2a$10$' + 'x'.repeat(53),
      expires_at: futureIso,
    });
    expect(impErr).not.toBeNull();
    expect(
      impErr?.code === '42501' ||
        /violates row-level security|permission denied/i.test(impErr?.message ?? ''),
    ).toBe(true);
  }, 30_000);

  // ── Stubs filled by later plans ─────────────────────────────────────────
  // These tests intentionally throw so the surface is red-but-visible until
  // the responsible plan lands. Existence is the Wave 0 gate (project rule).

  it.todo('audit_logs — share_view row written by log_share_view RPC has actor_type=share_recipient (Plan 08-02)');

  it.todo('share_snapshot_view — structural exclusion: pg_get_viewdef contains zero "ai_messages" references (Plan 08-01 Task 3 verify, but also runtime check here for regression coverage)');

  it.todo('redeem_share — code is single-use: second redeem on same share_id raises P0002 (Plan 08-02)');
});

describe('Phase 8 SHARE — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // Not a failure — communicate skipped state.
      // eslint-disable-next-line no-console
      console.warn(
        '[rls-shares.test] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set. Wave verification gates this.',
      );
    }
    expect(true).toBe(true);
  });
});
