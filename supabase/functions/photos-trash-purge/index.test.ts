/**
 * Phase 23 Plan 23-04 (DEBT-03) — Deno test suite for photos-trash-purge Edge Function.
 *
 * Test naming per [[reference-deno-test-discovery]]: `index.test.ts`
 * Deno's directory-walk matches `{*_,*.,}test.*` — NOT `index-test.ts`.
 *
 * Scenarios:
 *   T1: Missing SUPABASE_SERVICE_ROLE_KEY → 500 health-check response
 *   T2: Missing Authorization header → 401
 *   T3: Happy path — 5 expired rows → purged=5, errors=0, audit_log inserted
 *   T4: Per-row failure resilience — 3 rows, 1 storage delete throws → errors=1, purged=3
 *       (all 3 DB rows still deleted — storage failure does not block DB delete)
 *   T5: Empty batch — 0 expired rows → purged=0, errors=0, no audit_log INSERT
 */

import { assertEquals, assertExists } from 'https://deno.land/std@0.210.0/assert/mod.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(opts: {
  bearer?: string;
  method?: string;
}): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (opts.bearer) headers.set('Authorization', `Bearer ${opts.bearer}`);
  return new Request('https://example.supabase.co/functions/v1/photos-trash-purge', {
    method: opts.method ?? 'POST',
    headers,
    body: '{}',
  });
}

type CallRecord = { op: string; args: unknown[] };

function makeAdminStub(opts: {
  expiredRows: Array<{ user_id: string; photo_id: string; storage_path: string }>;
  storageRemoveError?: (path: string) => boolean;
  dbDeleteError?: (photo_id: string) => boolean;
}): { stub: unknown; calls: CallRecord[] } {
  const calls: CallRecord[] = [];

  const stub = {
    auth: {
      getUser: (_jwt: string) => {
        calls.push({ op: 'auth.getUser', args: [_jwt] });
        // Return service-role style (no user row) — expected for cron invocation
        return Promise.resolve({ data: { user: null }, error: null });
      },
    },
    from: (table: string) => {
      if (table === 'photos') {
        return {
          select: () => ({
            lt: () => ({
              limit: () => {
                calls.push({ op: 'photos.select.lt.limit', args: [] });
                return Promise.resolve({ data: opts.expiredRows, error: null });
              },
            }),
          }),
          delete: () => ({
            eq: (col: string, val: string) => {
              calls.push({ op: 'photos.delete.eq', args: [col, val] });
              if (opts.dbDeleteError?.(val)) {
                return Promise.resolve({ error: { message: 'db delete failed' } });
              }
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === 'audit_logs') {
        return {
          insert: (row: unknown) => {
            calls.push({ op: 'audit_logs.insert', args: [row] });
            return Promise.resolve({ error: null });
          },
        };
      }
      return {};
    },
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => {
          calls.push({ op: `storage.${bucket}.remove`, args: paths });
          if (opts.storageRemoveError?.(paths[0] ?? '')) {
            return Promise.reject(new Error('storage remove failed'));
          }
          return Promise.resolve({ data: null, error: null });
        },
      }),
    },
  };

  return { stub, calls };
}

// ---------------------------------------------------------------------------
// Import test seam after env setup
// ---------------------------------------------------------------------------

const { __internal } = await import('./index.ts');

// ---------------------------------------------------------------------------
// T1: Missing SUPABASE_SERVICE_ROLE_KEY → 500
// ---------------------------------------------------------------------------

Deno.test('T1: Missing SUPABASE_SERVICE_ROLE_KEY returns 500 health-check error', async () => {
  // Ensure key is absent
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
  __internal.resetAdmin();

  const req = makeReq({ bearer: 'some-token' });
  const res = await __internal.handlePurge(req);

  assertEquals(res.status, 500);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.error, 'service_role_key_missing');
});

// ---------------------------------------------------------------------------
// T2: Missing Authorization header → 401
// ---------------------------------------------------------------------------

