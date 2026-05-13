/**
 * Phase 10 Plan 10-04 — Deno unit tests for the `clinic-snapshot` Edge Function.
 *
 * Strategy mirrors `clinic-photo/index.test.ts`: seed env BEFORE importing
 * `index.ts` so module-level admin client construction succeeds, then invoke
 * the exported `handle(req, { admin })` with a hand-rolled mock SupabaseClient.
 * Exercises the full D-04 auth gate, consent_scope filtering, permission_map
 * computation, and audit row writes without spinning up Postgres or Storage.
 *
 * File suffix is `.test.ts` (NOT `-test.ts`) per memory
 * `reference_deno_test_discovery.md` so Deno's directory-walk picks it up.
 *
 * Run: `cd supabase/functions/clinic-snapshot && deno task test`
 *   or
 *      `deno test --allow-env --allow-net supabase/functions/clinic-snapshot/`
 *
 * Tests cover 10 behaviors from 10-04-PLAN.md task 2 <behavior>:
 *   1. GET with no JWT → 401 missing_jwt + Cache-Control: private, no-store.
 *   2. GET with invalid JWT (garbage Bearer) → 401 invalid_jwt + Cache-Control set.
 *   3. Valid JWT but caller has no membership in org → 403 not_member.
 *   4. Valid JWT, revoked membership (handled by not returning in mock) → 403 not_member.
 *   5. Valid JWT, active membership, but role lacks patient_data.read → 403 insufficient_permission.
 *   6. Happy path: valid JWT + active membership + permission → 200, SnapshotData shape
 *      with viewer_context='clinic', org_id, permission_map populated, consent_scope populated.
 *   7. consent_scope.photos=false → response has photos: [] + canViewPhotos: false
 *      regardless of operator's role.
 *   8. operator has patient_photos.read AND consent_scope.photos=true → canViewPhotos: true.
 *      operator lacks patient_photos.read → canViewPhotos: false.
 *   9. Cache-Control: private, no-store header present on EVERY status code
 *      (401, 403, 400, 200, OPTIONS).
 *  10. ai_history NOT in response body (structural exclusion — T-10-04-04).
 */
import { assert, assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { BASE_RESPONSE_HEADERS } from './cors.ts';

// Seed env BEFORE importing the module so createClient() at module
// scope doesn't blow up on missing SUPABASE_URL/key.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

const { handle } = await import('./index.ts');

// ─── Mock SupabaseClient ────────────────────────────────────────────────────

interface MockScenario {
  /** Token → user lookup result. Key '*' is the wildcard fallback. */
  users?: Record<string, { id: string; user_metadata?: Record<string, string> } | null>;
  /** Memberships table responses keyed by `${user_id}::${org_id}`. */
  memberships?: Record<
    string,
    { id: string; role_id?: string; consent_scope?: Record<string, boolean> } | null
  >;
  /** has_permission RPC results keyed by `${user_id}::${org_id}::${key}`. */
  permissions?: Record<string, boolean>;
  /** Table data keyed by table name. */
  tableData?: Record<string, unknown[]>;
  /** Force a has_permission RPC error. */
  permissionRpcError?: boolean;
  /** Force getUserById to fail. */
  getUserByIdError?: boolean;
}

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

interface InsertCall {
  table: string;
  data: Record<string, unknown>;
}

interface MockAdmin {
  calls: { rpc: RpcCall[]; inserts: InsertCall[] };
  auth: {
    getUser: (token: string) => Promise<{
      data: { user: { id: string; user_metadata?: Record<string, string> } | null };
      error: Error | null;
    }>;
    admin: {
      getUserById: (id: string) => Promise<{
        data: { user: { user_metadata: Record<string, string> } | null };
        error: Error | null;
      }>;
    };
  };
  from: (table: string) => MockQueryBuilder;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: Error | null }>;
}

interface MockQueryBuilder {
  select: (cols?: string) => MockQueryBuilder;
  eq: (col: string, val: unknown) => MockQueryBuilder;
  is: (col: string, val: unknown) => MockQueryBuilder;
  order: (col: string, opts?: unknown) => MockQueryBuilder;
  limit: (n: number) => MockQueryBuilder;
  insert: (data: unknown) => Promise<{ data: unknown; error: Error | null }>;
  maybeSingle: () => Promise<{ data: unknown; error: Error | null }>;
}

