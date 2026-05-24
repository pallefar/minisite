// Phase 48 Plan 48-08 — banned-words-sweep handler tests (GREEN).
//
// Drives the Plan 48-06 RED scaffold to GREEN. Per memory
// reference_deno_test_top_level_serve_trap, we import the named `handler`
// (NOT bare Deno.serve) — and the handler is guarded by `import.meta.main`
// so the import here does not spawn a real server.
//
// Test plan:
//   T1 — Missing/wrong bearer → 401 unauthorized.
//   T2 — Cursored batch: rows.length === batch_size → next_cursor = last row id,
//        done = false; partial batch → next_cursor = null, done = true.
//   T3 — Idempotent re-run: re-invoking with the same cursor against a fixture
//        where INSERT returns 23505 (duplicate key) does NOT increment match
//        count and does NOT call log_moderation_action.
//   T4 — Per-batch cap: a row count > batch_size returned by the fake admin
//        is impossible (.limit gates it); but we assert the batch_size param
//        IS forwarded to .limit and rows.length === batch_size triggers a
//        non-null next_cursor (resume contract).

import { assertEquals, assertExists } from 'jsr:@std/assert@^1';

// env stubs MUST be set BEFORE importing the subject module — supabase-js
// validates the URL at createClient time inside makeLazyAdmin.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

const SERVICE_BEARER = 'test-service-role-key';

const { handler, setAdminForTest, resetAdminForTest } = await import('./index.ts');

// ---------------------------------------------------------------------------
// Fake admin builder
// ---------------------------------------------------------------------------

interface FakeAdminConfig {
  words?: Array<{ id: string; word: string; severity: string; case_insensitive: boolean }>;
  rows?: Array<{ id: string; body: string; author_id: string | null; space_id: string | null }>;
  insertError?: { code?: string; message: string } | null;
}

interface AdminSpyState {
  insertCalls: unknown[];
  rpcCalls: Array<{ name: string; args: unknown }>;
  bannedWordsSelectCount: number;
  contentSelectCount: number;
  lastLimit: number | null;
  lastGtCursor: string | null;
}

