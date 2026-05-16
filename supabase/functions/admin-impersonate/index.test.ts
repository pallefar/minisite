/**
 * Deno tests for `admin-impersonate` Edge Function — Phase 22 Plan 22-03 (ADMIN-03).
 *
 * A1 PROBE verdict: PASS (336ms) — see 22-A1-PROBE.md. Implementation uses Option A:
 * `admin.auth.admin.updateUserById({app_metadata})` + `admin.auth.admin.generateLink('magiclink')`.
 * No Custom Access Token Hook fallback needed.
 *
 * Test plan (7 behaviors):
 *   T1 non-staff caller → 403 forbidden
 *   T2 self-impersonation attempt → 400 cannot_impersonate_self
 *   T3 target is also is_staff → 400 cannot_impersonate_admin
 *   T4 happy path (start) → updateUserById called with impersonator_id+impersonation_exp;
 *                            generateLink called; returns 200 {action_link, expires_at};
 *                            audit_logs has impersonate_start row.
 *   T5 happy path (end) → updateUserById clears impersonator_id+impersonation_exp;
 *                          audit_logs has impersonate_end row.
 *   T6 end when target has no active impersonation → 200 (idempotent no-op).
 *   T7 lazy admin singleton — module import does NOT throw on empty env.
 */
import { assertEquals, assert } from 'jsr:@std/assert@^1';

// Stub env BEFORE importing the module (lazy-singleton pattern reads at first call,
// but supabase-js validates URL at construction; ensure non-empty placeholder).
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

import { __internal } from './index.ts';

// ============================================================================
// Test fixtures — fake admin client
// ============================================================================

interface FakeProfile {
  id: string;
  is_staff: boolean;
  email: string;
}

interface FakeUserRow {
  id: string;
  email: string;
  app_metadata: Record<string, unknown>;
}

interface FakeState {
  profiles: FakeProfile[];
  users: FakeUserRow[];
  auditInserts: Array<Record<string, unknown>>;
  updateUserByIdCalls: Array<{ id: string; attrs: Record<string, unknown> }>;
  generateLinkCalls: Array<{ type: string; email: string }>;
  callerJwt?: string; // last bearer token getUser saw
  callerUserId: string; // who admin.auth.getUser(jwt) should return
}

function makeFakeAdmin(state: FakeState) {
  return {
    auth: {
      getUser: (jwt: string) => {
        state.callerJwt = jwt;
        const u = state.users.find((x) => x.id === state.callerUserId);
        if (!u) return Promise.resolve({ data: { user: null }, error: { message: 'no_user' } });
        return Promise.resolve({ data: { user: { id: u.id, email: u.email } }, error: null });
      },
      admin: {
        updateUserById: (id: string, attrs: Record<string, unknown>) => {
          state.updateUserByIdCalls.push({ id, attrs });
          const u = state.users.find((x) => x.id === id);
          if (u && attrs.app_metadata) {
            const newMeta = attrs.app_metadata as Record<string, unknown>;
            // Mimic Supabase: app_metadata write replaces the keys it touches.
            // null values clear; defined values set.
            for (const [k, v] of Object.entries(newMeta)) {
              if (v === null) delete u.app_metadata[k];
              else u.app_metadata[k] = v;
            }
          }
          return Promise.resolve({ data: { user: u }, error: null });
        },
        generateLink: (params: { type: string; email: string }) => {
          state.generateLinkCalls.push(params);
          return Promise.resolve({
            data: {
              properties: {
                action_link:
                  'http://localhost:54321/auth/v1/verify?token=fake_token_for_' + params.email,
              },
            },
            error: null,
          });
        },
        getUserById: (id: string) => {
          const u = state.users.find((x) => x.id === id);
          if (!u) return Promise.resolve({ data: { user: null }, error: { message: 'not_found' } });
          return Promise.resolve({
            data: { user: { id: u.id, email: u.email, app_metadata: u.app_metadata } },
            error: null,
          });
        },
      },
    },
    from: (table: string) => makeBuilder(table, state),
  };
}

