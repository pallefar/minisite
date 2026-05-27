/**
 * handler.test.ts — Deno tests for demo-org-purge handler.
 *
 * Phase 68 Plan 68-02 (LAND-06).
 *
 * Behaviour cases:
 *  1. Happy path: 3 demo orgs all >7d old, none extended → purges 3
 *  2. Extended demo not purged: 1 org >7d old but demo_extended_until in
 *     the future → not purged; only the others go
 *  3. dry_run=true → returns candidate list but does NOT delete
 *  4. Slack alert fires when purged_count > 10
 *  5. Missing/invalid bearer → 401
 *  6. GET /healthz → 200 { ok:true, fn:'demo-org-purge' }
 *  7. Bare DELETE on organizations runs AFTER child-table clears (Phase 28
 *     RESTRICT FK workaround per file header)
 */

import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handle } from '../handler.ts';
import type { DemoOrgPurgeDeps } from '../handler.ts';

const MOCK_SERVICE_ROLE_KEY = 'test-service-role-key';
const FIXED_NOW = new Date('2026-06-01T03:00:00.000Z');
const nowProvider = () => FIXED_NOW;

// ── Mock Supabase client ─────────────────────────────────────────────────────

interface MockOrg {
  id: string;
  is_demo: boolean;
  created_at: string;
  demo_extended_until: string | null;
}

interface DeleteCall {
  table: string;
  org_id?: string;
  id?: string;
  is_demo?: boolean;
}

function buildMockSupabaseClient(opts: {
  orgs: MockOrg[];
  failTable?: string; // simulate per-table delete failure
}) {
  const { orgs, failTable } = opts;
  const deleteCalls: DeleteCall[] = [];
  // Track which orgs have been deleted so the candidate query can reflect state
  // (not strictly needed for any current test but keeps the mock honest).
  const deletedOrgIds = new Set<string>();

  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  const fromImpl = (table: string) => {
    if (table === 'organizations') {
      return {
        // SELECT pipeline used by the candidate query.
        select: (_cols: string) => {
          const builder = {
            _filters: {
              is_demo: undefined as boolean | undefined,
              createdBefore: undefined as string | undefined,
              extendedClause: undefined as string | undefined,
            },
            eq(col: string, val: unknown) {
              if (col === 'is_demo') this._filters.is_demo = val as boolean;
              return this;
            },
            lt(col: string, val: string) {
              if (col === 'created_at') this._filters.createdBefore = val;
              return this;
            },
            or(clause: string) {
              this._filters.extendedClause = clause;
              return this;
            },
            // Make the builder awaitable so `await supabase.from(...).select(...).eq(...).lt(...).or(...)`
            // resolves to { data, error } the way @supabase/supabase-js does.
            then(
              onFulfilled: (v: { data: MockOrg[]; error: null }) => unknown,
              onRejected?: (e: unknown) => unknown,
            ) {
              try {
                const filtered = orgs.filter((o) => {
                  if (deletedOrgIds.has(o.id)) return false;
                  if (this._filters.is_demo !== undefined && o.is_demo !== this._filters.is_demo) return false;
                  if (this._filters.createdBefore) {
                    if (!(o.created_at < this._filters.createdBefore)) return false;
                  }
                  // Mirror the OR clause: demo_extended_until IS NULL OR demo_extended_until < now
                  if (o.demo_extended_until !== null) {
                    const nowIso = FIXED_NOW.toISOString();
                    if (!(o.demo_extended_until < nowIso)) return false;
                  }
                  return true;
                });
                return Promise.resolve({ data: filtered, error: null }).then(onFulfilled, onRejected);
              } catch (e) {
                if (onRejected) return Promise.resolve(onRejected(e));
                throw e;
              }
            },
          };
          return builder;
        },
        // DELETE pipeline used to drop the org row.
        delete: () => {
          const state: { id?: string; is_demo?: boolean } = {};
          const builder = {
            eq(col: string, val: unknown) {
              if (col === 'id') state.id = val as string;
              if (col === 'is_demo') state.is_demo = val as boolean;
              return this;
            },
            then(
              onFulfilled: (v: { data: null; error: null | { message: string } }) => unknown,
              onRejected?: (e: unknown) => unknown,
            ) {
              deleteCalls.push({ table: 'organizations', id: state.id, is_demo: state.is_demo });
              if (failTable === 'organizations') {
                return Promise.resolve({ data: null, error: { message: 'simulated org delete failure' } }).then(
                  onFulfilled,
                  onRejected,
                );
              }
              if (state.id) deletedOrgIds.add(state.id);
              return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
            },
          };
          return builder;
        },
      };
    }

    // Child tables: support .delete().eq('org_id', orgId)
    return {
      delete: () => {
        const state: { org_id?: string } = {};
        const builder = {
          eq(col: string, val: unknown) {
            if (col === 'org_id') state.org_id = val as string;
            return this;
          },
          then(
            onFulfilled: (v: { data: null; error: null | { message: string } }) => unknown,
            onRejected?: (e: unknown) => unknown,
          ) {
            deleteCalls.push({ table, org_id: state.org_id });
            if (failTable === table) {
              return Promise.resolve({ data: null, error: { message: `simulated ${table} delete failure` } }).then(
                onFulfilled,
                onRejected,
              );
            }
            return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
          },
        };
        return builder;
      },
    };
  };

  const mockClient = { from: fromImpl };

  return {
    client: mockClient as unknown as DemoOrgPurgeDeps['supabaseServiceClient'],
    deleteCalls,
  };
}