Deno.test('T2: Missing Authorization header returns 401', async () => {
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
  __internal.resetAdmin();

  const { stub } = makeAdminStub({ expiredRows: [] });
  __internal.setAdminForTest(stub);

  const req = makeReq({ bearer: undefined });
  const res = await __internal.handlePurge(req);

  assertEquals(res.status, 401);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.error, 'unauthenticated');
});

// ---------------------------------------------------------------------------
// T3: Happy path — 5 expired rows → purged=5, errors=0, audit_log inserted
// ---------------------------------------------------------------------------

Deno.test('T3: Happy path — 5 expired rows purged, audit_log written', async () => {
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
  Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
  __internal.resetAdmin();

  const expiredRows = Array.from({ length: 5 }, (_, i) => ({
    user_id: `user-${i}`,
    photo_id: `photo-${i}`,
    storage_path: `user-${i}/photos/photo-${i}.jpg`,
  }));

  const { stub, calls } = makeAdminStub({ expiredRows });
  __internal.setAdminForTest(stub);

  const req = makeReq({ bearer: 'test-service-key' });
  const res = await __internal.handlePurge(req);

  assertEquals(res.status, 200);
  const body = await res.json() as { purged: number; errors: number };
  assertEquals(body.purged, 5);
  assertEquals(body.errors, 0);

  // Verify audit_logs.insert was called once
  const auditCalls = calls.filter((c) => c.op === 'audit_logs.insert');
  assertEquals(auditCalls.length, 1);

  // Verify storage.remove called 5 times
  const storageCalls = calls.filter((c) => c.op === 'storage.photos.remove');
  assertEquals(storageCalls.length, 5);

  // Verify DB delete called 5 times
  const dbDeleteCalls = calls.filter((c) => c.op === 'photos.delete.eq');
  assertEquals(dbDeleteCalls.length, 5);
});

// ---------------------------------------------------------------------------
// T4: Per-row failure resilience — 1 storage delete throws → errors=1, purged=3
// ---------------------------------------------------------------------------

Deno.test('T4: Storage remove failure is logged but DB delete still proceeds for all rows', async () => {
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
  __internal.resetAdmin();

  const expiredRows = [
    { user_id: 'u1', photo_id: 'p1', storage_path: 'u1/photos/p1.jpg' },
    { user_id: 'u2', photo_id: 'p2', storage_path: 'u2/photos/p2.jpg' }, // this one will fail storage
    { user_id: 'u3', photo_id: 'p3', storage_path: 'u3/photos/p3.jpg' },
  ];

  const { stub, calls } = makeAdminStub({
    expiredRows,
    // Make storage.remove fail for p2
    storageRemoveError: (path) => path === 'u2/photos/p2.jpg',
  });
  __internal.setAdminForTest(stub);

  const req = makeReq({ bearer: 'test-service-key' });
  const res = await __internal.handlePurge(req);

  assertEquals(res.status, 200);
  const body = await res.json() as { purged: number; errors: number };
  // All 3 DB deletes succeed; 1 storage error
  assertEquals(body.purged, 3);
  assertEquals(body.errors, 1);

  // DB delete must have been called for all 3 rows (storage failure must not block)
  const dbDeleteCalls = calls.filter((c) => c.op === 'photos.delete.eq');
  assertEquals(dbDeleteCalls.length, 3);
});

// ---------------------------------------------------------------------------
// T5: Empty batch — 0 expired rows → purged=0, no audit_log INSERT
// ---------------------------------------------------------------------------

Deno.test('T5: Empty batch returns purged=0 errors=0 and skips audit_log INSERT', async () => {
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
  __internal.resetAdmin();

  const { stub, calls } = makeAdminStub({ expiredRows: [] });
  __internal.setAdminForTest(stub);

  const req = makeReq({ bearer: 'test-service-key' });
  const res = await __internal.handlePurge(req);

  assertEquals(res.status, 200);
  const body = await res.json() as { purged: number; errors: number };
  assertEquals(body.purged, 0);
  assertEquals(body.errors, 0);

  // No audit_log insert on empty batch
  const auditCalls = calls.filter((c) => c.op === 'audit_logs.insert');
  assertEquals(auditCalls.length, 0);
});

// Cleanup
__internal.resetAdmin();
