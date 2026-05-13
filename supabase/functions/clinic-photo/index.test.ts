/**
 * Phase 9 Plan 09-07 — Deno unit tests for the clinic-photo Edge Function.
 *
 * Strategy mirrors `share/index.test.ts`: seed env BEFORE importing
 * `index.ts` so module-level admin client construction succeeds, then
 * invoke the exported `handle(req, { admin })` with a hand-rolled mock
 * SupabaseClient. This exercises the full 3-check gate, audit-on-
 * success / audit-on-denied calls, and the signed-URL TTL without
 * spinning up Postgres or Storage.
 *
 * File suffix is `.test.ts` (NOT `-test.ts`) per memory
 * `reference_deno_test_discovery.md` so Deno's directory-walk picks it
 * up.
 *
 * Run: `cd supabase/functions/clinic-photo && deno task test`
 *      or
 *      `deno test --allow-env --allow-net supabase/functions/clinic-photo/`
 *
 * Tests cover behaviors 1-13 from 09-07-PLAN.md task 1 <behavior>:
 *   1. 200 happy-path (audit_logs row written).
 *   2. 401 no JWT.
 *   3. 401 invalid JWT.
 *   4. 401 operator revoked (audit permission_denied).
 *   5. 403 permission_denied (audit permission_denied).
 *   6. 403 consent_excluded (audit permission_denied).
 *   7. 401 patient_not_member (audit permission_denied).
 *   8. 404 photo_not_found (no audit row — not a security event).
 *   9. 200 includes `Cache-Control: private, no-store`.
 *  10. createSignedUrl is called with TTL=300.
 *  11. Success audit row uses actor_type='org_operator',
 *      action='clinic_photo_view', org_id, target_user_id, row_id.
 *  12. Denied audit row uses action='permission_denied'.
 *  13. CORS preflight returns Access-Control-Allow-Origin: '*'
 *      with NO credentials header.
 */
import { assert, assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { corsHeaders } from './cors.ts';

// Seed env BEFORE importing the module so createClient() at module
// scope doesn't blow up on missing SUPABASE_URL/key.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

const { handle } = await import('./index.ts');

// ─── Mock SupabaseClient ────────────────────────────────────────────────────
//
// We mock only the surface the handler touches:
//   - admin.auth.getUser(token) → { data: { user }, error }
//   - admin.from(table).select(...).eq(col, val).eq(...).is('revoked_at', null).maybeSingle()
//       → { data, error }
//     (and the variant ending in .eq().eq() for the photos table — no .is())
//   - admin.rpc(name, args) → { data, error }
//   - admin.storage.from(bucket).createSignedUrl(path, ttl) → { data, error }
//
// Each test seeds a scenario via MockScenario and asserts the relevant
// rpc/storage calls afterward via the recorded `calls` array.

interface MockScenario {
  /** Token → user lookup result. Key '*' is the wildcard fallback. */
  users?: Record<string, { id: string } | null>;
  /** Memberships table responses keyed by `${user_id}::${org_id}`. */
  memberships?: Record<string, { id: string; role_id?: string; consent_scope?: Record<string, unknown> } | null>;
  /** has_permission RPC result keyed by `${user_id}::${org_id}::${key}`. */
  permissions?: Record<string, boolean>;
  /** Photos table responses keyed by `${user_id}::${photo_id}`. */
  photos?: Record<string, { storage_path: string } | null>;
  /** Force a createSignedUrl error. */
  signError?: boolean;
  /** Force a has_permission RPC error. */
  permissionRpcError?: boolean;
}

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

interface StorageCall {
  bucket: string;
  path: string;
  ttl: number;
}

interface MockAdmin {
  calls: { rpc: RpcCall[]; signed: StorageCall[] };
  auth: { getUser: (token: string) => Promise<{ data: { user: { id: string } | null }; error: Error | null }> };
  from: (table: string) => MockQueryBuilder;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: Error | null }>;
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (path: string, ttl: number) => Promise<{ data: { signedUrl: string } | null; error: Error | null }>;
    };
  };
}

interface MockQueryBuilder {
  select: (cols: string) => MockQueryBuilder;
  eq: (col: string, val: unknown) => MockQueryBuilder;
  is: (col: string, val: unknown) => MockQueryBuilder;
  maybeSingle: () => Promise<{ data: unknown; error: Error | null }>;
}

