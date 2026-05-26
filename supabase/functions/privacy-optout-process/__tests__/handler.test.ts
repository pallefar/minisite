/**
 * privacy-optout-process — handler tests (Phase 64 Plan 64-02)
 *
 * TDD RED phase: Tests written before implementation.
 * Run with: $HOME/.deno/bin/deno test --no-check supabase/functions/privacy-optout-process/__tests__/handler.test.ts
 *
 * Covers 7 behavior cases per plan spec:
 *   T1: Happy path — POST valid → 200 + fan-out writes
 *   T2: Missing email → 400
 *   T3: Invalid state_residency → 400
 *   T4: Duplicate within 24h → 200 idempotent
 *   T5: Resend stubbed → 200 + confirmation_email_sent_at set
 *   T6: PostHog failure → still 200 (best-effort)
 *   T7: GET /healthz → 200 { ok: true, fn: 'privacy-optout-process' }
 *
 * Per [[reference_deno_test_top_level_serve_trap]]: imports handler.ts which
 * does NOT call Deno.serve; only index.ts (guarded by import.meta.main) does.
 */

import { assertEquals } from 'std/assert/assert_equals.ts';
import { handle } from '../handler.ts';
import type { PrivacyOptoutDeps } from '../handler.ts';

// ─── Minimal Supabase mock ────────────────────────────────────────────────────

type MockCall = { table: string; operation: string; data?: unknown };

interface MockSupabaseClient {
  calls: MockCall[];
  _existingRow: Record<string, unknown> | null;
  _insertId: string;
  _ipCount: number;
  from: (table: string) => MockQueryBuilder;
}

interface MockQueryBuilder {
  select: (...args: unknown[]) => MockQueryBuilder;
  insert: (data: unknown) => MockQueryBuilder;
  upsert: (data: unknown, opts?: unknown) => MockQueryBuilder;
  update: (data: unknown) => MockQueryBuilder;
  eq: (col: string, val: unknown) => MockQueryBuilder;
  gt: (col: string, val: unknown) => MockQueryBuilder;
  lt: (col: string, val: unknown) => MockQueryBuilder;
  gte: (col: string, val: unknown) => MockQueryBuilder;
  lte: (col: string, val: unknown) => MockQueryBuilder;
  single: () => Promise<{ data: Record<string, unknown> | null; error: null }>;
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: null }>;
  then: (resolve: (value: { data: unknown; error: null }) => unknown) => Promise<unknown>;
}

function makeMockSupabase(opts: {
  existingRow?: Record<string, unknown> | null;
  insertId?: string;
  ipCount?: number;
}): MockSupabaseClient {
  const client: MockSupabaseClient = {
    calls: [],
    _existingRow: opts.existingRow ?? null,
    _insertId: opts.insertId ?? 'test-uuid-1234',
    _ipCount: opts.ipCount ?? 0,
    from(table: string) {
      return makeQueryBuilder(client, table);
    },
  };
  return client;
}

