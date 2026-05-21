/**
 * Deno tests for `challenge-evaluate-cron` Edge Function — Phase 35 plan 35-09 (D-21).
 *
 * Test plan:
 *   T1 missing bearer → 401
 *   T2 valid bearer + no active users → 200 with processed:0, errors:0
 *   T3 valid bearer + N active users → calls evaluate_challenge_progress_for_user N times
 *   T4 per-user error does NOT abort batch (errors counter increments, others processed)
 */
import { assertEquals } from 'jsr:@std/assert@^1';
import { resetMirrorAdminForTest, setMirrorAdminForTest } from '../_shared/posthog-server.ts';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

const { __internal } = await import('./index.ts');

/** Stub posthog-server events_mirror to prevent real HTTP calls. */
function stubMirrorAdmin(): void {
  setMirrorAdminForTest({
    from: () => ({ insert: () => Promise.resolve({ data: null, error: null }) }),
  });
}

const VALID_HEADERS = { Authorization: 'Bearer test-service-role-key', 'Content-Type': 'application/json' };

function makeReq(headers = VALID_HEADERS): Request {
  return new Request('http://localhost/challenge-evaluate-cron', { method: 'POST', headers, body: '{}' });
}

Deno.test('T1 — missing bearer → 401', async () => {
  const req = makeReq({ 'Content-Type': 'application/json' });
  const res = await __internal.handler(req);
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'unauthorized');
});

Deno.test('T2 — valid bearer + no active users → 200 processed:0', async () => {
  const fakeAdmin: unknown = {
    from: () => ({
      select: () => ({
        eq: () => ({
          gt: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  };

  __internal.setAdminForTest(fakeAdmin);
  stubMirrorAdmin();
  try {
    const res = await __internal.handler(makeReq());
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.processed, 0);
    assertEquals(body.errors, 0);
  } finally {
    __internal.resetAdminForTest();
    resetMirrorAdminForTest();
  }
});

Deno.test('T3 — valid bearer + 3 active users → calls evaluate_challenge_progress_for_user 3 times', async () => {
  const rpcCalls: string[] = [];
  const fakeAdmin: unknown = {
    from: () => ({
      select: () => ({
        eq: () => ({
          gt: () => Promise.resolve({
            data: [
              { user_id: 'user-1' },
              { user_id: 'user-2' },
              { user_id: 'user-2' }, // duplicate — deduplicated in Fn
              { user_id: 'user-3' },
            ],
            error: null,
          }),
        }),
      }),
    }),
    rpc: (_name: string, args: { p_user: string }) => {
      rpcCalls.push(args.p_user);
      return Promise.resolve({ data: null, error: null });
    },
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  };

  __internal.setAdminForTest(fakeAdmin);
  stubMirrorAdmin();
  try {
    const res = await __internal.handler(makeReq());
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    // 4 rows but user-2 is deduplicated → 3 unique users
    assertEquals(body.processed, 3);
    assertEquals(body.errors, 0);
    assertEquals(rpcCalls.sort(), ['user-1', 'user-2', 'user-3']);
  } finally {
    __internal.resetAdminForTest();
    resetMirrorAdminForTest();
  }
});

Deno.test('T4 — per-user error does NOT abort batch (errors counted)', async () => {
  const rpcCalls: string[] = [];
  const fakeAdmin: unknown = {
    from: () => ({
      select: () => ({
        eq: () => ({
          gt: () => Promise.resolve({
            data: [
              { user_id: 'user-ok-1' },
              { user_id: 'user-err' },
              { user_id: 'user-ok-2' },
            ],
            error: null,
          }),
        }),
      }),
    }),
    rpc: (_name: string, args: { p_user: string }) => {
      rpcCalls.push(args.p_user);
      if (args.p_user === 'user-err') {
        return Promise.reject(new Error('simulated per-user rpc error'));
      }
      return Promise.resolve({ data: null, error: null });
    },
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  };

  __internal.setAdminForTest(fakeAdmin);
  stubMirrorAdmin();
  try {
    const res = await __internal.handler(makeReq());
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.processed, 2);   // 2 succeeded
    assertEquals(body.errors, 1);      // 1 failed
    // All 3 were attempted
    assertEquals(rpcCalls.length, 3);
  } finally {
    __internal.resetAdminForTest();
    resetMirrorAdminForTest();
  }
});