function buildMockAdmin(scenario: MockScenario): MockAdmin {
  const calls: { rpc: RpcCall[]; signed: StorageCall[] } = { rpc: [], signed: [] };

  const makeBuilder = (table: string): MockQueryBuilder => {
    const where: Record<string, unknown> = {};
    const builder: MockQueryBuilder = {
      select: () => builder,
      eq: (col, val) => {
        where[col] = val;
        return builder;
      },
      is: (col, val) => {
        where[col] = val; // we just record; consumed in maybeSingle resolver
        return builder;
      },
      maybeSingle: () => {
        if (table === 'memberships') {
          const key = `${String(where.user_id)}::${String(where.org_id)}`;
          const row = scenario.memberships?.[key] ?? null;
          // Honour the partial-index predicate: handler always calls
          // .is('revoked_at', null). If the scenario row is meant to
          // represent a revoked membership it should NOT be present
          // in scenario.memberships for that key (the partial-index
          // lookup wouldn't see it).
          return Promise.resolve({ data: row, error: null });
        }
        if (table === 'photos') {
          const key = `${String(where.user_id)}::${String(where.photo_id)}`;
          const row = scenario.photos?.[key] ?? null;
          return Promise.resolve({ data: row, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    return builder;
  };

  return {
    calls,
    auth: {
      getUser: (token: string) => {
        const u = scenario.users?.[token] ?? scenario.users?.['*'] ?? null;
        if (!u) return Promise.resolve({ data: { user: null }, error: new Error('bad jwt') });
        return Promise.resolve({ data: { user: u }, error: null });
      },
    },
    from: (table: string) => makeBuilder(table),
    rpc: (fn, args) => {
      calls.rpc.push({ fn, args });
      if (fn === 'has_permission') {
        if (scenario.permissionRpcError) return Promise.resolve({ data: null, error: new Error('rpc failed') });
        const key = `${String(args.p_user_id)}::${String(args.p_org_id)}::${String(args.p_permission_key)}`;
        return Promise.resolve({ data: scenario.permissions?.[key] ?? false, error: null });
      }
      if (fn === 'log_clinic_event') {
        // Always succeeds in the mock unless an explicit test wants
        // failure. (We don't test the audit-failure path because the
        // handler is best-effort and swallows.)
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: (path: string, ttl: number) => {
          calls.signed.push({ bucket, path, ttl });
          if (scenario.signError) return Promise.resolve({ data: null, error: new Error('sign failed') });
          return Promise.resolve({ data: { signedUrl: `https://signed.example/${bucket}/${path}?ttl=${ttl}` }, error: null });
        },
      }),
    },
  };
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const ORG = '00000000-0000-0000-0000-000000000001';
const OP = '00000000-0000-0000-0000-0000000000aa';
const PATIENT = '00000000-0000-0000-0000-0000000000bb';
const PHOTO = '00000000-0000-0000-0000-0000000000cc';
const OP_TOKEN = 'op-jwt';

function happyScenario(): MockScenario {
  return {
    users: { [OP_TOKEN]: { id: OP } },
    memberships: {
      [`${OP}::${ORG}`]: { id: 'op-mem', role_id: 'role-coach' },
      [`${PATIENT}::${ORG}`]: { id: 'pt-mem', consent_scope: { photos: true } },
    },
    permissions: {
      [`${OP}::${ORG}::patient_photos.read`]: true,
    },
    photos: {
      [`${PATIENT}::${PHOTO}`]: { storage_path: `${PATIENT}/photos/${PHOTO}.jpg` },
    },
  };
}

function makeReq(opts: { method?: string; auth?: string | null; path?: string } = {}): Request {
  const method = opts.method ?? 'GET';
  const path = opts.path ?? `/clinic-photo/${ORG}/${PATIENT}/${PHOTO}`;
  const headers: Record<string, string> = {};
  if (opts.auth !== null) headers['Authorization'] = opts.auth ?? `Bearer ${OP_TOKEN}`;
  return new Request(`https://example.supabase.co${path}`, { method, headers });
}

// ─── Behavior 1: 200 happy-path ─────────────────────────────────────────────

Deno.test('clinic-photo: 200 happy-path mints signed URL and writes audit row', async () => {
  const admin = buildMockAdmin(happyScenario());
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq(), { admin: admin as any });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertExists(body.signedUrl);
  assertEquals(body.ttl, 300);

  // Behavior 11: audit row uses canonical fields.
  const auditCall = admin.calls.rpc.find((c) => c.fn === 'log_clinic_event' && c.args.p_action === 'clinic_photo_view');
  assertExists(auditCall, 'expected log_clinic_event(clinic_photo_view) call');
  assertEquals(auditCall.args.p_actor_type, 'org_operator');
  assertEquals(auditCall.args.p_org_id, ORG);
  assertEquals(auditCall.args.p_target_user_id, PATIENT);
  assertEquals(auditCall.args.p_row_id, PHOTO);
});

// ─── Behavior 2: 401 no JWT ─────────────────────────────────────────────────

Deno.test('clinic-photo: 401 no_auth when Authorization header missing', async () => {
  const admin = buildMockAdmin(happyScenario());
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq({ auth: null }), { admin: admin as any });
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'no_auth');
  // No audit row before JWT is even resolved — operator identity unknown.
  assertEquals(admin.calls.rpc.filter((c) => c.fn === 'log_clinic_event').length, 0);
});

// ─── Behavior 3: 401 invalid JWT ────────────────────────────────────────────

Deno.test('clinic-photo: 401 invalid_jwt when token does not resolve', async () => {
  const admin = buildMockAdmin({ users: {} });
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq({ auth: 'Bearer garbage' }), { admin: admin as any });
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'invalid_jwt');
});

