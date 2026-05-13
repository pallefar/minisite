/**
 * Phase 10 Plan 10-09 — Deno unit tests for the `patient-activity` Edge Function.
 *
 * Strategy mirrors `clinic-snapshot/index.test.ts`: seed env BEFORE importing
 * `index.ts` so module-level admin client construction succeeds, then invoke
 * the exported `handle(req, { admin })` with a hand-rolled mock SupabaseClient.
 *
 * File suffix is `.test.ts` (NOT `-test.ts`) per memory
 * `reference_deno_test_discovery.md` so Deno's directory-walk picks it up.
 *
 * Run: `cd supabase/functions/patient-activity && deno task test`
 *   or
 *      `deno test --allow-env supabase/functions/patient-activity/`
 *
 * Tests cover 9 behaviors from 10-09-PLAN.md task 1 <behavior>:
 *   1. No JWT → 401 + Cache-Control: private, no-store.
 *   2. Valid JWT, missing org_id → 400.
 *   3. Valid patient JWT, querying own audit rows for own org → returns rows;
 *      each enriched with actor_display_name; rows where target_user_id != patient absent.
 *   4. Cross-tenant: Patient B's JWT querying Patient A's org_id → 0 rows.
 *   5. tab=operator_views → only section_view / patient_data.read / patient_photos.read / clinic_snapshot_loaded rows.
 *   6. tab=ranking_events → only rank_threshold_crossed rows.
 *   7. Actor display fallback: actor with null display_name → actor_display_name='a clinic member'.
 *   8. Pagination: offset=25 returns next page; has_more=true when more exist.
 *   9. Cache-Control: private, no-store on every status code.
 */

