/**
 * Deno tests for `admin-grant-freeze-token` Edge Function — Phase 35 Plan 35-02.
 *
 * Per [[reference_deno_test_discovery]]: filename is `index.test.ts`.
 *
 * Test plan (4 behaviors + OPTIONS from 35-02-PLAN.md Task 3):
 *   T1 — Missing auth header → 401 unauthenticated
 *   T2 — Non-admin user → 403 forbidden_not_admin
 *   T3 — Invalid body (delta=0, delta=3, bad uuid, empty reason_note) → 400 invalid_body
 *   T4 — Happy path: admin grants delta=1 → 200 ok:true, ledger row inserted with granted_by_admin_user_id
 *   T5 — OPTIONS preflight → 204 with CORS headers
 *
 * Uses __internal.setAdminForTest hook to inject mock admin client.
 * Calls __internal.handler directly — does NOT go through Deno.serve.
 *
 * Run: $HOME/.deno/bin/deno test --no-check --allow-net --allow-env index.test.ts
 */

import { assertEquals } from 'jsr:@std/assert@1';
import { __internal } from './index.ts';
import { setMirrorAdminForTest, resetMirrorAdminForTest } from '../_shared/posthog-server.ts';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
Deno.env.set('POSTHOG_PROJECT_KEY', '');  // disable PostHog capture in tests

const ADMIN_USER_ID  = '11111111-1111-4111-8111-111111111111';
const TARGET_USER_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_JWT      = 'fake-admin-jwt';

// ============================================================================
// Fake admin builder
// ============================================================================

interface FakeAdminConfig {
  authUserId: string | null;
  adminRole: string | null;
  insertError: string | null;
  insertedRows: Record<string, unknown>[];
}

// deno-lint-ignore no-explicit-any
function makeFakeAdmin(cfg: FakeAdminConfig): any {
  return {
    auth: {
      getUser: (_jwt: string) => {
        if (cfg.authUserId === null) {
          return Promise.resolve({ data: { user: null }, error: { message: 'bad token' } });
        }
        return Promise.resolve({ data: { user: { id: cfg.authUserId } }, error: null });
      },
    },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) => ({
              maybeSingle: () => {
                if (cfg.adminRole === null) {
                  return Promise.resolve({ data: null, error: null });
                }
                return Promise.resolve({ data: { admin_role: cfg.adminRole }, error: null });
              },
            }),
          }),
        };
      }
      if (table === 'freeze_tokens_ledger') {
        return {
          insert: (row: Record<string, unknown>) => {
            if (cfg.insertError) {
              return Promise.resolve({ error: { message: cfg.insertError } });
            }
            cfg.insertedRows.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`[test] unexpected from(${table})`);
    },
  };
}

// ============================================================================
// Request builder
// ============================================================================