function buildDeps(overrides: {
  orgs?: MockOrg[];
  failTable?: string;
  slackAlert?: DemoOrgPurgeDeps['slackAlert'];
} = {}): { deps: DemoOrgPurgeDeps; deleteCalls: DeleteCall[] } {
  const { orgs = [], failTable, slackAlert } = overrides;
  const { client, deleteCalls } = buildMockSupabaseClient({ orgs, failTable });

  return {
    deps: {
      supabaseServiceClient: client,
      serviceRoleKey: MOCK_SERVICE_ROLE_KEY,
      nowProvider,
      slackAlert: slackAlert ?? (async () => {}),
    },
    deleteCalls,
  };
}

function buildPostRequest(bearer?: string, body?: unknown): Request {
  return new Request('https://test.supabase.co/functions/v1/demo-org-purge', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(bearer !== undefined ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : '',
  });
}

// Helper: produce a created_at N days before FIXED_NOW.
function daysAgo(n: number): string {
  return new Date(FIXED_NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

// ── Test 1: Happy path — 3 expired orgs, none extended → purges 3 ───────────

Deno.test('Test 1: 3 expired demo orgs, none extended → purges 3', async () => {
  const orgs: MockOrg[] = [
    { id: 'org-a', is_demo: true, created_at: daysAgo(10), demo_extended_until: null },
    { id: 'org-b', is_demo: true, created_at: daysAgo(8), demo_extended_until: null },
    { id: 'org-c', is_demo: true, created_at: daysAgo(14), demo_extended_until: null },
  ];
  const { deps, deleteCalls } = buildDeps({ orgs });

  const res = await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY, {}), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as {
    purged_count: number;
    purged_org_ids: string[];
    dry_run: boolean;
  };
  assertEquals(body.purged_count, 3);
  assertEquals(body.dry_run, false);
  assertEquals(new Set(body.purged_org_ids), new Set(['org-a', 'org-b', 'org-c']));

  // Sanity: organizations.delete called once per org, AFTER child-table clears.
  const orgDeleteCalls = deleteCalls.filter((c) => c.table === 'organizations');
  assertEquals(orgDeleteCalls.length, 3);
  // Every org-delete enforces is_demo=true (belt-and-braces).
  for (const c of orgDeleteCalls) assertEquals(c.is_demo, true);
});

// ── Test 2: Extended demo NOT purged ────────────────────────────────────────

Deno.test('Test 2: demo_extended_until in future → org skipped', async () => {
  const futureExt = new Date(FIXED_NOW.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const orgs: MockOrg[] = [
    { id: 'org-expired', is_demo: true, created_at: daysAgo(10), demo_extended_until: null },
    { id: 'org-extended', is_demo: true, created_at: daysAgo(10), demo_extended_until: futureExt },
  ];
  const { deps } = buildDeps({ orgs });

  const res = await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY, {}), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { purged_count: number; purged_org_ids: string[] };
  assertEquals(body.purged_count, 1);
  assertEquals(body.purged_org_ids, ['org-expired']);
});

// ── Test 2b: Non-demo org never purged even if old ──────────────────────────

Deno.test('Test 2b: is_demo=false org → never purged', async () => {
  const orgs: MockOrg[] = [
    { id: 'org-real', is_demo: false, created_at: daysAgo(30), demo_extended_until: null },
    { id: 'org-demo', is_demo: true, created_at: daysAgo(8), demo_extended_until: null },
  ];
  const { deps, deleteCalls } = buildDeps({ orgs });

  const res = await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY, {}), deps);
  const body = await res.json() as { purged_org_ids: string[] };
  assertEquals(body.purged_org_ids, ['org-demo']);
  // Defensive: org-real is_demo=false should never even appear in candidates.
  const realOrgTouched = deleteCalls.some(
    (c) => c.table === 'organizations' && c.id === 'org-real',
  );
  assertEquals(realOrgTouched, false);
});

// ── Test 3: dry_run=true → counts but no deletes ────────────────────────────

Deno.test('Test 3: dry_run=true → returns count, no deletes performed', async () => {
  const orgs: MockOrg[] = [
    { id: 'org-1', is_demo: true, created_at: daysAgo(10), demo_extended_until: null },
    { id: 'org-2', is_demo: true, created_at: daysAgo(20), demo_extended_until: null },
  ];
  const { deps, deleteCalls } = buildDeps({ orgs });

  const res = await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY, { dry_run: true }), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as {
    purged_count: number;
    purged_org_ids: string[];
    dry_run: boolean;
  };
  assertEquals(body.purged_count, 2);
  assertEquals(body.dry_run, true);
  assertEquals(new Set(body.purged_org_ids), new Set(['org-1', 'org-2']));

  // No delete calls were issued — that's the whole point of dry-run.
  assertEquals(deleteCalls.length, 0);
});

