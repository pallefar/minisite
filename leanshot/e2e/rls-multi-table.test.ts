/**
 * Phase 6 SC#5 cross-tenant RLS proof — parameterized over the 9 new tables
 * (weights, meals, workouts, supplements, mood, sleep, symptoms, vials,
 * settings).
 *
 * Two distinct authenticated users; user A's JWT-scoped client must see
 * ONLY user A's rows, never user B's. The admin client (service role)
 * confirms each seeded row really exists. Each parameterized case also
 * asserts user B's impersonation attempt is rejected with code 42501 (RLS
 * WITH CHECK).
 *
 * Extends `e2e/rls-injections.test.ts` (Phase 5 SC#5 — same lifecycle, swapped
 * table). Uses `it.each` over the 7 composite-PK mechanical tables; settings
 * + supplements have their own bespoke cases because their PKs differ.
 *
 * Environment:
 *   SUPABASE_URL              — public
 *   SUPABASE_ANON_KEY         — public anon JWT
 *   SUPABASE_SERVICE_ROLE_KEY — PRIVATE (CI secret; never committed)
 *
 * Skipped automatically if any required env var is absent (default local +
 * PR-from-fork safety). Phase 6 wave verification runs this against the
 * live cloud DB with the secret injected.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

/**
 * 7 composite-PK mechanical tables. The `seed` function produces the
 * domain-specific row payload (sans user_id). The test wraps it with
 * `user_id: userA.id` at insert time.
 */
const TABLES_WITH_COMPOSITE_PK: Array<{
  name: string;
  pk: string;
  seed: () => Record<string, unknown>;
}> = [
  {
    name: 'weights',
    pk: 'weight_id',
    seed: () => ({
      weight_id: crypto.randomUUID(),
      date: '2026-05-12',
      weight: 90,
      ts: Date.now(),
    }),
  },
  {
    name: 'meals',
    pk: 'meal_id',
    seed: () => ({
      meal_id: crypto.randomUUID(),
      date: '2026-05-12',
      name: 'eggs',
      calories: 200,
      protein: 18,
      fiber: 2,
      ts: Date.now(),
    }),
  },
  {
    name: 'workouts',
    pk: 'workout_id',
    seed: () => ({
      workout_id: crypto.randomUUID(),
      date: '2026-05-12',
      type: 'cardio',
      name: 'jog',
      minutes: 30,
      notes: '',
    }),
  },
  {
    name: 'mood',
    pk: 'mood_id',
    seed: () => ({
      mood_id: crypto.randomUUID(),
      date: '2026-05-12',
      mood: 4,
      notes: '',
    }),
  },
  {
    name: 'sleep',
    pk: 'sleep_id',
    seed: () => ({
      sleep_id: crypto.randomUUID(),
      date: '2026-05-12',
      hours: 7.5,
      wakings: 1,
      notes: '',
    }),
  },
  {
    name: 'symptoms',
    pk: 'symptom_id',
    seed: () => ({
      symptom_id: crypto.randomUUID(),
      date: '2026-05-12',
      symptom: 'headache',
      severity: 2,
      notes: '',
    }),
  },
  {
    name: 'vials',
    pk: 'vial_id',
    seed: () => ({
      vial_id: crypto.randomUUID(),
      name: 'ozempic 2mg',
      doses_per_vial: 4,
      doses_used: 0,
      start_date: '2026-05-12',
      expiration_date: '2026-08-12',
    }),
  },
];

