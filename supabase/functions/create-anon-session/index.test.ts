/**
 * Deno tests for `create-anon-session` Edge Function — Phase 34 Plan 34-02.
 *
 * Per [[reference_deno_test_discovery]]: filename MUST be `index.test.ts`
 * (Deno's directory-walk matches `{*_,*.,}test.*`; `*-test.ts` is silently
 * skipped on Supabase CI).
 *
 * Test plan (5 behaviors from 34-02-PLAN.md <behavior>):
 *   T1 — POST with no body → 200 + new UUID cookie_id (insert path)
 *   T2 — POST with valid existing cookie_id → 200 + same cookie_id (update path)
 *   T3 — POST with malformed cookie_id → 200 + fresh UUID (insert path)
 *   T4 — OPTIONS preflight → 204 + CORS headers
 *   T5 — GET (non-POST) → 405
 *
 * Plus DB-error gates:
 *   T6 — DB update error → 500
 *   T7 — DB insert error → 500
 */
import { assertEquals, assert, assertMatch } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';

const { handleCreateAnonSession, setAdminForTest, resetAdminForTest, UUID_RE } = __internal;

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

// ----------------------------------------------------------------------------
// Fake admin client — chainable `from('anonymous_sessions').…` builder that
// records the issued ops and returns canned responses.
// ----------------------------------------------------------------------------

interface FakeOps {
  inserts: Array<Record<string, unknown>>;
  updates: Array<{ patch: Record<string, unknown>; eq: Record<string, unknown>; is: Record<string, unknown> }>;
}

interface FakeAdminConfig {
  updateResult?: { data: { cookie_id: string } | null; error: { message: string } | null };
  insertResult?: { error: { message: string } | null };
  log: FakeOps;
}

// deno-lint-ignore no-explicit-any
function makeFakeAdmin(cfg: FakeAdminConfig): any {
  return {
    from(table: string) {
      assertEquals(table, 'anonymous_sessions', 'fn must only touch anonymous_sessions');

      const eqState: Record<string, unknown> = {};
      const isState: Record<string, unknown> = {};
      let pendingPatch: Record<string, unknown> | null = null;
      let pendingInsert: Record<string, unknown> | null = null;

      const builder = {
        update(patch: Record<string, unknown>) {
          pendingPatch = patch;
          return builder;
        },
        insert(row: Record<string, unknown>) {
          pendingInsert = row;
          cfg.log.inserts.push(row);
          // .insert(...) is awaited directly in cold-start path.
          return Promise.resolve(cfg.insertResult ?? { error: null });
        },
        eq(col: string, val: unknown) {
          eqState[col] = val;
          return builder;
        },
        is(col: string, val: unknown) {
          isState[col] = val;
          return builder;
        },
        select(_cols: string) {
          return builder;
        },
        maybeSingle() {
          // This terminates the update chain.
          if (pendingPatch) {
            cfg.log.updates.push({
              patch: pendingPatch,
              eq: { ...eqState },
              is: { ...isState },
            });
          }
          return Promise.resolve(cfg.updateResult ?? { data: null, error: null });
        },
      };

      return builder;
    },
  };
}

function newLog(): FakeOps {
  return { inserts: [], updates: [] };
}

// ----------------------------------------------------------------------------
// T1 — POST no body → fresh UUID via insert.
// ----------------------------------------------------------------------------
Deno.test('T1: POST with no body returns fresh UUID and inserts new row', async () => {
  const log = newLog();
  setAdminForTest(makeFakeAdmin({ log }));
  try {
    const req = new Request('http://localhost/functions/v1/create-anon-session', {
      method: 'POST',
    });
    const res = await handleCreateAnonSession(req);
    assertEquals(res.status, 200);
    const body = (await res.json()) as { cookie_id: string };
    assertMatch(body.cookie_id, UUID_RE);
    assertEquals(log.inserts.length, 1);
    assertEquals(log.inserts[0].cookie_id, body.cookie_id);
    assertEquals(log.updates.length, 0);
  } finally {
    resetAdminForTest();
  }
});

// ----------------------------------------------------------------------------
// T2 — POST with valid cookie_id matching an existing row → update + same id.
// ----------------------------------------------------------------------------
Deno.test('T2: POST with existing cookie_id returns same id and updates last_activity_at', async () => {
  const existing = '11111111-1111-4111-8111-111111111111';
  const log = newLog();
  setAdminForTest(
    makeFakeAdmin({
      log,
      updateResult: { data: { cookie_id: existing }, error: null },
    }),
  );
  try {
    const req = new Request('http://localhost/functions/v1/create-anon-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie_id: existing }),
    });
    const res = await handleCreateAnonSession(req);
    assertEquals(res.status, 200);
    const body = (await res.json()) as { cookie_id: string };
    assertEquals(body.cookie_id, existing);
    assertEquals(log.updates.length, 1);
    assertEquals(log.updates[0].eq.cookie_id, existing);
    assertEquals(log.updates[0].is.merged_user_id, null);
    assert('last_activity_at' in log.updates[0].patch, 'must touch last_activity_at');
    assertEquals(log.inserts.length, 0);
  } finally {
    resetAdminForTest();
  }
});

