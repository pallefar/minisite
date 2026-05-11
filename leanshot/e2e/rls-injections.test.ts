/**
 * Phase 5 SC#5 + T-05-01 cross-tenant proof for `public.injections`.
 *
 * Two distinct authenticated users; user A's JWT-scoped client must see ONLY
 * user A's `injections` rows, never user B's. The admin client (service role)
 * confirms the seeded row really exists, isolating "row visibility" from
 * "row absence". A negative test asserts user B cannot impersonate user A
 * via `user_id` in the insert payload (RLS WITH CHECK).
 *
 * Mirrors `e2e/rls-ai-messages.test.ts` (Phase 4 04-03 Task 5) — same lifecycle
 * (admin createUser → JWT-scoped client → RLS-bound select), swapped table.
 *
 * Environment:
 *   SUPABASE_URL              — public, e.g. https://<ref>.supabase.co
 *   SUPABASE_ANON_KEY         — public anon JWT (publishable)
 *   SUPABASE_SERVICE_ROLE_KEY — PRIVATE service-role JWT (NEVER commit; CI secret only)
 *
 * Skipped automatically if any required env var is absent (default local + PR
 * runs from forks). Phase 5 wave verification runs this against the live cloud
 * DB with the secret injected.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(URL && ANON && SERVICE);

const describeIfLive = SHOULD_RUN ? describe : describe.skip;

describeIfLive('Phase 5 SC#5 — cross-tenant RLS isolation on injections', () => {
  // Lazy-construct the admin client so `describe.skip` doesn't crash on
  // missing env vars when SHOULD_RUN is false (describe.skip still runs
  // the factory body; createClient throws on undefined URL).
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
        // best-effort cleanup; on delete cascade handles the injection rows
      }
    }
  });

  it('user B cannot read user A injections via RLS-scoped client (SC#5)', async () => {
    const adminClient = getAdmin();
    // 1. Seed two users via the admin API (verified inline so no email loop).
    const passwordA = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    const passwordB = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    const emailA = `rls-inj-a-${Date.now()}@leanshot.test`;
    const emailB = `rls-inj-b-${Date.now()}@leanshot.test`;

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
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-inj-a' },
    });
    const userBClient = createClient(URL!, ANON!, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-inj-b' },
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

    // 3. Seed: user A inserts ONE injection via their OWN JWT — proves the
    //    INSERT RLS policy allows own-row writes (auth.uid() = user_id).
    const seedLogId = crypto.randomUUID();
    const { error: insErr } = await userAClient.from('injections').insert({
      user_id: userA.id,
      log_id: seedLogId,
      medication: 'ozempic',
      dose: '0.5',
      unit: 'mg',
      site: 'abdomen-ul',
      notes: '',
      logged_at: new Date().toISOString(),
      pk_engine_version: 1,
    });
    if (insErr) throw insErr;

    // 4. Admin (service role) confirms the row really exists.
    const { data: adminData, error: adminErr } = await adminClient
      .from('injections')
      .select('*')
      .eq('log_id', seedLogId);
    if (adminErr) throw adminErr;
    expect(adminData).toHaveLength(1);
    expect(adminData![0]!.user_id).toBe(userA.id);

    // 5. User A reads their OWN injection — RLS allows it (count = 1).
    const { data: aData, error: aReadErr } = await userAClient
      .from('injections')
      .select('*');
    if (aReadErr) throw aReadErr;
    expect(aData).toHaveLength(1);
    expect(aData![0]!.log_id).toBe(seedLogId);

    // 6. THE PROOF: user B reads ZERO injections — RLS returns empty set
    //    (NOT an error; RLS filters silently rather than 403'ing).
    const { data: bData, error: bReadErr } = await userBClient
      .from('injections')
      .select('*');
    expect(bReadErr).toBeNull();
    expect(bData).toEqual([]);

    // 7. NEGATIVE TEST: user B cannot insert a row pretending to be user A.
    //    The INSERT WITH CHECK (auth.uid() = user_id) policy rejects it.
    const { error: impErr } = await userBClient.from('injections').insert({
      user_id: userA.id, // impersonation attempt
      log_id: crypto.randomUUID(),
      medication: 'ozempic',
      dose: '0.5',
      unit: 'mg',
      site: 'abdomen-ul',
      notes: '',
      logged_at: new Date().toISOString(),
      pk_engine_version: 1,
    });
    expect(impErr).not.toBeNull();
    expect(
      impErr?.code === '42501' ||
        /violates row-level security/i.test(impErr?.message ?? ''),
    ).toBe(true);
  }, 30_000);
});

describe('Phase 5 SC#5 — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // Not a failure — communicate skipped state.
      // eslint-disable-next-line no-console
      console.warn(
        '[rls-injections.test] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set. Wave verification gates this.',
      );
    }
    expect(true).toBe(true);
  });
});
