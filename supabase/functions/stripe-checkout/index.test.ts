/**
 * Deno test suite for `stripe-checkout` Edge Function — Phase 14 Plan 14-04.
 *
 * Test list mirrors the plan's <behavior>:
 *   1. session: missing JWT → 401
 *   2. session: web plan happy-path → 200 + correct Stripe params
 *   3. portal: no subscription → 404 + no Stripe call
 *   4. session: clinic plan → 200 + 2 line_items (A3 PASS variant)
 *
 * Mock strategy: module-level __setStripeForTest / __setAdminForTest from
 * index.ts, which replaces the singleton instances before the handlers run.
 * Environment variables are set before the dynamic import.
 */

// ---------------------------------------------------------------------------
// Env vars — must be set before importing index.ts (ESM hoisting)
// ---------------------------------------------------------------------------
Deno.env.set('SUPABASE_URL', 'https://stub.supabase.co');
Deno.env.set('SUPABASE_ANON_KEY', 'stub-anon');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'stub-service-role');
Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_dummy');
Deno.env.set('STRIPE_PRICE_PLUS_MONTHLY', 'price_monthly_test');
Deno.env.set('STRIPE_PRICE_PLUS_YEARLY', 'price_yearly_test');
Deno.env.set('STRIPE_PRICE_CLINIC_BASE', 'price_base_test');
Deno.env.set('STRIPE_PRICE_CLINIC_OVERAGE', 'price_overage_test');
Deno.env.set('STRIPE_PRICE_LIFETIME', 'price_lifetime_test');
Deno.env.set('PUBLIC_APP_ORIGIN', 'https://test.local');

import { assertEquals, assertExists } from 'jsr:@std/assert';
import { __internal, __setStripeForTest, __setAdminForTest } from './index.ts';

const { handleSession, handlePortal } = __internal;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal spy that records calls and returns a fixed value. */
function makeSpy<T>(returnValue: T): { fn: (...args: unknown[]) => Promise<T>; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const fn = (...args: unknown[]): Promise<T> => {
    calls.push(args);
    return Promise.resolve(returnValue);
  };
  return { fn, calls };
}

/** Build a spy that throws when called (assert side-effect-free). */
function makeThrowSpy(message: string): { fn: () => never; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const fn = (): never => {
    calls.push([]);
    throw new Error(`Should not be called: ${message}`);
  };
  return { fn, calls };
}

/** Build a Stripe stub with configurable spies. */
interface StripeStub {
  checkout: { sessions: { create: { fn: (...a: unknown[]) => Promise<unknown>; calls: unknown[][] } } };
  billingPortal: { sessions: { create: { fn: (...a: unknown[]) => Promise<unknown>; calls: unknown[][] } } };
  customers: { create: { fn: (...a: unknown[]) => Promise<unknown>; calls: unknown[][] } };
}

function makeStripeStub(opts?: {
  sessionUrl?: string;
  portalUrl?: string;
  customerCreate?: unknown;
  portalThrows?: boolean;
}): StripeStub {
  const sessionSpy = makeSpy({ url: opts?.sessionUrl ?? 'https://checkout.stripe.com/c/pay/cs_test_abc' });
  const customerSpy = makeSpy(opts?.customerCreate ?? { id: 'cus_new_999' });
  let portalSpy: { fn: (...a: unknown[]) => unknown; calls: unknown[][] };
  if (opts?.portalThrows) {
    const t = makeThrowSpy('billingPortal.sessions.create should not be called');
    portalSpy = t;
  } else {
    portalSpy = makeSpy({ url: opts?.portalUrl ?? 'https://billing.stripe.com/session/test_portal' });
  }

  return {
    checkout: { sessions: { create: sessionSpy } },
    billingPortal: { sessions: { create: portalSpy as typeof sessionSpy } },
    customers: { create: customerSpy },
  };
}

/** Proxy the StripeStub so all methods are directly callable (not via .fn). */
function asStripeProxy(stub: StripeStub): unknown {
  return {
    checkout: {
      sessions: {
        create: (...args: unknown[]) => stub.checkout.sessions.create.fn(...args),
      },
    },
    billingPortal: {
      sessions: {
        create: (...args: unknown[]) => stub.billingPortal.sessions.create.fn(...args),
      },
    },
    customers: {
      create: (...args: unknown[]) => stub.customers.create.fn(...args),
    },
  };
}

/**
 * Build a fake Supabase admin client. The `tables` map is keyed by table name
 * and maps to the value returned by `.maybeSingle()`.
 *
 * auth.getUser resolves to { data: { user: <user> }, error: null } when user is
 * truthy, otherwise { data: { user: null }, error: 'unauthenticated' }.
 */
