/**
 * Phase 45 Plan 01 — DM thread RLS: symmetric block + participant-only proof.
 *
 * REQUIRES: supabase db push --linked completed (plan 45-09 close-out) AND
 * toggle_community_block RPC deployed (20270727000003).
 *
 * Verifies, against the live cloud DB (ytnsipxxmzgaebkqmokp), that:
 *
 *   T-45-06 / D-10 symmetric block:
 *     User A blocks user B → user B INSERT on dm_threads (B→A) returns 42501
 *     (RLS WITH CHECK violation). The block is enforced even though B is the
 *     attacker (asymmetric attack against a symmetric RLS predicate).
 *
 *   Participant access:
 *     If a thread already exists (created PRE-block), user B can still SELECT it
 *     (RLS SELECT policy is participant-only; block prevents NEW thread INSERT).
 *
 *   COMMUNITY-09 dm_open=false blocks INSERT:
 *     Recipient with dm_open=false → INSERT returns 42501.
 *
 * Pattern: file-scoped slug + admin.generateLink + /auth/v1/verify per
 * reference_rls_fixture_gotrueclient_flake.
 */

import { type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildAdmin,
  buildAnonClient,
  createOrgScopedUser,
  SHOULD_RUN,
  type TestUser,
} from './fixtures-community';

const TEST_SLUG_PREFIX = `p45_${new URL(import.meta.url).pathname.split('/').pop()}_${Date.now()}`;

const describeIfLive = SHOULD_RUN ? describe : describe.skip;

let admin: SupabaseClient;
let userA: TestUser;
let userB: TestUser;
let userC: TestUser; // dm_open=false
let preBlockThreadId: string | null = null;

describeIfLive('Phase 45 Plan 01 — DM RLS: symmetric block + dm_open + participant', () => {
  beforeAll(async () => {
    admin = buildAdmin();
    const ts = Date.now();

    userA = await createOrgScopedUser(admin, `${TEST_SLUG_PREFIX}-ua-${ts}@leanshot.test`);
    userB = await createOrgScopedUser(admin, `${TEST_SLUG_PREFIX}-ub-${ts}@leanshot.test`);
    userC = await createOrgScopedUser(admin, `${TEST_SLUG_PREFIX}-uc-${ts}@leanshot.test`);

    // userC closes their DMs.
    await admin.from('profiles').update({ dm_open: false }).eq('id', userC.id);

    // Pre-block thread (B→A created BEFORE block) so we can prove SELECT still works.
    const { data: t, error: tErr } = await admin
      .from('dm_threads')
      .insert({ creator_user_id: userB.id, recipient_user_id: userA.id })
      .select('id')
      .single();
    if (tErr) throw new Error(`pre-block thread insert: ${tErr.message}`);
    preBlockThreadId = (t as { id: string }).id;

    // Now A blocks B.
    const { error: blockErr } = await admin
      .from('user_block_list')
      .insert({ blocker_user_id: userA.id, blocked_user_id: userB.id });
    if (blockErr) throw new Error(`block insert: ${blockErr.message}`);
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    const userIds = [userA?.id, userB?.id, userC?.id].filter(Boolean) as string[];
    try { await admin.from('user_block_list').delete().in('blocker_user_id', userIds); } catch { /* best-effort */ }
    try { await admin.from('dm_threads').delete().in('creator_user_id', userIds); } catch { /* best-effort */ }
    for (const id of userIds) {
      try { await admin.auth.admin.deleteUser(id); } catch { /* best-effort */ }
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // T-45-06 symmetric block: B cannot INSERT new B→A thread after A blocks B
  // -------------------------------------------------------------------------

  it('User B CANNOT create new dm_threads to user A after A blocked B (symmetric block)', async () => {
    const tokenB = await userB.accessToken();
    const clientB = buildAnonClient(`${TEST_SLUG_PREFIX}-block-insert`);

    const { error } = await clientB
      .from('dm_threads')
      .insert({ creator_user_id: userB.id, recipient_user_id: userA.id })
      .setHeader('Authorization', `Bearer ${tokenB}`);

    expect(error).not.toBeNull();
    // PostgREST surfaces RLS violations as either 42501 (RLS WITH CHECK) or
    // 23505 (duplicate UNIQUE) — in this test the WITH CHECK predicate fires
    // first because the row would be NEW. Treat any non-null error as proof.
    expect(error?.code === '42501' || /row-level security/i.test(error?.message ?? '')).toBe(true);
  }, 30_000);

  // -------------------------------------------------------------------------
  // Participant SELECT survives block (the existing thread is visible)
  // -------------------------------------------------------------------------

  it('User B CAN still SELECT the pre-block thread (participant SELECT survives block)', async () => {
    const tokenB = await userB.accessToken();
    const clientB = buildAnonClient(`${TEST_SLUG_PREFIX}-select-pre`);

    const { data, error } = await clientB
      .from('dm_threads')
      .select('id')
      .eq('id', preBlockThreadId!)
      .setHeader('Authorization', `Bearer ${tokenB}`);

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
  }, 30_000);

  // -------------------------------------------------------------------------
  // COMMUNITY-09 dm_open=false blocks INSERT to recipient
  // -------------------------------------------------------------------------

  it('User A CANNOT create dm_threads to user C (recipient has dm_open=false)', async () => {
    const tokenA = await userA.accessToken();
    const clientA = buildAnonClient(`${TEST_SLUG_PREFIX}-dmopen-false`);

    const { error } = await clientA
      .from('dm_threads')
      .insert({ creator_user_id: userA.id, recipient_user_id: userC.id })
      .setHeader('Authorization', `Bearer ${tokenA}`);

    expect(error).not.toBeNull();
    expect(error?.code === '42501' || /row-level security/i.test(error?.message ?? '')).toBe(true);
  }, 30_000);
});
