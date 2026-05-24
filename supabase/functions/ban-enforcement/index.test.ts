/**
 * Phase 48 Plan 48-09 — Deno tests for ban-enforcement Edge Function.
 *
 * Drives Plan 48-09 RED→GREEN. Replaces Plan 48-06 stub.
 *
 * Test plan (4 Deno.test blocks):
 *   T1 — Missing/invalid bearer → 401 unauthorized
 *   T2 — Service-role bearer + valid body → revoke_user_sessions RPC called
 *        with correct user_id; returns 200 { revoked: true, user_id }
 *   T3 — Audit row written: log_moderation_action invoked with
 *        p_action_type='session_revoked', p_target_id=<user>
 *   T4 — Invalid body (missing user_id, non-uuid) → 400 invalid_body
 *
 * Per reference_deno_test_top_level_serve_trap — Deno.serve guarded;
 * tests import handler directly without triggering server bind.
 */
import { assertEquals } from 'jsr:@std/assert@^1';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

const SERVICE_BEARER = 'test-service-role-key';
const ALICE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// Import AFTER env vars set (lazy admin reads them on first access).
const { __internal } = await import('./index.ts');

// ---------------------------------------------------------------------------
// Fake admin builder
// ---------------------------------------------------------------------------

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

interface FakeAdminConfig {
  revokeError?: { message: string } | null;
}

function makeFakeAdmin(cfg: FakeAdminConfig, calls: RpcCall[]): unknown {
  return {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === 'revoke_user_sessions' && cfg.revokeError) {
        return Promise.resolve({ data: null, error: cfg.revokeError });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function makeReq(body: unknown, opts?: { bearer?: string | null; method?: string }): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const bearer = opts?.bearer !== undefined ? opts.bearer : SERVICE_BEARER;
  if (bearer !== null) headers['Authorization'] = `Bearer ${bearer}`;
  const method = opts?.method ?? 'POST';
  const init: RequestInit = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = JSON.stringify(body);
  }
  return new Request('http://test/functions/v1/ban-enforcement', init);
}

// ---------------------------------------------------------------------------
// T1: Missing bearer → 401
// ---------------------------------------------------------------------------

Deno.test('T1 — missing bearer returns 401 unauthorized', async () => {
  const req = makeReq({ user_id: ALICE_ID }, { bearer: null });
  const res = await __internal.handler(req);
  assertEquals(res.status, 401);
  const json = await res.json();
  assertEquals(json.error, 'unauthorized');
});

Deno.test('T1b — wrong bearer returns 401 unauthorized', async () => {
  const req = makeReq({ user_id: ALICE_ID }, { bearer: 'not-the-service-role-key' });
  const res = await __internal.handler(req);
  assertEquals(res.status, 401);
  const json = await res.json();
  assertEquals(json.error, 'unauthorized');
});

// ---------------------------------------------------------------------------
// T2: Service-role + valid body → revoke_user_sessions called, 200
// ---------------------------------------------------------------------------

Deno.test('T2 — service-role + valid body → revoke_user_sessions called, returns 200', async () => {
  const calls: RpcCall[] = [];
  __internal.setAdminForTest(makeFakeAdmin({}, calls));
  const req = makeReq({ user_id: ALICE_ID });
  const res = await __internal.handler(req);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.revoked, true);
  assertEquals(json.user_id, ALICE_ID);

  // Verify revoke_user_sessions called with correct arg
  const revokeCall = calls.find((c) => c.fn === 'revoke_user_sessions');
  assertEquals(revokeCall?.args.p_user_id, ALICE_ID);

  __internal.resetAdminForTest();
});

// ---------------------------------------------------------------------------
// T3: Audit log row written
// ---------------------------------------------------------------------------

Deno.test('T3 — writes moderation audit row action=session_revoked', async () => {
  const calls: RpcCall[] = [];
  __internal.setAdminForTest(makeFakeAdmin({}, calls));
  const req = makeReq({ user_id: ALICE_ID });
  const res = await __internal.handler(req);
  assertEquals(res.status, 200);

  const auditCall = calls.find((c) => c.fn === 'log_moderation_action');
  assertEquals(auditCall?.args.p_action_type, 'session_revoked');
  assertEquals(auditCall?.args.p_target_type, 'user');
  assertEquals(auditCall?.args.p_target_id, ALICE_ID);

  __internal.resetAdminForTest();
});

// ---------------------------------------------------------------------------
// T4: Invalid body → 400
// ---------------------------------------------------------------------------

Deno.test('T4 — missing user_id returns 400 invalid_body', async () => {
  const req = makeReq({});
  const res = await __internal.handler(req);
  assertEquals(res.status, 400);
  const json = await res.json();
  assertEquals(json.error, 'invalid_body');
});

Deno.test('T4b — non-uuid user_id returns 400 invalid_body', async () => {
  const req = makeReq({ user_id: 'not-a-uuid' });
  const res = await __internal.handler(req);
  assertEquals(res.status, 400);
  const json = await res.json();
  assertEquals(json.error, 'invalid_body');
});

// ---------------------------------------------------------------------------
// T5: revoke RPC error → 500
// ---------------------------------------------------------------------------

Deno.test('T5 — revoke_user_sessions error → 500 session_revoke_failed', async () => {
  const calls: RpcCall[] = [];
  __internal.setAdminForTest(makeFakeAdmin({ revokeError: { message: 'boom' } }, calls));
  const req = makeReq({ user_id: ALICE_ID });
  const res = await __internal.handler(req);
  assertEquals(res.status, 500);
  const json = await res.json();
  assertEquals(json.error, 'session_revoke_failed');
  __internal.resetAdminForTest();
});

// ---------------------------------------------------------------------------
// T6: Method not allowed
// ---------------------------------------------------------------------------

Deno.test('T6 — GET returns 405 method_not_allowed', async () => {
  const req = makeReq({ user_id: ALICE_ID }, { method: 'GET' });
  const res = await __internal.handler(req);
  assertEquals(res.status, 405);
});

// ---------------------------------------------------------------------------
// T7: Idempotent re-invoke — calling twice in succession both return 200
// ---------------------------------------------------------------------------

Deno.test('T7 — idempotent: second invocation also returns 200', async () => {
  const calls: RpcCall[] = [];
  __internal.setAdminForTest(makeFakeAdmin({}, calls));
  const req1 = makeReq({ user_id: ALICE_ID });
  const res1 = await __internal.handler(req1);
  assertEquals(res1.status, 200);

  const req2 = makeReq({ user_id: ALICE_ID });
  const res2 = await __internal.handler(req2);
  assertEquals(res2.status, 200);

  __internal.resetAdminForTest();
});