import { assert, assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { BASE_RESPONSE_HEADERS } from './cors.ts';

// Seed env BEFORE importing the module.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

const { handle } = await import('./index.ts');

// ─── Fixture UUIDs ────────────────────────────────────────────────────────────

const ORG_A = '00000000-0000-0000-0000-000000000001';
const ORG_B = '00000000-0000-0000-0000-000000000002';
const PATIENT_A = '00000000-0000-0000-0000-0000000000aa';
const PATIENT_B = '00000000-0000-0000-0000-0000000000bb';
const ACTOR_1 = '00000000-0000-0000-0000-000000000011';
const ACTOR_2 = '00000000-0000-0000-0000-000000000012';
const TOKEN_A = 'patient-a-jwt';
const TOKEN_B = 'patient-b-jwt';

// ─── Mock factory ─────────────────────────────────────────────────────────────

interface MockAuditRow {
  id: number;
  timestamp: string;
  action: string;
  actor_type: string | null;
  org_id: string | null;
  target_user_id: string | null;
  metadata: Record<string, unknown> | null;
  user_id: string | null;
}

interface MockScenario {
  /** Token → patient user mapping. */
  patients?: Record<string, { id: string; user_metadata?: Record<string, string> } | null>;
  /** Actor user metadata by actor id. */
  actors?: Record<string, { user_metadata?: Record<string, string> } | null>;
  /** audit_logs rows keyed by `${target_user_id}::${org_id}`. */
  auditRows?: Record<string, MockAuditRow[]>;
  /** Total count to simulate has_more scenarios. */
  totalCount?: number;
}

function buildMock(scenario: MockScenario) {
  const makeQueryBuilder = (opts: {
    targetUserId?: string;
    orgId?: string;
    tab?: string;
    offset?: number;
    limit?: number;
  }) => {
    const key = `${opts.targetUserId ?? ''}::${opts.orgId ?? ''}`;
    let rows = scenario.auditRows?.[key] ?? [];

    // Apply tab filter
    if (opts.tab === 'operator_views') {
      const opActions = ['section_view', 'patient_data.read', 'patient_photos.read', 'clinic_snapshot_loaded'];
      rows = rows.filter((r) => opActions.includes(r.action));
    } else if (opts.tab === 'ranking_events') {
      rows = rows.filter((r) => r.action === 'rank_threshold_crossed');
    }

    const total = scenario.totalCount ?? rows.length;
    const start = opts.offset ?? 0;
    const end = start + (opts.limit ?? 25);
    const page = rows.slice(start, end);

    return {
      data: page,
      error: null,
      count: total,
    };
  };

  // Track query state
  let currentTargetUserId: string | undefined;
  let currentOrgId: string | undefined;
  let currentTab: string | undefined;
  let currentOffset: number | undefined;
  let currentLimit: number | undefined;
  let currentInActions: string[] | undefined;

  const builder = {
    select: (_cols: string, _opts?: unknown) => builder,
    eq: (col: string, val: unknown) => {
      if (col === 'target_user_id') currentTargetUserId = val as string;
      if (col === 'org_id') currentOrgId = val as string;
      if (col === 'user_id') { /* ignore */ }
      return builder;
    },
    is: (_col: string, _val: unknown) => builder,
    in: (col: string, vals: string[]) => {
      if (col === 'action') currentInActions = vals;
      if (col === 'user_id') { /* ignore */ }
      return builder;
    },
    order: (_col: string, _opts?: unknown) => builder,
    range: (from: number, to: number) => {
      currentOffset = from;
      currentLimit = to - from + 1;
      return builder;
    },
    // For memberships JOIN roles query
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (resolve: (v: { data: MockAuditRow[]; error: null; count: number }) => void) => {
      const tabFilter = currentInActions?.includes('rank_threshold_crossed')
        ? 'ranking_events'
        : currentInActions?.includes('section_view')
          ? 'operator_views'
          : 'all';
      const result = makeQueryBuilder({
        targetUserId: currentTargetUserId,
        orgId: currentOrgId,
        tab: tabFilter,
        offset: currentOffset,
        limit: currentLimit,
      });
      resolve(result);
    },
  };

  const membershipBuilder = {
    select: (_cols: string) => membershipBuilder,
    eq: (_col: string, _val: unknown) => membershipBuilder,
    in: (_col: string, _vals: string[]) => membershipBuilder,
    is: (_col: string, _val: unknown) => membershipBuilder,
    then: (
      resolve: (v: { data: Array<{ user_id: string; roles: { name: string } | null }>; error: null }) => void,
    ) => {
      resolve({ data: [], error: null });
    },
  };

  const mockAdmin = {
    auth: {
      getUser: (token: string) => {
        const patient = scenario.patients?.[token] ?? null;
        if (!patient) {
          return Promise.resolve({ data: { user: null }, error: new Error('bad jwt') });
        }
        return Promise.resolve({ data: { user: patient }, error: null });
      },
      admin: {
        getUserById: (id: string) => {
          const actor = scenario.actors?.[id] ?? null;
          return Promise.resolve({
            data: { user: actor ? { user_metadata: actor.user_metadata ?? {} } : null },
            error: null,
          });
        },
      },
    },
    from: (table: string) => {
      if (table === 'memberships') return membershipBuilder;
      // Reset state for each query chain
      currentTargetUserId = undefined;
      currentOrgId = undefined;
      currentTab = undefined;
      currentOffset = undefined;
      currentLimit = undefined;
      currentInActions = undefined;
      return builder;
    },
  };

  return mockAdmin;
}

// ─── Request builder ──────────────────────────────────────────────────────────

function makeReq(opts: {
  auth?: string | null;
  orgId?: string | null;
  tab?: string;
  offset?: number;
  limit?: number;
} = {}): Request {
  const params = new URLSearchParams();
  if (opts.orgId !== null) {
    params.set('org_id', opts.orgId ?? ORG_A);
  }
  if (opts.tab) params.set('tab', opts.tab);
  if (opts.offset !== undefined) params.set('offset', String(opts.offset));
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));

  const url = `https://example.supabase.co/patient-activity?${params.toString()}`;
  const headers: Record<string, string> = {};
  if (opts.auth !== null) {
    headers['Authorization'] = opts.auth ?? `Bearer ${TOKEN_A}`;
  }
  return new Request(url, { method: 'GET', headers });
}

