/**
 * Phase 10 Plan 10-10 — Deno unit tests for the `bulk-csv-export` Edge Function.
 *
 * Strategy mirrors `clinic-snapshot/index.test.ts`: seed env BEFORE importing
 * `index.ts` so module-level admin client construction succeeds, then invoke
 * the exported `handle(req, { admin })` with a hand-rolled mock SupabaseClient.
 *
 * File suffix is `.test.ts` (NOT `-test.ts`) per memory
 * `reference_deno_test_discovery.md` so Deno's directory-walk picks it up.
 *
 * Run: `cd supabase/functions/bulk-csv-export && deno task test`
 *   or: `deno test --allow-all supabase/functions/bulk-csv-export/`
 *
 * Tests cover behaviors from 10-10-PLAN.md task 1 <behavior>:
 *   Test 1 (Behavior 5): No JWT → 401 missing_jwt.
 *   Test 2: Invalid JWT → 401 invalid_jwt.
 *   Test 3: Not a member → 403 not_member.
 *   Test 4: Lacks patient_data.read → 403 insufficient_permission.
 *   Test 5: Empty patient_ids → 400 empty_patient_ids.
 *   Test 6 (Behavior 6): 3 patients all consent → CSV + text/csv + attachment.
 *   Test 7 (Behavior 7): 1 patient consent=false → absent from CSV; no audit row.
 *   Test 8 (Behavior 8): 3 patients → 3 log_bulk_export_inclusion rpc calls.
 */
import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// Seed env BEFORE importing the module.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

const { handle } = await import('./index.ts');

// ─── Constants ─────────────────────────────────────────────────────────────
const ORG_ID = '11111111-1111-1111-1111-111111111111';
const PAT_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PAT_2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PAT_3 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OP_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const VALID_TOKEN = 'valid-operator-token';

// ─── Mock infrastructure ──────────────────────────────────────────────────────
interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

interface MockScenario {
  validUser?: boolean;
  getUserError?: boolean;
  opMembership?: { id: string; role_id: string } | null;
  hasPerm?: boolean;
  orgSlug?: string;
  patientMemberships?: Array<{ user_id: string; consent_scope: Record<string, boolean> | null }>;
  symptoms?: Record<string, Array<{ logged_at: string; name: string; severity: number }>>;
}

/**
 * A universal chainable builder that resolves to `resolve` when awaited.
 * Every method on it returns `this` so any fluent chain works.
 */
// deno-lint-ignore no-explicit-any
function chainable(resolve: () => Promise<{ data: any; error: any }>): any {
  // deno-lint-ignore no-explicit-any
  const handler: any = new Proxy(
    {
      // Make it thenable so `await chainable(...)` resolves correctly
      then: (
        // deno-lint-ignore no-explicit-any
        onFulfilled?: (v: any) => any,
        // deno-lint-ignore no-explicit-any
        onRejected?: (e: any) => any,
      ) => resolve().then(onFulfilled, onRejected),
    },
    {
      get(target, prop) {
        if (prop === 'then') return target.then;
        // Every method returns a new chainable with the same resolver
        // deno-lint-ignore no-explicit-any
        return (..._args: any[]) => chainable(resolve);
      },
    },
  );
  return handler;
}

