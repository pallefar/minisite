/**
 * Phase 42 Plan 42-07 (POLISH-12) — Live cross-tenant RLS impersonation proof
 * for the quarterly NPS schema.
 *
 * Verifies:
 *   T-42-07-01: user A can SELECT their own quarterly_nps_responses row.
 *   T-42-07-02: user B CANNOT SELECT user A's quarterly_nps_responses row.
 *   T-42-07-03: user A can INSERT their own row (in-app fallback path).
 *   T-42-07-04: user A CANNOT INSERT a row for user B (auth.uid() mismatch).
 *   T-42-07-05: authenticated SELECT against quarterly_nps_nonces returns
 *               zero rows (service-role only — REVOKE + RLS deny-all).
 *   T-42-07-06: cron schedule 'quarterly-nps-enqueue' exists with
 *               schedule = '0 0 1 1,4,7,10 *' (live verification of D-22).
 *
 * Pattern follows tests/rls/photo-trash-rls.test.ts:
 *   - admin client via service_role for setup/teardown
 *   - per-user authenticated clients via getUserAccessToken
 *     (admin.generateLink + /auth/v1/verify — plain fetch, ES256-compat)
 *     per [[reference_rls_fixture_gotrueclient_flake]]
 *   - file-scoped slug prefix per [[feedback_rls_per_file_slug_prefix]]
 *
 * Environment (auto-skips when missing):
 *   SUPABASE_URL              — public
 *   SUPABASE_ANON_KEY         — public
 *   SUPABASE_SERVICE_ROLE_KEY — PRIVATE
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getUserAccessToken } from './helpers/admin-session';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// File-scoped slug per [[feedback_rls_per_file_slug_prefix]].
const QNPS_PREFIX = `p42-qnps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const QUARTER = '2026-Q3';

function getAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function buildAnonClient(storageKey: string): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false, storageKey },
  });
}

describeIfLive('Phase 42 Plan 42-07 — Quarterly NPS RLS cross-tenant isolation', () => {
  let admin: SupabaseClient;
  let userAId: string;
  let userBId: string;
  let userAEmail: string;
  let userBEmail: string;
  let seededResponseId: string | undefined;

  beforeAll(async () => {
    admin = getAdmin();
    const ts = Date.now();
    userAEmail = `${QNPS_PREFIX}-a-${ts}@leanshot.test`;
    userBEmail = `${QNPS_PREFIX}-b-${ts}@leanshot.test`;

    const { data: aRes, error: aErr } = await admin.auth.admin.createUser({
      email: userAEmail,
      password: `Pass1234-${crypto.randomUUID().slice(0, 8)}`,
      email_confirm: true,
    });
    if (aErr) throw new Error(`createUser A: ${aErr.message}`);
    userAId = aRes.user!.id;

    const { data: bRes, error: bErr } = await admin.auth.admin.createUser({
      email: userBEmail,
      password: `Pass1234-${crypto.randomUUID().slice(0, 8)}`,
      email_confirm: true,
    });
    if (bErr) throw new Error(`createUser B: ${bErr.message}`);
    userBId = bRes.user!.id;

    // Seed one NPS response for user A so the cross-tenant SELECT has prey.
    const { data: ins, error: insErr } = await admin
      .from('quarterly_nps_responses')
      .insert({
        user_id: userAId,
        quarter: QUARTER,
        score: 9,
        comment: `${QNPS_PREFIX} seed`,
        responded_via: 'email',
      })
      .select('id')
      .single();
    if (insErr) throw new Error(`seed quarterly_nps_responses: ${insErr.message}`);
    seededResponseId = ins!.id as string;
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    try {
      await admin
        .from('quarterly_nps_responses')
        .delete()
        .or(`user_id.eq.${userAId},user_id.eq.${userBId}`);
    } catch { /* best-effort */ }
    try {
      await admin
        .from('quarterly_nps_nonces')
        .delete()
        .or(`user_id.eq.${userAId},user_id.eq.${userBId}`);
    } catch { /* best-effort */ }
    try {
      if (userAId) await admin.auth.admin.deleteUser(userAId);
    } catch { /* best-effort */ }
    try {
      if (userBId) await admin.auth.admin.deleteUser(userBId);
    } catch { /* best-effort */ }
  }, 60_000);

  it('T-42-07-01: user A SELECTs own quarterly_nps_responses row', async () => {
    const tokenA = await getUserAccessToken(userAEmail);
    const clientA = buildAnonClient(`qnps-rls-a-01-${QNPS_PREFIX}`);
    const { data, error } = await clientA
      .from('quarterly_nps_responses')
      .select('id, user_id, quarter, score')
      .eq('quarter', QUARTER)
      .setHeader('Authorization', `Bearer ${tokenA}`);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].user_id).toBe(userAId);
    expect(data![0].id).toBe(seededResponseId);
  });

  it('T-42-07-02: user B CANNOT see user A quarterly_nps_responses row', async () => {
    const tokenB = await getUserAccessToken(userBEmail);
    const clientB = buildAnonClient(`qnps-rls-b-02-${QNPS_PREFIX}`);
    const { data, error } = await clientB
      .from('quarterly_nps_responses')
      .select('id, user_id, quarter')
      .eq('quarter', QUARTER)
      .setHeader('Authorization', `Bearer ${tokenB}`);
    expect(error).toBeNull();
    // User B has not seeded any row; user A's row must be RLS-hidden.
    expect((data ?? []).filter((r) => r.user_id === userAId)).toHaveLength(0);
  });

  it('T-42-07-03: user A can INSERT own row (in-app fallback path)', async () => {
    const tokenA = await getUserAccessToken(userAEmail);
    const clientA = buildAnonClient(`qnps-rls-a-03-${QNPS_PREFIX}`);
    const { error } = await clientA
      .from('quarterly_nps_responses')
      .insert({
        user_id: userAId,
        quarter: '2026-Q4',
        score: 7,
        responded_via: 'in-app',
      })
      .setHeader('Authorization', `Bearer ${tokenA}`);
    // The seed inserted '2026-Q3'; this inserts '2026-Q4' to avoid UNIQUE conflict.
    expect(error).toBeNull();
  });

  it('T-42-07-04: user A CANNOT INSERT a row for user B (auth.uid mismatch)', async () => {
    const tokenA = await getUserAccessToken(userAEmail);
    const clientA = buildAnonClient(`qnps-rls-a-04-${QNPS_PREFIX}`);
    const { error } = await clientA
      .from('quarterly_nps_responses')
      .insert({
        user_id: userBId, // ← mismatch — should be rejected by WITH CHECK
        quarter: '2026-Q1',
        score: 5,
        responded_via: 'in-app',
      })
      .setHeader('Authorization', `Bearer ${tokenA}`);
    expect(error).not.toBeNull();
    // PostgREST returns code '42501' (insufficient_privilege) or '23' family
    // depending on policy ordering; any non-null error is sufficient proof
    // that the cross-tenant INSERT was rejected.
  });

  it('T-42-07-05: authenticated SELECT on quarterly_nps_nonces returns 0 rows (service-role only)', async () => {
    // Seed a nonce via admin (service-role bypasses RLS).
    const nonce = `${QNPS_PREFIX}-n5-${crypto.randomUUID()}`;
    const { error: seedErr } = await admin.from('quarterly_nps_nonces').insert({
      nonce,
      user_id: userAId,
      quarter: QUARTER,
    });
    expect(seedErr).toBeNull();

    const tokenA = await getUserAccessToken(userAEmail);
    const clientA = buildAnonClient(`qnps-rls-a-05-${QNPS_PREFIX}`);
    const { data } = await clientA
      .from('quarterly_nps_nonces')
      .select('nonce')
      .eq('nonce', nonce)
      .setHeader('Authorization', `Bearer ${tokenA}`);
    // Either the result is empty (RLS denies) or PostgREST returns an error;
    // both prove the row is invisible. We treat either as PASS.
    expect((data ?? []).length).toBe(0);
  });

  // Note: cron.job presence (D-22 schedule '0 0 1 1,4,7,10 *') is verified at
  // the Task 4 human-checkpoint via `supabase db query --linked
  // "SELECT jobname, schedule FROM cron.job WHERE jobname='quarterly-nps-enqueue'"`.
  // PostgREST does not expose the `cron` schema; making a Deno-side admin RPC
  // exclusively for the test would add migration surface for zero defensive
  // value over the human-checkpoint check.
});