describeIfLive('Phase 6 SC#5 — RLS over 9 new tables', () => {
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
    const emailA = `phase6-rls-a-${Date.now()}@leanshot.test`;
    const emailB = `phase6-rls-b-${Date.now()}@leanshot.test`;
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
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-mt-a' },
    });
    const bClient = createClient(URL!, ANON!, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-mt-b' },
    });
    {
      const { error } = await aClient.auth.signInWithPassword({ email: emailA, password: pwA });
      if (error) throw error;
    }
    {
      const { error } = await bClient.auth.signInWithPassword({ email: emailB, password: pwB });
      if (error) throw error;
    }
    userA = { id: aRes.data.user!.id, client: aClient };
    userB = { id: bRes.data.user!.id, client: bClient };
    createdUserIds.push(userA.id, userB.id);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    for (const id of createdUserIds) {
      try {
        await admin.auth.admin.deleteUser(id);
      } catch {
        // best-effort cleanup; on-delete-cascade handles entity rows
      }
    }
  });

  it.each(TABLES_WITH_COMPOSITE_PK)(
    'table $name — user B reads ZERO of user A rows; impersonation rejected',
    async ({ name, pk, seed }) => {
      const a = userA!;
      const b = userB!;
      const adminClient = getAdmin();

      // 1. User A seeds via their OWN JWT — RLS INSERT policy must allow it.
      const seedRow = { user_id: a.id, ...seed() };
      const { error: insErr } = await a.client.from(name).insert(seedRow);
      expect(insErr).toBeNull();

      // 2. Admin (service role) confirms the row exists.
      const { data: adminData, error: adminErr } = await adminClient
        .from(name)
        .select('*')
        .eq('user_id', a.id)
        .eq(pk, (seedRow as Record<string, unknown>)[pk] as string);
      if (adminErr) throw adminErr;
      expect(adminData!.length).toBeGreaterThanOrEqual(1);

      // 3. User A reads own → ≥ 1 row.
      const { data: aData, error: aReadErr } = await a.client.from(name).select('*');
      if (aReadErr) throw aReadErr;
      expect(aData!.length).toBeGreaterThanOrEqual(1);

      // 4. THE PROOF: user B reads → ZERO rows (RLS filters silently).
      const { data: bData, error: bReadErr } = await b.client.from(name).select('*');
      expect(bReadErr).toBeNull();
      expect(bData).toEqual([]);

      // 5. NEGATIVE TEST: user B impersonation attempt → 42501 RLS rejection.
      const impersonationRow = { user_id: a.id, ...seed() };
      const { error: impErr } = await b.client.from(name).insert(impersonationRow);
      expect(impErr).not.toBeNull();
      expect(
        impErr!.code === '42501' || /violates row-level security/i.test(impErr!.message ?? ''),
      ).toBe(true);
    },
    30_000,
  );

  it('table supplements — user B reads ZERO of user A rows; impersonation rejected', async () => {
    const a = userA!;
    const b = userB!;
    const adminClient = getAdmin();

    const seedRow = {
      user_id: a.id,
      date: '2026-05-12',
      supplement_name: 'd3-rls',
      taken: true,
    };
    const { error: insErr } = await a.client.from('supplements').insert(seedRow);
    expect(insErr).toBeNull();

    const { data: adminData } = await adminClient
      .from('supplements')
      .select('*')
      .eq('user_id', a.id)
      .eq('date', '2026-05-12')
      .eq('supplement_name', 'd3-rls');
    expect(adminData!.length).toBeGreaterThanOrEqual(1);

    const { data: bData, error: bReadErr } = await b.client.from('supplements').select('*');
    expect(bReadErr).toBeNull();
    expect(bData).toEqual([]);

    const { error: impErr } = await b.client.from('supplements').insert({
      user_id: a.id,
      date: '2026-05-13',
      supplement_name: 'd3-rls',
      taken: true,
    });
    expect(impErr).not.toBeNull();
    expect(
      impErr!.code === '42501' || /violates row-level security/i.test(impErr!.message ?? ''),
    ).toBe(true);
  }, 30_000);

  it('table settings — user B reads ZERO of user A rows; impersonation rejected', async () => {
    const a = userA!;
    const b = userB!;
    const adminClient = getAdmin();

    // settings PK = user_id alone → upsert with onConflict='user_id'.
    const { error: insErr } = await a.client
      .from('settings')
      .upsert({ user_id: a.id, payload: { medication: 'ozempic' } }, { onConflict: 'user_id' });
    expect(insErr).toBeNull();

    const { data: adminData } = await adminClient
      .from('settings')
      .select('*')
      .eq('user_id', a.id);
    expect(adminData!.length).toBe(1);
    expect((adminData![0]!.payload as { medication?: string }).medication).toBe('ozempic');

    const { data: bData, error: bReadErr } = await b.client.from('settings').select('*');
    expect(bReadErr).toBeNull();
    expect(bData).toEqual([]);

    const { error: impErr } = await b.client
      .from('settings')
      .upsert({ user_id: a.id, payload: { medication: 'rogue' } }, { onConflict: 'user_id' });
    expect(impErr).not.toBeNull();
    expect(
      impErr!.code === '42501' || /violates row-level security/i.test(impErr!.message ?? ''),
    ).toBe(true);
  }, 30_000);
});

describe('Phase 6 SC#5 — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn(
        '[rls-multi-table.test] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set. Wave verification gates this.',
      );
    }
    expect(true).toBe(true);
  });
});