function makeFakeAdmin(opts: {
  user?: { id: string; email?: string } | null;
  tables?: Record<string, unknown>;
}): unknown {
  const { user = null, tables = {} } = opts;

  // Chainable query builder that always returns the staged value.
  function makeChain(value: unknown) {
    const chain = {
      select: (_: string) => chain,
      eq: (_: string, __: unknown) => chain,
      is: (_: string, __: unknown) => chain,
      insert: (_: unknown) => Promise.resolve({ data: null, error: null }),
      maybeSingle: () => Promise.resolve({ data: value, error: null }),
    };
    return chain;
  }

  const fakeAdmin = {
    auth: {
      getUser: (_jwt: string) => {
        if (user) {
          return Promise.resolve({ data: { user }, error: null });
        }
        return Promise.resolve({ data: { user: null }, error: 'unauthenticated' });
      },
    },
    from: (table: string) => {
      const staged = tables[table] ?? null;
      const baseChain = makeChain(staged);
      // For insert, we need to return a promise directly.
      return {
        ...baseChain,
        select: (_: string) => baseChain,
        insert: (_: unknown) => Promise.resolve({ data: null, error: null }),
      };
    },
    // Phase 43 Plan 04: stripe-checkout calls admin.rpc('resolve_user_effective_price').
    // Default to null (vendor-gated-send falls through to env helper).
    rpc: (_name: string, _args: unknown) => Promise.resolve({ data: null, error: null }),
  };
  return fakeAdmin;
}

/**
 * Build a fake admin that allows per-operation responses via a stateful queue.
 * Each call to from(table) pops the next response for that table.
 */
function makeQueueAdmin(opts: {
  user?: { id: string; email?: string } | null;
  queues: Record<string, unknown[]>;
}): unknown {
  const { user = null, queues } = opts;
  const counters: Record<string, number> = {};

  function makeChain(value: unknown) {
    const chain = {
      select: (_: string) => chain,
      eq: (_: string, __: unknown) => chain,
      is: (_: string, __: unknown) => chain,
      insert: (_: unknown) => Promise.resolve({ data: null, error: null }),
      maybeSingle: () => Promise.resolve({ data: value, error: null }),
    };
    return chain;
  }

  return {
    auth: {
      getUser: (_jwt: string) => {
        if (user) {
          return Promise.resolve({ data: { user }, error: null });
        }
        return Promise.resolve({ data: { user: null }, error: 'unauthenticated' });
      },
    },
    from: (table: string) => {
      const q = queues[table] ?? [];
      const idx = counters[table] ?? 0;
      counters[table] = idx + 1;
      const staged = q[idx] ?? null;
      const baseChain = makeChain(staged);
      return {
        ...baseChain,
        select: (_: string) => baseChain,
        insert: (_: unknown) => Promise.resolve({ data: null, error: null }),
      };
    },
    // Phase 43 Plan 04: rpc stub. clinic-mode (the consumer of makeQueueAdmin)
    // doesn't call rpc, so null is safe.
    rpc: (_name: string, _args: unknown) => Promise.resolve({ data: null, error: null }),
  };
}

// ---------------------------------------------------------------------------
// Test 1: session — missing JWT → 401
// ---------------------------------------------------------------------------

Deno.test({
  name: 'session: missing JWT → 401 unauthenticated',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = new Request('http://localhost/functions/v1/stripe-checkout/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await handleSession(req);
    assertEquals(res.status, 401);
    const body = await res.json();
    assertEquals(body, { error: 'unauthenticated' });
  },
});

// ---------------------------------------------------------------------------
// Test 2: session — web plan happy-path → 200 + correct Stripe params
// ---------------------------------------------------------------------------

Deno.test({
  name: 'session: web plan happy-path → 200 + correct Stripe params',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({
      sessionUrl: 'https://checkout.stripe.com/c/pay/cs_test_abc',
    });
    __setStripeForTest(asStripeProxy(stripeStub));

    // Admin: auth user exists; stripe_customers has existing row.
    const fakeAdmin = makeFakeAdmin({
      user: { id: 'user-uuid-1', email: 'a@b.com' },
      tables: {
        stripe_customers: { stripe_customer_id: 'cus_existing_123' },
      },
    });
    __setAdminForTest(fakeAdmin);

    const req = new Request('http://localhost/functions/v1/stripe-checkout/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer stub-jwt',
      },
      body: JSON.stringify({ plan: 'plus_monthly' }),
    });

    const res = await handleSession(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertExists(body.url);
    assertEquals(body.url, 'https://checkout.stripe.com/c/pay/cs_test_abc');

    // Assert Stripe was called exactly once with the correct params.
    const { calls } = stripeStub.checkout.sessions.create;
    assertEquals(calls.length, 1);
    const params = calls[0]![0] as Record<string, unknown>;

    assertEquals(params['mode'], 'subscription');
    assertEquals(params['payment_method_collection'], 'always');
    assertEquals(params['customer'], 'cus_existing_123');

    const subData = params['subscription_data'] as Record<string, unknown>;
    assertEquals(subData['trial_period_days'], 7);

    const meta = subData['metadata'] as Record<string, string>;
    assertEquals(meta['user_id'], 'user-uuid-1');
    assertEquals(meta['tier_kind'], 'web');

    const lineItems = params['line_items'] as Array<{ price: string; quantity: number }>;
    assertEquals(lineItems.length, 1);
    assertEquals(lineItems[0]!.price, 'price_monthly_test');
    assertEquals(lineItems[0]!.quantity, 1);
  },
});