// ----------------------------------------------------------------------------
// T3 — POST with malformed cookie_id → ignored, fresh UUID issued.
// ----------------------------------------------------------------------------
Deno.test('T3: POST with malformed cookie_id ignores input and creates fresh row', async () => {
  const log = newLog();
  setAdminForTest(makeFakeAdmin({ log }));
  try {
    const req = new Request('http://localhost/functions/v1/create-anon-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie_id: 'not-a-uuid' }),
    });
    const res = await handleCreateAnonSession(req);
    assertEquals(res.status, 200);
    const body = (await res.json()) as { cookie_id: string };
    assertMatch(body.cookie_id, UUID_RE);
    assertEquals(body.cookie_id !== 'not-a-uuid', true);
    assertEquals(log.updates.length, 0, 'malformed input must not trigger update');
    assertEquals(log.inserts.length, 1);
  } finally {
    resetAdminForTest();
  }
});

// ----------------------------------------------------------------------------
// T3b — POST with valid UUID-shape cookie that does NOT match any row →
// falls through to fresh-row creation (orphan / already-merged recovery).
// ----------------------------------------------------------------------------
Deno.test('T3b: POST with orphan UUID falls through to fresh insert', async () => {
  const orphan = '22222222-2222-4222-8222-222222222222';
  const log = newLog();
  setAdminForTest(
    makeFakeAdmin({
      log,
      updateResult: { data: null, error: null }, // no row found
    }),
  );
  try {
    const req = new Request('http://localhost/functions/v1/create-anon-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie_id: orphan }),
    });
    const res = await handleCreateAnonSession(req);
    assertEquals(res.status, 200);
    const body = (await res.json()) as { cookie_id: string };
    assertMatch(body.cookie_id, UUID_RE);
    assertEquals(body.cookie_id !== orphan, true, 'orphan id must NOT be reused');
    assertEquals(log.updates.length, 1);
    assertEquals(log.inserts.length, 1);
  } finally {
    resetAdminForTest();
  }
});

// ----------------------------------------------------------------------------
// T4 — OPTIONS preflight returns 204 + CORS headers.
// ----------------------------------------------------------------------------
Deno.test('T4: OPTIONS preflight returns 204 with CORS headers', async () => {
  const req = new Request('http://localhost/functions/v1/create-anon-session', {
    method: 'OPTIONS',
  });
  const res = await handleCreateAnonSession(req);
  assertEquals(res.status, 204);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert(res.headers.get('Access-Control-Allow-Methods')?.includes('POST'));
  // Drain body to avoid leak warning.
  await res.body?.cancel();
});

// ----------------------------------------------------------------------------
// T5 — Non-POST verbs return 405.
// ----------------------------------------------------------------------------
Deno.test('T5: GET returns 405 method_not_allowed', async () => {
  const req = new Request('http://localhost/functions/v1/create-anon-session', {
    method: 'GET',
  });
  const res = await handleCreateAnonSession(req);
  assertEquals(res.status, 405);
  const body = (await res.json()) as { error: string };
  assertEquals(body.error, 'method_not_allowed');
});

// ----------------------------------------------------------------------------
// T6 — DB update error → 500.
// ----------------------------------------------------------------------------
Deno.test('T6: DB update error returns 500', async () => {
  const log = newLog();
  setAdminForTest(
    makeFakeAdmin({
      log,
      updateResult: { data: null, error: { message: 'simulated db failure' } },
    }),
  );
  try {
    const req = new Request('http://localhost/functions/v1/create-anon-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie_id: '33333333-3333-4333-8333-333333333333' }),
    });
    const res = await handleCreateAnonSession(req);
    assertEquals(res.status, 500);
    const body = (await res.json()) as { error: string };
    assertEquals(body.error, 'db_error');
  } finally {
    resetAdminForTest();
  }
});

// ----------------------------------------------------------------------------
// T7 — DB insert error → 500.
// ----------------------------------------------------------------------------
Deno.test('T7: DB insert error returns 500', async () => {
  const log = newLog();
  setAdminForTest(
    makeFakeAdmin({
      log,
      insertResult: { error: { message: 'simulated insert failure' } },
    }),
  );
  try {
    const req = new Request('http://localhost/functions/v1/create-anon-session', {
      method: 'POST',
    });
    const res = await handleCreateAnonSession(req);
    assertEquals(res.status, 500);
    const body = (await res.json()) as { error: string };
    assertEquals(body.error, 'db_error');
  } finally {
    resetAdminForTest();
  }
});
