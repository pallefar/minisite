/**
 * handler.test.ts — Deno tests for request-refund handler.
 *
 * Phase 65 Plan 65-06 (PAY-08).
 *
 * 12 behavior cases (per <behavior> block of 65-06-PLAN.md):
 *  1.  no JWT returns 401
 *  2.  JWT with no active subscription returns 404 { error: 'no_subscription' }
 *  3.  in-trial (trial_end > now()) created 30 days ago is eligible (window=trial)
 *  4.  no-trial, created 10 days ago is eligible (window=money_back_14d)
 *  5.  no-trial, created 30 days ago returns 403 window_expired + support fallback
 *  6.  eligible refund: stripe.refunds.create invoked with payment_intent + reason
 *  7.  eligible refund: refunds row INSERTed with eligibility_window
 *  8.  eligible refund: stripe.subscriptions.cancel invoked AFTER refunds.create
 *  9.  eligible refund: Resend confirmation email fires with amount + 5-10 days copy
 *  10. Stripe refund fails: refunds row NOT written + sub NOT cancelled + 500
 *  11. Idempotent: 2nd call with existing refund returns 409 refund_already_processed
 *  12. POST body { reason: '<text>' } captures reason into refunds.reason column
 */

import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handle } from '../handler.ts';
import type { RequestRefundDeps } from '../handler.ts';

// ── Constants ───────────────────────────────────────────────────────────────

const MOCK_SUPABASE_URL = 'https://test.supabase.co';
const MOCK_SIGNING_KEY = 'test-signing-key-32byteslongaaaa';
const MOCK_PHYSICAL_ADDRESS = '123 Test Street, San Francisco, CA 94105';
const MOCK_RESEND_API_KEY = 'test-stub';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const USER_EMAIL = 'alice@example.com';
const SUB_ID = 'sub_test_123';
const PAYMENT_INTENT_ID = 'pi_test_abc';

// ── FakeStripe ──────────────────────────────────────────────────────────────

interface FakeStripeCallLog {
  refundsCreate: Array<{ payment_intent: string; reason: string }>;
  subscriptionsCancel: string[];
  invoicesList: Array<{ subscription: string; status: string }>;
}

interface FakeStripeOpts {
  refundResult?: { id: string; amount: number; currency: string; status: string };
  refundShouldThrow?: boolean;
  cancelShouldThrow?: boolean;
  invoiceList?: Array<{ payment_intent: string }>;
}

function buildFakeStripe(opts: FakeStripeOpts = {}) {
  const log: FakeStripeCallLog = {
    refundsCreate: [],
    subscriptionsCancel: [],
    invoicesList: [],
  };

  const refundResult = opts.refundResult ?? {
    id: 're_test_xyz',
    amount: 2999,
    currency: 'usd',
    status: 'succeeded',
  };

  const invoiceList = opts.invoiceList ?? [
    { payment_intent: PAYMENT_INTENT_ID },
  ];

  return {
    log,
    stripe: {
      refunds: {
        // deno-lint-ignore require-await
        create: async (params: { payment_intent: string; reason: string }) => {
          log.refundsCreate.push({ payment_intent: params.payment_intent, reason: params.reason });
          if (opts.refundShouldThrow) {
            throw new Error('stripe_refund_error');
          }
          return refundResult;
        },
      },
      subscriptions: {
        // deno-lint-ignore require-await
        cancel: async (subId: string) => {
          log.subscriptionsCancel.push(subId);
          if (opts.cancelShouldThrow) {
            throw new Error('stripe_cancel_error');
          }
          return { id: subId, status: 'canceled' };
        },
      },
      invoices: {
        // deno-lint-ignore require-await
        list: async (params: { subscription: string; status: string; limit: number }) => {
          log.invoicesList.push({ subscription: params.subscription, status: params.status });
          return { data: invoiceList };
        },
      },
    },
  };
}

// ── FakeAdmin (Supabase client mock) ────────────────────────────────────────

interface FakeAdminOpts {
  userResolved?: { id: string; email: string } | null;
  userErr?: boolean;
  subscription?: {
    id: string;
    user_id: string;
    status: string;
    trial_end: string | null;
    created_at: string;
  } | null;
  existingRefund?: { id: string; stripe_refund_id: string; status: string } | null;
  insertShouldError?: boolean;
}

