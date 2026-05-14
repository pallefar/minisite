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
