/**
 * Phase 7 D-03 cross-tenant RLS proof for `public.pending_account_deletions`
 * AND the `photos-pending-shred/<uid>/` Storage prefix.
 *
 * Per project rule (memory `reference_supabase_project.md`): every RLS
 * surface MUST have a live cross-tenant impersonation proof, not just policy
 * SQL. `pending_account_deletions` is the load-bearing destructive surface
 * in v1 — a bug here produces irreversible data loss for a real user.
 *
 * Six assertions (each its own `it()` for clear failure isolation):
 *   1. SELECT — user A cannot read user B's pending row.
 *   2. INSERT — user A cannot directly insert a pending row (only the
 *      SECURITY DEFINER RPC + service-role can).
 *   3. UPDATE — user A cannot update their OWN pending row directly (T-07-07-T2
 *      — the RPC is the only legitimate writer).
 *   4. DELETE — user A cannot delete their own pending row.
 *   5. Storage SELECT — user A cannot list user B's photos-pending-shred/
 *      objects (deny-read RLS, T-07-07-I1).
 *   6. Storage SELECT (own) — user B cannot list THEIR OWN photos-pending-shred/
 *      objects either (entire prefix is service-role-only — D-03 invariant).
 *
 * Mirrors `e2e/rls-audit-logs.test.ts` shape. Filename ends in `.test.ts`
 * (not `.spec.ts`) per project convention — Playwright matches *.spec.ts;
 * Vitest cross-tenant RLS specs use *.test.ts and run via
 * `npm run test:e2e:rls`.
 *
 * Environment:
 *   SUPABASE_URL              — public (also VITE_SUPABASE_URL)
 *   SUPABASE_ANON_KEY         — public (also VITE_SUPABASE_ANON_KEY)
 *   SUPABASE_SERVICE_ROLE_KEY — PRIVATE
 *
 * Skipped automatically if any required env var is absent.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

describeIfLive('Phase 7 D-03 — RLS over pending_account_deletions + photos-pending-shred/', () => {
  let admin: SupabaseClient | null = null;
  const getAdmin = (): SupabaseClient => {
    if (!admin) {
      admin = createClient(URL!, SERVICE!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }
    return admin;
  };

  let userA: { id: string; client: SupabaseClient } | null = null;
  let userB: { id: string; client: SupabaseClient } | null = null;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const adminClient = getAdmin();
    const emailA = `phase7-pend-rls-a-${Date.now()}@leanshot.test`;
    const emailB = `phase7-pend-rls-b-${Date.now()}@leanshot.test`;
    const pwA = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    const pwB = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;

    const aRes = await adminClient.auth.admin.createUser({
      email: emailA,
      password: pwA,
      email_confirm: true,
    });
    if (aRes.error) throw aRes.error;
    const bRes = await adminClient.auth.admin.createUser({
      email: emailB,
      password: pwB,
      email_confirm: true,
    });
    if (bRes.error) throw bRes.error;

    const aClient = createClient(URL!, ANON!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        storageKey: 'rls-pend-a',
      },
    });
    const bClient = createClient(URL!, ANON!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        storageKey: 'rls-pend-b',
      },
    });
    {
      const { error } = await aClient.auth.signInWithPassword({
        email: emailA,
        password: pwA,
      });
      if (error) throw error;
    }
    {
      const { error } = await bClient.auth.signInWithPassword({
        email: emailB,
        password: pwB,
      });
      if (error) throw error;
    }

    userA = { id: aRes.data.user!.id, client: aClient };
    userB = { id: bRes.data.user!.id, client: bClient };
    createdUserIds.push(userA.id, userB.id);

    // User B seeds a pending row + a pending-shred Storage object via the
    // service-role admin (bypassing the SECURITY DEFINER RPC for setup).
    // The "service-role bypass" path is the OTHER permitted writer; using
    // it here is exactly how the production cron worker writes too.
    const { error: pendErr } = await adminClient
      .from('pending_account_deletions')
      .insert({ user_id: userB.id });
    if (pendErr) throw pendErr;

    // Storage seed: a sentinel object under photos-pending-shred/<B.id>/.
    // The RPC would normally MOVE existing photos here; for the RLS proof
    // we don't need the move semantics — just an object under the prefix
    // to assert read denial against.
    const sentinelBytes = new TextEncoder().encode('rls-test');
    const { error: upErr } = await adminClient.storage
      .from('photos')
      .upload(
        `photos-pending-shred/${userB.id}/sentinel.jpg`,
        sentinelBytes,
        { contentType: 'image/jpeg', upsert: true },
      );
    if (upErr) throw upErr;
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    // The cascade DELETE on auth.users will purge pending_account_deletions
    // automatically. Storage objects under photos-pending-shred/ are NOT
    // cascade-deleted (FK is on storage.objects.owner which is uuid, not a
    // hard FK to auth.users) — clean them up explicitly via the Storage API
    // (the only path that bypasses the protect_objects_delete trigger from
    // a non-superuser context).
    for (const id of createdUserIds) {
      try {
        await admin.storage.from('photos').remove([
          `photos-pending-shred/${id}/sentinel.jpg`,
        ]);
      } catch {
        /* best-effort */
      }
    }
    for (const id of createdUserIds) {
      try {
        await admin.auth.admin.deleteUser(id);
      } catch {
        /* best-effort */
      }
    }
  });

  it('1. user A cannot SELECT user B pending row (T-07-07-I1 cross-tenant info-disclosure)', async () => {
    const a = userA!;
    const b = userB!;
    const adminClient = getAdmin();

    // Admin sees B's row (false-pass guard).
    const { data: adminPending } = await adminClient
      .from('pending_account_deletions')
      .select('user_id')
      .eq('user_id', b.id);
    expect(adminPending!.length).toBeGreaterThanOrEqual(1);

    // User A's JWT-scoped read returns ZERO rows (RLS filters silently).
    const { data: aSeesB, error } = await a.client
      .from('pending_account_deletions')
      .select('user_id')
      .eq('user_id', b.id);
    expect(error).toBeNull();
    expect(aSeesB).toEqual([]);

    // User A also cannot see B by querying the whole table — only their own
    // rows (which is zero rows in this test, since A never initiated).
    const { data: aAll } = await a.client
      .from('pending_account_deletions')
      .select('user_id');
    expect(aAll!.every((r) => r.user_id === a.id)).toBe(true);
  }, 30_000);

  it('2. user A cannot directly INSERT a pending row (T-07-07-T2 tampering)', async () => {
    const a = userA!;
    const { error } = await a.client.from('pending_account_deletions').insert({
      user_id: a.id,
      initiated_at: new Date().toISOString(),
    });
    expect(error).not.toBeNull();
    expect(
      error!.code === '42501' ||
        /violates row-level security/i.test(error!.message ?? ''),
    ).toBe(true);
  }, 30_000);

  it('3. user B cannot UPDATE their own pending row directly (RPC is the only legitimate writer)', async () => {
    const b = userB!;
    // Even the OWNER cannot update — the absence of an UPDATE policy means
    // RLS default-denies. Either the update returns an error, or returns
    // zero affected rows (PostgREST surfaces this differently across
    // versions; both shapes prove the same tampering invariant).
    const { data, error } = await b.client
      .from('pending_account_deletions')
      .update({ initiated_at: new Date(0).toISOString() })
      .eq('user_id', b.id)
      .select();
    if (error) {
      expect(
        error.code === '42501' ||
          /violates row-level security/i.test(error.message ?? ''),
      ).toBe(true);
    } else {
      expect(data ?? []).toEqual([]);
    }
    // Verify the row is unchanged (initiated_at is recent, not 1970).
    const adminClient = getAdmin();
    const { data: adminRow } = await adminClient
      .from('pending_account_deletions')
      .select('initiated_at')
      .eq('user_id', b.id)
      .single();
    expect(new Date(adminRow!.initiated_at).getFullYear()).toBeGreaterThan(2020);
  }, 30_000);

  it('4. user B cannot DELETE their own pending row directly', async () => {
    const b = userB!;
    const { data, error } = await b.client
      .from('pending_account_deletions')
      .delete()
      .eq('user_id', b.id)
      .select();
    if (error) {
      expect(
        error.code === '42501' ||
          /violates row-level security/i.test(error.message ?? ''),
      ).toBe(true);
    } else {
      expect(data ?? []).toEqual([]);
    }
    // Row still there post-attempt.
    const adminClient = getAdmin();
    const { data: adminRow } = await adminClient
      .from('pending_account_deletions')
      .select('user_id')
      .eq('user_id', b.id);
    expect(adminRow!.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('5. user A cannot LIST user B photos-pending-shred/ objects (Storage deny-read)', async () => {
    const a = userA!;
    const b = userB!;
    const { data, error } = await a.client.storage
      .from('photos')
      .list(`photos-pending-shred/${b.id}`);
    // Supabase Storage list surfaces RLS denials as an empty array (silent
    // filter, mirrors `audit_logs_select_own` behavior). Either shape is
    // valid evidence of the deny.
    if (error) {
      expect(error.message).toMatch(/permission|not allowed|unauthorized/i);
    } else {
      expect(data ?? []).toEqual([]);
    }
  }, 30_000);

  it('6. user B cannot LIST their OWN photos-pending-shred/ objects (entire prefix is service-role-only)', async () => {
    const b = userB!;
    // The D-03 invariant: even the original owner cannot read their own
    // pending-shred photos. The RESTRICTIVE policy from
    // 20260601000014_photos_pending_shred_storage.sql ANDs with
    // photos_select_own and denies the entire prefix unconditionally for
    // the authenticated role.
    const { data, error } = await b.client.storage
      .from('photos')
      .list(`photos-pending-shred/${b.id}`);
    if (error) {
      expect(error.message).toMatch(/permission|not allowed|unauthorized/i);
    } else {
      expect(data ?? []).toEqual([]);
    }

    // Admin still sees the object (false-pass guard).
    const adminClient = getAdmin();
    const { data: adminData } = await adminClient.storage
      .from('photos')
      .list(`photos-pending-shred/${b.id}`);
    expect((adminData ?? []).length).toBeGreaterThanOrEqual(1);
  }, 30_000);
});