// ── Test 4: Slack alert fires when purged_count > 10 ────────────────────────

Deno.test('Test 4: Slack alert fires when >10 orgs purged in one run', async () => {
  // Build 11 expired demo orgs.
  const orgs: MockOrg[] = [];
  for (let i = 0; i < 11; i++) {
    orgs.push({
      id: `bulk-${i}`,
      is_demo: true,
      created_at: daysAgo(10 + i),
      demo_extended_until: null,
    });
  }
  let slackCalled = false;
  let slackChannel = '';
  let slackSeverity = '';

  const { deps } = buildDeps({
    orgs,
    slackAlert: async (channel, payload) => {
      slackCalled = true;
      slackChannel = channel;
      slackSeverity = payload.severity;
    },
  });

  const res = await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY, {}), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { purged_count: number };
  assertEquals(body.purged_count, 11);

  // Allow the void Slack promise to settle.
  await new Promise((r) => setTimeout(r, 0));
  assert(slackCalled, 'Slack alert should have been called for >10 purges');
  assertEquals(slackChannel, 'cost');
  assertEquals(slackSeverity, 'P2');
});

Deno.test('Test 4b: Slack alert does NOT fire for ≤10 purges', async () => {
  const orgs: MockOrg[] = [];
  for (let i = 0; i < 5; i++) {
    orgs.push({
      id: `mod-${i}`,
      is_demo: true,
      created_at: daysAgo(10 + i),
      demo_extended_until: null,
    });
  }
  let slackCalled = false;
  const { deps } = buildDeps({
    orgs,
    slackAlert: async () => {
      slackCalled = true;
    },
  });

  await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY, {}), deps);
  await new Promise((r) => setTimeout(r, 0));
  assertEquals(slackCalled, false);
});

// ── Test 5: Missing / invalid bearer → 401 ─────────────────────────────────

Deno.test('Test 5: Missing bearer → 401 unauthorized', async () => {
  const { deps } = buildDeps({ orgs: [] });
  const req = new Request('https://test.supabase.co/functions/v1/demo-org-purge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const res = await handle(req, deps);
  assertEquals(res.status, 401);
});

Deno.test('Test 5b: Wrong bearer → 401 unauthorized', async () => {
  const { deps } = buildDeps({ orgs: [] });
  const res = await handle(buildPostRequest('wrong-key', {}), deps);
  assertEquals(res.status, 401);
});

// ── Test 6: GET /healthz ────────────────────────────────────────────────────

Deno.test('Test 6: GET /healthz → 200 { ok:true }', async () => {
  const { deps } = buildDeps({ orgs: [] });
  const req = new Request('https://test.supabase.co/functions/v1/demo-org-purge/healthz', {
    method: 'GET',
  });
  const res = await handle(req, deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { ok: boolean; fn: string };
  assertEquals(body.ok, true);
  assertEquals(body.fn, 'demo-org-purge');
});

// ── Test 7: Empty candidate set → 0 purges ──────────────────────────────────

Deno.test('Test 7: No expired demo orgs → purged_count=0', async () => {
  const orgs: MockOrg[] = [
    { id: 'fresh', is_demo: true, created_at: daysAgo(2), demo_extended_until: null },
  ];
  const { deps, deleteCalls } = buildDeps({ orgs });

  const res = await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY, {}), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { purged_count: number; purged_org_ids: string[] };
  assertEquals(body.purged_count, 0);
  assertEquals(body.purged_org_ids, []);
  assertEquals(deleteCalls.length, 0);
});

// ── Test 8: Child-table delete order — clears precede org delete ────────────

Deno.test('Test 8: child-table deletes precede the org-row delete', async () => {
  const orgs: MockOrg[] = [
    { id: 'order-org', is_demo: true, created_at: daysAgo(10), demo_extended_until: null },
  ];
  const { deps, deleteCalls } = buildDeps({ orgs });

  await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY, {}), deps);

  // Filter to just our test org's delete calls.
  const calls = deleteCalls.filter(
    (c) => c.org_id === 'order-org' || (c.table === 'organizations' && c.id === 'order-org'),
  );
  // The final call must be on `organizations` — every preceding call clears a child table.
  const last = calls[calls.length - 1];
  assertEquals(last?.table, 'organizations');
  // At least one child-table clear happened before the org delete.
  assert(calls.length > 1, 'expected child-table clears before org delete');
  // All non-final calls target child tables, not organizations.
  for (const c of calls.slice(0, -1)) {
    assert(c.table !== 'organizations', `child clear before org delete; got ${c.table}`);
  }
});