function happyScenario(): MockScenario {
  return {
    patients: {
      [TOKEN_A]: { id: PATIENT_A, user_metadata: { display_name: 'Patient A' } },
      [TOKEN_B]: { id: PATIENT_B, user_metadata: { display_name: 'Patient B' } },
    },
    actors: {
      [ACTOR_1]: { user_metadata: { display_name: 'Dr. Smith' } },
      [ACTOR_2]: { user_metadata: { display_name: 'Nurse Jones' } },
    },
    auditRows: {
      [`${PATIENT_A}::${ORG_A}`]: [
        {
          id: 1,
          timestamp: '2026-05-13T09:00:00Z',
          action: 'section_view',
          actor_type: 'org_operator',
          org_id: ORG_A,
          target_user_id: PATIENT_A,
          metadata: { section: 'injections' },
          user_id: ACTOR_1,
        },
        {
          id: 2,
          timestamp: '2026-05-13T08:00:00Z',
          action: 'rank_threshold_crossed',
          actor_type: 'org_system',
          org_id: ORG_A,
          target_user_id: PATIENT_A,
          metadata: {
            score: 75,
            breakdown_snapshot: { missed_dose: 30, symptom_severity: 25, weight_trend: 20 },
            threshold_crossed: 70,
            direction: 'up',
          },
          user_id: null,
        },
      ],
      // Patient B has NO rows in ORG_A (cross-tenant isolation)
      [`${PATIENT_B}::${ORG_A}`]: [],
      [`${PATIENT_A}::${ORG_B}`]: [],
    },
  };
}

// ─── Test 1: No JWT → 401 ─────────────────────────────────────────────────────

Deno.test('patient-activity: 401 missing_jwt when Authorization header absent', async () => {
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq({ auth: null }), { admin: buildMock(happyScenario()) as any });
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'missing_jwt');
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

// ─── Test 2: Valid JWT, missing org_id → 400 ─────────────────────────────────

Deno.test('patient-activity: 400 missing_or_invalid_org_id when org_id absent', async () => {
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq({ orgId: null }), { admin: buildMock(happyScenario()) as any });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'missing_or_invalid_org_id');
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

// ─── Test 3: Valid JWT, own org → returns enriched rows, others absent ────────

Deno.test('patient-activity: 200 returns own audit rows enriched with actor_display_name', async () => {
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq(), { admin: buildMock(happyScenario()) as any });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');

  assertExists(body.rows);
  assert(Array.isArray(body.rows), 'rows must be array');
  assert(body.rows.length > 0, 'should return rows for own org');

  // All rows must belong to Patient A
  for (const row of body.rows) {
    assertEquals(row.target_user_id, PATIENT_A, 'rows must be scoped to patient A');
  }

  // Rows for Patient B must not appear (cross-tenant isolation)
  const patientBRows = body.rows.filter((r: { target_user_id: string }) => r.target_user_id === PATIENT_B);
  assertEquals(patientBRows.length, 0, 'Patient B rows must not appear in Patient A response');

  // Enriched fields must be present
  for (const row of body.rows) {
    assertExists(row.actor_display_name, 'each row must have actor_display_name');
    assert(typeof row.actor_display_name === 'string');
  }
});

// ─── Test 4: Cross-tenant — Patient B querying Patient A's org → 0 rows ──────

Deno.test('patient-activity: cross-tenant isolation — Patient B querying ORG_A returns 0 rows', async () => {
  const scenario = happyScenario();
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq({ auth: `Bearer ${TOKEN_B}` }), { admin: buildMock(scenario) as any });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.rows.length, 0, 'Patient B must get 0 rows from Patient A org (cross-tenant isolation)');
  assertEquals(body.has_more, false);
});

// ─── Test 5: tab=operator_views → only operator_view actions ─────────────────

Deno.test('patient-activity: tab=operator_views returns only operator-view actions', async () => {
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq({ tab: 'operator_views' }), { admin: buildMock(happyScenario()) as any });
  assertEquals(res.status, 200);
  const body = await res.json();

  const allowedActions = ['section_view', 'patient_data.read', 'patient_photos.read', 'clinic_snapshot_loaded'];
  for (const row of body.rows) {
    assert(
      allowedActions.includes(row.action),
      `action '${row.action}' must be an operator-view action`,
    );
  }

  // rank_threshold_crossed must NOT appear
  const rankRows = body.rows.filter((r: { action: string }) => r.action === 'rank_threshold_crossed');
  assertEquals(rankRows.length, 0, 'rank_threshold_crossed must not appear in operator_views tab');
});

// ─── Test 6: tab=ranking_events → only rank_threshold_crossed ────────────────