// ---------------------------------------------------------------------------
// Test 3: portal — no subscription → 404 + no Stripe call
// ---------------------------------------------------------------------------

Deno.test({
  name: 'portal: no subscription → 404 + no Stripe call',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({ portalThrows: true });
    __setStripeForTest(asStripeProxy(stripeStub));

    // Admin: auth user exists; stripe_customers has NO row.
    const fakeAdmin = makeFakeAdmin({
      user: { id: 'user-uuid-1', email: 'a@b.com' },
      tables: {
        stripe_customers: null, // no row
      },
    });
    __setAdminForTest(fakeAdmin);

    const req = new Request('http://localhost/functions/v1/stripe-checkout/portal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer stub-jwt',
      },
      body: JSON.stringify({}),
    });

    const res = await handlePortal(req);
    assertEquals(res.status, 404);
    const body = await res.json();
    assertEquals(body, { error: 'no_subscription' });

    // Portal spy must NOT have been called.
    assertEquals(stripeStub.billingPortal.sessions.create.calls.length, 0);
  },
});

// ---------------------------------------------------------------------------
// Test 4: session — clinic plan → 200 + 2 line_items (A3 PASS variant)
// ---------------------------------------------------------------------------

Deno.test({
  name: 'session: clinic plan → 200 + 2 line_items (A3 PASS)',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({
      sessionUrl: 'https://checkout.stripe.com/c/pay/cs_test_clinic',
    });
    __setStripeForTest(asStripeProxy(stripeStub));

    // We need the admin to return:
    // 1. auth.getUser → user
    // 2. from('memberships').maybeSingle() → owner row
    // 3. from('clinic_stripe_customers').maybeSingle() → existing customer row
    //
    // Using queue-based admin to serve responses in order per table.
    const fakeAdmin = makeQueueAdmin({
      user: { id: 'user-uuid-1', email: 'owner@clinic.com' },
      queues: {
        // First call to memberships → returns owner row
        memberships: [{ id: 'mbr-1', roles: { name: 'Owner' } }],
        // First call to clinic_stripe_customers → returns existing customer
        clinic_stripe_customers: [{ stripe_customer_id: 'cus_clinic_456' }],
      },
    });
    __setAdminForTest(fakeAdmin);

    const clinicId = '00000000-0000-0000-0000-000000000001';
    const req = new Request('http://localhost/functions/v1/stripe-checkout/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer stub-jwt',
      },
      body: JSON.stringify({ plan: 'clinic', clinic_id: clinicId }),
    });

    const res = await handleSession(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertExists(body.url);

    // Assert Stripe was called exactly once with 2 line_items.
    const { calls } = stripeStub.checkout.sessions.create;
    assertEquals(calls.length, 1);
    const params = calls[0]![0] as Record<string, unknown>;

    const lineItems = params['line_items'] as Array<{ price: string; quantity: number }>;
    assertEquals(lineItems.length, 2);

    // Order-independent check for both price IDs.
    const priceIds = new Set(lineItems.map((li) => li.price));
    assertEquals(priceIds.has('price_base_test'), true);
    assertEquals(priceIds.has('price_overage_test'), true);

    // Both must have quantity: 1.
    for (const li of lineItems) {
      assertEquals(li.quantity, 1);
    }

    // Check metadata.
    const subData = params['subscription_data'] as Record<string, unknown>;
    const meta = subData['metadata'] as Record<string, string>;
    assertEquals(meta['clinic_id'], clinicId);
    assertEquals(meta['tier_kind'], 'clinic');

    // Check customer.
    assertEquals(params['customer'], 'cus_clinic_456');
  },
});

// ---------------------------------------------------------------------------
// Phase 19 Plan 19-04 — affiliate-code propagation tests (AFF-02, D-23)
// ---------------------------------------------------------------------------
//
// These tests cover the new ?aff= / ?aff_manual= / _aff cookie precedence and
// the addition of aff_code to subscription_data.metadata + session.metadata.
// They reuse the same module-level __setStripeForTest / __setAdminForTest seams.

