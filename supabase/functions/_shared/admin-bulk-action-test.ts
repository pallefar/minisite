/**
 * admin-bulk-action-test.ts — Deno integration probe stub for the Phase 27
 * Plan 27-01 admin_bulk_action_execute + admin_bulk_action_undo SECDEF RPCs.
 *
 * STATUS: STUB — runs against a live linked Supabase project (NOT in CI). The
 * harness expects SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + a seeded admin
 * user. Invocation: `deno test --allow-net --allow-env supabase/functions/_shared/admin-bulk-action-test.ts`.
 *
 * Behaviors covered:
 *   1. Non-staff invocation → expect 42501 (forbidden).
 *   2. Admin invocation with 5 user ids action_type='tag' →
 *      expect {mode:'sync', affected:5, undo_token: non-null}.
 *   3. Undo with that token → expect {reversed:5}.
 *   4. Undo with same token twice → expect 'token_expired' (22023).
 *
 * NOTE: In CI we run the vitest action-handlers.test.ts (mocked) + the
 * Playwright e2e (live DB). This stub is reserved for ad-hoc manual probing.
 */

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ADMIN_JWT    = Deno.env.get('TEST_ADMIN_JWT');
const NONSTAFF_JWT = Deno.env.get('TEST_NONSTAFF_JWT');
const SEED_USER_1  = Deno.env.get('TEST_SEED_USER_1');
const SEED_USER_2  = Deno.env.get('TEST_SEED_USER_2');
const SEED_USER_3  = Deno.env.get('TEST_SEED_USER_3');
const SEED_USER_4  = Deno.env.get('TEST_SEED_USER_4');
const SEED_USER_5  = Deno.env.get('TEST_SEED_USER_5');

function rpcUrl(name: string): string {
  return `${SUPABASE_URL}/rest/v1/rpc/${name}`;
}

interface RpcResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

async function callRpc(jwt: string, name: string, body: Record<string, unknown>): Promise<RpcResponse> {
  const res = await fetch(rpcUrl(name), {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE ?? '',
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

function skipIfNoEnv(): boolean {
  return !SUPABASE_URL || !SERVICE_ROLE || !ADMIN_JWT || !NONSTAFF_JWT
    || !SEED_USER_1 || !SEED_USER_2 || !SEED_USER_3 || !SEED_USER_4 || !SEED_USER_5;
}

Deno.test('1. non-staff invocation → 42501 (forbidden)', { ignore: skipIfNoEnv() }, async () => {
  const r = await callRpc(NONSTAFF_JWT!, 'admin_bulk_action_execute', {
    p_action_type: 'tag',
    p_target_user_ids: [SEED_USER_1],
    p_params: { tag: 'integration-probe' },
  });
  assertEquals(r.ok, false);
  // PostgREST surfaces SQLSTATE 42501 as HTTP 403 with code field.
  const body = r.body as { code?: string; message?: string };
  assertEquals(body.code, '42501');
});

Deno.test('2. admin tag of 5 users → {mode:sync, affected:5, undo_token}', { ignore: skipIfNoEnv() }, async () => {
  const r = await callRpc(ADMIN_JWT!, 'admin_bulk_action_execute', {
    p_action_type: 'tag',
    p_target_user_ids: [SEED_USER_1, SEED_USER_2, SEED_USER_3, SEED_USER_4, SEED_USER_5],
    p_params: { tag: 'integration-probe' },
  });
  assertEquals(r.ok, true);
  const body = r.body as { mode: string; affected: number; undo_token: string | null };
  assertEquals(body.mode, 'sync');
  assertEquals(body.affected, 5);
  if (!body.undo_token) throw new Error('expected undo_token to be non-null for tag');

  // 3. Undo with that token → {reversed:5}
  const undo1 = await callRpc(ADMIN_JWT!, 'admin_bulk_action_undo', {
    p_undo_token: body.undo_token,
  });
  assertEquals(undo1.ok, true);
  assertEquals((undo1.body as { reversed: number }).reversed, 5);

  // 4. Undo with same token again → token_expired
  await assertRejects(async () => {
    const undo2 = await callRpc(ADMIN_JWT!, 'admin_bulk_action_undo', {
      p_undo_token: body.undo_token!,
    });
    if (!undo2.ok) {
      const msg = (undo2.body as { message?: string }).message ?? '';
      if (msg.includes('token_expired')) throw new Error('token_expired');
    }
  });
});