function buildMockAdmin(scenario: MockScenario): MockAdmin {
  const calls: { rpc: RpcCall[]; inserts: InsertCall[] } = { rpc: [], inserts: [] };

  const makeBuilder = (table: string): MockQueryBuilder => {
    const where: Record<string, unknown> = {};
    const builder: MockQueryBuilder = {
      select: () => builder,
      eq: (col, val) => { where[col] = val; return builder; },
      is: (col, val) => { where[col] = val; return builder; },
      order: () => builder,
      limit: () => builder,
      insert: (data) => {
        calls.inserts.push({ table, data: data as Record<string, unknown> });
        return Promise.resolve({ data: null, error: null });
      },
      maybeSingle: () => {
        if (table === 'memberships') {
          const key = `${String(where.user_id)}::${String(where.org_id)}`;
          const row = scenario.memberships?.[key] ?? null;
          return Promise.resolve({ data: row, error: null });
        }
        // Other tables return seeded data or empty array (via .select())
        return Promise.resolve({ data: scenario.tableData?.[table]?.[0] ?? null, error: null });
      },
    };
    // Override maybeSingle for select to return array shapes for non-membership tables
    const originalMaybySingle = builder.maybeSingle;
    // Return the builder; .maybeSingle() is called on the membership query
    return Object.assign(builder, {
      // For SELECT without maybySingle (data tables), return array
      then: undefined, // not a Promise
    });
  };

  return {
    calls,
    auth: {
      getUser: (token: string) => {
        const u = scenario.users?.[token] ?? scenario.users?.['*'] ?? null;
        if (!u) return Promise.resolve({ data: { user: null }, error: new Error('bad jwt') });
        return Promise.resolve({ data: { user: u }, error: null });
      },
      admin: {
        getUserById: (_id: string) => {
          if (scenario.getUserByIdError) {
            return Promise.resolve({ data: { user: null }, error: new Error('not found') });
          }
          // Return a user with display_name from the users map
          const u = scenario.users?.['*'] ?? scenario.users?.[Object.keys(scenario.users ?? {})[0]] ?? null;
          if (!u) return Promise.resolve({ data: { user: null }, error: null });
          return Promise.resolve({
            data: { user: { user_metadata: u.user_metadata ?? {} } },
            error: null,
          });
        },
      },
    },
    from: (table: string) => {
      const tableBuilder = makeBuilder(table);
      // Override select to return array data for non-membership tables
      const originalSelect = tableBuilder.select.bind(tableBuilder);
      tableBuilder.select = (cols?: string) => {
        const sub = originalSelect(cols);
        // Give the builder a special resolution for data tables
        const origMaybe = sub.maybeSingle.bind(sub);
        sub.maybeSingle = () => {
          if (table === 'memberships') return origMaybe();
          return Promise.resolve({ data: scenario.tableData?.[table]?.[0] ?? null, error: null });
        };
        // For array results (the WHERE eq chain), we need to simulate returning
        // an array. Since we can't do real async resolution here, we use a
        // wrapper that resolves the full chain to an object with .data.
        return Object.assign(sub, {
          // Patch: when the handler awaits the query builder directly (not .maybeSingle),
          // resolve with the data array.
          // NOTE: supabase-js query builders are thenable (Promises).
          then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
            resolve({ data: scenario.tableData?.[table] ?? [], error: null });
          },
        });
      };
      return tableBuilder;
    },
    rpc: (fn, args) => {
      calls.rpc.push({ fn, args });
      if (fn === 'has_permission') {
        if (scenario.permissionRpcError) {
          return Promise.resolve({ data: null, error: new Error('rpc failed') });
        }
        const key = `${String(args.p_user_id)}::${String(args.p_org_id)}::${String(args.p_permission_key)}`;
        return Promise.resolve({ data: scenario.permissions?.[key] ?? false, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const ORG = '00000000-0000-0000-0000-000000000001';
const OPERATOR = '00000000-0000-0000-0000-0000000000aa';
const PATIENT = '00000000-0000-0000-0000-0000000000bb';
const OP_TOKEN = 'op-jwt-valid';

function happyScenario(): MockScenario {
  return {
    users: {
      [OP_TOKEN]: { id: OPERATOR, user_metadata: { display_name: 'Dr. Smith' } },
      '*': { id: PATIENT, user_metadata: { display_name: 'Pat Patient' } },
    },
    memberships: {
      [`${OPERATOR}::${ORG}`]: { id: 'op-mem', role_id: 'role-coach' },
      [`${PATIENT}::${ORG}`]: {
        id: 'pt-mem',
        consent_scope: {
          injections: true,
          weights: true,
          symptoms: true,
          photos: true,
          meals: true,
          workouts: true,
          supplements: true,
          mood: true,
          sleep: true,
        },
      },
    },
    permissions: {
      [`${OPERATOR}::${ORG}::patient_data.read`]: true,
      [`${OPERATOR}::${ORG}::patient_photos.read`]: true,
      [`${OPERATOR}::${ORG}::roster.read_breakdown`]: true,
    },
    tableData: {
      injections: [{ id: 'inj-1', dose_mg: 0.5, site: 'abdomen', created_at: '2026-05-13T00:00:00Z' }],
      weights: [{ id: 'w-1', weight_kg: 80.0, recorded_at: '2026-05-12T00:00:00Z' }],
      symptoms: [{ id: 'sym-1', name: 'nausea', severity: 2, recorded_at: '2026-05-12T00:00:00Z' }],
      photos: [],
      meals: [],
      workouts: [],
      supplements: [],
      mood: [],
      sleep: [],
    },
  };
}

function makeReq(opts: {
  method?: string;
  auth?: string | null;
  orgId?: string;
  patientId?: string;
} = {}): Request {
  const method = opts.method ?? 'GET';
  const orgId = opts.orgId ?? ORG;
  const patientId = opts.patientId ?? PATIENT;
  const url = `https://example.supabase.co/clinic-snapshot?org_id=${orgId}&patient_id=${patientId}`;
  const headers: Record<string, string> = {};
  if (opts.auth !== null) {
    headers['Authorization'] = opts.auth ?? `Bearer ${OP_TOKEN}`;
  }
  return new Request(url, { method, headers });
}

// ─── Behavior 1: no JWT → 401 ────────────────────────────────────────────────

Deno.test('clinic-snapshot: 401 missing_jwt when Authorization header is absent', async () => {
  const admin = buildMockAdmin(happyScenario());
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq({ auth: null }), { admin: admin as any });
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'missing_jwt');
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

// ─── Behavior 2: invalid JWT → 401 ─────────────────────────────────────────

Deno.test('clinic-snapshot: 401 invalid_jwt when token does not resolve to a user', async () => {
  const admin = buildMockAdmin({ users: {} });
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq({ auth: 'Bearer garbage-token' }), { admin: admin as any });
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'invalid_jwt');
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

// ─── Behavior 3: valid JWT but no membership → 403 ──────────────────────────

Deno.test('clinic-snapshot: 403 not_member when operator has no active membership', async () => {
  const scenario = happyScenario();
  delete scenario.memberships![`${OPERATOR}::${ORG}`];
  const admin = buildMockAdmin(scenario);
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq(), { admin: admin as any });
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, 'not_member');
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

// ─── Behavior 4: revoked membership → 403 not_member ────────────────────────
// Revoked membership is emulated by removing the row from the mock (partial-index
// semantics: .is('revoked_at', null) returns nothing for revoked rows).

Deno.test('clinic-snapshot: 403 not_member when operator membership is revoked', async () => {
  const scenario = happyScenario();
  // Emulate revoked: row absent from the .is('revoked_at', null) partial-index query
  delete scenario.memberships![`${OPERATOR}::${ORG}`];
  const admin = buildMockAdmin(scenario);
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq(), { admin: admin as any });
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, 'not_member');
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

// ─── Behavior 5: insufficient permission → 403 ──────────────────────────────

Deno.test('clinic-snapshot: 403 insufficient_permission when role lacks patient_data.read', async () => {
  const scenario = happyScenario();
  scenario.permissions = {}; // has_permission returns false for everything
  const admin = buildMockAdmin(scenario);
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq(), { admin: admin as any });
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, 'insufficient_permission');
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

// ─── Behavior 6: happy path 200 ─────────────────────────────────────────────

Deno.test('clinic-snapshot: 200 happy path returns SnapshotData shape with clinic fields', async () => {
  const admin = buildMockAdmin(happyScenario());
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq(), { admin: admin as any });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');

  // Must have the clinic-specific fields
  assertEquals(body.viewer_context, 'clinic');
  assertEquals(body.org_id, ORG);
  assertExists(body.permission_map, 'response must have permission_map');
  assertExists(body.consent_scope, 'response must have consent_scope');
  assertEquals(body.patient_user_id, PATIENT);

  // ai_history MUST NOT be present (T-10-04-04)
  assert(!('ai_history' in body), 'ai_history must NOT be in response body (T-10-04-04)');

  // Data arrays present
  assertExists(body.injections);
  assertExists(body.weights);
  assertExists(body.symptoms);
  assertExists(body.photos);
});

// ─── Behavior 7: consent_scope.photos=false → photos absent/empty ───────────

Deno.test('clinic-snapshot: photos: [] + canViewPhotos=false when consent_scope.photos=false', async () => {
  const scenario = happyScenario();
  scenario.memberships![`${PATIENT}::${ORG}`] = {
    id: 'pt-mem',
    consent_scope: {
      injections: true,
      weights: true,
      symptoms: false,
      photos: false, // consent withdrawn
      meals: false,
      workouts: false,
      supplements: false,
      mood: false,
      sleep: false,
    },
  };
  const admin = buildMockAdmin(scenario);
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq(), { admin: admin as any });
  assertEquals(res.status, 200);
  const body = await res.json();

  // canViewPhotos must be false (consent gate overrides role permission)
  assertEquals(
    body.permission_map.canViewPhotos,
    false,
    'canViewPhotos must be false when consent_scope.photos=false',
  );
  // photos array must be empty (not absent — empty is the canonical form per plan)
  assertEquals(
    Array.isArray(body.photos) && body.photos.length === 0,
    true,
    'photos must be [] when consent_scope.photos=false',
  );
  // symptoms also excluded
  assertEquals(body.permission_map.canViewSymptoms, false);
});

// ─── Behavior 8: permission_map.canViewPhotos reflects both role + consent ────

Deno.test('clinic-snapshot: canViewPhotos=true when operator has photos.read AND consent=true', async () => {
  const scenario = happyScenario();
  // Operator has patient_photos.read (already in happyScenario)
  const admin = buildMockAdmin(scenario);
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq(), { admin: admin as any });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(
    body.permission_map.canViewPhotos,
    true,
    'canViewPhotos=true when operator has patient_photos.read AND consent.photos=true',
  );
});

Deno.test('clinic-snapshot: canViewPhotos=false when operator lacks patient_photos.read', async () => {
  const scenario = happyScenario();
  // Remove patient_photos.read from operator
  scenario.permissions = {
    [`${OPERATOR}::${ORG}::patient_data.read`]: true,
    [`${OPERATOR}::${ORG}::patient_photos.read`]: false, // no photos permission
    [`${OPERATOR}::${ORG}::roster.read_breakdown`]: false,
  };
  const admin = buildMockAdmin(scenario);
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq(), { admin: admin as any });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(
    body.permission_map.canViewPhotos,
    false,
    'canViewPhotos=false when operator lacks patient_photos.read',
  );
});

// ─── Behavior 9: Cache-Control: private, no-store on ALL status codes ────────

Deno.test('clinic-snapshot: Cache-Control: private, no-store on OPTIONS preflight', async () => {
  const admin = buildMockAdmin(happyScenario());
  const req = new Request(`https://example.supabase.co/clinic-snapshot?org_id=${ORG}&patient_id=${PATIENT}`, {
    method: 'OPTIONS',
  });
  // deno-lint-ignore no-explicit-any
  const res = await handle(req, { admin: admin as any });
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
  await res.text(); // drain
});

Deno.test('clinic-snapshot: Cache-Control on 400 (missing params)', async () => {
  const admin = buildMockAdmin(happyScenario());
  const req = new Request('https://example.supabase.co/clinic-snapshot', {
    method: 'GET',
    headers: { Authorization: `Bearer ${OP_TOKEN}` },
  });
  // deno-lint-ignore no-explicit-any
  const res = await handle(req, { admin: admin as any });
  assertEquals(res.status, 400);
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
  await res.json();
});

// ─── Behavior 10: ai_history never in response body ──────────────────────────

Deno.test('clinic-snapshot: ai_history is structurally excluded from the 200 response', async () => {
  const scenario = happyScenario();
  // Inject ai_history into the tableData to simulate if the SELECT accidentally included it
  scenario.tableData!['ai_messages'] = [{ id: 'ai-1', content: 'secret', created_at: '2026-05-13T00:00:00Z' }];
  const admin = buildMockAdmin(scenario);
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq(), { admin: admin as any });
  assertEquals(res.status, 200);
  const body = await res.json();
  assert(!('ai_history' in body), 'ai_history MUST NOT be in the response body (T-10-04-04 structural exclusion)');
  assert(!('ai_messages' in body), 'ai_messages MUST NOT be in the response body (T-10-04-04 structural exclusion)');
});

// ─── Static check: BASE_RESPONSE_HEADERS includes Cache-Control ─────────────

Deno.test('clinic-snapshot cors BASE_RESPONSE_HEADERS contains Cache-Control: private, no-store', () => {
  assertEquals(BASE_RESPONSE_HEADERS['Cache-Control'], 'private, no-store');
});

// ─── Patient not member → 403 ────────────────────────────────────────────────

Deno.test('clinic-snapshot: 403 patient_not_member when patient has no active membership', async () => {
  const scenario = happyScenario();
  delete scenario.memberships![`${PATIENT}::${ORG}`];
  const admin = buildMockAdmin(scenario);
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq(), { admin: admin as any });
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, 'patient_not_member');
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});