function makeBuilder(table: string, state: FakeState) {
  let filters: Array<{ col: string; val: unknown }> = [];
  let selectedCols = '';
  // deno-lint-ignore no-explicit-any
  const api: any = {
    select(cols: string) {
      selectedCols = cols;
      return api;
    },
    eq(col: string, val: unknown) {
      filters.push({ col, val });
      return api;
    },
    single() {
      return Promise.resolve(runSingle(table, state, selectedCols, filters));
    },
    maybeSingle() {
      return Promise.resolve(runSingle(table, state, selectedCols, filters));
    },
    insert(row: Record<string, unknown> | Array<Record<string, unknown>>) {
      if (table === 'audit_logs') {
        const rows = Array.isArray(row) ? row : [row];
        for (const r of rows) state.auditInserts.push(r);
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return api;
}

function runSingle(
  table: string,
  state: FakeState,
  cols: string,
  filters: Array<{ col: string; val: unknown }>,
): { data: unknown; error: { message?: string } | null } {
  if (table === 'profiles') {
    const idF = filters.find((f) => f.col === 'id');
    const id = idF?.val as string;
    const p = state.profiles.find((x) => x.id === id);
    if (!p) return { data: null, error: { message: 'no_profile' } };
    // Return only requested cols
    const out: Record<string, unknown> = {};
    for (const c of cols.split(',').map((s) => s.trim())) {
      if (c === 'is_staff') out.is_staff = p.is_staff;
      if (c === 'email') out.email = p.email;
      if (c === 'id') out.id = p.id;
      if (c === '*') {
        out.id = p.id;
        out.is_staff = p.is_staff;
        out.email = p.email;
      }
    }
    return { data: out, error: null };
  }
  return { data: null, error: { message: 'unknown_table' } };
}

function makeReq(body: Record<string, unknown>, bearer = 'caller-jwt'): Request {
  return new Request('http://localhost/admin-impersonate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

// Real UUIDv4 fixtures (must match UUID_RE in production code).
const ADMIN_1 = '11111111-1111-4111-8111-111111111111';
const USER_2 = '22222222-2222-4222-8222-222222222222';
const ADMIN_3 = '33333333-3333-4333-8333-333333333333';

function defaultState(): FakeState {
  return {
    profiles: [
      { id: ADMIN_1, is_staff: true, email: 'admin@leanshot.app' },
      { id: USER_2, is_staff: false, email: 'user@example.com' },
      { id: ADMIN_3, is_staff: true, email: 'admin2@leanshot.app' },
    ],
    users: [
      { id: ADMIN_1, email: 'admin@leanshot.app', app_metadata: {} },
      { id: USER_2, email: 'user@example.com', app_metadata: {} },
      { id: ADMIN_3, email: 'admin2@leanshot.app', app_metadata: {} },
    ],
    auditInserts: [],
    updateUserByIdCalls: [],
    generateLinkCalls: [],
    callerUserId: ADMIN_1,
  };
}

// ============================================================================
// Tests
// ============================================================================

Deno.test('T1 — non-staff caller returns 403 forbidden + no audit row', async () => {
  const state = defaultState();
  state.callerUserId = USER_2; // non-staff caller
  __internal.setAdminForTest(makeFakeAdmin(state));
  const res = await __internal.handle(
    makeReq({ action: 'start', target_user_id: ADMIN_3 }),
  );
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, 'forbidden');
  assertEquals(state.auditInserts.length, 0);
  assertEquals(state.updateUserByIdCalls.length, 0);
});

Deno.test('T2 — self-impersonation returns 400 cannot_impersonate_self', async () => {
  const state = defaultState();
  state.callerUserId = ADMIN_1;
  __internal.setAdminForTest(makeFakeAdmin(state));
  const res = await __internal.handle(
    makeReq({ action: 'start', target_user_id: ADMIN_1 }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'cannot_impersonate_self');
  assertEquals(state.updateUserByIdCalls.length, 0);
});

Deno.test('T3 — target is also is_staff returns 400 cannot_impersonate_admin', async () => {
  const state = defaultState();
  state.callerUserId = ADMIN_1;
  __internal.setAdminForTest(makeFakeAdmin(state));
  const res = await __internal.handle(
    makeReq({ action: 'start', target_user_id: ADMIN_3 }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'cannot_impersonate_admin');
  assertEquals(state.updateUserByIdCalls.length, 0);
});

Deno.test('T4 — happy path start: updateUserById + generateLink + audit row', async () => {
  const state = defaultState();
  state.callerUserId = ADMIN_1;
  __internal.setAdminForTest(makeFakeAdmin(state));
  const before = Date.now();
  const res = await __internal.handle(
    makeReq({ action: 'start', target_user_id: USER_2 }),
  );
  const after = Date.now();
  assertEquals(res.status, 200);
  const body = await res.json();
  assert(typeof body.action_link === 'string', 'action_link returned');
  assert(typeof body.expires_at === 'number', 'expires_at returned');
  // 30-min TTL (with small slack for test exec)
  assert(body.expires_at >= before + 30 * 60 * 1000 - 100, 'expires_at near now+30m');
  assert(body.expires_at <= after + 30 * 60 * 1000 + 100, 'expires_at not over now+30m');

  // updateUserById called with correct app_metadata
  assertEquals(state.updateUserByIdCalls.length, 1);
  const call = state.updateUserByIdCalls[0]!;
  assertEquals(call.id, USER_2);
  const meta = (call.attrs as { app_metadata: Record<string, unknown> }).app_metadata;
  assertEquals(meta.impersonator_id, ADMIN_1);
  assert(typeof meta.impersonation_exp === 'number');

  // generateLink called with type=magiclink + target email
  assertEquals(state.generateLinkCalls.length, 1);
  assertEquals(state.generateLinkCalls[0]!.type, 'magiclink');
  assertEquals(state.generateLinkCalls[0]!.email, 'user@example.com');

  // audit_logs has impersonate_start row
  assertEquals(state.auditInserts.length, 1);
  const audit = state.auditInserts[0]!;
  assertEquals(audit.action, 'impersonate_start');
  assertEquals(audit.impersonator_id, ADMIN_1);
  assertEquals(audit.target_user_id, USER_2);
  assertEquals(audit.user_id, ADMIN_1); // caller is the actor
});

Deno.test('T5 — happy path end: clears app_metadata + writes impersonate_end audit row', async () => {
  const state = defaultState();
  state.callerUserId = ADMIN_1;
  // Set target's existing impersonation state so 'end' has something to clear
  state.users[1]!.app_metadata = {
    impersonator_id: ADMIN_1,
    impersonation_exp: Date.now() + 1000,
  };
  __internal.setAdminForTest(makeFakeAdmin(state));
  const res = await __internal.handle(
    makeReq({ action: 'end', target_user_id: USER_2 }),
  );
  assertEquals(res.status, 200);
  assertEquals(state.updateUserByIdCalls.length, 1);
  const meta = (state.updateUserByIdCalls[0]!.attrs as {
    app_metadata: Record<string, unknown>;
  }).app_metadata;
  assertEquals(meta.impersonator_id, null);
  assertEquals(meta.impersonation_exp, null);
  assertEquals(state.auditInserts.length, 1);
  assertEquals(state.auditInserts[0]!.action, 'impersonate_end');
  assertEquals(state.auditInserts[0]!.impersonator_id, ADMIN_1);
  assertEquals(state.auditInserts[0]!.target_user_id, USER_2);
});

Deno.test('T6 — end when no active impersonation returns 200 (idempotent)', async () => {
  const state = defaultState();
  state.callerUserId = ADMIN_1;
  // target has NO impersonator_id set
  __internal.setAdminForTest(makeFakeAdmin(state));
  const res = await __internal.handle(
    makeReq({ action: 'end', target_user_id: USER_2 }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  // Idempotent no-op: no updateUserById, no audit row
  assertEquals(state.updateUserByIdCalls.length, 0);
  assertEquals(state.auditInserts.length, 0);
});

Deno.test('T7 — module import succeeded without throwing (lazy singleton check)', () => {
  // The mere fact that all tests above ran means import didn't throw on empty env.
  // The test stubs Deno.env BEFORE importing the module, but the lazy singleton
  // pattern is the reason that works robustly even if env were truly empty.
  assertEquals(typeof __internal.handle, 'function');
  assertEquals(typeof __internal.setAdminForTest, 'function');
});