function makeQueryBuilder(client: MockSupabaseClient, table: string): MockQueryBuilder {
  const ops: string[] = [];
  let pendingData: unknown = null;

  const builder: MockQueryBuilder = {
    select(..._args: unknown[]) {
      ops.push('select');
      return builder;
    },
    insert(data: unknown) {
      ops.push('insert');
      pendingData = data;
      client.calls.push({ table, operation: 'insert', data });
      return builder;
    },
    upsert(data: unknown, _opts?: unknown) {
      ops.push('upsert');
      pendingData = data;
      client.calls.push({ table, operation: 'upsert', data });
      return builder;
    },
    update(data: unknown) {
      ops.push('update');
      pendingData = data;
      client.calls.push({ table, operation: 'update', data });
      return builder;
    },
    eq(_col: string, _val: unknown) {
      return builder;
    },
    gt(_col: string, _val: unknown) {
      return builder;
    },
    lt(_col: string, _val: unknown) {
      return builder;
    },
    gte(_col: string, _val: unknown) {
      return builder;
    },
    lte(_col: string, _val: unknown) {
      return builder;
    },
    single() {
      // For ip rate-limit check: return count
      if (table === 'privacy_optout_requests' && ops.includes('select')) {
        return Promise.resolve({ data: { count: client._ipCount }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    maybeSingle() {
      // For idempotency check (existing row by email)
      if (table === 'privacy_optout_requests' && ops.includes('select')) {
        if (client._existingRow) {
          return Promise.resolve({ data: client._existingRow, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    then(resolve) {
      // Default async resolution for insert/upsert/update chains.
      // ops accumulates all chained operations; check if 'insert' was part of chain.
      const hasInsert = ops.includes('insert');
      const hasUpdate = ops.includes('update');
      if (hasInsert && table === 'privacy_optout_requests') {
        return Promise.resolve(
          resolve({
            data: [{ id: client._insertId, submitted_at: new Date().toISOString() }],
            error: null,
          }),
        );
      }
      if (hasUpdate || ops.includes('upsert')) {
        return Promise.resolve(resolve({ data: [], error: null }));
      }
      return Promise.resolve(resolve({ data: [], error: null }));
    },
  };

  return builder;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeValidBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'Alice Smith',
    email: 'alice@example.com',
    state_residency: 'CA',
    opt_out_scope: ['advertising', 'sale'],
    ...overrides,
  });
}

function makeDeps(
  supabase: MockSupabaseClient,
  fetchImpl?: typeof fetch,
): PrivacyOptoutDeps {
  return {
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: supabase as any,
    fetchImpl: fetchImpl ?? (() => Promise.resolve(new Response(JSON.stringify({ id: 'msg-123' }), { status: 200 }))) as unknown as typeof fetch,
    resendApiKey: 'test-stub',
    posthogProjectKey: 'ph-test-key',
    supabaseUrl: 'https://test.supabase.co',
  };
}

function makeRequest(
  method: string,
  url: string,
  body?: string,
  contentType = 'application/json',
): Request {
  return new Request(url, {
    method,
    headers: {
      'Content-Type': contentType,
      'X-Forwarded-For': '127.0.0.1',
      'User-Agent': 'test-agent/1.0',
    },
    body: body ?? undefined,
  });
}

// ─── Test 7: GET /healthz ─────────────────────────────────────────────────────
// (Defined first so it runs before implementation-dependent tests)

Deno.test('T7: GET /healthz → 200 { ok: true, fn }', async () => {
  const req = new Request('https://fn.supabase.co/privacy-optout-process/healthz', {
    method: 'GET',
  });
  const supabase = makeMockSupabase({});
  const res = await handle(req, makeDeps(supabase));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(body.fn, 'privacy-optout-process');
});

// ─── Test 1: Happy path ───────────────────────────────────────────────────────

Deno.test('T1: valid POST → 200 + fan-out to 3 tables', async () => {
  const supabase = makeMockSupabase({ insertId: 'req-uuid-abc' });
  const deps = makeDeps(supabase);

  const req = makeRequest(
    'POST',
    'https://fn.supabase.co/privacy-optout-process',
    makeValidBody(),
  );

  const res = await handle(req, deps);
  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(typeof body.request_id, 'string');
  assertEquals(typeof body.propagated_at, 'string');

  // Verify DB fan-out calls
  const tableNames = supabase.calls.map((c) => c.table);
  // Must write to all 3 tables (privacy_optout_requests + ad_targeting_exclusion + email_lifecycle_exclusion)
  const hasOptout = tableNames.includes('privacy_optout_requests');
  const hasAd = tableNames.includes('ad_targeting_exclusion');
  const hasEmail = tableNames.includes('email_lifecycle_exclusion');
  assertEquals(hasOptout, true, 'Must insert into privacy_optout_requests');
  assertEquals(hasAd, true, 'Must insert/upsert into ad_targeting_exclusion');
  assertEquals(hasEmail, true, 'Must insert/upsert into email_lifecycle_exclusion');
});

// ─── Test 2: Missing required field ──────────────────────────────────────────

Deno.test('T2: missing email → 400 { error }', async () => {
  const supabase = makeMockSupabase({});

  const req = makeRequest(
    'POST',
    'https://fn.supabase.co/privacy-optout-process',
    makeValidBody({ email: undefined }),
  );

  const res = await handle(req, makeDeps(supabase));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(typeof body.error, 'string');

  // No DB writes
  assertEquals(supabase.calls.length, 0, 'Must not write to DB on validation failure');
});

// ─── Test 3: Invalid state_residency ─────────────────────────────────────────

Deno.test('T3: invalid state_residency XX → 400', async () => {
  const supabase = makeMockSupabase({});

  const req = makeRequest(
    'POST',
    'https://fn.supabase.co/privacy-optout-process',
    makeValidBody({ state_residency: 'XX' }),
  );

  const res = await handle(req, makeDeps(supabase));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(typeof body.error, 'string');

  assertEquals(supabase.calls.length, 0, 'Must not write to DB on validation failure');
});

// ─── Test 4: Duplicate within 24h ────────────────────────────────────────────

Deno.test('T4: duplicate email within 24h → 200 idempotent', async () => {
  const existingRow = {
    id: 'existing-uuid',
    submitted_at: new Date().toISOString(),
    email: 'alice@example.com',
  };
  const supabase = makeMockSupabase({ existingRow });

  const req = makeRequest(
    'POST',
    'https://fn.supabase.co/privacy-optout-process',
    makeValidBody(),
  );

  const res = await handle(req, makeDeps(supabase));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(body.idempotent, true);
  assertEquals(body.request_id, 'existing-uuid');

  // Must NOT create new insert rows
  const insertCalls = supabase.calls.filter(
    (c) => c.table === 'privacy_optout_requests' && c.operation === 'insert',
  );
  assertEquals(insertCalls.length, 0, 'Must not insert duplicate row');
});

// ─── Test 5: Resend stubbed ───────────────────────────────────────────────────

Deno.test('T5: RESEND_API_KEY=test-stub → 200 + confirmation_email_sent_at set', async () => {
  const supabase = makeMockSupabase({ insertId: 'req-uuid-def' });
  const deps: PrivacyOptoutDeps = {
    ...makeDeps(supabase),
    resendApiKey: 'test-stub',
  };

  const req = makeRequest(
    'POST',
    'https://fn.supabase.co/privacy-optout-process',
    makeValidBody(),
  );

  const res = await handle(req, deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);

  // Verify the UPDATE call included confirmation_email_sent_at
  const updateCalls = supabase.calls.filter(
    (c) => c.table === 'privacy_optout_requests' && c.operation === 'update',
  );
  assertEquals(updateCalls.length > 0, true, 'Must UPDATE privacy_optout_requests with timestamps');
  const updateData = updateCalls[0].data as Record<string, unknown>;
  assertEquals(
    typeof updateData.confirmation_email_sent_at === 'string',
    true,
    'Must set confirmation_email_sent_at',
  );
});

// ─── Test 6: PostHog failure → still 200 ─────────────────────────────────────

Deno.test('T6: PostHog failure → Fn still returns 200', async () => {
  const supabase = makeMockSupabase({ insertId: 'req-uuid-xyz' });

  // fetchImpl that returns 500 for PostHog, 200 for Resend
  const failPosthogFetch = ((url: string | URL, _init?: RequestInit) => {
    const urlStr = url.toString();
    if (urlStr.includes('posthog.com')) {
      return Promise.resolve(new Response('{"error":"server error"}', { status: 500 }));
    }
    // Resend
    return Promise.resolve(new Response(JSON.stringify({ id: 'msg-789' }), { status: 200 }));
  }) as unknown as typeof fetch;

  const deps: PrivacyOptoutDeps = {
    ...makeDeps(supabase, failPosthogFetch),
    resendApiKey: 'test-stub', // still stub so Resend doesn't call fetch
    posthogProjectKey: 'ph-test-key',
  };

  const req = makeRequest(
    'POST',
    'https://fn.supabase.co/privacy-optout-process',
    makeValidBody(),
  );

  const res = await handle(req, deps);
  // PostHog failure must NOT cause the overall Fn to fail
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  // propagated_at set because DB fan-outs succeeded
  assertEquals(typeof body.propagated_at, 'string');
});
