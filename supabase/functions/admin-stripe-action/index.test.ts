/**
 * Deno tests for `admin-stripe-action` Edge Function — Phase 22 Plan 22-03 (ADMIN-04).
 *
 * Test plan (7 behaviors):
 *   T1 non-staff caller → 403 forbidden
 *   T2 refund happy: stripe.refunds.create + admin_log_refund RPC + lifecycle-transactional invoke
 *      with idempotency_key shape `refund-<charge>-<amount>`
 *   T3 cancel happy: stripe.subscriptions.update({cancel_at_period_end:true})
 *      + admin_log_subscription_canceled RPC
 *   T4 comp happy: stripe.subscriptions.update({trial_end: now+comp_days*86400, proration_behavior:'none'})
 *      + admin_log_subscription_comped RPC
 *   T5 Stripe error → 502; audit RPC NOT called (no row when Stripe failed)
 *   T6 Stripe error → response body does NOT echo raw Stripe message (PII safety)
 *   T7 idempotency — same {charge,amount} args → same idempotencyKey string
 */
import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert@^1';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_dummy');

import { __internal } from './index.ts';

// ============================================================================
// Test fixtures
// ============================================================================

interface FakeProfile {
  id: string;
  is_staff: boolean;
}

interface FakeState {
  profiles: FakeProfile[];
  rpcCalls: Array<{ name: string; params: Record<string, unknown> }>;
  invokeCalls: Array<{ name: string; body: Record<string, unknown> }>;
  callerUserId: string;
}

interface FakeStripeBehavior {
  refundResult?: { id?: string; amount?: number };
  refundError?: Error;
  subscriptionResult?: { id?: string };
  subscriptionError?: Error;
}

interface FakeStripeCall {
  method: 'refunds.create' | 'subscriptions.update';
  args: unknown;
  opts: unknown;
}

function makeFakeAdmin(state: FakeState) {
  return {
    auth: {
      getUser: (_jwt: string) => {
        const u = state.profiles.find((p) => p.id === state.callerUserId);
        if (!u) return Promise.resolve({ data: { user: null }, error: { message: 'no_user' } });
        return Promise.resolve({ data: { user: { id: u.id } }, error: null });
      },
    },
    from: (table: string) => {
      const filters: Array<{ col: string; val: unknown }> = [];
      let cols = '';
      // deno-lint-ignore no-explicit-any
      const api: any = {
        select(c: string) {
          cols = c;
          return api;
        },
        eq(col: string, val: unknown) {
          filters.push({ col, val });
          return api;
        },
        single() {
          if (table === 'profiles') {
            const idF = filters.find((f) => f.col === 'id');
            const p = state.profiles.find((x) => x.id === (idF?.val as string));
            if (!p) return Promise.resolve({ data: null, error: { message: 'no_profile' } });
            const out: Record<string, unknown> = {};
            if (cols.includes('is_staff')) out.is_staff = p.is_staff;
            if (cols.includes('id')) out.id = p.id;
            return Promise.resolve({ data: out, error: null });
          }
          return Promise.resolve({ data: null, error: { message: 'unknown_table' } });
        },
      };
      return api;
    },
    rpc: (name: string, params: Record<string, unknown>) => {
      state.rpcCalls.push({ name, params });
      return Promise.resolve({ data: null, error: null });
    },
    functions: {
      invoke: (name: string, opts: { body?: Record<string, unknown> }) => {
        state.invokeCalls.push({ name, body: opts?.body ?? {} });
        return Promise.resolve({ data: { ok: true }, error: null });
      },
    },
  };
}

function makeFakeStripe(behavior: FakeStripeBehavior, calls: FakeStripeCall[]) {
  return {
    refunds: {
      create: (args: unknown, opts: unknown) => {
        calls.push({ method: 'refunds.create', args, opts });
        if (behavior.refundError) return Promise.reject(behavior.refundError);
        return Promise.resolve({
          id: behavior.refundResult?.id ?? 're_test_OK',
          amount: behavior.refundResult?.amount ?? (args as { amount?: number }).amount ?? 0,
        });
      },
    },
    subscriptions: {
      update: (id: string, args: unknown, opts?: unknown) => {
        calls.push({
          method: 'subscriptions.update',
          args: { id, ...(args as object) },
          opts: opts ?? null,
        });
        if (behavior.subscriptionError) return Promise.reject(behavior.subscriptionError);
        return Promise.resolve({ id: behavior.subscriptionResult?.id ?? id });
      },
    },
  };
}