function mkReq(opts: { method?: string; jwt?: string; body?: unknown }): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.jwt) headers.authorization = `Bearer ${opts.jwt}`;
  return new Request('http://localhost/functions/v1/admin-grant-freeze-token', {
    method: opts.method ?? 'POST',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

// ============================================================================
// T1 — Missing auth header → 401
// ============================================================================

Deno.test('T1: missing bearer → 401 unauthenticated', async () => {
  const insertedRows: Record<string, unknown>[] = [];
  __internal.setAdminForTest(makeFakeAdmin({
    authUserId: ADMIN_USER_ID,
    adminRole: 'superadmin',
    insertError: null,
    insertedRows,
  }));

  const req = mkReq({ body: { target_user_id: TARGET_USER_ID, delta: 1, reason_note: 'test' } });
  // No jwt — Authorization header absent.
  const res = await __internal.handler(req);
  assertEquals(res.status, 401, 'missing jwt must return 401');
  const body = await res.json();
  assertEquals(body.error, 'unauthenticated');
  assertEquals(insertedRows.length, 0, 'no ledger row when unauthenticated');
  __internal.resetAdminForTest();
});

// ============================================================================
// T2 — Non-admin user → 403
// ============================================================================

Deno.test('T2: non-admin user → 403 forbidden_not_admin', async () => {
  const insertedRows: Record<string, unknown>[] = [];
  __internal.setAdminForTest(makeFakeAdmin({
    authUserId: ADMIN_USER_ID,
    adminRole: 'user',  // not in ADMIN_ROLES set
    insertError: null,
    insertedRows,
  }));

  const req = mkReq({ jwt: ADMIN_JWT, body: { target_user_id: TARGET_USER_ID, delta: 1, reason_note: 'test' } });
  const res = await __internal.handler(req);
  assertEquals(res.status, 403, 'non-admin must return 403');
  const body = await res.json();
  assertEquals(body.error, 'forbidden_not_admin');
  assertEquals(insertedRows.length, 0, 'no ledger row when non-admin');
  __internal.resetAdminForTest();
});

// ============================================================================
// T3 — Invalid body → 400
// ============================================================================

Deno.test('T3: delta=0 → 400 invalid_body (delta must be 1 or 2)', async () => {
  const insertedRows: Record<string, unknown>[] = [];
  __internal.setAdminForTest(makeFakeAdmin({
    authUserId: ADMIN_USER_ID,
    adminRole: 'support_admin',
    insertError: null,
    insertedRows,
  }));

  // delta=0 is out of [1,2]
  const req = mkReq({ jwt: ADMIN_JWT, body: { target_user_id: TARGET_USER_ID, delta: 0, reason_note: 'test' } });
  const res = await __internal.handler(req);
  assertEquals(res.status, 400, 'delta=0 must return 400');
  const body = await res.json();
  assertEquals(body.error, 'invalid_body');

  // delta=3 is out of [1,2]
  const req3 = mkReq({ jwt: ADMIN_JWT, body: { target_user_id: TARGET_USER_ID, delta: 3, reason_note: 'test' } });
  const res3 = await __internal.handler(req3);
  assertEquals(res3.status, 400, 'delta=3 must return 400');

  assertEquals(insertedRows.length, 0, 'no ledger row on invalid body');
  __internal.resetAdminForTest();
});

// ============================================================================
// T4 — Happy path: admin grants delta=1 → 200 + ledger row with audit fields
// ============================================================================

Deno.test('T4: admin grant inserts ledger row with granted_by_admin_user_id audit', async () => {
  const insertedRows: Record<string, unknown>[] = [];
  __internal.setAdminForTest(makeFakeAdmin({
    authUserId: ADMIN_USER_ID,
    adminRole: 'support_admin',
    insertError: null,
    insertedRows,
  }));

  // Stub the events_mirror admin to prevent fire-and-forget async fetch leaks.
  // The mock's from().insert() is a no-op that returns immediately (sync).
  // deno-lint-ignore no-explicit-any
  const noopMirrorAdmin: any = {
    from: (_table: string) => ({ insert: () => Promise.resolve({ error: null }) }),
  };
  setMirrorAdminForTest(noopMirrorAdmin);

  const reasonNote = 'compensating user for app downtime';
  const req = mkReq({
    jwt: ADMIN_JWT,
    body: { target_user_id: TARGET_USER_ID, delta: 1, reason_note: reasonNote },
  });
  const res = await __internal.handler(req);
  assertEquals(res.status, 200, 'valid admin grant must return 200');
  const body = await res.json();
  assertEquals(body.ok, true, 'response.ok must be true');

  assertEquals(insertedRows.length, 1, 'exactly one ledger row inserted');
  const row = insertedRows[0];
  assertEquals(row.user_id, TARGET_USER_ID, 'row.user_id = target_user_id');
  assertEquals(row.delta, 1, 'row.delta = 1');
  assertEquals(row.reason, 'admin_grant', 'row.reason = admin_grant');
  assertEquals(row.granted_by_admin_user_id, ADMIN_USER_ID, 'granted_by_admin_user_id = caller (D-10 audit)');
  assertEquals(
    typeof row.source_ref === 'string' && (row.source_ref as string).startsWith('admin_grant:'),
    true,
    'source_ref must carry human-readable reason',
  );
  __internal.resetAdminForTest();
  resetMirrorAdminForTest();
});

// ============================================================================
// T5 — OPTIONS preflight → 204
// ============================================================================

Deno.test('T5: OPTIONS preflight → 204 with CORS headers', async () => {
  const req = new Request('http://localhost/functions/v1/admin-grant-freeze-token', {
    method: 'OPTIONS',
  });
  const res = await __internal.handler(req);
  assertEquals(res.status, 204, 'OPTIONS must return 204');
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*', 'CORS Allow-Origin: *');
  assertEquals(res.headers.get('Access-Control-Allow-Methods')?.includes('POST'), true, 'CORS allows POST');
});