Deno.test({
  name: '19-04 / Test A: ?aff= + approved affiliate → aff_code in all 3 metadata slots',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({});
    __setStripeForTest(asStripeProxy(stripeStub));

    const fakeAdmin = makeFakeAdmin({
      user: { id: 'user-uuid-1', email: 'a@b.com' },
      tables: {
        affiliates: { id: 'aff-1', status: 'approved' },
        stripe_customers: { stripe_customer_id: 'cus_existing_123' },
      },
    });
    __setAdminForTest(fakeAdmin);

    const req = new Request(
      'http://localhost/functions/v1/stripe-checkout/session?aff=valid-code',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer stub-jwt',
        },
        body: JSON.stringify({ plan: 'plus_monthly' }),
      },
    );

    const res = await handleSession(req);
    assertEquals(res.status, 200);

    const { calls } = stripeStub.checkout.sessions.create;
    assertEquals(calls.length, 1);
    const params = calls[0]![0] as Record<string, unknown>;

    // Session-level metadata.aff_code
    const sessMeta = params['metadata'] as Record<string, string>;
    assertEquals(sessMeta['aff_code'], 'valid-code');

    // subscription_data.metadata.aff_code (canonical — survives renewals).
    const subData = params['subscription_data'] as Record<string, unknown>;
    const subMeta = subData['metadata'] as Record<string, string>;
    assertEquals(subMeta['aff_code'], 'valid-code');

    // client_reference_id unchanged from Phase 14 contract (user.id here).
    assertEquals(params['client_reference_id'], 'user-uuid-1');
  },
});

Deno.test({
  name: '19-04 / Test B: ?aff= + non-approved affiliate (status=pending) → aff_code is empty string',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({});
    __setStripeForTest(asStripeProxy(stripeStub));

    const fakeAdmin = makeFakeAdmin({
      user: { id: 'user-uuid-1', email: 'a@b.com' },
      tables: {
        affiliates: { id: 'aff-pending', status: 'pending' },
        stripe_customers: { stripe_customer_id: 'cus_existing_123' },
      },
    });
    __setAdminForTest(fakeAdmin);

    const req = new Request(
      'http://localhost/functions/v1/stripe-checkout/session?aff=pending-code',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer stub-jwt',
        },
        body: JSON.stringify({ plan: 'plus_monthly' }),
      },
    );

    const res = await handleSession(req);
    assertEquals(res.status, 200);

    const params = stripeStub.checkout.sessions.create.calls[0]![0] as Record<string, unknown>;
    const subData = params['subscription_data'] as Record<string, unknown>;
    const subMeta = subData['metadata'] as Record<string, string>;
    assertEquals(subMeta['aff_code'], '');
  },
});

Deno.test({
  name: '19-04 / Test C: ?aff=invalid!chars → regex drops, aff_code is empty string',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({});
    __setStripeForTest(asStripeProxy(stripeStub));

    const fakeAdmin = makeFakeAdmin({
      user: { id: 'user-uuid-1', email: 'a@b.com' },
      tables: {
        stripe_customers: { stripe_customer_id: 'cus_existing_123' },
      },
    });
    __setAdminForTest(fakeAdmin);

    const req = new Request(
      'http://localhost/functions/v1/stripe-checkout/session?aff=' + encodeURIComponent('invalid!chars'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer stub-jwt',
        },
        body: JSON.stringify({ plan: 'plus_monthly' }),
      },
    );

    const res = await handleSession(req);
    assertEquals(res.status, 200);

    const params = stripeStub.checkout.sessions.create.calls[0]![0] as Record<string, unknown>;
    const subData = params['subscription_data'] as Record<string, unknown>;
    const subMeta = subData['metadata'] as Record<string, string>;
    assertEquals(subMeta['aff_code'], '');
  },
});

Deno.test({
  name: '19-04 / Test D: no ?aff= + _aff cookie + approved → cookie fallback wins',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({});
    __setStripeForTest(asStripeProxy(stripeStub));

    const fakeAdmin = makeFakeAdmin({
      user: { id: 'user-uuid-1', email: 'a@b.com' },
      tables: {
        affiliates: { id: 'aff-1', status: 'approved' },
        stripe_customers: { stripe_customer_id: 'cus_existing_123' },
      },
    });
    __setAdminForTest(fakeAdmin);

    const req = new Request('http://localhost/functions/v1/stripe-checkout/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer stub-jwt',
        Cookie: '_aff=cookie-code',
      },
      body: JSON.stringify({ plan: 'plus_monthly' }),
    });

    const res = await handleSession(req);
    assertEquals(res.status, 200);

    const params = stripeStub.checkout.sessions.create.calls[0]![0] as Record<string, unknown>;
    const subData = params['subscription_data'] as Record<string, unknown>;
    const subMeta = subData['metadata'] as Record<string, string>;
    assertEquals(subMeta['aff_code'], 'cookie-code');
  },
});