Deno.test('patient-activity: tab=ranking_events returns only rank_threshold_crossed rows', async () => {
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq({ tab: 'ranking_events' }), { admin: buildMock(happyScenario()) as any });
  assertEquals(res.status, 200);
  const body = await res.json();

  for (const row of body.rows) {
    assertEquals(
      row.action,
      'rank_threshold_crossed',
      'only rank_threshold_crossed must appear in ranking_events tab',
    );
  }

  // section_view must NOT appear
  const viewRows = body.rows.filter((r: { action: string }) => r.action === 'section_view');
  assertEquals(viewRows.length, 0, 'section_view must not appear in ranking_events tab');
});

// ─── Test 7: Actor display fallback — null display_name → 'a clinic member' ──

Deno.test('patient-activity: actor with null display_name falls back to "a clinic member"', async () => {
  const scenario = happyScenario();
  // Override actor 1 to have no display_name
  scenario.actors = {
    [ACTOR_1]: { user_metadata: {} }, // no display_name
    [ACTOR_2]: { user_metadata: { display_name: 'Nurse Jones' } },
  };
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq(), { admin: buildMock(scenario) as any });
  assertEquals(res.status, 200);
  const body = await res.json();

  // Find rows with ACTOR_1
  const actor1Rows = body.rows.filter((r: { user_id: string | null }) => r.user_id === ACTOR_1);
  assert(actor1Rows.length > 0, 'should have rows from ACTOR_1');
  for (const row of actor1Rows) {
    assertEquals(
      row.actor_display_name,
      'a clinic member',
      'empty display_name should fall back to "a clinic member"',
    );
  }
});

// ─── Test 8: Pagination — offset=25 returns next page; has_more when total > offset+limit ──

Deno.test('patient-activity: pagination — offset=25 returns next page; has_more=true when applicable', async () => {
  const scenario = happyScenario();
  // Seed 30 rows to test pagination
  const manyRows: MockAuditRow[] = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    timestamp: new Date(Date.now() - i * 60000).toISOString(),
    action: 'section_view',
    actor_type: 'org_operator',
    org_id: ORG_A,
    target_user_id: PATIENT_A,
    metadata: { section: 'injections' },
    user_id: ACTOR_1,
  }));
  scenario.auditRows![`${PATIENT_A}::${ORG_A}`] = manyRows;
  scenario.totalCount = 30;

  // First page
  // deno-lint-ignore no-explicit-any
  const res1 = await handle(makeReq({ offset: 0, limit: 25 }), { admin: buildMock(scenario) as any });
  assertEquals(res1.status, 200);
  const body1 = await res1.json();
  assertEquals(body1.rows.length, 25);
  assertEquals(body1.has_more, true, 'has_more must be true when 30 total, showing offset=0 limit=25');

  // Second page (offset=25)
  // deno-lint-ignore no-explicit-any
  const res2 = await handle(makeReq({ offset: 25, limit: 25 }), { admin: buildMock(scenario) as any });
  assertEquals(res2.status, 200);
  const body2 = await res2.json();
  assertEquals(body2.rows.length, 5, 'second page should return remaining 5 rows');
  assertEquals(body2.has_more, false, 'has_more must be false on last page');
});

// ─── Test 9: Cache-Control on every status code ───────────────────────────────

Deno.test('patient-activity: Cache-Control: private, no-store on 401 (no JWT)', async () => {
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq({ auth: null }), { admin: buildMock(happyScenario()) as any });
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
  await res.json();
});

Deno.test('patient-activity: Cache-Control: private, no-store on 400 (bad org_id)', async () => {
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq({ orgId: null }), { admin: buildMock(happyScenario()) as any });
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
  await res.json();
});

Deno.test('patient-activity: Cache-Control: private, no-store on OPTIONS preflight', async () => {
  const req = new Request('https://example.supabase.co/patient-activity', { method: 'OPTIONS' });
  // deno-lint-ignore no-explicit-any
  const res = await handle(req, { admin: buildMock(happyScenario()) as any });
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
  await res.text();
});

Deno.test('patient-activity: Cache-Control: private, no-store on 200 happy path', async () => {
  // deno-lint-ignore no-explicit-any
  const res = await handle(makeReq(), { admin: buildMock(happyScenario()) as any });
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
  await res.json();
});

// ─── Static check: BASE_RESPONSE_HEADERS ─────────────────────────────────────

Deno.test('patient-activity cors BASE_RESPONSE_HEADERS has Cache-Control: private, no-store', () => {
  assertEquals(BASE_RESPONSE_HEADERS['Cache-Control'], 'private, no-store');
});
