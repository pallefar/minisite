/**
 * Phase 22 Plan 22-12 — RLS proof for `public.dsar_requests` (GDPR-03).
 *
 * Behaviors (Wave 0 it.skip replaced with live cross-tenant proofs):
 *   T1 user A calls `create_dsar_request` RPC → row inserted with
 *      user_id=auth.uid(), status='pending'; user A SELECT returns it.
 *   T2 user B SELECT for user A's row → ZERO (cross-tenant deny).
 *   T3 authenticated UPDATE of status → 42501 (only service-role Edge Fn
 *      writes status transitions; client cannot self-promote pending →
 *      completed to claim a fake bundle).
 *
 * Per-file slug prefix `phase22-dsar-requests-rls`.
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

const DSAR_REQUESTS_PREFIX = 'phase22-dsar-requests-rls';

describeIfLive('Phase 22 plan 22-12 — RLS dsar_requests', () => {
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
    const stamp = Date.now();
    const emailA = `${DSAR_REQUESTS_PREFIX}-a-${stamp}@leanshot.test`;
    const emailB = `${DSAR_REQUESTS_PREFIX}-b-${stamp}@leanshot.test`;
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
        storageKey: `${DSAR_REQUESTS_PREFIX}-a`,
      },
    });
    const bClient = createClient(URL!, ANON!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        storageKey: `${DSAR_REQUESTS_PREFIX}-b`,
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
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    for (const id of createdUserIds) {
      try {
        await admin.from('dsar_requests').delete().eq('user_id', id);
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

  it('create_dsar_request RPC inserts pending row for user A; cross-tenant select returns []', async () => {
    const a = userA!;
    const b = userB!;

    const { data: rpcOut, error: rpcErr } = await a.client.rpc('create_dsar_request');
    expect(rpcErr).toBeNull();
    // RPC returns the row id (uuid).
    expect(rpcOut).toBeTruthy();

    const { data: aSelf, error: aErr } = await a.client
      .from('dsar_requests')
      .select('id, user_id, status')
      .order('requested_at', { ascending: false })
      .limit(5);
    expect(aErr).toBeNull();
    expect(aSelf!.length).toBeGreaterThanOrEqual(1);
    expect(aSelf!.every((r) => r.user_id === a.id)).toBe(true);
    expect(aSelf!.some((r) => r.status === 'pending')).toBe(true);

    const { data: bSees } = await b.client
      .from('dsar_requests')
      .select('*')
      .eq('user_id', a.id);
    expect(bSees).toEqual([]);
  }, 30_000);

  it('authenticated UPDATE of status → 42501 / silent no-op', async () => {
    const a = userA!;
    const adminClient = getAdmin();

    // Seed a pending row directly via service-role so we have a known target.
    const { data: seed, error: seedErr } = await adminClient
      .from('dsar_requests')
      .insert({ user_id: a.id, status: 'pending' })
      .select('id')
      .single();
    if (seedErr) throw seedErr;

    const { error: updErr } = await a.client
      .from('dsar_requests')
      .update({ status: 'completed' })
      .eq('id', seed!.id);

    // Two acceptable outcomes (RLS deny on UPDATE OR row filtered out by RLS):
    if (updErr) {
      expect(
        updErr.code === '42501' || /row-level security/i.test(updErr.message ?? ''),
      ).toBe(true);
    } else {
      // Verify row STILL has status='pending' via service-role.
      const { data: check } = await adminClient
        .from('dsar_requests')
        .select('status')
        .eq('id', seed!.id)
        .maybeSingle();
      expect(check?.status).toBe('pending');
    }
  }, 30_000);
});

describe('Phase 22 plan 22-12 — RLS dsar_requests gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn(
        '[rls-dsar-requests] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set.',
      );
    }
    expect(true).toBe(true);
  });
});