Deno.test({
  name: '19-04 / Test E: ?aff_manual=<code> (BL-1 / D-23 manual-entry path) + approved → propagated',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({});
    __setStripeForTest(asStripeProxy(stripeStub));

    const fakeAdmin = makeFakeAdmin({
      user: { id: 'user-uuid-1', email: 'a@b.com' },
      tables: {
        affiliates: { id: 'aff-1', status: 'approved' },
        stripe_customers: { stripe_customer_id: 'cus_existing_123' },
      },
    });
    __setAdminForTest(fakeAdmin);

    const req = new Request(
      'http://localhost/functions/v1/stripe-checkout/session?aff_manual=manual-code',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer stub-jwt',
        },
        body: JSON.stringify({ plan: 'plus_monthly' }),
      },
    );

    const res = await handleSession(req);
    assertEquals(res.status, 200);

    const params = stripeStub.checkout.sessions.create.calls[0]![0] as Record<string, unknown>;
    const subData = params['subscription_data'] as Record<string, unknown>;
    const subMeta = subData['metadata'] as Record<string, string>;
    assertEquals(subMeta['aff_code'], 'manual-code');
  },
});

Deno.test({
  name: '19-04 / Test F: no aff= and no cookie and no aff_manual= leaves aff_code empty',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({});
    __setStripeForTest(asStripeProxy(stripeStub));

    const fakeAdmin = makeFakeAdmin({
      user: { id: 'user-uuid-1', email: 'a@b.com' },
      tables: {
        stripe_customers: { stripe_customer_id: 'cus_existing_123' },
      },
    });
    __setAdminForTest(fakeAdmin);

    const req = new Request('http://localhost/functions/v1/stripe-checkout/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer stub-jwt',
      },
      body: JSON.stringify({ plan: 'plus_monthly' }),
    });

    const res = await handleSession(req);
    assertEquals(res.status, 200);

    const params = stripeStub.checkout.sessions.create.calls[0]![0] as Record<string, unknown>;
    const subData = params['subscription_data'] as Record<string, unknown>;
    const subMeta = subData['metadata'] as Record<string, string>;
    assertEquals(subMeta['aff_code'], '');
  },
});

// =============================================================================
// Phase 43 Plan 04 — lifetime branch + grandfathered resolver + 70%-cap tests
// =============================================================================

/**
 * Build a fake admin that supports:
 *   - auth.getUser
 *   - from(table).select.eq.maybeSingle (existing pattern)
 *   - from(table).select.eq.eq.order.limit.maybeSingle (cancellation_offers_log)
 *   - rpc(name, args) → returns staged value
 */
function makeP43Admin(opts: {
  user?: { id: string; email?: string } | null;
  tables?: Record<string, unknown>;
  rpcs?: Record<string, unknown>;
  rpcCalls?: Array<{ name: string; args: unknown }>;
}): unknown {
  const { user = null, tables = {}, rpcs = {}, rpcCalls = [] } = opts;

  function makeChain(value: unknown) {
    const chain: Record<string, unknown> = {};
    chain['select'] = (_: string) => chain;
    chain['eq'] = (_: string, __: unknown) => chain;
    chain['is'] = (_: string, __: unknown) => chain;
    chain['order'] = (_: string, __: unknown) => chain;
    chain['limit'] = (_: number) => chain;
    chain['insert'] = (_: unknown) => Promise.resolve({ data: null, error: null });
    chain['maybeSingle'] = () => Promise.resolve({ data: value, error: null });
    return chain;
  }

  const fakeAdmin = {
    auth: {
      getUser: (_jwt: string) => {
        if (user) return Promise.resolve({ data: { user }, error: null });
        return Promise.resolve({ data: { user: null }, error: 'unauthenticated' });
      },
    },
    from: (table: string) => {
      const staged = tables[table] ?? null;
      const baseChain = makeChain(staged);
      return {
        ...baseChain,
        select: (_: string) => baseChain,
        insert: (_: unknown) => Promise.resolve({ data: null, error: null }),
      };
    },
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      const v = Object.prototype.hasOwnProperty.call(rpcs, name) ? rpcs[name] : null;
      return Promise.resolve({ data: v, error: null });
    },
  };
  return fakeAdmin;
}

// --- 43-04 / Test 1: lifetime + no promo → 200, mode=payment ---------------

Deno.test({
  name: '43-04 / Test 1: lifetime + no promo → mode=payment + resolved price',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({});
    __setStripeForTest(asStripeProxy(stripeStub));

    const rpcCalls: Array<{ name: string; args: unknown }> = [];
    const fakeAdmin = makeP43Admin({
      user: { id: 'user-uuid-LT', email: 'lt@test.com' },
      tables: { stripe_customers: { stripe_customer_id: 'cus_lifetime_1' } },
      rpcs: { resolve_user_effective_price: 'price_LIFETIME_DEFAULT' },
      rpcCalls,
    });
    __setAdminForTest(fakeAdmin);

    const req = new Request('http://localhost/functions/v1/stripe-checkout/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer stub-jwt' },
      body: JSON.stringify({ plan: 'lifetime' }),
    });

    const res = await handleSession(req);
    assertEquals(res.status, 200);

    const { calls } = stripeStub.checkout.sessions.create;
    assertEquals(calls.length, 1);
    const params = calls[0]![0] as Record<string, unknown>;

    assertEquals(params['mode'], 'payment');
    assertEquals(params['subscription_data'], undefined);

    const pid = params['payment_intent_data'] as Record<string, unknown>;
    const pidMeta = pid['metadata'] as Record<string, string>;
    assertEquals(pidMeta['tier_kind'], 'lifetime');
    assertEquals(pidMeta['user_id'], 'user-uuid-LT');

    const lineItems = params['line_items'] as Array<{ price: string; quantity: number }>;
    assertEquals(lineItems.length, 1);
    assertEquals(lineItems[0]!.price, 'price_LIFETIME_DEFAULT');

    const lt = rpcCalls.find((c) => c.name === 'resolve_user_effective_price');
    assertExists(lt);
    assertEquals((lt!.args as { p_plan: string }).p_plan, 'lifetime');
    assertEquals((lt!.args as { p_user_id: string }).p_user_id, 'user-uuid-LT');
  },
});

