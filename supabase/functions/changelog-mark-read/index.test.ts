/**
 * Deno tests for `changelog-mark-read` Edge Function — Phase 42 Plan 42-06.
 *
 * Test plan:
 *   T1 — OPTIONS preflight → 200 CORS headers
 *   T2 — non-POST method → 405 method_not_allowed
 *   T3 — missing Authorization header → 401 unauthenticated
 *   T4 — invalid JWT (admin.getUser returns error) → 401 unauthenticated
 *   T5 — happy path: upsert called with auth.uid() + now timestamp; 200 returned
 *   T6 — DB upsert error → 500 internal
 *   T7 — idempotent: second invocation also returns 200 with newer timestamp
 *
 * Per [[reference_deno_test_discovery]]: file is `index.test.ts` (project rule).
 */
import { assertEquals, assertExists } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

const USER_UUID = '11111111-1111-4111-8111-111111111111';

// ----------------------------------------------------------------------------
// Fake admin builder
// ----------------------------------------------------------------------------

interface UpsertCall {
  table: string;
  row: Record<string, unknown>;
  opts: Record<string, unknown>;
}

interface FakeAdminLog {
  upsertCalls: UpsertCall[];
}

interface FakeAdminConfig {
  /** auth.getUser result. */
  authBehavior: 'ok' | 'error';
  userId?: string;
  /** Upsert result. */
  upsertBehavior: 'ok' | 'error';
  /** Test-recorded events. */
  log: FakeAdminLog;
}

// deno-lint-ignore no-explicit-any
function makeFakeAdmin(cfg: FakeAdminConfig): any {
  return {
    auth: {
      getUser: (_jwt: string) => {
        if (cfg.authBehavior === 'error') {
          return Promise.resolve({
            data: { user: null },
            error: { message: 'invalid_jwt' },
          });
        }
        return Promise.resolve({
          data: { user: { id: cfg.userId ?? USER_UUID } },
          error: null,
        });
      },
    },
    from: (table: string) => ({
      upsert: (row: Record<string, unknown>, opts: Record<string, unknown>) => {
        cfg.log.upsertCalls.push({ table, row, opts });
        if (cfg.upsertBehavior === 'error') {
          return Promise.resolve({ error: { message: 'fake_db_error' } });
        }
        return Promise.resolve({ error: null });
      },
    }),
  };
}

function mkReq(method: string, jwt?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  return new Request('http://localhost/functions/v1/changelog-mark-read', {
    method,
    headers,
    body: method === 'POST' ? '{}' : undefined,
  });
}

// ----------------------------------------------------------------------------
// T1 — OPTIONS preflight
// ----------------------------------------------------------------------------

Deno.test('T1: OPTIONS preflight returns 200 + CORS headers', async () => {
  __internal.resetAdminForTest();
  const log: FakeAdminLog = { upsertCalls: [] };
  __internal.setAdminForTest(makeFakeAdmin({ authBehavior: 'ok', upsertBehavior: 'ok', log }));

  const res = await __internal.handleMarkRead(mkReq('OPTIONS'));
  assertEquals(res.status, 200);
  assertExists(res.headers.get('Access-Control-Allow-Origin'));
});

// ----------------------------------------------------------------------------
// T2 — non-POST → 405
// ----------------------------------------------------------------------------

Deno.test('T2: GET method → 405 method_not_allowed', async () => {
  __internal.resetAdminForTest();
  const log: FakeAdminLog = { upsertCalls: [] };
  __internal.setAdminForTest(makeFakeAdmin({ authBehavior: 'ok', upsertBehavior: 'ok', log }));

  const res = await __internal.handleMarkRead(mkReq('GET', 'fake-jwt'));
  assertEquals(res.status, 405);
  const body = (await res.json()) as { error: string };
  assertEquals(body.error, 'method_not_allowed');
  assertEquals(log.upsertCalls.length, 0);
});

// ----------------------------------------------------------------------------
// T3 — missing Authorization → 401
// ----------------------------------------------------------------------------

Deno.test('T3: missing Authorization → 401 unauthenticated', async () => {
  __internal.resetAdminForTest();
  const log: FakeAdminLog = { upsertCalls: [] };
  __internal.setAdminForTest(makeFakeAdmin({ authBehavior: 'ok', upsertBehavior: 'ok', log }));

  const res = await __internal.handleMarkRead(mkReq('POST'));
  assertEquals(res.status, 401);
  const body = (await res.json()) as { error: string };
  assertEquals(body.error, 'unauthenticated');
  assertEquals(log.upsertCalls.length, 0);
});

