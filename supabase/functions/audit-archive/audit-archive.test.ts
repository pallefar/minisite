/**
 * Phase 24 Plan 24-06 — audit-archive Edge Function tests.
 *
 * Deno test suite covering all 5 behaviors from 24-06-PLAN Task 2:
 *   Test 1: SMOKE — DuckDB compat probe (CSV fallback if fails)
 *   Test 2: Returns 200 + { archived_count, archived_path } on valid cron POST
 *   Test 3: Deletes rows >90 days after successful write (SECDEF RPC path)
 *   Test 4: Returns 500 if storage bucket is missing
 *   Test 5: Idempotent — second run for same date appends -rerun-<epoch>
 *
 * Pattern: lazy admin singleton injectable via __internal.setAdminForTest.
 * Per [[reference_deno_test_discovery]]: uses `.test.ts` naming.
 *
 * Run: deno test --allow-all --import-map=../import_map.json supabase/functions/audit-archive/audit-archive.test.ts
 */

import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { __internal } from './index.ts';

// ── Mock factory helpers ───────────────────────────────────────────────────────

const SERVICE_ROLE = 'test-service-role-key';

/** Override Deno.env for test isolation */
const originalEnvGet = Deno.env.get.bind(Deno.env);
function withEnv(overrides: Record<string, string>, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const stub = (key: string) => overrides[key] ?? originalEnvGet(key);
    // deno-lint-ignore no-explicit-any
    (Deno.env as any).get = stub;
    try {
      await fn();
    } finally {
      // deno-lint-ignore no-explicit-any
      (Deno.env as any).get = originalEnvGet;
    }
  };
}

function makeFakeRow(daysAgo = 91) {
  return {
    id: crypto.randomUUID(),
    created_at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    actor_user_id: crypto.randomUUID(),
    target_user_id: crypto.randomUUID(),
    action_name: 'test.action',
    table_name: 'profiles',
    row_pk: crypto.randomUUID(),
    before_data: { field: 'old' },
    after_data: { field: 'new' },
    source: 'rpc',
    org_id: null,
  };
}

// Chainable query builder mock
function makeQueryBuilder(result: { data?: unknown; error?: { message: string } | null } = {}) {
  const b = {
    select: () => b,
    lt: () => b,
    gte: () => b,
    order: () => b,
    range: () => b,
    then: (
      resolve: (v: { data: unknown; error: { message: string } | null }) => void,
    ) => {
      resolve({ data: result.data ?? [], error: result.error ?? null });
      return Promise.resolve();
    },
  };
  return b;
}

function makeFakeAdmin({
  buckets = [{ name: 'audit-archive', public: false }],
  auditRows = [makeFakeRow()],
  listFiles = [] as Array<{ name: string }>,
  uploadError = null as { message: string } | null,
  rpcError = null as { message: string } | null,
} = {}) {
  return {
    storage: {
      listBuckets: () =>
        Promise.resolve({ data: buckets, error: null }),
      from: (bucket: string) => ({
        list: (_path: string, _opts?: unknown) =>
          Promise.resolve({ data: listFiles, error: null }),
        upload: (_path: string, _data: Uint8Array, _opts?: unknown) => {
          void bucket;
          return Promise.resolve({ data: { path: _path }, error: uploadError });
        },
      }),
    },
    from: (_table: string) => makeQueryBuilder({ data: auditRows }),
    rpc: (_fn: string, _args?: unknown) =>
      Promise.resolve({ data: { deleted: auditRows.length }, error: rpcError }),
  };
}

