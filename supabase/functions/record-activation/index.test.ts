/**
 * Deno tests for `record-activation` Edge Function — Phase 34 Plan 34-03.
 *
 * Per CONTEXT D-03/D-04/D-15 + RESEARCH:
 *   - Fire-once per user (re-invocation → 200 { already_activated: true }, NO second capture).
 *   - 7-day window guard (outside window → 200 { skipped: true }, NO row insert).
 *   - SECDEF RPC `record_activation_event` uses pg_advisory_xact_lock + check + UPSERT
 *     to guarantee race-safety under concurrent invocations.
 *   - try/finally with shutdownPostHog() in finally per memory feedback_planner_iter1_anti_patterns.
 *
 * Test plan (8 behaviors from 34-03-PLAN.md <behavior>):
 *   T1 — Happy path (signup 3 days ago, no prior activation) → did_fire=true → captureServer called 1x → 200 activated:true
 *   T2 — Already activated (RPC returns did_fire=false) → no captureServer → 200 already_activated:true
 *   T3 — Outside window (signup 10 days ago) → 200 skipped:true reason:outside_window; rpc NOT called
 *   T4 — Invalid goal_type (not in 8-enum) → 400 invalid_body
 *   T5 — No auth header → 401 unauthenticated
 *   T6 — OPTIONS preflight → 204
 *   T7 — Concurrent: two parallel invocations → captureServer called AT MOST once
 *   T8 — finally-block: even on BodySchema.safeParse failure, shutdownPostHog called (spy)
 *
 * Per [[reference_deno_test_discovery]]: filename is `index.test.ts`.
 */
import { assertEquals, assert } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

const USER_UUID = '11111111-1111-4111-8111-111111111111';
const USER_JWT = 'fake-user-jwt-token';

// ----------------------------------------------------------------------------
// Capture spy — counts captureServer calls and records args.
// ----------------------------------------------------------------------------

interface CaptureCall {
  userId: string;
  event: string;
  properties: Record<string, unknown>;
}

let captureCalls: CaptureCall[] = [];
let shutdownCalls = 0;

function resetSpies(): void {
  captureCalls = [];
  shutdownCalls = 0;
}

// ----------------------------------------------------------------------------
// Fake admin builder
// ----------------------------------------------------------------------------

interface FakeAdminConfig {
  authBehavior: 'ok' | 'error';
  profileSignupOffsetDays: number | null; // null → profile missing
  rpcResult?: {
    did_fire: boolean;
    reason?: string;
    days_since_signup?: number;
  };
  rpcError?: string;
  rpcCallCount: { n: number };
}

// deno-lint-ignore no-explicit-any
function makeFakeAdmin(cfg: FakeAdminConfig): any {
  return {
    auth: {
      getUser: (_jwt: string) => {
        if (cfg.authBehavior === 'error') {
          return Promise.resolve({ data: { user: null }, error: { message: 'bad' } });
        }
        return Promise.resolve({ data: { user: { id: USER_UUID } }, error: null });
      },
    },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) => ({
              maybeSingle: () => {
                if (cfg.profileSignupOffsetDays === null) {
                  return Promise.resolve({ data: null, error: null });
                }
                const signupAt = new Date(
                  Date.now() - cfg.profileSignupOffsetDays * 86400000,
                ).toISOString();
                return Promise.resolve({
                  data: { created_at: signupAt },
                  error: null,
                });
              },
            }),
          }),
        };
      }
      throw new Error(`unexpected from(${table})`);
    },
    rpc: (fn: string, _args: Record<string, unknown>) => {
      cfg.rpcCallCount.n += 1;
      if (fn !== 'record_activation_event') {
        return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } });
      }
      if (cfg.rpcError) {
        return Promise.resolve({ data: null, error: { message: cfg.rpcError } });
      }
      return Promise.resolve({ data: cfg.rpcResult ?? null, error: null });
    },
  };
}

// ----------------------------------------------------------------------------
// Request builder
// ----------------------------------------------------------------------------