// --- 43-04 / Test 2: lifetime + promo → 400 lifetime_no_promo_code ----------

Deno.test({
  name: '43-04 / Test 2: lifetime + promo_code → 400 lifetime_no_promo_code',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({});
    __setStripeForTest(asStripeProxy(stripeStub));

    const fakeAdmin = makeP43Admin({
      user: { id: 'user-uuid-LT2', email: 'lt2@test.com' },
      tables: { stripe_customers: { stripe_customer_id: 'cus_lt_2' } },
      rpcs: { resolve_user_effective_price: 'price_LIFETIME_DEFAULT' },
    });
    __setAdminForTest(fakeAdmin);

    const req = new Request('http://localhost/functions/v1/stripe-checkout/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer stub-jwt' },
      body: JSON.stringify({ plan: 'lifetime', promo_code: 'WELCOMEBACK' }),
    });

    const res = await handleSession(req);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body, { error: 'lifetime_no_promo_code' });

    assertEquals(stripeStub.checkout.sessions.create.calls.length, 0);
  },
});

// --- 43-04 / Test 3: plus_monthly resolves via RPC → grandfathered price ----

Deno.test({
  name: '43-04 / Test 3: plus_monthly resolves via RPC + grandfathered price used',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({});
    __setStripeForTest(asStripeProxy(stripeStub));

    const rpcCalls: Array<{ name: string; args: unknown }> = [];
    const fakeAdmin = makeP43Admin({
      user: { id: 'user-uuid-GF', email: 'gf@test.com' },
      tables: { stripe_customers: { stripe_customer_id: 'cus_gf_1' } },
      rpcs: { resolve_user_effective_price: 'price_GRANDFATHERED_X' },
      rpcCalls,
    });
    __setAdminForTest(fakeAdmin);

    const req = new Request('http://localhost/functions/v1/stripe-checkout/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer stub-jwt' },
      body: JSON.stringify({ plan: 'plus_monthly' }),
    });

    const res = await handleSession(req);
    assertEquals(res.status, 200);

    const params = stripeStub.checkout.sessions.create.calls[0]![0] as Record<string, unknown>;
    const lineItems = params['line_items'] as Array<{ price: string; quantity: number }>;
    assertEquals(lineItems[0]!.price, 'price_GRANDFATHERED_X');

    const gf = rpcCalls.find((c) => c.name === 'resolve_user_effective_price');
    assertExists(gf);
    assertEquals((gf!.args as { p_plan: string }).p_plan, 'plus_monthly');
  },
});

// --- 43-04 / Test 4: plus_monthly + promo above cap → 400 ------------------

Deno.test({
  name: '43-04 / Test 4: clamp exceeds → 400 discount_combination_exceeds_max',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const sessionSpy = makeSpy({ url: 'https://checkout.stripe.com/c/pay/should_not_call' });
    const couponSpy = makeSpy({ id: 'PROMO50', percent_off: 50 });
    const customerSpy = makeSpy({ id: 'cus_new_clamp' });

    const stripeProxy = {
      checkout: { sessions: { create: (...a: unknown[]) => sessionSpy.fn(...a) } },
      coupons: { retrieve: (...a: unknown[]) => couponSpy.fn(...a) },
      customers: { create: (...a: unknown[]) => customerSpy.fn(...a) },
      billingPortal: { sessions: { create: () => Promise.resolve({ url: '' }) } },
    };
    __setStripeForTest(stripeProxy);

    const fakeAdmin = makeP43Admin({
      user: { id: 'user-uuid-CL', email: 'cl@test.com' },
      tables: {
        stripe_customers: { stripe_customer_id: 'cus_clamp_1' },
        cancellation_offers_log: { offer_payload: { offer_type: 'discount', percent_off: 50 } },
      },
      rpcs: { resolve_user_effective_price: 'price_GRANDFATHERED_X' },
    });
    __setAdminForTest(fakeAdmin);

    const req = new Request('http://localhost/functions/v1/stripe-checkout/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer stub-jwt' },
      body: JSON.stringify({ plan: 'plus_monthly', promo_code: 'PROMO50' }),
    });

    const res = await handleSession(req);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body, { error: 'discount_combination_exceeds_max' });

    assertEquals(sessionSpy.calls.length, 0);
  },
});