function makeRequest(
  body: Record<string, unknown> = { source: 'cron' },
  bearerOverride?: string,
) {
  return new Request('https://example.supabase.co/functions/v1/audit-archive', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearerOverride ?? SERVICE_ROLE}`,
    },
    body: JSON.stringify(body),
  });
}

// ── Test 1: SMOKE — DuckDB compat probe ───────────────────────────────────────

Deno.test(
  'SMOKE: function handles DuckDB absence gracefully and falls back to CSV',
  withEnv({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE },
    async () => {
      const fakeAdmin = makeFakeAdmin({ auditRows: Array.from({ length: 5 }, () => makeFakeRow()) });
      // deno-lint-ignore no-explicit-any
      __internal.setAdminForTest(fakeAdmin as any);

      const req = makeRequest();
      const res = await __internal.handle(req);

      // Should complete successfully (200 or 207) regardless of DuckDB availability
      const body = await res.json() as Record<string, unknown>;
      const ok = res.status === 200 || res.status === 207;
      if (!ok) {
        console.log('SMOKE test body:', JSON.stringify(body));
      }
      assertEquals(ok, true, `Expected 200/207, got ${res.status}: ${JSON.stringify(body)}`);
    }),
);

// ── Test 2: 200 + archived_count + archived_path on valid cron POST ───────────
//
// Phase 48 Plan 48-04: Fn now archives multiple tables per run (audit_logs +
// moderation_audit_log). The mock `from(_table)` returns the same `rows` for
// every table, so total archived_count = rows.length × TABLES_TO_ARCHIVE.length.
// The per-table breakdown lives in body.tables[].

Deno.test(
  'Returns 200 + archived_count + archived_path when source=cron is POSTed',
  withEnv({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE },
    async () => {
      const rows = Array.from({ length: 3 }, () => makeFakeRow());
      const fakeAdmin = makeFakeAdmin({ auditRows: rows });
      // deno-lint-ignore no-explicit-any
      __internal.setAdminForTest(fakeAdmin as any);

      const req = makeRequest({ source: 'cron' });
      const res = await __internal.handle(req);

      assertEquals(res.status, 200);
      const body = await res.json() as Record<string, unknown>;
      assertEquals(typeof body.archived_count, 'number');
      // Each registered table contributes `rows.length` (mock returns same fixture per table).
      const tables = body.tables as Array<Record<string, unknown>>;
      assertEquals(Array.isArray(tables), true, 'response must include per-table breakdown');
      assertEquals(body.archived_count, rows.length * tables.length);
      assertEquals(typeof body.archived_path, 'string');
      assertStringIncludes(body.archived_path as string, '/');
      // Each table's per-table archived_count matches the mock fixture row count.
      for (const t of tables) {
        assertEquals(t.archived_count, rows.length, `table ${t.table} should archive ${rows.length} rows`);
      }
    }),
);

// ── Test 3: Deletes rows via SECDEF RPC after successful write ────────────────

Deno.test(
  'Calls delete_archived_audit_rows RPC after successful upload',
  withEnv({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE },
    async () => {
      const rows = [makeFakeRow(95)]; // 95 days old
      let rpcCalled = false;
      let rpcArgs: Record<string, unknown> | null = null;

      const fakeAdmin = {
        ...makeFakeAdmin({ auditRows: rows }),
        rpc: (fn: string, args?: Record<string, unknown>) => {
          if (fn === 'delete_archived_audit_rows') {
            rpcCalled = true;
            rpcArgs = args ?? null;
          }
          return Promise.resolve({ data: { deleted: 1 }, error: null });
        },
      };
      // deno-lint-ignore no-explicit-any
      __internal.setAdminForTest(fakeAdmin as any);

      const req = makeRequest();
      const res = await __internal.handle(req);

      assertEquals(res.status, 200);
      assertEquals(rpcCalled, true, 'delete_archived_audit_rows RPC must be called');
      // deno-lint-ignore no-explicit-any
      assertEquals(typeof (rpcArgs as any)?.p_cutoff, 'string', 'RPC must receive p_cutoff timestamptz');
    }),
);

// ── Test 4: Returns 500 if bucket is missing ──────────────────────────────────

Deno.test(
  'Returns 500 with bucket_missing error when audit-archive bucket does not exist',
  withEnv({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE },
    async () => {
      const fakeAdmin = makeFakeAdmin({ buckets: [] }); // empty bucket list
      // deno-lint-ignore no-explicit-any
      __internal.setAdminForTest(fakeAdmin as any);

      const req = makeRequest();
      const res = await __internal.handle(req);

      assertEquals(res.status, 500);
      const body = await res.json() as Record<string, unknown>;
      assertEquals(body.error, 'bucket_missing');
    }),
);

// ── Test 5: Idempotent — second run appends -rerun-<epoch> suffix ─────────────

Deno.test(
  'Idempotent: second run for same date appends -rerun-<epoch> suffix to storage path',
  withEnv({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE },
    async () => {
      const rows = [makeFakeRow(92)];
      const today = new Date();
      const dd = String(today.getUTCDate()).padStart(2, '0');

      // Pre-populate: simulate existing file for today
      const existingFiles = [{ name: `${dd}.csv` }];
      const uploadPaths: string[] = [];

      const fakeAdmin = {
        ...makeFakeAdmin({ auditRows: rows, listFiles: existingFiles }),
        storage: {
          listBuckets: () => Promise.resolve({ data: [{ name: 'audit-archive', public: false }], error: null }),
          from: (_bucket: string) => ({
            list: (_path: string, _opts?: unknown) =>
              Promise.resolve({ data: existingFiles, error: null }),
            upload: (path: string, _data: Uint8Array, _opts?: unknown) => {
              uploadPaths.push(path);
              return Promise.resolve({ data: { path }, error: null });
            },
          }),
        },
      };
      // deno-lint-ignore no-explicit-any
      __internal.setAdminForTest(fakeAdmin as any);

      const req = makeRequest();
      const res = await __internal.handle(req);

      assertEquals(res.status, 200);

      // Phase 48 Plan 48-04: Fn now archives multiple tables per run; mock's
      // `list()` returns `existingFiles` for every table, so every upload gets
      // a rerun suffix. Per-table invariant: every uploaded path contains
      // '-rerun-'.
      assertEquals(uploadPaths.length > 0, true, 'Should have uploaded at least one file');
      for (const p of uploadPaths) {
        assertStringIncludes(p, '-rerun-',
          `Expected idempotency suffix in path: ${p}`);
      }
    }),
);