function mkReq(opts: {
  method?: string;
  jwt?: string;
  body?: unknown;
}): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.jwt) headers.Authorization = `Bearer ${opts.jwt}`;
  return new Request('http://localhost/functions/v1/record-activation', {
    method: opts.method ?? 'POST',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

// ----------------------------------------------------------------------------
// Wire spies into the Edge Fn module
// ----------------------------------------------------------------------------

__internal.setCaptureSpyForTest((args: CaptureCall) => {
  captureCalls.push(args);
});
__internal.setShutdownSpyForTest(() => {
  shutdownCalls += 1;
});

// ============================================================================
// T1 — Happy path
// ============================================================================
Deno.test('T1: happy path — signup 3 days ago, no prior activation → activated:true', async () => {
  resetSpies();
  const rpcCallCount = { n: 0 };
  __internal.setAdminForTest(
    makeFakeAdmin({
      authBehavior: 'ok',
      profileSignupOffsetDays: 3,
      rpcResult: { did_fire: true, days_since_signup: 3 },
      rpcCallCount,
    }),
  );
  const res = await __internal.handleRecordActivation(
    mkReq({ jwt: USER_JWT, body: { goal_type: 'lose-weight', action_type: 'first_weight_log' } }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.activated, true);
  assertEquals(body.days_since_signup, 3);
  assertEquals(captureCalls.length, 1, 'captureServer must fire exactly once');
  assertEquals(captureCalls[0].event, 'activation_completed');
  assertEquals(captureCalls[0].userId, USER_UUID);
  assertEquals(captureCalls[0].properties.goal_type, 'lose-weight');
  assertEquals(captureCalls[0].properties.window_days, 7);
  assertEquals(captureCalls[0].properties.source, 'first_log');
  assertEquals(captureCalls[0].properties.days_since_signup, 3);
  assert(shutdownCalls >= 1, 'shutdownPostHog must be called in finally');
  __internal.resetAdminForTest();
});

// ============================================================================
// T2 — Already activated
// ============================================================================
Deno.test('T2: already activated → 200 already_activated:true, NO captureServer', async () => {
  resetSpies();
  const rpcCallCount = { n: 0 };
  __internal.setAdminForTest(
    makeFakeAdmin({
      authBehavior: 'ok',
      profileSignupOffsetDays: 3,
      rpcResult: { did_fire: false, reason: 'already_activated' },
      rpcCallCount,
    }),
  );
  const res = await __internal.handleRecordActivation(
    mkReq({ jwt: USER_JWT, body: { goal_type: 'build-habit', action_type: 'second_log' } }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.already_activated, true);
  assertEquals(captureCalls.length, 0, 'captureServer must NOT fire on already_activated');
  assert(shutdownCalls >= 1, 'shutdownPostHog must be called in finally');
  __internal.resetAdminForTest();
});

// ============================================================================
// T3 — Outside window
// ============================================================================
Deno.test('T3: signup 10 days ago → 200 skipped:true, rpc NOT called', async () => {
  resetSpies();
  const rpcCallCount = { n: 0 };
  __internal.setAdminForTest(
    makeFakeAdmin({
      authBehavior: 'ok',
      profileSignupOffsetDays: 10,
      rpcCallCount,
    }),
  );
  const res = await __internal.handleRecordActivation(
    mkReq({ jwt: USER_JWT, body: { goal_type: 'lose-weight', action_type: 'first_weight_log' } }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.skipped, true);
  assertEquals(body.reason, 'outside_window');
  assertEquals(captureCalls.length, 0);
  assertEquals(rpcCallCount.n, 0, 'RPC must NOT be called outside window');
  assert(shutdownCalls >= 1);
  __internal.resetAdminForTest();
});

// ============================================================================
// T4 — Invalid goal_type
// ============================================================================
Deno.test('T4: invalid goal_type → 400 invalid_body', async () => {
  resetSpies();
  const rpcCallCount = { n: 0 };
  __internal.setAdminForTest(
    makeFakeAdmin({
      authBehavior: 'ok',
      profileSignupOffsetDays: 3,
      rpcCallCount,
    }),
  );
  const res = await __internal.handleRecordActivation(
    mkReq({ jwt: USER_JWT, body: { goal_type: 'made-up-goal', action_type: 'foo' } }),
  );
  assertEquals(res.status, 400);
  assertEquals(captureCalls.length, 0);
  assertEquals(rpcCallCount.n, 0);
  __internal.resetAdminForTest();
});

// ============================================================================
// T5 — No auth
// ============================================================================
Deno.test('T5: missing Authorization → 401', async () => {
  resetSpies();
  const rpcCallCount = { n: 0 };
  __internal.setAdminForTest(
    makeFakeAdmin({
      authBehavior: 'ok',
      profileSignupOffsetDays: 3,
      rpcCallCount,
    }),
  );
  const res = await __internal.handleRecordActivation(
    mkReq({ body: { goal_type: 'lose-weight', action_type: 'foo' } }),
  );
  assertEquals(res.status, 401);
  assertEquals(captureCalls.length, 0);
  __internal.resetAdminForTest();
});

// ============================================================================
// T6 — OPTIONS preflight
// ============================================================================
Deno.test('T6: OPTIONS preflight → 204', async () => {
  resetSpies();
  const res = await __internal.handleRecordActivation(mkReq({ method: 'OPTIONS' }));
  assertEquals(res.status, 204);
});

// ============================================================================
// T7 — Concurrent invocations
// ============================================================================
Deno.test('T7: concurrent invocations → captureServer called AT MOST once', async () => {
  resetSpies();
  // Simulate the SECDEF RPC's advisory-lock behavior: first call returns did_fire=true,
  // second call returns did_fire=false (already_activated).
  let rpcInvocation = 0;
  const rpcCallCount = { n: 0 };
  const admin = {
    auth: {
      getUser: (_j: string) =>
        Promise.resolve({ data: { user: { id: USER_UUID } }, error: null }),
    },
    from: (_t: string) => ({
      select: (_c: string) => ({
        eq: (_col: string, _v: string) => ({
          maybeSingle: () =>
            Promise.resolve({
              data: { created_at: new Date(Date.now() - 3 * 86400000).toISOString() },
              error: null,
            }),
        }),
      }),
    }),
    rpc: (_fn: string, _args: Record<string, unknown>) => {
      rpcCallCount.n += 1;
      const n = ++rpcInvocation;
      if (n === 1) {
        return Promise.resolve({ data: { did_fire: true, days_since_signup: 3 }, error: null });
      }
      return Promise.resolve({
        data: { did_fire: false, reason: 'already_activated' },
        error: null,
      });
    },
  };
  __internal.setAdminForTest(admin);
  const [r1, r2] = await Promise.all([
    __internal.handleRecordActivation(
      mkReq({ jwt: USER_JWT, body: { goal_type: 'lose-weight', action_type: 'first_log' } }),
    ),
    __internal.handleRecordActivation(
      mkReq({ jwt: USER_JWT, body: { goal_type: 'lose-weight', action_type: 'first_log' } }),
    ),
  ]);
  assertEquals(r1.status, 200);
  assertEquals(r2.status, 200);
  assert(
    captureCalls.length === 1,
    `captureServer must fire exactly once across concurrent invocations, got ${captureCalls.length}`,
  );
  __internal.resetAdminForTest();
});

// ============================================================================
// T8 — finally-block: shutdownPostHog called even on body-parse failure
// ============================================================================
Deno.test('T8: shutdownPostHog called in finally even on invalid body', async () => {
  resetSpies();
  const rpcCallCount = { n: 0 };
  __internal.setAdminForTest(
    makeFakeAdmin({
      authBehavior: 'ok',
      profileSignupOffsetDays: 3,
      rpcCallCount,
    }),
  );
  const res = await __internal.handleRecordActivation(
    mkReq({ jwt: USER_JWT, body: { goal_type: 'NOPE', action_type: '' } }),
  );
  assertEquals(res.status, 400);
  assert(shutdownCalls >= 1, 'shutdownPostHog must be called in finally even on validation failure');
  __internal.resetAdminForTest();
});