// ─── Behavior 4: 401 operator revoked ───────────────────────────────────────

Deno.test('clinic-photo: 401 not_member when operator has no active membership', async () => {
  const scenario = happyScenario();
  // Operator's membership row is "revoked" — emulated by removing it
  // from the partial-index-aligned mock (the .is('revoked_at', null)
  // SELECT returns nothing).
  delete scenario.memberships![`${OP}::${ORG}`];
  const admin = buildMockAdmin(scenario);
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq(), { admin: admin as any });
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'not_member');

  // Behavior 12: deny path writes permission_denied audit row.
  const denied = admin.calls.rpc.find((c) => c.fn === 'log_clinic_event' && c.args.p_action === 'permission_denied');
  assertExists(denied, 'expected log_clinic_event(permission_denied) on operator revoked');
  assertEquals(denied.args.p_actor_type, 'org_operator');
  assertEquals(denied.args.p_org_id, ORG);
  assertEquals(denied.args.p_target_user_id, PATIENT);
  assertEquals(denied.args.p_row_id, PHOTO);
});

// ─── Behavior 5: 403 permission_denied ──────────────────────────────────────

Deno.test('clinic-photo: 403 permission_denied when role lacks patient_photos.read', async () => {
  const scenario = happyScenario();
  scenario.permissions = {}; // has_permission returns false.
  const admin = buildMockAdmin(scenario);
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq(), { admin: admin as any });
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, 'permission_denied');

  const denied = admin.calls.rpc.find((c) => c.fn === 'log_clinic_event' && c.args.p_action === 'permission_denied');
  assertExists(denied);
});

// ─── Behavior 6: 403 consent_excluded ───────────────────────────────────────

Deno.test('clinic-photo: 403 consent_excluded when patient consent_scope.photos is false', async () => {
  const scenario = happyScenario();
  scenario.memberships![`${PATIENT}::${ORG}`] = {
    id: 'pt-mem',
    consent_scope: { photos: false },
  };
  const admin = buildMockAdmin(scenario);
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq(), { admin: admin as any });
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, 'consent_excluded');

  const denied = admin.calls.rpc.find((c) => c.fn === 'log_clinic_event' && c.args.p_action === 'permission_denied');
  assertExists(denied);
});

Deno.test('clinic-photo: 403 consent_excluded when consent_scope omits photos key (strict shape defense)', async () => {
  const scenario = happyScenario();
  scenario.memberships![`${PATIENT}::${ORG}`] = {
    id: 'pt-mem',
    consent_scope: { injections: true }, // photos key missing entirely
  };
  const admin = buildMockAdmin(scenario);
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq(), { admin: admin as any });
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, 'consent_excluded');
});