interface FakeAdminCallLog {
  getUserCalls: string[];
  selectSubscriptionFor: string[];
  selectRefundsFor: string[];
  insertRefundsRows: Array<Record<string, unknown>>;
}

function buildFakeAdmin(opts: FakeAdminOpts = {}) {
  const log: FakeAdminCallLog = {
    getUserCalls: [],
    selectSubscriptionFor: [],
    selectRefundsFor: [],
    insertRefundsRows: [],
  };

  const client = {
    auth: {
      // deno-lint-ignore require-await
      getUser: async (jwt: string) => {
        log.getUserCalls.push(jwt);
        if (opts.userErr || !opts.userResolved) {
          return { data: { user: null }, error: opts.userErr ? new Error('auth') : null };
        }
        return { data: { user: opts.userResolved }, error: null };
      },
    },
    from: (table: string) => {
      if (table === 'subscriptions') {
        return {
          select: (_cols?: string) => ({
            eq: (_col: string, val: string) => {
              log.selectSubscriptionFor.push(val);
              return {
                in: (_col2: string, _vals: string[]) => ({
                  order: (_col3: string, _opts?: unknown) => ({
                    limit: (_n: number) => ({
                      // deno-lint-ignore require-await
                      maybeSingle: async () => ({
                        data: opts.subscription ?? null,
                        error: null,
                      }),
                    }),
                  }),
                }),
              };
            },
          }),
        };
      }
      if (table === 'refunds') {
        return {
          select: (_cols?: string) => ({
            eq: (_col: string, val: string) => {
              log.selectRefundsFor.push(val);
              return {
                in: (_col2: string, _vals: string[]) => ({
                  limit: (_n: number) => ({
                    // deno-lint-ignore require-await
                    maybeSingle: async () => ({
                      data: opts.existingRefund ?? null,
                      error: null,
                    }),
                  }),
                }),
              };
            },
          }),
          insert: (row: Record<string, unknown>) => {
            log.insertRefundsRows.push(row);
            return {
              // deno-lint-ignore require-await
              select: async () => ({
                data: opts.insertShouldError ? null : [row],
                error: opts.insertShouldError ? { message: 'insert error' } : null,
              }),
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  return { log, client };
}

// ── fetchImpl (Resend) recorder ─────────────────────────────────────────────

function buildFetchRecorder(): { calls: Array<{ url: string; body: unknown }>; fetchImpl: typeof fetch } {
  const calls: Array<{ url: string; body: unknown }> = [];
  // deno-lint-ignore require-await
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    let body: unknown = null;
    if (init?.body) {
      try {
        body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, body });
    return new Response(JSON.stringify({ id: 'msg_fake' }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

// ── Helper: build deps + request ────────────────────────────────────────────

function buildDeps(overrides: Partial<RequestRefundDeps> = {}): RequestRefundDeps {
  const { stripe } = buildFakeStripe();
  const { client } = buildFakeAdmin();
  const { fetchImpl } = buildFetchRecorder();
  return {
    fetchImpl,
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: client as any,
    // deno-lint-ignore no-explicit-any
    stripe: stripe as any,
    resendApiKey: MOCK_RESEND_API_KEY,
    supabaseUrl: MOCK_SUPABASE_URL,
    signingKey: MOCK_SIGNING_KEY,
    physicalAddress: MOCK_PHYSICAL_ADDRESS,
    moneyBackDays: 14,
    ...overrides,
  };
}

function postReq(body: unknown, jwt?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
  return new Request('https://example.com/functions/v1/request-refund/', {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
}

const now = () => new Date();
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();
const daysAhead = (n: number) => new Date(Date.now() + n * 86400_000).toISOString();

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('1. no JWT returns 401', async () => {
  const deps = buildDeps();
  const res = await handle(postReq({}), deps);
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'unauthenticated');
});

Deno.test('2. JWT with no active subscription returns 404 no_subscription', async () => {
  const fakeStripe = buildFakeStripe();
  const fakeAdmin = buildFakeAdmin({
    userResolved: { id: USER_ID, email: USER_EMAIL },
    subscription: null,
  });
  const { fetchImpl } = buildFetchRecorder();
  const deps = buildDeps({
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: fakeAdmin.client as any,
    // deno-lint-ignore no-explicit-any
    stripe: fakeStripe.stripe as any,
    fetchImpl,
  });

  const res = await handle(postReq({}, 'jwt-abc'), deps);
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error, 'no_subscription');
  assertEquals(fakeAdmin.log.getUserCalls, ['jwt-abc']);
});

Deno.test('3. in-trial user (trial_end > now) is eligible (window=trial)', async () => {
  const fakeStripe = buildFakeStripe();
  const fakeAdmin = buildFakeAdmin({
    userResolved: { id: USER_ID, email: USER_EMAIL },
    subscription: {
      id: SUB_ID,
      user_id: USER_ID,
      status: 'trialing',
      trial_end: daysAhead(2), // still in trial
      created_at: daysAgo(30), // outside 14d MBG, but trial extends eligibility
    },
  });
  const { fetchImpl } = buildFetchRecorder();
  const deps = buildDeps({
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: fakeAdmin.client as any,
    // deno-lint-ignore no-explicit-any
    stripe: fakeStripe.stripe as any,
    fetchImpl,
  });

  const res = await handle(postReq({ reason: 'changed mind' }, 'jwt-abc'), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  // Insert recorded with eligibility_window=trial
  assertEquals(fakeAdmin.log.insertRefundsRows.length, 1);
  assertEquals(fakeAdmin.log.insertRefundsRows[0].eligibility_window, 'trial');
});

Deno.test('4. no-trial user created 10d ago is eligible (window=money_back_14d)', async () => {
  const fakeStripe = buildFakeStripe();
  const fakeAdmin = buildFakeAdmin({
    userResolved: { id: USER_ID, email: USER_EMAIL },
    subscription: {
      id: SUB_ID,
      user_id: USER_ID,
      status: 'active',
      trial_end: null,
      created_at: daysAgo(10),
    },
  });
  const { fetchImpl } = buildFetchRecorder();
  const deps = buildDeps({
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: fakeAdmin.client as any,
    // deno-lint-ignore no-explicit-any
    stripe: fakeStripe.stripe as any,
    fetchImpl,
  });

  const res = await handle(postReq({}, 'jwt-abc'), deps);
  assertEquals(res.status, 200);
  assertEquals(fakeAdmin.log.insertRefundsRows.length, 1);
  assertEquals(fakeAdmin.log.insertRefundsRows[0].eligibility_window, 'money_back_14d');
});

Deno.test('5. no-trial user created 30d ago returns 403 window_expired with support fallback', async () => {
  const fakeStripe = buildFakeStripe();
  const fakeAdmin = buildFakeAdmin({
    userResolved: { id: USER_ID, email: USER_EMAIL },
    subscription: {
      id: SUB_ID,
      user_id: USER_ID,
      status: 'active',
      trial_end: null,
      created_at: daysAgo(30),
    },
  });
  const deps = buildDeps({
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: fakeAdmin.client as any,
    // deno-lint-ignore no-explicit-any
    stripe: fakeStripe.stripe as any,
  });

  const res = await handle(postReq({}, 'jwt-abc'), deps);
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, 'window_expired');
  assertEquals(body.eligibility_reason, 'past_14d_money_back');
  assertExists(body.support_email);
  assertEquals(body.support_email, 'billing-support@leanshot.app');
  // No refund / cancel calls fired
  assertEquals(fakeStripe.log.refundsCreate.length, 0);
  assertEquals(fakeStripe.log.subscriptionsCancel.length, 0);
});

Deno.test('6. eligible refund: stripe.refunds.create invoked with payment_intent + reason=requested_by_customer', async () => {
  const fakeStripe = buildFakeStripe();
  const fakeAdmin = buildFakeAdmin({
    userResolved: { id: USER_ID, email: USER_EMAIL },
    subscription: {
      id: SUB_ID,
      user_id: USER_ID,
      status: 'active',
      trial_end: null,
      created_at: daysAgo(5),
    },
  });
  const deps = buildDeps({
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: fakeAdmin.client as any,
    // deno-lint-ignore no-explicit-any
    stripe: fakeStripe.stripe as any,
  });

  const res = await handle(postReq({}, 'jwt-abc'), deps);
  assertEquals(res.status, 200);
  assertEquals(fakeStripe.log.refundsCreate.length, 1);
  assertEquals(fakeStripe.log.refundsCreate[0].payment_intent, PAYMENT_INTENT_ID);
  assertEquals(fakeStripe.log.refundsCreate[0].reason, 'requested_by_customer');
});

Deno.test('7. eligible refund: refunds row INSERTed with full audit columns', async () => {
  const fakeStripe = buildFakeStripe();
  const fakeAdmin = buildFakeAdmin({
    userResolved: { id: USER_ID, email: USER_EMAIL },
    subscription: {
      id: SUB_ID,
      user_id: USER_ID,
      status: 'active',
      trial_end: null,
      created_at: daysAgo(5),
    },
  });
  const deps = buildDeps({
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: fakeAdmin.client as any,
    // deno-lint-ignore no-explicit-any
    stripe: fakeStripe.stripe as any,
  });

  const res = await handle(postReq({ reason: 'too expensive' }, 'jwt-abc'), deps);
  assertEquals(res.status, 200);
  assertEquals(fakeAdmin.log.insertRefundsRows.length, 1);
  const row = fakeAdmin.log.insertRefundsRows[0];
  assertEquals(row.subscription_id, SUB_ID);
  assertEquals(row.stripe_refund_id, 're_test_xyz');
  assertEquals(row.stripe_payment_intent_id, PAYMENT_INTENT_ID);
  assertEquals(row.amount_cents, 2999);
  assertEquals(row.currency, 'usd');
  assertEquals(row.status, 'succeeded');
  assertEquals(row.reason, 'too expensive');
  assertEquals(row.eligibility_window, 'money_back_14d');
});

Deno.test('8. eligible refund: stripe.subscriptions.cancel invoked AFTER refunds.create', async () => {
  const callOrder: string[] = [];
  const fakeStripe = buildFakeStripe();
  // Wrap to record order
  const origCreate = fakeStripe.stripe.refunds.create;
  fakeStripe.stripe.refunds.create = async (p: { payment_intent: string; reason: string }) => {
    callOrder.push('refunds.create');
    return await origCreate(p);
  };
  const origCancel = fakeStripe.stripe.subscriptions.cancel;
  fakeStripe.stripe.subscriptions.cancel = async (s: string) => {
    callOrder.push('subscriptions.cancel');
    return await origCancel(s);
  };

  const fakeAdmin = buildFakeAdmin({
    userResolved: { id: USER_ID, email: USER_EMAIL },
    subscription: {
      id: SUB_ID,
      user_id: USER_ID,
      status: 'active',
      trial_end: null,
      created_at: daysAgo(5),
    },
  });
  const deps = buildDeps({
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: fakeAdmin.client as any,
    // deno-lint-ignore no-explicit-any
    stripe: fakeStripe.stripe as any,
  });

  const res = await handle(postReq({}, 'jwt-abc'), deps);
  assertEquals(res.status, 200);
  assertEquals(callOrder, ['refunds.create', 'subscriptions.cancel']);
  assertEquals(fakeStripe.log.subscriptionsCancel, [SUB_ID]);
});

Deno.test('9. eligible refund: Resend confirmation email fires with amount + 5-10 business days copy', async () => {
  const fakeStripe = buildFakeStripe();
  const fakeAdmin = buildFakeAdmin({
    userResolved: { id: USER_ID, email: USER_EMAIL },
    subscription: {
      id: SUB_ID,
      user_id: USER_ID,
      status: 'active',
      trial_end: null,
      created_at: daysAgo(5),
    },
  });
  const recorder = buildFetchRecorder();
  const deps = buildDeps({
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: fakeAdmin.client as any,
    // deno-lint-ignore no-explicit-any
    stripe: fakeStripe.stripe as any,
    fetchImpl: recorder.fetchImpl,
    resendApiKey: 're_test_live_key', // not stub: actually call fetch
  });

  const res = await handle(postReq({}, 'jwt-abc'), deps);
  assertEquals(res.status, 200);
  // 1 Resend call to https://api.resend.com/emails
  const resendCalls = recorder.calls.filter((c) => c.url.includes('resend.com/emails'));
  assertEquals(resendCalls.length, 1);
  // deno-lint-ignore no-explicit-any
  const payload = resendCalls[0].body as any;
  assertEquals(payload.to, [USER_EMAIL]);
  // Subject signals refund processed
  assertExists(payload.subject);
  // Body interpolation
  assertEquals(typeof payload.html, 'string');
  assertEquals(typeof payload.text, 'string');
  // amount = 2999 cents → $29.99
  if (!payload.html.includes('29.99') && !payload.text.includes('29.99')) {
    throw new Error('expected $29.99 in body');
  }
  if (!payload.text.includes('5-10') && !payload.html.includes('5-10')) {
    throw new Error('expected 5-10 business days copy');
  }
});

Deno.test('10. Stripe refund fails: refunds row NOT written + sub NOT cancelled + 500', async () => {
  const fakeStripe = buildFakeStripe({ refundShouldThrow: true });
  const fakeAdmin = buildFakeAdmin({
    userResolved: { id: USER_ID, email: USER_EMAIL },
    subscription: {
      id: SUB_ID,
      user_id: USER_ID,
      status: 'active',
      trial_end: null,
      created_at: daysAgo(5),
    },
  });
  const deps = buildDeps({
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: fakeAdmin.client as any,
    // deno-lint-ignore no-explicit-any
    stripe: fakeStripe.stripe as any,
  });

  const res = await handle(postReq({}, 'jwt-abc'), deps);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error, 'refund_failed');
  assertEquals(fakeAdmin.log.insertRefundsRows.length, 0);
  assertEquals(fakeStripe.log.subscriptionsCancel.length, 0);
});

Deno.test('11. Idempotent: existing succeeded refund returns 409 refund_already_processed', async () => {
  const fakeStripe = buildFakeStripe();
  const fakeAdmin = buildFakeAdmin({
    userResolved: { id: USER_ID, email: USER_EMAIL },
    subscription: {
      id: SUB_ID,
      user_id: USER_ID,
      status: 'active',
      trial_end: null,
      created_at: daysAgo(5),
    },
    existingRefund: { id: 'r-uuid', stripe_refund_id: 're_old_123', status: 'succeeded' },
  });
  const deps = buildDeps({
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: fakeAdmin.client as any,
    // deno-lint-ignore no-explicit-any
    stripe: fakeStripe.stripe as any,
  });

  const res = await handle(postReq({}, 'jwt-abc'), deps);
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error, 'refund_already_processed');
  assertEquals(body.stripe_refund_id, 're_old_123');
  // No Stripe calls
  assertEquals(fakeStripe.log.refundsCreate.length, 0);
  assertEquals(fakeStripe.log.subscriptionsCancel.length, 0);
});

Deno.test('12. POST body reason text captured into refunds.reason column', async () => {
  const fakeStripe = buildFakeStripe();
  const fakeAdmin = buildFakeAdmin({
    userResolved: { id: USER_ID, email: USER_EMAIL },
    subscription: {
      id: SUB_ID,
      user_id: USER_ID,
      status: 'active',
      trial_end: null,
      created_at: daysAgo(5),
    },
  });
  const deps = buildDeps({
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: fakeAdmin.client as any,
    // deno-lint-ignore no-explicit-any
    stripe: fakeStripe.stripe as any,
  });

  const userReason = 'Did not match my expectations for GLP-1 tracking';
  const res = await handle(postReq({ reason: userReason }, 'jwt-abc'), deps);
  assertEquals(res.status, 200);
  assertEquals(fakeAdmin.log.insertRefundsRows[0].reason, userReason);
});

// ─── Extra: CAN-SPAM placeholder guard (WR-02) ──────────────────────────────

Deno.test('CAN-SPAM guard: missing/placeholder PHYSICAL_ADDRESS returns 503', async () => {
  const fakeStripe = buildFakeStripe();
  const fakeAdmin = buildFakeAdmin({
    userResolved: { id: USER_ID, email: USER_EMAIL },
    subscription: {
      id: SUB_ID,
      user_id: USER_ID,
      status: 'active',
      trial_end: null,
      created_at: daysAgo(5),
    },
  });
  const deps = buildDeps({
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: fakeAdmin.client as any,
    // deno-lint-ignore no-explicit-any
    stripe: fakeStripe.stripe as any,
    physicalAddress: '[REPLACE_ME]',
  });

  const res = await handle(postReq({}, 'jwt-abc'), deps);
  assertEquals(res.status, 503);
  const body = await res.json();
  assertEquals(body.error, 'can_spam_address_not_configured');
});

// ─── Extra: GET /healthz ────────────────────────────────────────────────────

Deno.test('GET /healthz returns 200 ok', async () => {
  const deps = buildDeps();
  const req = new Request('https://example.com/functions/v1/request-refund/healthz', {
    method: 'GET',
  });
  const res = await handle(req, deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(body.fn, 'request-refund');
});