// deno-lint-ignore no-explicit-any
function buildAdmin(scenario: MockScenario, rpcs: RpcCall[]): any {
  // Track which from() call we're on so sequential calls use different resolvers
  let membershipCallIndex = 0;

  return {
    auth: {
      getUser: (token: string) => {
        if (scenario.getUserError || token !== VALID_TOKEN || !scenario.validUser) {
          return Promise.resolve({ data: { user: null }, error: new Error('invalid token') });
        }
        return Promise.resolve({
          data: { user: { id: OP_ID, email: 'op@test.com', user_metadata: {} } },
          error: null,
        });
      },
      admin: {
        listUsers: () =>
          Promise.resolve({
            data: {
              users: [
                { id: PAT_1, email: 'p1@t.com', user_metadata: { display_name: 'Alice Smith' } },
                { id: PAT_2, email: 'p2@t.com', user_metadata: { display_name: 'Bob Jones' } },
                { id: PAT_3, email: 'p3@t.com', user_metadata: { display_name: 'Carol Brown' } },
              ],
            },
            error: null,
          }),
      },
    },
    from: (table: string) => {
      const callIndex = membershipCallIndex;
      membershipCallIndex++;

      // deno-lint-ignore no-explicit-any
      const tableResolver = (): Promise<{ data: any; error: any }> => {
        if (table === 'orgs') {
          return Promise.resolve({ data: { slug: scenario.orgSlug ?? 'test-clinic' }, error: null });
        }
        if (table === 'memberships') {
          if (callIndex === 0) {
            // First memberships call: operator membership check
            const mem = scenario.opMembership;
            return Promise.resolve({
              data: mem ?? null,
              error: mem ? null : new Error('not found'),
            });
          }
          // Second memberships call: patient memberships
          return Promise.resolve({
            data: scenario.patientMemberships ?? [],
            error: null,
          });
        }
        if (table === 'symptoms') {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({ data: null, error: null });
      };

      // For symptoms table we need to capture the user_id from the eq chain
      if (table === 'symptoms') {
        // deno-lint-ignore no-explicit-any
        const sympHandler: any = new Proxy(
          {
            then: (
              // deno-lint-ignore no-explicit-any
              onFulfilled?: (v: any) => any,
              // deno-lint-ignore no-explicit-any
              onRejected?: (e: any) => any,
            ) => tableResolver().then(onFulfilled, onRejected),
          },
          {
            get(target, prop) {
              if (prop === 'then') return target.then;
              // deno-lint-ignore no-explicit-any
              return (...args: any[]) => {
                if (prop === 'eq' && args[0] === 'user_id') {
                  const uid = args[1] as string;
                  return chainable(() =>
                    Promise.resolve({
                      data: scenario.symptoms?.[uid] ?? [],
                      error: null,
                    })
                  );
                }
                return sympHandler;
              };
            },
          },
        );
        return { select: () => sympHandler };
      }

      return { select: () => chainable(tableResolver) };
    },
    rpc: (fnName: string, args: Record<string, unknown>) => {
      rpcs.push({ fn: fnName, args });
      if (fnName === 'has_permission') {
        return Promise.resolve({ data: scenario.hasPerm ?? true, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function makePostReq(body: unknown, token?: string): Request {
  return new Request('https://func.supabase.co/bulk-csv-export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

// ─── Test 1: No JWT → 401 ────────────────────────────────────────────────────
Deno.test('Test 1 (Behavior 5): No JWT → 401 missing_jwt', async () => {
  const rpcs: RpcCall[] = [];
  const admin = buildAdmin({}, rpcs);
  const req = new Request('https://func.supabase.co/bulk-csv-export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ org_id: ORG_ID, patient_ids: [PAT_1] }),
  });
  const res = await handle(req, { admin });
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'missing_jwt');
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

// ─── Test 2: Invalid JWT → 401 ───────────────────────────────────────────────
Deno.test('Test 2: Invalid JWT → 401 invalid_jwt', async () => {
  const rpcs: RpcCall[] = [];
  const admin = buildAdmin({ getUserError: true }, rpcs);
  const req = makePostReq({ org_id: ORG_ID, patient_ids: [PAT_1] }, 'garbage-token');
  const res = await handle(req, { admin });
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'invalid_jwt');
});

// ─── Test 3: Not a member → 403 ──────────────────────────────────────────────
Deno.test('Test 3: Operator not a member → 403 not_member', async () => {
  const rpcs: RpcCall[] = [];
  const admin = buildAdmin({ validUser: true, opMembership: null }, rpcs);
  const req = makePostReq({ org_id: ORG_ID, patient_ids: [PAT_1] }, VALID_TOKEN);
  const res = await handle(req, { admin });
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, 'not_member');
});

// ─── Test 4: Lacks patient_data.read → 403 ───────────────────────────────────
Deno.test('Test 4: Lacks patient_data.read → 403 insufficient_permission', async () => {
  const rpcs: RpcCall[] = [];
  const admin = buildAdmin({
    validUser: true,
    opMembership: { id: 'mem-1', role_id: 'role-1' },
    hasPerm: false,
  }, rpcs);
  const req = makePostReq({ org_id: ORG_ID, patient_ids: [PAT_1] }, VALID_TOKEN);
  const res = await handle(req, { admin });
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, 'insufficient_permission');
});

// ─── Test 5: Empty patient_ids → 400 ─────────────────────────────────────────
Deno.test('Test 5: Empty patient_ids → 400 empty_patient_ids', async () => {
  const rpcs: RpcCall[] = [];
  const admin = buildAdmin({
    validUser: true,
    opMembership: { id: 'mem-1', role_id: 'role-1' },
    hasPerm: true,
  }, rpcs);
  const req = makePostReq({ org_id: ORG_ID, patient_ids: [] }, VALID_TOKEN);
  const res = await handle(req, { admin });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'empty_patient_ids');
});

// ─── Test 6 (Behavior 6): Happy path — 3 patients all consented → CSV ────────
Deno.test('Test 6 (Behavior 6): 3 patients all consent.symptoms=true → CSV with all rows', async () => {
  const rpcs: RpcCall[] = [];
  const admin = buildAdmin({
    validUser: true,
    opMembership: { id: 'mem-1', role_id: 'role-1' },
    hasPerm: true,
    orgSlug: 'test-clinic',
    patientMemberships: [
      { user_id: PAT_1, consent_scope: { symptoms: true } },
      { user_id: PAT_2, consent_scope: { symptoms: true } },
      { user_id: PAT_3, consent_scope: { symptoms: true } },
    ],
    symptoms: {
      [PAT_1]: [{ logged_at: '2026-04-15T10:00:00Z', name: 'Nausea', severity: 3 }],
      [PAT_2]: [{ logged_at: '2026-04-16T11:00:00Z', name: 'Headache', severity: 4 }],
      [PAT_3]: [{ logged_at: '2026-04-13T08:00:00Z', name: 'Dizziness', severity: 1 }],
    },
  }, rpcs);
  const req = makePostReq({ org_id: ORG_ID, patient_ids: [PAT_1, PAT_2, PAT_3] }, VALID_TOKEN);
  const res = await handle(req, { admin });

  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Content-Type'), 'text/csv');
  const disposition = res.headers.get('Content-Disposition') ?? '';
  assertStringIncludes(disposition, 'attachment');
  assertStringIncludes(disposition, 'symptoms-test-clinic-');
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');

  const csv = await res.text();
  assertStringIncludes(csv, 'patient_display_name,date,symptom_name,severity');
  assertStringIncludes(csv, 'Nausea');
  assertStringIncludes(csv, 'Headache');
  assertStringIncludes(csv, 'Dizziness');
});

// ─── Test 7 (Behavior 7): Consent filter ──────────────────────────────────────
Deno.test('Test 7 (Behavior 7): Patient with consent.symptoms=false absent from CSV + no audit row', async () => {
  const rpcs: RpcCall[] = [];
  const admin = buildAdmin({
    validUser: true,
    opMembership: { id: 'mem-1', role_id: 'role-1' },
    hasPerm: true,
    orgSlug: 'test-clinic',
    patientMemberships: [
      { user_id: PAT_1, consent_scope: { symptoms: true } },
      { user_id: PAT_2, consent_scope: { symptoms: false } }, // NOT consented
      { user_id: PAT_3, consent_scope: { symptoms: true } },
    ],
    symptoms: {
      [PAT_1]: [{ logged_at: '2026-04-15T10:00:00Z', name: 'Nausea', severity: 3 }],
      [PAT_2]: [{ logged_at: '2026-04-16T11:00:00Z', name: 'Headache', severity: 4 }],
      [PAT_3]: [{ logged_at: '2026-04-13T08:00:00Z', name: 'Dizziness', severity: 1 }],
    },
  }, rpcs);
  const req = makePostReq({ org_id: ORG_ID, patient_ids: [PAT_1, PAT_2, PAT_3] }, VALID_TOKEN);
  const res = await handle(req, { admin });

  assertEquals(res.status, 200);
  const csv = await res.text();

  // PAT_1 and PAT_3 symptoms included
  assertStringIncludes(csv, 'Nausea');
  assertStringIncludes(csv, 'Dizziness');

  // PAT_2 Headache must NOT appear (consent=false)
  assertEquals(csv.includes('Headache'), false);

  // Audit RPC must NOT have been called for PAT_2
  const auditForPat2 = rpcs.filter(
    (r) => r.fn === 'log_bulk_export_inclusion' && r.args.p_target_user_id === PAT_2,
  );
  assertEquals(auditForPat2.length, 0);
});

// ─── Test 8 (Behavior 8): Per-patient audit — 3 patients → 3 rpc calls ───────
Deno.test('Test 8 (Behavior 8): 3 included patients → 3 log_bulk_export_inclusion calls', async () => {
  const rpcs: RpcCall[] = [];
  const admin = buildAdmin({
    validUser: true,
    opMembership: { id: 'mem-1', role_id: 'role-1' },
    hasPerm: true,
    orgSlug: 'test-clinic',
    patientMemberships: [
      { user_id: PAT_1, consent_scope: { symptoms: true } },
      { user_id: PAT_2, consent_scope: { symptoms: true } },
      { user_id: PAT_3, consent_scope: { symptoms: true } },
    ],
    symptoms: {
      [PAT_1]: [{ logged_at: '2026-04-15T10:00:00Z', name: 'Nausea', severity: 3 }],
      [PAT_2]: [],
      [PAT_3]: [],
    },
  }, rpcs);
  const req = makePostReq({ org_id: ORG_ID, patient_ids: [PAT_1, PAT_2, PAT_3] }, VALID_TOKEN);
  const res = await handle(req, { admin });

  assertEquals(res.status, 200);

  const auditCalls = rpcs.filter((r) => r.fn === 'log_bulk_export_inclusion');
  assertEquals(auditCalls.length, 3);

  for (const call of auditCalls) {
    assertEquals(call.args.p_export_type, 'csv');
    assertEquals(call.args.p_org_id, ORG_ID);
  }

  const auditIds = new Set(auditCalls.map((c) => c.args.p_target_user_id));
  assertEquals(auditIds.has(PAT_1), true);
  assertEquals(auditIds.has(PAT_2), true);
  assertEquals(auditIds.has(PAT_3), true);
});