function makeFakeAdmin(cfg: FakeAdminConfig): { admin: unknown; spy: AdminSpyState } {
  const spy: AdminSpyState = {
    insertCalls: [],
    rpcCalls: [],
    bannedWordsSelectCount: 0,
    contentSelectCount: 0,
    lastLimit: null,
    lastGtCursor: null,
  };

  const admin = {
    from: (table: string) => {
      if (table === 'banned_words') {
        return {
          select: (_cols?: string) => {
            spy.bannedWordsSelectCount++;
            return Promise.resolve({ data: cfg.words ?? [], error: null });
          },
        };
      }
      if (table === 'community_posts' || table === 'community_comments') {
        spy.contentSelectCount++;
        const chain = {
          select: (_cols?: string) => chain,
          order: (_col: string, _opts: unknown) => chain,
          limit: (n: number) => {
            spy.lastLimit = n;
            return chain;
          },
          gt: (_col: string, val: string) => {
            spy.lastGtCursor = val;
            return chain;
          },
          // PromiseLike — `await chain` resolves to the configured rows.
          then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
            return Promise.resolve({ data: cfg.rows ?? [], error: null })
              .then(resolve, reject);
          },
        };
        return chain;
      }
      if (table === 'community_reports') {
        return {
          insert: (vals: unknown) => {
            spy.insertCalls.push(vals);
            return Promise.resolve({ data: null, error: cfg.insertError ?? null });
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    rpc: (name: string, args: unknown) => {
      spy.rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
  };

  return { admin, spy };
}

function makeRequest(opts: { bearer?: string | null; body?: unknown }): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.bearer !== null && opts.bearer !== undefined) {
    headers.Authorization = `Bearer ${opts.bearer}`;
  }
  return new Request('http://localhost/banned-words-sweep', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test('T1 — missing bearer → 401 unauthorized', async () => {
  const { admin } = makeFakeAdmin({});
  setAdminForTest(admin);
  try {
    const req = new Request('http://localhost/banned-words-sweep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: 'community_posts' }),
    });
    const res = await handler(req);
    assertEquals(res.status, 401);
    const body = await res.json();
    assertEquals(body.error, 'unauthorized');
  } finally {
    resetAdminForTest();
  }
});

Deno.test('T1b — wrong bearer → 401 unauthorized', async () => {
  const { admin } = makeFakeAdmin({});
  setAdminForTest(admin);
  try {
    const req = makeRequest({ bearer: 'not-the-service-role', body: { table: 'community_posts' } });
    const res = await handler(req);
    assertEquals(res.status, 401);
  } finally {
    resetAdminForTest();
  }
});

Deno.test('T1c — invalid body (missing table) → 400 invalid_body', async () => {
  const { admin } = makeFakeAdmin({});
  setAdminForTest(admin);
  try {
    const req = makeRequest({ bearer: SERVICE_BEARER, body: {} });
    const res = await handler(req);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, 'invalid_body');
  } finally {
    resetAdminForTest();
  }
});

Deno.test('T2 — full batch returns next_cursor + done:false; matched rows INSERT', async () => {
  const POST_A = '00000001-0000-4000-8000-000000000001';
  const POST_B = '00000002-0000-4000-8000-000000000002';
  const POST_C = '00000003-0000-4000-8000-000000000003';
  const { admin, spy } = makeFakeAdmin({
    words: [{ id: 'w1', word: 'spam', severity: 'flag', case_insensitive: true }],
    rows: [
      { id: POST_A, body: 'Hello SPAM message',  author_id: 'u1', space_id: 's1' },
      { id: POST_B, body: 'clean text',          author_id: 'u2', space_id: 's1' },
      { id: POST_C, body: 'another spam variant', author_id: 'u3', space_id: 's1' },
    ],
  });
  setAdminForTest(admin);
  try {
    const req = makeRequest({
      bearer: SERVICE_BEARER,
      body: { table: 'community_posts', batch_size: 3 },
    });
    const res = await handler(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.processed, 3);
    assertEquals(body.matches, 2);          // POST_A + POST_C matched 'spam'
    assertEquals(body.next_cursor, POST_C); // last row id (rows.length === batch_size)
    assertEquals(body.done, false);

    // banned_words loaded EXACTLY once (cache invariant)
    assertEquals(spy.bannedWordsSelectCount, 1);
    // .limit(batch_size) forwarded
    assertEquals(spy.lastLimit, 3);
    // 2 INSERTs, 2 audit RPCs
    assertEquals(spy.insertCalls.length, 2);
    assertEquals(spy.rpcCalls.length, 2);
    assertEquals(spy.rpcCalls[0].name, 'log_moderation_action');
    // INSERT shape includes the idempotency-key fields the partial UNIQUE
    // depends on (reason.source='banned_word').
    const firstInsert = spy.insertCalls[0] as Record<string, unknown>;
    assertEquals(firstInsert.target_type, 'post');
    assertEquals(firstInsert.target_id, POST_A);
    assertEquals(firstInsert.reporter_user_id, null);
    const reason = firstInsert.reason as Record<string, unknown>;
    assertEquals(reason.source, 'banned_word');
    assertEquals(reason.word, 'spam');
  } finally {
    resetAdminForTest();
  }
});

Deno.test('T2b — partial batch returns next_cursor=null + done:true', async () => {
  const POST_A = '00000001-0000-4000-8000-000000000001';
  const { admin, spy } = makeFakeAdmin({
    words: [{ id: 'w1', word: 'spam', severity: 'flag', case_insensitive: true }],
    rows: [
      { id: POST_A, body: 'clean',  author_id: 'u1', space_id: 's1' },
    ],
  });
  setAdminForTest(admin);
  try {
    const req = makeRequest({
      bearer: SERVICE_BEARER,
      body: { table: 'community_posts', batch_size: 100 },
    });
    const res = await handler(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.processed, 1);
    assertEquals(body.matches, 0);
    assertEquals(body.next_cursor, null);
    assertEquals(body.done, true);
    assertEquals(spy.lastLimit, 100);
  } finally {
    resetAdminForTest();
  }
});

Deno.test('T2c — start_cursor forwards to .gt() for resume', async () => {
  const CURSOR = '00000001-0000-4000-8000-000000000099';
  const { admin, spy } = makeFakeAdmin({ words: [], rows: [] });
  setAdminForTest(admin);
  try {
    const req = makeRequest({
      bearer: SERVICE_BEARER,
      body: { table: 'community_comments', batch_size: 50, start_cursor: CURSOR },
    });
    const res = await handler(req);
    assertEquals(res.status, 200);
    assertEquals(spy.lastGtCursor, CURSOR);
  } finally {
    resetAdminForTest();
  }
});

Deno.test('T3 — idempotent re-run: 23505 from INSERT does NOT count match nor audit', async () => {
  const POST_A = '00000004-0000-4000-8000-000000000004';
  const { admin, spy } = makeFakeAdmin({
    words: [{ id: 'w1', word: 'spam', severity: 'flag', case_insensitive: true }],
    rows: [
      { id: POST_A, body: 'spammy post',  author_id: 'u1', space_id: 's1' },
    ],
    insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
  });
  setAdminForTest(admin);
  try {
    const req = makeRequest({
      bearer: SERVICE_BEARER,
      body: { table: 'community_posts', batch_size: 10 },
    });
    const res = await handler(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.processed, 1);
    assertEquals(body.matches, 0);            // duplicate → NOT counted
    assertEquals(body.done, true);
    assertEquals(spy.insertCalls.length, 1);  // INSERT attempted exactly once
    assertEquals(spy.rpcCalls.length, 0);     // NO audit row on duplicate
  } finally {
    resetAdminForTest();
  }
});

Deno.test('T4 — per-batch cap honored via .limit(batch_size) (no unbounded scan)', async () => {
  // The fake admin returns exactly the rows it was configured with — there is
  // no real LIMIT enforcement. The contract this test asserts is: the
  // batch_size param IS forwarded to .limit() AND a full-batch result yields
  // a non-null next_cursor (resume continues from cursor).
  const ids = Array.from({ length: 5 }, (_, i) =>
    `0000000${i + 1}-0000-4000-8000-00000000000${i + 1}`);
  const { admin, spy } = makeFakeAdmin({
    words: [],
    rows: ids.map((id) => ({ id, body: 'x', author_id: null, space_id: null })),
  });
  setAdminForTest(admin);
  try {
    const req = makeRequest({
      bearer: SERVICE_BEARER,
      body: { table: 'community_posts', batch_size: 5 },
    });
    const res = await handler(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(spy.lastLimit, 5);
    assertEquals(body.processed, 5);
    assertExists(body.next_cursor); // resume cursor present when batch == cap
    assertEquals(body.next_cursor, ids[4]);
    assertEquals(body.done, false);
  } finally {
    resetAdminForTest();
  }
});