// --- 43-04 / Test 5: empty price → 503 vendor_unconfigured -----------------

Deno.test({
  name: '43-04 / Test 5: empty price → 503 vendor_unconfigured',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({});
    __setStripeForTest(asStripeProxy(stripeStub));

    Deno.env.set('STRIPE_PRICE_LIFETIME', '');

    const fakeAdmin = makeP43Admin({
      user: { id: 'user-uuid-VG', email: 'vg@test.com' },
      tables: { stripe_customers: { stripe_customer_id: 'cus_vg_1' } },
      rpcs: { resolve_user_effective_price: null },
    });
    __setAdminForTest(fakeAdmin);

    const req = new Request('http://localhost/functions/v1/stripe-checkout/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer stub-jwt' },
      body: JSON.stringify({ plan: 'lifetime' }),
    });

    const res = await handleSession(req);
    Deno.env.set('STRIPE_PRICE_LIFETIME', 'price_lifetime_test');

    assertEquals(res.status, 503);
    const body = await res.json();
    assertEquals(body, { error: 'vendor_unconfigured' });

    assertEquals(stripeStub.checkout.sessions.create.calls.length, 0);
  },
});

// =============================================================================
// Phase 65 Plan 03 — Stripe Tax + B2B tax_id_collection tests (PAY-01/02/03)
// =============================================================================
//
// Per CONTEXT.md D-01/D-02/D-03:
// - Every session: automatic_tax: { enabled: true } + customer_update: { address: 'auto', name: 'auto' }
// - Clinic sessions ONLY: tax_id_collection: { enabled: true }
// - Consumer (web + lifetime) sessions: NO tax_id_collection
// - Stripe Tax must be enabled in Dashboard (operator gate via Plan 65-10) — code
//   ships the flag unconditionally; deploy-time smoke test ratifies enablement.

Deno.test({
  name: '65-03 / Test 1: web subscription session includes automatic_tax: { enabled: true }',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({});
    __setStripeForTest(asStripeProxy(stripeStub));

    const fakeAdmin = makeFakeAdmin({
      user: { id: 'user-uuid-T1', email: 't1@test.com' },
      tables: { stripe_customers: { stripe_customer_id: 'cus_t1' } },
    });
    __setAdminForTest(fakeAdmin);

    const req = new Request('http://localhost/functions/v1/stripe-checkout/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer stub-jwt' },
      body: JSON.stringify({ plan: 'plus_monthly' }),
    });

    const res = await handleSession(req);
    assertEquals(res.status, 200);

    const params = stripeStub.checkout.sessions.create.calls[0]![0] as Record<string, unknown>;
    const autoTax = params['automatic_tax'] as Record<string, unknown>;
    assertExists(autoTax);
    assertEquals(autoTax['enabled'], true);
  },
});

Deno.test({
  name: '65-03 / Test 2: web subscription session includes customer_update: { address: auto, name: auto }',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({});
    __setStripeForTest(asStripeProxy(stripeStub));

    const fakeAdmin = makeFakeAdmin({
      user: { id: 'user-uuid-T2', email: 't2@test.com' },
      tables: { stripe_customers: { stripe_customer_id: 'cus_t2' } },
    });
    __setAdminForTest(fakeAdmin);

    const req = new Request('http://localhost/functions/v1/stripe-checkout/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer stub-jwt' },
      body: JSON.stringify({ plan: 'plus_monthly' }),
    });

    const res = await handleSession(req);
    assertEquals(res.status, 200);

    const params = stripeStub.checkout.sessions.create.calls[0]![0] as Record<string, unknown>;
    const custUpdate = params['customer_update'] as Record<string, unknown>;
    assertExists(custUpdate);
    assertEquals(custUpdate['address'], 'auto');
    assertEquals(custUpdate['name'], 'auto');
  },
});

Deno.test({
  name: '65-03 / Test 3: web subscription session does NOT include tax_id_collection',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({});
    __setStripeForTest(asStripeProxy(stripeStub));

    const fakeAdmin = makeFakeAdmin({
      user: { id: 'user-uuid-T3', email: 't3@test.com' },
      tables: { stripe_customers: { stripe_customer_id: 'cus_t3' } },
    });
    __setAdminForTest(fakeAdmin);

    const req = new Request('http://localhost/functions/v1/stripe-checkout/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer stub-jwt' },
      body: JSON.stringify({ plan: 'plus_monthly' }),
    });

    const res = await handleSession(req);
    assertEquals(res.status, 200);

    const params = stripeStub.checkout.sessions.create.calls[0]![0] as Record<string, unknown>;
    assertEquals(params['tax_id_collection'], undefined);
  },
});

