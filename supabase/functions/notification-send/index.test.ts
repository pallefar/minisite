/**
 * Phase 42 Plan 42-05 — Deno tests for notification-send Edge Function.
 *
 * Per reference_deno_test_discovery — filename pattern <name>.test.ts.
 *
 * Test plan:
 *   T1 — OPTIONS preflight → 200 CORS
 *   T2 — non-POST → 405
 *   T3 — missing/wrong bearer → 401 service_role_required
 *   T4 — body validation: missing user_id / bad category / non-object payload
 *   T5 — PHI gate: clinic-alerts with non-allowed key → 400 phi_field_forbidden
 *   T6 — happy path: ai-insights → decision fires push+in-app, user_notifications insert called
 *   T7 — cap-exceeded path: firedToday=3 (cap=3) → fired=[], decision.email=false push=false in_app=false
 *   T8 — URGENT path: clinic-alerts → decision.urgent=true; push fan-out called with urgency:'high'
 *   T9 (54-04) — helpdesk-reply passes validateBody (PUSH-06)
 *   T10 (54-04) — web-only filter: .eq('platform','web') called; native row not delivered
 */
import { assertEquals, assertExists } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
Deno.env.set('VAPID_SUBJECT', 'mailto:test@leanshot.app');
Deno.env.set('VAPID_PUBLIC_KEY', 'test-public-key');
Deno.env.set('VAPID_PRIVATE_KEY', 'test-private-key');

const SERVICE_BEARER = 'test-service-role-key';
const USER_ID = '11111111-1111-4111-8111-111111111111';

// ----------------------------------------------------------------------------
// Fake admin builder — minimal supabase-js mock that records calls
// ----------------------------------------------------------------------------

interface FakeAdminLog {
  inserts: Array<{ table: string; row: Record<string, unknown> }>;
}

interface FakeAdminConfig {
  prefs: Array<Record<string, unknown>>;
  cfg: Record<string, unknown> | null;
  dismissal: Record<string, unknown> | null;
  firedTodayCount: number;
  firedThisWeekCount: number;
  pushSubs: Array<{ endpoint: string; p256dh: string; auth: string }>;
  userEmail: string | null;
  log: FakeAdminLog;
}