function makeReq(body: Record<string, unknown>, bearer = 'caller-jwt'): Request {
  return new Request('http://localhost/admin-stripe-action', {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Real UUIDv4 fixtures (must match UUID_RE in production code).
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function defaultState(): FakeState {
  return {
    profiles: [
      { id: ADMIN_ID, is_staff: true },
      { id: USER_ID, is_staff: false },
    ],
    rpcCalls: [],
    invokeCalls: [],
    callerUserId: ADMIN_ID,
  };
}

// ============================================================================
// Tests
// ============================================================================

Deno.test('T1 — non-staff caller returns 403 forbidden + no Stripe/RPC calls', async () => {
  const state = defaultState();
  state.callerUserId = USER_ID; // non-staff
  const stripeCalls: FakeStripeCall[] = [];
  __internal.setAdminForTest(makeFakeAdmin(state));
  __internal.setStripeForTest(makeFakeStripe({}, stripeCalls));
  const res = await __internal.handle(
    makeReq({
      operation: 'refund',
      target_user_id: ADMIN_ID,
      charge_id: 'ch_test_123',
      amount_cents: 1000,
    }),
  );
  assertEquals(res.status, 403);
  assertEquals(stripeCalls.length, 0);
  assertEquals(state.rpcCalls.length, 0);
  assertEquals(state.invokeCalls.length, 0);
});

Deno.test('T2 — refund happy: stripe + audit RPC + receipt invoke + idempotency_key shape', async () => {
  const state = defaultState();
  const stripeCalls: FakeStripeCall[] = [];
  __internal.setAdminForTest(makeFakeAdmin(state));
  __internal.setStripeForTest(
    makeFakeStripe({ refundResult: { id: 're_OK', amount: 1500 } }, stripeCalls),
  );
  const res = await __internal.handle(
    makeReq({
      operation: 'refund',
      target_user_id: USER_ID,
      charge_id: 'ch_test_xyz',
      amount_cents: 1500,
      reason: 'duplicate charge',
    }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.refund_id, 're_OK');
  assertEquals(body.amount_refunded, 1500);

  // Stripe call shape
  assertEquals(stripeCalls.length, 1);
  assertEquals(stripeCalls[0]!.method, 'refunds.create');
  const args = stripeCalls[0]!.args as {
    charge: string;
    amount: number;
    reason: string;
    metadata: { admin_id: string };
  };
  assertEquals(args.charge, 'ch_test_xyz');
  assertEquals(args.amount, 1500);
  assertEquals(args.reason, 'requested_by_customer');
  assertEquals(args.metadata.admin_id, ADMIN_ID);
  const opts = stripeCalls[0]!.opts as { idempotencyKey: string };
  assertEquals(opts.idempotencyKey, 'refund-ch_test_xyz-1500');

  // Audit RPC fired
  assertEquals(state.rpcCalls.length, 1);
  assertEquals(state.rpcCalls[0]!.name, 'admin_log_refund');
  assertEquals(state.rpcCalls[0]!.params.p_target_user_id, USER_ID);
  assertEquals(state.rpcCalls[0]!.params.p_charge_id, 'ch_test_xyz');
  assertEquals(state.rpcCalls[0]!.params.p_amount_cents, 1500);
  assertEquals(state.rpcCalls[0]!.params.p_reason, 'duplicate charge');

  // Receipt email triggered
  assertEquals(state.invokeCalls.length, 1);
  assertEquals(state.invokeCalls[0]!.name, 'lifecycle-transactional');
  const invBody = state.invokeCalls[0]!.body as {
    template: string;
    user_id: string;
    data: { refund_id: string; amount_cents: number };
  };
  assertEquals(invBody.template, 'receipt');
  assertEquals(invBody.user_id, USER_ID);
  assertEquals(invBody.data.refund_id, 're_OK');
  assertEquals(invBody.data.amount_cents, 1500);
});

Deno.test('T3 — cancel happy: stripe.subscriptions.update + admin_log_subscription_canceled', async () => {
  const state = defaultState();
  const stripeCalls: FakeStripeCall[] = [];
  __internal.setAdminForTest(makeFakeAdmin(state));
  __internal.setStripeForTest(makeFakeStripe({}, stripeCalls));
  const res = await __internal.handle(
    makeReq({
      operation: 'cancel',
      target_user_id: USER_ID,
      subscription_id: 'sub_test_abc',
    }),
  );
  assertEquals(res.status, 200);

  assertEquals(stripeCalls.length, 1);
  assertEquals(stripeCalls[0]!.method, 'subscriptions.update');
  const args = stripeCalls[0]!.args as { id: string; cancel_at_period_end: boolean };
  assertEquals(args.id, 'sub_test_abc');
  assertEquals(args.cancel_at_period_end, true);

  assertEquals(state.rpcCalls.length, 1);
  assertEquals(state.rpcCalls[0]!.name, 'admin_log_subscription_canceled');
  assertEquals(state.rpcCalls[0]!.params.p_target_user_id, USER_ID);
  assertEquals(state.rpcCalls[0]!.params.p_subscription_id, 'sub_test_abc');

  // Cancel does NOT trigger receipt email (only refund does per UI-SPEC line 387)
  assertEquals(state.invokeCalls.length, 0);
});

Deno.test('T4 — comp happy: trial_end extended + admin_log_subscription_comped', async () => {
  const state = defaultState();
  const stripeCalls: FakeStripeCall[] = [];
  __internal.setAdminForTest(makeFakeAdmin(state));
  __internal.setStripeForTest(makeFakeStripe({}, stripeCalls));
  const before = Math.floor(Date.now() / 1000);
  const res = await __internal.handle(
    makeReq({
      operation: 'comp',
      target_user_id: USER_ID,
      subscription_id: 'sub_test_def',
      comp_days: 30,
    }),
  );
  const after = Math.floor(Date.now() / 1000);
  assertEquals(res.status, 200);

  assertEquals(stripeCalls.length, 1);
  const args = stripeCalls[0]!.args as {
    id: string;
    trial_end: number;
    proration_behavior: string;
  };
  assertEquals(args.id, 'sub_test_def');
  assertEquals(args.proration_behavior, 'none');
  const expectedLow = before + 30 * 86400 - 5;
  const expectedHigh = after + 30 * 86400 + 5;
  assert(
    args.trial_end >= expectedLow && args.trial_end <= expectedHigh,
    `trial_end ${args.trial_end} not in [${expectedLow}, ${expectedHigh}]`,
  );

  assertEquals(state.rpcCalls.length, 1);
  assertEquals(state.rpcCalls[0]!.name, 'admin_log_subscription_comped');
  assertEquals(state.rpcCalls[0]!.params.p_target_user_id, USER_ID);
  assertEquals(state.rpcCalls[0]!.params.p_subscription_id, 'sub_test_def');
  assert(state.rpcCalls[0]!.params.p_trial_end != null);
});

Deno.test('T5 — Stripe error → 502 + audit RPC NOT called', async () => {
  const state = defaultState();
  const stripeCalls: FakeStripeCall[] = [];
  const err = new Error('Your card was declined.') as Error & { code: string };
  err.code = 'card_declined';
  __internal.setAdminForTest(makeFakeAdmin(state));
  __internal.setStripeForTest(makeFakeStripe({ refundError: err }, stripeCalls));
  const res = await __internal.handle(
    makeReq({
      operation: 'refund',
      target_user_id: USER_ID,
      charge_id: 'ch_fail',
      amount_cents: 500,
    }),
  );
  assertEquals(res.status, 502);
  assertEquals(stripeCalls.length, 1); // Stripe WAS called
  assertEquals(state.rpcCalls.length, 0); // but audit NOT called
  assertEquals(state.invokeCalls.length, 0); // and receipt NOT sent
});

Deno.test('T6 — Stripe error response does not echo raw Stripe message', async () => {
  const state = defaultState();
  const stripeCalls: FakeStripeCall[] = [];
  const secretLeak = 'SECRET_CHARGE_INFO_DO_NOT_LEAK_ch_secret_999';
  const err = new Error(secretLeak) as Error & { code: string };
  err.code = 'api_error';
  __internal.setAdminForTest(makeFakeAdmin(state));
  __internal.setStripeForTest(makeFakeStripe({ refundError: err }, stripeCalls));
  const res = await __internal.handle(
    makeReq({
      operation: 'refund',
      target_user_id: USER_ID,
      charge_id: 'ch_leak',
      amount_cents: 100,
    }),
  );
  assertEquals(res.status, 502);
  const text = await res.text();
  assert(!text.includes(secretLeak), `response body leaked Stripe raw message: ${text}`);
  assertStringIncludes(text, 'stripe_'); // sanitized code prefix
});

Deno.test('T7 — idempotency: same (charge, amount) → same idempotencyKey across runs', async () => {
  const state1 = defaultState();
  const calls1: FakeStripeCall[] = [];
  __internal.setAdminForTest(makeFakeAdmin(state1));
  __internal.setStripeForTest(makeFakeStripe({ refundResult: { id: 're_1' } }, calls1));
  await __internal.handle(
    makeReq({
      operation: 'refund',
      target_user_id: USER_ID,
      charge_id: 'ch_dup',
      amount_cents: 2500,
    }),
  );

  const state2 = defaultState();
  const calls2: FakeStripeCall[] = [];
  __internal.setAdminForTest(makeFakeAdmin(state2));
  __internal.setStripeForTest(makeFakeStripe({ refundResult: { id: 're_2' } }, calls2));
  await __internal.handle(
    makeReq({
      operation: 'refund',
      target_user_id: USER_ID,
      charge_id: 'ch_dup',
      amount_cents: 2500,
    }),
  );

  const key1 = (calls1[0]!.opts as { idempotencyKey: string }).idempotencyKey;
  const key2 = (calls2[0]!.opts as { idempotencyKey: string }).idempotencyKey;
  assertEquals(key1, key2);
  assertEquals(key1, 'refund-ch_dup-2500');
});