// ----------------------------------------------------------------------------
// T4 — invalid JWT (admin.getUser returns error) → 401
// ----------------------------------------------------------------------------

Deno.test('T4: invalid JWT → 401 unauthenticated', async () => {
  __internal.resetAdminForTest();
  const log: FakeAdminLog = { upsertCalls: [] };
  __internal.setAdminForTest(makeFakeAdmin({ authBehavior: 'error', upsertBehavior: 'ok', log }));

  const res = await __internal.handleMarkRead(mkReq('POST', 'forged-jwt'));
  assertEquals(res.status, 401);
  const body = (await res.json()) as { error: string };
  assertEquals(body.error, 'unauthenticated');
  assertEquals(log.upsertCalls.length, 0);
});

// ----------------------------------------------------------------------------
// T5 — happy path
// ----------------------------------------------------------------------------

Deno.test('T5: happy path — upsert called with auth.uid() + now; 200 returned', async () => {
  __internal.resetAdminForTest();
  const log: FakeAdminLog = { upsertCalls: [] };
  __internal.setAdminForTest(
    makeFakeAdmin({ authBehavior: 'ok', userId: USER_UUID, upsertBehavior: 'ok', log }),
  );

  const before = Date.now();
  const res = await __internal.handleMarkRead(mkReq('POST', 'valid-jwt'));
  const after = Date.now();

  assertEquals(res.status, 200);
  const body = (await res.json()) as { last_seen_published_at: string };
  assertExists(body.last_seen_published_at);
  const ts = new Date(body.last_seen_published_at).getTime();
  // Allow ±100ms wiggle on either side
  assertEquals(ts >= before - 100 && ts <= after + 100, true, `ts=${ts} outside [${before}, ${after}]`);

  assertEquals(log.upsertCalls.length, 1);
  const call = log.upsertCalls[0]!;
  assertEquals(call.table, 'user_changelog_dismissed');
  assertEquals(call.row.user_id, USER_UUID);
  assertExists(call.row.last_seen_published_at);
  assertExists(call.row.updated_at);
  assertEquals(call.opts.onConflict, 'user_id');
});

// ----------------------------------------------------------------------------
// T6 — DB upsert error → 500
// ----------------------------------------------------------------------------

Deno.test('T6: upsert error → 500 internal', async () => {
  __internal.resetAdminForTest();
  const log: FakeAdminLog = { upsertCalls: [] };
  __internal.setAdminForTest(
    makeFakeAdmin({ authBehavior: 'ok', userId: USER_UUID, upsertBehavior: 'error', log }),
  );

  const res = await __internal.handleMarkRead(mkReq('POST', 'valid-jwt'));
  assertEquals(res.status, 500);
  const body = (await res.json()) as { error: string };
  assertEquals(body.error, 'internal');
});

// ----------------------------------------------------------------------------
// T7 — idempotent: second call also succeeds with newer timestamp
// ----------------------------------------------------------------------------

Deno.test('T7: idempotent — second call still returns 200; newer timestamp', async () => {
  __internal.resetAdminForTest();
  const log: FakeAdminLog = { upsertCalls: [] };
  __internal.setAdminForTest(
    makeFakeAdmin({ authBehavior: 'ok', userId: USER_UUID, upsertBehavior: 'ok', log }),
  );

  const res1 = await __internal.handleMarkRead(mkReq('POST', 'valid-jwt'));
  assertEquals(res1.status, 200);
  const b1 = (await res1.json()) as { last_seen_published_at: string };

  // Force a measurable time gap so timestamps differ.
  await new Promise((r) => setTimeout(r, 5));

  const res2 = await __internal.handleMarkRead(mkReq('POST', 'valid-jwt'));
  assertEquals(res2.status, 200);
  const b2 = (await res2.json()) as { last_seen_published_at: string };

  assertEquals(
    new Date(b2.last_seen_published_at).getTime() >=
      new Date(b1.last_seen_published_at).getTime(),
    true,
  );
  assertEquals(log.upsertCalls.length, 2);
});