Deno.test({
  name: '65-03 / Test 4: clinic subscription session includes tax_id_collection + automatic_tax + customer_update',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({});
    __setStripeForTest(asStripeProxy(stripeStub));

    const fakeAdmin = makeQueueAdmin({
      user: { id: 'user-uuid-T4', email: 'owner@clinic.com' },
      queues: {
        memberships: [{ id: 'mbr-T4', roles: { name: 'Owner' } }],
        clinic_stripe_customers: [{ stripe_customer_id: 'cus_clinic_T4' }],
      },
    });
    __setAdminForTest(fakeAdmin);

    const clinicId = '00000000-0000-0000-0000-000000000065';
    const req = new Request('http://localhost/functions/v1/stripe-checkout/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer stub-jwt' },
      body: JSON.stringify({ plan: 'clinic', clinic_id: clinicId }),
    });

    const res = await handleSession(req);
    assertEquals(res.status, 200);

    const params = stripeStub.checkout.sessions.create.calls[0]![0] as Record<string, unknown>;

    // tax_id_collection MUST be present on clinic branch
    const taxIdCol = params['tax_id_collection'] as Record<string, unknown>;
    assertExists(taxIdCol);
    assertEquals(taxIdCol['enabled'], true);

    // automatic_tax MUST also be present
    const autoTax = params['automatic_tax'] as Record<string, unknown>;
    assertExists(autoTax);
    assertEquals(autoTax['enabled'], true);

    // customer_update MUST also be present
    const custUpdate = params['customer_update'] as Record<string, unknown>;
    assertExists(custUpdate);
    assertEquals(custUpdate['address'], 'auto');
    assertEquals(custUpdate['name'], 'auto');
  },
});

Deno.test({
  name: '65-03 / Test 5: lifetime payment session includes automatic_tax + customer_update (no tax_id_collection)',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({});
    __setStripeForTest(asStripeProxy(stripeStub));

    const fakeAdmin = makeP43Admin({
      user: { id: 'user-uuid-T5', email: 't5@test.com' },
      tables: { stripe_customers: { stripe_customer_id: 'cus_t5_lt' } },
      rpcs: { resolve_user_effective_price: 'price_LIFETIME_DEFAULT' },
    });
    __setAdminForTest(fakeAdmin);

    const req = new Request('http://localhost/functions/v1/stripe-checkout/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer stub-jwt' },
      body: JSON.stringify({ plan: 'lifetime' }),
    });

    const res = await handleSession(req);
    assertEquals(res.status, 200);

    const params = stripeStub.checkout.sessions.create.calls[0]![0] as Record<string, unknown>;
    assertEquals(params['mode'], 'payment');

    // automatic_tax must apply to lifetime (mode='payment') too
    const autoTax = params['automatic_tax'] as Record<string, unknown>;
    assertExists(autoTax);
    assertEquals(autoTax['enabled'], true);

    // customer_update applies to mode='payment' because ensureWebCustomer
    // creates the Stripe customer BEFORE sessions.create.
    const custUpdate = params['customer_update'] as Record<string, unknown>;
    assertExists(custUpdate);
    assertEquals(custUpdate['address'], 'auto');
    assertEquals(custUpdate['name'], 'auto');

    // tax_id_collection NOT on lifetime (consumer flow)
    assertEquals(params['tax_id_collection'], undefined);
  },
});

// --- 43-04 / Test 6: existing 'clinic' branch unchanged (regression) -------

Deno.test({
  name: '43-04 / Test 6: clinic branch unchanged (regression guard)',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({});
    __setStripeForTest(asStripeProxy(stripeStub));

    const fakeAdmin = makeP43Admin({
      user: { id: 'user-uuid-CLN', email: 'cln@test.com' },
      tables: {
        memberships: { id: 'mbr-1', roles: { name: 'Owner' } },
        clinic_stripe_customers: { stripe_customer_id: 'cus_cln_1' },
      },
      rpcs: {},
    });
    __setAdminForTest(fakeAdmin);

    const clinicId = '00000000-0000-0000-0000-000000000010';
    const req = new Request('http://localhost/functions/v1/stripe-checkout/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer stub-jwt' },
      body: JSON.stringify({ plan: 'clinic', clinic_id: clinicId }),
    });

    const res = await handleSession(req);
    assertEquals(res.status, 200);

    const params = stripeStub.checkout.sessions.create.calls[0]![0] as Record<string, unknown>;
    const lineItems = params['line_items'] as Array<{ price: string; quantity: number }>;
    assertEquals(lineItems.length, 2);
    const priceIds = new Set(lineItems.map((li) => li.price));
    assertEquals(priceIds.has('price_base_test'), true);
    assertEquals(priceIds.has('price_overage_test'), true);
    assertEquals(params['mode'], 'subscription');
  },
});