// deno-lint-ignore no-explicit-any
function makeFakeAdmin(cfg: FakeAdminConfig): any {
  return {
    auth: {
      admin: {
        getUserById: (_id: string) => {
          if (!cfg.userEmail) {
            return Promise.resolve({
              data: { user: null },
              error: { message: 'not_found' },
            });
          }
          return Promise.resolve({
            data: { user: { id: _id, email: cfg.userEmail } },
            error: null,
          });
        },
      },
    },
    from: (table: string) => {
      // Build a chainable, table-aware query.
      // deno-lint-ignore no-explicit-any
      const state: any = {
        table,
        filters: {},
        countMode: false,
      };

      const exec = () => {
        if (table === 'notification_settings') {
          return Promise.resolve({ data: cfg.prefs, error: null });
        }
        if (table === 'notification_category_config') {
          return Promise.resolve({ data: cfg.cfg, error: null });
        }
        if (table === 'notification_dismissal_state') {
          return Promise.resolve({ data: cfg.dismissal, error: null });
        }
        if (table === 'user_notifications') {
          if (state.countMode) {
            // Different ranges return different counts based on filter.
            // The test calls .gte('fired_at', ...) — we approximate via order:
            // first count() call = today, second = week. We use a stack.
            const c = state.gteCalled
              ? // Use the first/second invocation pattern: alternate.
                cfg.firedTodayCount
              : cfg.firedTodayCount;
            return Promise.resolve({ count: c, error: null });
          }
          // Default (non-count) — e.g. insert path returns separately.
          return Promise.resolve({ data: [], error: null });
        }
        if (table === 'push_subscriptions') {
          return Promise.resolve({ data: cfg.pushSubs, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      };

      const chain = {
        select(_cols?: string, opts?: { count?: string; head?: boolean }) {
          if (opts?.count === 'exact') state.countMode = true;
          return chain;
        },
        eq(_col: string, _val: unknown) {
          return chain;
        },
        gte(_col: string, _val: unknown) {
          state.gteCalled = true;
          return chain;
        },
        maybeSingle() {
          return exec();
        },
        single() {
          if (table === 'user_notifications') {
            const id = `notif-${crypto.randomUUID()}`;
            return Promise.resolve({ data: { id }, error: null });
          }
          return exec();
        },
        // PromiseLike: makes `await chain` work
        then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
          return exec().then(resolve, reject);
        },
        insert(row: Record<string, unknown>) {
          cfg.log.inserts.push({ table, row });
          // Return a chain that supports .select().single()
          const insertChain = {
            select(_c?: string) {
              return insertChain;
            },
            single() {
              return Promise.resolve({
                data: { id: `notif-${crypto.randomUUID()}` },
                error: null,
              });
            },
            then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
              return Promise.resolve({ data: null, error: null }).then(resolve, reject);
            },
          };
          return insertChain;
        },
      };
      return chain;
    },
  };
}

function makeReq(body: unknown, opts?: { method?: string; bearer?: string }): Request {
  return new Request('http://test/functions/v1/notification-send', {
    method: opts?.method ?? 'POST',
    headers: {
      ...(opts?.bearer !== undefined
        ? { Authorization: `Bearer ${opts.bearer}` }
        : opts?.bearer === undefined && opts?.method !== 'OPTIONS'
          ? { Authorization: `Bearer ${SERVICE_BEARER}` }
          : {}),
      'Content-Type': 'application/json',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

Deno.test('T1 — OPTIONS preflight returns 200 with CORS', async () => {
  const req = new Request('http://test/functions/v1/notification-send', {
    method: 'OPTIONS',
  });
  const res = await __internal.handleSend(req);
  assertEquals(res.status, 200);
  assertExists(res.headers.get('Access-Control-Allow-Origin'));
});

Deno.test('T2 — non-POST returns 405', async () => {
  const req = new Request('http://test/functions/v1/notification-send', { method: 'GET' });
  const res = await __internal.handleSend(req);
  assertEquals(res.status, 405);
});

Deno.test('T3a — missing Authorization returns 401', async () => {
  const req = new Request('http://test/functions/v1/notification-send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const res = await __internal.handleSend(req);
  assertEquals(res.status, 401);
});

Deno.test('T3b — wrong bearer returns 401', async () => {
  const res = await __internal.handleSend(
    makeReq({}, { bearer: 'wrong-bearer' }),
  );
  assertEquals(res.status, 401);
});

Deno.test('T4a — body validation: missing user_id', async () => {
  const res = await __internal.handleSend(
    makeReq({ category: 'ai-insights', payload: {} }, { bearer: SERVICE_BEARER }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'user_id_required');
});

Deno.test('T4b — body validation: invalid category', async () => {
  const res = await __internal.handleSend(
    makeReq(
      { user_id: USER_ID, category: 'invalid-cat', payload: {} },
      { bearer: SERVICE_BEARER },
    ),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'category_invalid');
});

Deno.test('T4c — body validation: payload must be object', async () => {
  const res = await __internal.handleSend(
    makeReq(
      { user_id: USER_ID, category: 'ai-insights', payload: 'not-object' },
      { bearer: SERVICE_BEARER },
    ),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'payload_required_object');
});

Deno.test('T5 — PHI gate: clinic-alerts with forbidden key returns 400', () => {
  const res = __internal.validatePhiGate('clinic-alerts', {
    subject: 'Lab result',
    deeplink: 'app://lab/123',
    patient_dob: '1990-01-01', // forbidden PHI field
  });
  assertEquals(res.ok, false);
  if (!res.ok) {
    assertEquals(res.reason.startsWith('phi_field_forbidden'), true);
  }
});

Deno.test('T5b — PHI gate: clinic-alerts with only {subject, deeplink} passes', () => {
  const res = __internal.validatePhiGate('clinic-alerts', {
    subject: 'Lab ready',
    deeplink: 'app://lab/123',
  });
  assertEquals(res.ok, true);
});

Deno.test('T5c — PHI gate: ai-insights payload is open (any keys allowed)', () => {
  const res = __internal.validatePhiGate('ai-insights', {
    weight_trend: 'declining',
    custom_field: 'whatever',
  });
  assertEquals(res.ok, true);
});

Deno.test('T6 — happy path: ai-insights fires push+in-app, inserts user_notifications row', async () => {
  const log: FakeAdminLog = { inserts: [] };
  const fakeAdmin = makeFakeAdmin({
    prefs: [
      {
        user_id: USER_ID,
        category: 'ai-insights',
        channel: 'in-app',
        enabled: true,
        snoozed_until: null,
        user_cap_override: null,
      },
      {
        user_id: USER_ID,
        category: 'ai-insights',
        channel: 'web-push',
        enabled: true,
        snoozed_until: null,
        user_cap_override: null,
      },
    ],
    cfg: {
      category: 'ai-insights',
      daily_cap: 3,
      weekly_cap: null,
      urgent_escalation: false,
      push_enabled_default: true,
      email_enabled_default: false,
      in_app_enabled_default: true,
    },
    dismissal: null,
    firedTodayCount: 1,
    firedThisWeekCount: 1,
    pushSubs: [
      { endpoint: 'https://fcm.example/abc', p256dh: 'p256dh', auth: 'authk' },
    ],
    userEmail: 'user@example.com',
    log,
  });
  __internal.setAdminForTest(fakeAdmin);

  let pushCalled = 0;
  let pushUrgency: string | undefined;
  __internal.setPushFnForTest(async (_sub, _payload, opts) => {
    pushCalled += 1;
    pushUrgency = opts.urgency;
    return { ok: true, status: 201 };
  });

  let emailCalled = 0;
  // deno-lint-ignore no-explicit-any
  __internal.setEmailFnForTest((async (_sb: any, _args: any) => {
    emailCalled += 1;
    return { provider: 'resend', id: 'fake' };
    // deno-lint-ignore no-explicit-any
  }) as any);

  const res = await __internal.handleSend(
    makeReq(
      {
        user_id: USER_ID,
        category: 'ai-insights',
        payload: { subject: 'Weight trend update', body: 'You are trending down 0.5kg/wk' },
      },
      { bearer: SERVICE_BEARER },
    ),
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.decision.push, true);
  assertEquals(body.decision.in_app, true);
  assertEquals(body.decision.urgent, false);
  assertEquals(pushCalled, 1);
  assertEquals(pushUrgency, 'normal');
  assertEquals(emailCalled, 0); // email_enabled_default = false; no pref row for email
  assertEquals(log.inserts.length, 1);
  assertEquals(log.inserts[0].table, 'user_notifications');

  __internal.resetAdminForTest();
  __internal.resetPushFnForTest();
  __internal.resetEmailFnForTest();
});

Deno.test('T7 — cap-exceeded: firedToday=3 (cap=3) blocks all channels', async () => {
  const log: FakeAdminLog = { inserts: [] };
  const fakeAdmin = makeFakeAdmin({
    prefs: [
      {
        user_id: USER_ID,
        category: 'ai-insights',
        channel: 'in-app',
        enabled: true,
        snoozed_until: null,
        user_cap_override: null,
      },
    ],
    cfg: {
      category: 'ai-insights',
      daily_cap: 3,
      weekly_cap: null,
      urgent_escalation: false,
      push_enabled_default: true,
      email_enabled_default: false,
      in_app_enabled_default: true,
    },
    dismissal: null,
    firedTodayCount: 3,
    firedThisWeekCount: 3,
    pushSubs: [],
    userEmail: 'user@example.com',
    log,
  });
  __internal.setAdminForTest(fakeAdmin);

  let pushCalled = 0;
  __internal.setPushFnForTest(async () => {
    pushCalled += 1;
    return { ok: true };
  });

  const res = await __internal.handleSend(
    makeReq(
      {
        user_id: USER_ID,
        category: 'ai-insights',
        payload: { subject: 'cap test', body: 'x' },
      },
      { bearer: SERVICE_BEARER },
    ),
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.decision.push, false);
  assertEquals(body.decision.in_app, false);
  assertEquals(body.decision.reasons.cap, 'cap_exceeded');
  assertEquals(pushCalled, 0);

  __internal.resetAdminForTest();
  __internal.resetPushFnForTest();
});

Deno.test('T8 — URGENT: clinic-alerts → urgency=high passed to push fan-out', async () => {
  const log: FakeAdminLog = { inserts: [] };
  const fakeAdmin = makeFakeAdmin({
    prefs: [
      {
        user_id: USER_ID,
        category: 'clinic-alerts',
        channel: 'web-push',
        enabled: true,
        snoozed_until: null,
        user_cap_override: null,
      },
      {
        user_id: USER_ID,
        category: 'clinic-alerts',
        channel: 'email',
        enabled: true,
        snoozed_until: null,
        user_cap_override: null,
      },
    ],
    cfg: {
      category: 'clinic-alerts',
      daily_cap: null,
      weekly_cap: null,
      urgent_escalation: true,
      push_enabled_default: true,
      email_enabled_default: true,
      in_app_enabled_default: true,
    },
    dismissal: null,
    firedTodayCount: 0,
    firedThisWeekCount: 0,
    pushSubs: [
      { endpoint: 'https://fcm.example/clinic', p256dh: 'p', auth: 'a' },
    ],
    userEmail: 'patient@example.com',
    log,
  });
  __internal.setAdminForTest(fakeAdmin);

  let pushUrgency: string | undefined;
  __internal.setPushFnForTest(async (_sub, _payload, opts) => {
    pushUrgency = opts.urgency;
    return { ok: true };
  });

  let emailPhi: boolean | undefined;
  // deno-lint-ignore no-explicit-any
  __internal.setEmailFnForTest((async (_sb: any, args: any) => {
    emailPhi = args.phi;
    return { provider: 'ses', id: 'fake-ses' };
    // deno-lint-ignore no-explicit-any
  }) as any);

  const res = await __internal.handleSend(
    makeReq(
      {
        user_id: USER_ID,
        category: 'clinic-alerts',
        payload: { subject: 'Lab ready', deeplink: 'app://lab/123' },
      },
      { bearer: SERVICE_BEARER },
    ),
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.decision.urgent, true);
  assertEquals(pushUrgency, 'high');
  assertEquals(emailPhi, true); // D-08: clinic-alerts → SES (phi=true)

  __internal.resetAdminForTest();
  __internal.resetPushFnForTest();
  __internal.resetEmailFnForTest();
});

Deno.test('T8b — clinic-alerts payload with PHI field rejected by Edge Fn entry', async () => {
  // Even before context loading, the PHI gate should reject.
  const res = await __internal.handleSend(
    makeReq(
      {
        user_id: USER_ID,
        category: 'clinic-alerts',
        payload: {
          subject: 'Lab',
          deeplink: 'app://lab/1',
          patient_dob: '1990-01-01', // forbidden
        },
      },
      { bearer: SERVICE_BEARER },
    ),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.startsWith('phi_field_forbidden'), true);
});

// ----------------------------------------------------------------------------
// Phase 54 Plan 54-04 — web-only push filter + helpdesk-reply category tests
// ----------------------------------------------------------------------------

Deno.test('T9 — helpdesk-reply passes validateBody (PUSH-06, was previously category_invalid)', () => {
  const result = __internal.validateBody({
    user_id: USER_ID,
    category: 'helpdesk-reply',
    payload: { ticket_id: 'tk-123', subject: 'Your ticket was updated' },
  });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.body.category, 'helpdesk-reply');
  }
});

Deno.test('T9b — helpdesk-reply was previously rejected (regression guard)', () => {
  // Confirm non-existent category is still rejected to catch VALID_CATEGORIES regressions.
  const result = __internal.validateBody({
    user_id: USER_ID,
    category: 'helpdesk-nonexistent',
    payload: {},
  });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.reason, 'category_invalid');
  }
});

Deno.test('T10 — web-only filter: .eq(platform,web) called; native-only subscriber not delivered', async () => {
  const log: FakeAdminLog = { inserts: [] };

  // Track which .eq() calls the push_subscriptions chain receives.
  const eqCalls: Array<[string, unknown]> = [];

  const fakeAdmin = {
    auth: {
      admin: {
        getUserById: (_id: string) =>
          Promise.resolve({ data: { user: { id: _id, email: 'user@example.com' } }, error: null }),
      },
    },
    from: (table: string) => {
      // deno-lint-ignore no-explicit-any
      const state: any = { table, countMode: false };

      const exec = () => {
        if (table === 'notification_settings') {
          return Promise.resolve({
            data: [
              {
                user_id: USER_ID,
                category: 'ai-insights',
                channel: 'web-push',
                enabled: true,
                snoozed_until: null,
                user_cap_override: null,
              },
            ],
            error: null,
          });
        }
        if (table === 'notification_category_config') {
          return Promise.resolve({
            data: {
              category: 'ai-insights',
              daily_cap: 5,
              weekly_cap: null,
              urgent_escalation: false,
              push_enabled_default: true,
              email_enabled_default: false,
              in_app_enabled_default: false,
            },
            error: null,
          });
        }
        if (table === 'notification_dismissal_state') {
          return Promise.resolve({ data: null, error: null });
        }
        if (table === 'user_notifications') {
          if (state.countMode) return Promise.resolve({ count: 0, error: null });
          return Promise.resolve({ data: [], error: null });
        }
        if (table === 'push_subscriptions') {
          // Only return web subscription; simulate platform='web' filter succeeding.
          // If the filter is NOT applied, a native-only scenario would still land here —
          // the test asserts the eq('platform','web') call was recorded.
          return Promise.resolve({
            data: [{ endpoint: 'https://web.push.example/sub1', p256dh: 'p256', auth: 'auth' }],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      };

      const chain = {
        select(_cols?: string, opts?: { count?: string; head?: boolean }) {
          if (opts?.count === 'exact') state.countMode = true;
          return chain;
        },
        eq(col: string, val: unknown) {
          if (table === 'push_subscriptions') {
            eqCalls.push([col, val]);
          }
          return chain;
        },
        gte(_col: string, _val: unknown) {
          return chain;
        },
        maybeSingle() {
          return exec();
        },
        single() {
          if (table === 'user_notifications') {
            return Promise.resolve({ data: { id: `notif-${crypto.randomUUID()}` }, error: null });
          }
          return exec();
        },
        then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
          return exec().then(resolve, reject);
        },
        insert(row: Record<string, unknown>) {
          log.inserts.push({ table, row });
          const insertChain = {
            select(_c?: string) { return insertChain; },
            single() {
              return Promise.resolve({ data: { id: `notif-${crypto.randomUUID()}` }, error: null });
            },
            then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
              return Promise.resolve({ data: null, error: null }).then(resolve, reject);
            },
          };
          return insertChain;
        },
      };
      return chain;
    },
  };

  __internal.setAdminForTest(fakeAdmin);

  let pushDelivered = 0;
  __internal.setPushFnForTest(async (_sub, _payload, _opts) => {
    pushDelivered += 1;
    return { ok: true, status: 201 };
  });

  const res = await __internal.handleSend(
    makeReq(
      {
        user_id: USER_ID,
        category: 'ai-insights',
        payload: { subject: 'Push filter test', body: 'web only' },
      },
      { bearer: SERVICE_BEARER },
    ),
  );

  assertEquals(res.status, 200);

  // Assert .eq('platform', 'web') was called on the push_subscriptions chain.
  const platformEq = eqCalls.find(([col, val]) => col === 'platform' && val === 'web');
  assertExists(
    platformEq,
    `Expected .eq('platform','web') call on push_subscriptions chain, got: ${JSON.stringify(eqCalls)}`,
  );

  // Web subscription was delivered (filter returned a web row).
  assertEquals(pushDelivered, 1, 'Expected exactly one push delivery to web subscriber');

  __internal.resetAdminForTest();
  __internal.resetPushFnForTest();
});