// ─── Behavior 7: 401 patient_not_member ─────────────────────────────────────

Deno.test('clinic-photo: 401 patient_not_member when patient has no active membership', async () => {
  const scenario = happyScenario();
  delete scenario.memberships![`${PATIENT}::${ORG}`];
  const admin = buildMockAdmin(scenario);
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq(), { admin: admin as any });
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'patient_not_member');

  const denied = admin.calls.rpc.find((c) => c.fn === 'log_clinic_event' && c.args.p_action === 'permission_denied');
  assertExists(denied);
});

// ─── Behavior 8: 404 photo_not_found (no audit row) ────────────────────────

Deno.test('clinic-photo: 404 photo_not_found writes NO audit row', async () => {
  const scenario = happyScenario();
  scenario.photos = {}; // photo missing
  const admin = buildMockAdmin(scenario);
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq(), { admin: admin as any });
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error, 'photo_not_found');

  // 404 is NOT a security event — gate already passed. No
  // permission_denied row, no clinic_photo_view row.
  const auditCalls = admin.calls.rpc.filter((c) => c.fn === 'log_clinic_event');
  assertEquals(auditCalls.length, 0);
});

// ─── Behavior 9: 200 Cache-Control header ───────────────────────────────────

Deno.test('clinic-photo: 200 response sets Cache-Control: private, no-store', async () => {
  const admin = buildMockAdmin(happyScenario());
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq(), { admin: admin as any });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
  // Read body to release the stream (avoid Deno leak detector noise).
  await res.json();
});

// ─── Behavior 10: 5-minute TTL on signed URL ────────────────────────────────

Deno.test('clinic-photo: createSignedUrl is called with TTL=300 (D-13)', async () => {
  const admin = buildMockAdmin(happyScenario());
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq(), { admin: admin as any });
  assertEquals(res.status, 200);
  await res.json();
  assertEquals(admin.calls.signed.length, 1);
  assertEquals(admin.calls.signed[0].ttl, 300);
  assertEquals(admin.calls.signed[0].bucket, 'photos');
  assertEquals(admin.calls.signed[0].path, `${PATIENT}/photos/${PHOTO}.jpg`);
});

// ─── Behavior 11: success audit-row fields (covered inline above) ──────────
// Asserted in the 200 happy-path test (Behavior 1).

// ─── Behavior 12: denied audit-row fields (covered inline above) ───────────
// Asserted in Behavior-4/5/6/7 tests.

// ─── Behavior 13: CORS preflight ────────────────────────────────────────────

Deno.test('clinic-photo: CORS preflight returns wildcard origin without credentials', async () => {
  const admin = buildMockAdmin(happyScenario());
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq({ method: 'OPTIONS', auth: null }), { admin: admin as any });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
  assertEquals(res.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS');
  // Pitfall #11: no Allow-Credentials header — JWT is the auth gate,
  // no cookies are set or read.
  assertEquals(res.headers.get('Access-Control-Allow-Credentials'), null);
  // Drain body.
  await res.text();
});

// ─── Static asserts on cors module ──────────────────────────────────────────

Deno.test('clinic-photo cors headers — wildcard origin (no credentials)', () => {
  assertEquals(corsHeaders['Access-Control-Allow-Origin'], '*');
  assertEquals(corsHeaders['Access-Control-Allow-Methods'], 'GET, OPTIONS');
  assert(!('Access-Control-Allow-Credentials' in corsHeaders));
});

// ─── Bonus: bad path ─────────────────────────────────────────────────────────

Deno.test('clinic-photo: 400 bad_path when fewer than 3 path segments', async () => {
  const admin = buildMockAdmin(happyScenario());
  const req = new Request('https://example.supabase.co/clinic-photo/only-one', {
    method: 'GET',
    headers: { Authorization: `Bearer ${OP_TOKEN}` },
  });
  // deno-lint-ignore no-explicit-any
  const res = await handle(req, { admin: admin as any });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'bad_path');
});

// ─── Bonus: method not allowed ──────────────────────────────────────────────

Deno.test('clinic-photo: 405 method_not_allowed on POST', async () => {
  const admin = buildMockAdmin(happyScenario());
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq({ method: 'POST' }), { admin: admin as any });
  assertEquals(res.status, 405);
});
