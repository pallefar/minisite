/**
 * Phase 22 Plan 22-12 — RLS proof for `public.feature_flag_overrides` (D-08).
 *
 * Behaviors (Wave 0 it.skip replaced with live cross-tenant proofs):
 *   T1 user A SELECTs own active overrides → succeeds (RLS policy
 *      `feature_flag_overrides_select_own` per plan 22-01 migration); cross-
 *      tenant user B sees ZERO of user A's rows.
 *   T2 authenticated INSERT directly (without going through
 *      `admin_set_feature_flag_override` RPC) → 42501 (no auth write policy).
 *   T3 service-role write (representing the admin RPC body) succeeds.
 *
 * Per-file slug prefix `phase22-flag-overrides-rls` per
 * feedback_rls_per_file_slug_prefix.md.
 *
 * Auto-skips when SUPABASE_SERVICE_ROLE_KEY missing.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const FLAG_OVERRIDES_PREFIX = 'phase22-flag-overrides-rls';

describeIfLive('Phase 22 plan 22-12 — RLS feature_flag_overrides', () => {
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
  const seededRowIds: string[] = [];

  beforeAll(async () => {
    const adminClient = getAdmin();
    const stamp = Date.now();
    const emailA = `${FLAG_OVERRIDES_PREFIX}-a-${stamp}@leanshot.test`;
    const emailB = `${FLAG_OVERRIDES_PREFIX}-b-${stamp}@leanshot.test`;
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
        storageKey: `${FLAG_OVERRIDES_PREFIX}-a`,
      },
    });
    const bClient = createClient(URL!, ANON!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        storageKey: `${FLAG_OVERRIDES_PREFIX}-b`,
      },
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

    // Service-role seeds an override row for user A (mirrors what
    // admin_set_feature_flag_override RPC body would do — RPC tested
    // separately at unit level in plan 22-06).
    const futureExp = new Date(Date.now() + 24 * 3600_000).toISOString();
    const { data: seed, error: seedErr } = await adminClient
      .from('feature_flag_overrides')
      .insert({
        user_id: userA.id,
        flag_key: `${FLAG_OVERRIDES_PREFIX}-test-flag`,
        value: true,
        expires_at: futureExp,
        set_by: userA.id, // self for test purposes
      })
      .select('id')
      .single();
    if (seedErr) throw seedErr;
    if (seed?.id) seededRowIds.push(seed.id);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    for (const id of seededRowIds) {
      try {
        await admin.from('feature_flag_overrides').delete().eq('id', id);
      } catch {
        /* best-effort */
      }
    }
    for (const id of createdUserIds) {
      try {
        await admin
          .from('feature_flag_overrides')
          .delete()
          .or(`user_id.eq.${id},set_by.eq.${id}`);
      } catch {
        /* best-effort */
      }
      try {
        await admin.auth.admin.deleteUser(id);
      } catch {
        /* best-effort */
      }
    }
  });

  it('select-own returns user A row; cross-user returns []', async () => {
    const a = userA!;
    const b = userB!;

    const { data: aSelf, error: aErr } = await a.client
      .from('feature_flag_overrides')
      .select('*')
      .eq('flag_key', `${FLAG_OVERRIDES_PREFIX}-test-flag`);
    expect(aErr).toBeNull();
    expect(aSelf!.length).toBeGreaterThanOrEqual(1);
    expect(aSelf![0].user_id).toBe(a.id);

    const { data: bSees, error: bErr } = await b.client
      .from('feature_flag_overrides')
      .select('*')
      .eq('flag_key', `${FLAG_OVERRIDES_PREFIX}-test-flag`);
    expect(bErr).toBeNull();
    expect(bSees).toEqual([]);
  }, 30_000);

  it('authenticated INSERT (without admin RPC) → 42501 / RLS violation', async () => {
    const a = userA!;
    const { error } = await a.client.from('feature_flag_overrides').insert({
      user_id: a.id,
      flag_key: `${FLAG_OVERRIDES_PREFIX}-attempt-write`,
      value: true,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      set_by: a.id,
    });
    expect(error).not.toBeNull();
    expect(
      error!.code === '42501' || /row-level security/i.test(error!.message ?? ''),
    ).toBe(true);
  }, 30_000);

  it('service-role write succeeds (sanity for admin_set_feature_flag_override RPC body)', async () => {
    const a = userA!;
    const adminClient = getAdmin();
    const futureExp = new Date(Date.now() + 3600_000).toISOString();
    const { data, error } = await adminClient
      .from('feature_flag_overrides')
      .insert({
        user_id: a.id,
        flag_key: `${FLAG_OVERRIDES_PREFIX}-svc-role`,
        value: false,
        expires_at: futureExp,
        set_by: a.id,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    if (data?.id) seededRowIds.push(data.id);
  }, 30_000);
});

describe('Phase 22 plan 22-12 — RLS feature_flag_overrides gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn(
        '[rls-feature-flag-overrides] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set.',
      );
    }
    expect(true).toBe(true);
  });
});
