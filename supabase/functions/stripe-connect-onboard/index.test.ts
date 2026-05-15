/**
 * Deno test suite for `stripe-connect-onboard` Edge Function — Phase 19 Plan 19-03.
 *
 * Test list mirrors the plan's <action> verify section:
 *   1. missing JWT → 401
 *   2. no affiliate row → 404 not_an_affiliate
 *   3. status='pending' → 403 not_approved
 *   4. approved + no stripe_connect_account_id → accounts.create called with
 *      capabilities.transfers.requested=true; affiliate row UPDATED; account
 *      link minted; response = { url }.
 *   5. approved + has account id → accounts.create NOT called (idempotent);
 *      only accountLinks.create called; response = { url }.
 *   6. Stripe API error → 500 internal; no Stripe error message echoed.
 *
 * Mock strategy: __setStripeForTest / __setAdminForTest from index.ts.
 */

// ---------------------------------------------------------------------------
// Env vars — must be set before importing index.ts (ESM hoisting)
// ---------------------------------------------------------------------------
Deno.env.set('SUPABASE_URL', 'https://stub.supabase.co');
Deno.env.set('SUPABASE_ANON_KEY', 'stub-anon');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'stub-service-role');
Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_dummy');
Deno.env.set('STRIPE_CONNECT_RETURN_URL', 'https://leanshot.app');
Deno.env.set('STRIPE_CONNECT_REFRESH_URL', 'https://leanshot.app');

import { assertEquals, assertExists } from 'jsr:@std/assert';
import { __internal } from './index.ts';

const { handleOnboard, __setStripeForTest, __setAdminForTest } = __internal;

// ---------------------------------------------------------------------------
// Spy / stub helpers
// ---------------------------------------------------------------------------

function makeSpy<T>(returnValue: T): {
  fn: (...args: unknown[]) => Promise<T>;
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  const fn = (...args: unknown[]): Promise<T> => {
    calls.push(args);
    return Promise.resolve(returnValue);
  };
  return { fn, calls };
}

function makeThrowSpy(message: string): {
  fn: () => never;
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  const fn = (): never => {
    calls.push([]);
    throw new Error(message);
  };
  return { fn, calls };
}

interface StripeStub {
  accounts: {
    create: { fn: (...a: unknown[]) => Promise<unknown>; calls: unknown[][] };
  };
  accountLinks: {
    create: { fn: (...a: unknown[]) => Promise<unknown>; calls: unknown[][] };
  };
}

function makeStripeStub(opts?: {
  newAccountId?: string;
  linkUrl?: string;
  accountsCreateThrows?: boolean;
  accountLinksThrows?: boolean;
}): StripeStub {
  const accountsCreate = opts?.accountsCreateThrows
    ? makeThrowSpy('stripe-secret-error-do-not-echo')
    : makeSpy({ id: opts?.newAccountId ?? 'acct_new_999' });
  const accountLinksCreate = opts?.accountLinksThrows
    ? makeThrowSpy('stripe-secret-error-do-not-echo')
    : makeSpy({ url: opts?.linkUrl ?? 'https://connect.stripe.com/setup/e/test_link_abc' });

  return {
    accounts: { create: accountsCreate as StripeStub['accounts']['create'] },
    accountLinks: { create: accountLinksCreate as StripeStub['accountLinks']['create'] },
  };
}

function asStripeProxy(stub: StripeStub): unknown {
  return {
    accounts: {
      create: (...args: unknown[]) => stub.accounts.create.fn(...args),
    },
    accountLinks: {
      create: (...args: unknown[]) => stub.accountLinks.create.fn(...args),
    },
  };
}

// ---------------------------------------------------------------------------
// Fake admin
// ---------------------------------------------------------------------------

/**
 * Fake admin supabase client. `affiliateRow` is what `affiliates` table
 * returns on the SELECT. `updateError` is what `affiliates.update().eq()`
 * resolves to.
 */
function makeFakeAdmin(opts: {
  user?: { id: string; email?: string } | null;
  affiliateRow?: unknown;
  affiliateSelectError?: { message: string } | null;
  updateError?: { message: string } | null;
}): {
  admin: unknown;
  updateCalls: unknown[][];
} {
  const { user = null, affiliateRow = null, affiliateSelectError = null, updateError = null } = opts;
  const updateCalls: unknown[][] = [];

  function makeChain() {
    const chain = {
      select: (_: string) => chain,
      eq: (_: string, __: unknown) => chain,
      limit: (_: number) => chain,
      maybeSingle: () => Promise.resolve({
        data: affiliateRow,
        error: affiliateSelectError,
      }),
      update: (vals: unknown) => {
        updateCalls.push([vals]);
        return {
          eq: (_: string, __: unknown) =>
            Promise.resolve({ data: null, error: updateError }),
        };
      },
    };
    return chain;
  }

  const admin = {
    auth: {
      getUser: (_jwt: string) => {
        if (user) return Promise.resolve({ data: { user }, error: null });
        return Promise.resolve({ data: { user: null }, error: 'unauthenticated' });
      },
    },
    from: (_table: string) => makeChain(),
  };

  return { admin, updateCalls };
}

// ---------------------------------------------------------------------------
// Test 1: missing JWT → 401
// ---------------------------------------------------------------------------

Deno.test({
  name: 'onboard: missing JWT → 401 unauthenticated',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = new Request('http://localhost/functions/v1/stripe-connect-onboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleOnboard(req);
    assertEquals(res.status, 401);
    const body = await res.json();
    assertEquals(body, { error: 'unauthenticated' });
  },
});

// ---------------------------------------------------------------------------
// Test 2: no affiliate row → 404 not_an_affiliate
// ---------------------------------------------------------------------------

Deno.test({
  name: 'onboard: no affiliate row → 404 not_an_affiliate (no Stripe call)',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({ accountsCreateThrows: true, accountLinksThrows: true });
    __setStripeForTest(asStripeProxy(stripeStub));

    const { admin } = makeFakeAdmin({
      user: { id: 'user-uuid-1', email: 'a@b.com' },
      affiliateRow: null,
    });
    __setAdminForTest(admin);

    const req = new Request('http://localhost/functions/v1/stripe-connect-onboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer stub-jwt' },
    });

    const res = await handleOnboard(req);
    assertEquals(res.status, 404);
    const body = await res.json();
    assertEquals(body, { error: 'not_an_affiliate' });

    assertEquals(stripeStub.accounts.create.calls.length, 0);
    assertEquals(stripeStub.accountLinks.create.calls.length, 0);
  },
});

// ---------------------------------------------------------------------------
// Test 3: status='pending' → 403 not_approved
// ---------------------------------------------------------------------------

Deno.test({
  name: 'onboard: status=pending → 403 not_approved (no Stripe call)',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({ accountsCreateThrows: true, accountLinksThrows: true });
    __setStripeForTest(asStripeProxy(stripeStub));

    const { admin } = makeFakeAdmin({
      user: { id: 'user-uuid-1' },
      affiliateRow: {
        id: 'aff-uuid-1',
        status: 'pending',
        stripe_connect_account_id: null,
      },
    });
    __setAdminForTest(admin);

    const req = new Request('http://localhost/functions/v1/stripe-connect-onboard', {
      method: 'POST',
      headers: { Authorization: 'Bearer stub-jwt' },
    });

    const res = await handleOnboard(req);
    assertEquals(res.status, 403);
    const body = await res.json();
    assertEquals(body, { error: 'not_approved' });

    assertEquals(stripeStub.accounts.create.calls.length, 0);
    assertEquals(stripeStub.accountLinks.create.calls.length, 0);
  },
});

// ---------------------------------------------------------------------------
// Test 4: approved + no account id → accounts.create + UPDATE + accountLinks
// ---------------------------------------------------------------------------

Deno.test({
  name: 'onboard: approved + no account id → creates account with transfers.requested + persists + mints link',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({
      newAccountId: 'acct_new_42',
      linkUrl: 'https://connect.stripe.com/setup/e/acct_new_42/abc',
    });
    __setStripeForTest(asStripeProxy(stripeStub));

    const { admin, updateCalls } = makeFakeAdmin({
      user: { id: 'user-uuid-1' },
      affiliateRow: {
        id: 'aff-uuid-1',
        status: 'approved',
        stripe_connect_account_id: null,
      },
    });
    __setAdminForTest(admin);

    const req = new Request('http://localhost/functions/v1/stripe-connect-onboard', {
      method: 'POST',
      headers: { Authorization: 'Bearer stub-jwt' },
    });

    const res = await handleOnboard(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertExists(body.url);
    assertEquals(body.url, 'https://connect.stripe.com/setup/e/acct_new_42/abc');
    // V7: response is strictly { url } — no account id leak.
    assertEquals(Object.keys(body).length, 1);

    // accounts.create called once with the load-bearing capability flag.
    assertEquals(stripeStub.accounts.create.calls.length, 1);
    const acctParams = stripeStub.accounts.create.calls[0]![0] as Record<string, unknown>;
    assertEquals(acctParams['type'], 'express');
    assertEquals(acctParams['country'], 'US');
    assertEquals(acctParams['business_type'], 'individual');
    const caps = acctParams['capabilities'] as { transfers: { requested: boolean } };
    assertEquals(caps.transfers.requested, true);
    const meta = acctParams['metadata'] as Record<string, string>;
    assertEquals(meta['affiliate_id'], 'aff-uuid-1');
    assertEquals(meta['leanshot_user_id'], 'user-uuid-1');
    assertEquals(meta['leanshot_phase'], '19');

    // affiliates.update called once with the new account id.
    assertEquals(updateCalls.length, 1);
    const updateVals = updateCalls[0]![0] as Record<string, unknown>;
    assertEquals(updateVals['stripe_connect_account_id'], 'acct_new_42');

    // accountLinks.create called once with type=account_onboarding.
    assertEquals(stripeStub.accountLinks.create.calls.length, 1);
    const linkParams = stripeStub.accountLinks.create.calls[0]![0] as Record<string, unknown>;
    assertEquals(linkParams['account'], 'acct_new_42');
    assertEquals(linkParams['type'], 'account_onboarding');
    assertEquals(
      linkParams['refresh_url'],
      'https://leanshot.app/partner/payouts?refresh=1',
    );
    assertEquals(
      linkParams['return_url'],
      'https://leanshot.app/partner/payouts?from=connect',
    );
  },
});

// ---------------------------------------------------------------------------
// Test 5: approved + existing account id → idempotent (no accounts.create)
// ---------------------------------------------------------------------------

Deno.test({
  name: 'onboard: approved + existing account id → idempotent, only mints link',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const accountsCreateSpy = makeThrowSpy('accounts.create must NOT be called when id already exists');
    const accountLinksSpy = makeSpy({ url: 'https://connect.stripe.com/setup/e/existing/xyz' });

    const stripeProxy = {
      accounts: { create: (...args: unknown[]) => accountsCreateSpy.fn(...args) },
      accountLinks: { create: (...args: unknown[]) => accountLinksSpy.fn(...args) },
    };
    __setStripeForTest(stripeProxy);

    const { admin, updateCalls } = makeFakeAdmin({
      user: { id: 'user-uuid-1' },
      affiliateRow: {
        id: 'aff-uuid-1',
        status: 'approved',
        stripe_connect_account_id: 'acct_existing_77',
      },
    });
    __setAdminForTest(admin);

    const req = new Request('http://localhost/functions/v1/stripe-connect-onboard', {
      method: 'POST',
      headers: { Authorization: 'Bearer stub-jwt' },
    });

    const res = await handleOnboard(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.url, 'https://connect.stripe.com/setup/e/existing/xyz');

    // accounts.create NEVER called when id already exists.
    assertEquals(accountsCreateSpy.calls.length, 0);
    // affiliates.update NEVER called (no new id to write).
    assertEquals(updateCalls.length, 0);

    // accountLinks.create called once with the EXISTING account id.
    assertEquals(accountLinksSpy.calls.length, 1);
    const linkParams = accountLinksSpy.calls[0]![0] as Record<string, unknown>;
    assertEquals(linkParams['account'], 'acct_existing_77');
    assertEquals(linkParams['type'], 'account_onboarding');
  },
});

// ---------------------------------------------------------------------------
// Test 6: Stripe API error → 500 internal; no error message echoed
// ---------------------------------------------------------------------------

Deno.test({
  name: 'onboard: Stripe accounts.create throws → 500 internal (no Stripe error echoed)',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stripeStub = makeStripeStub({ accountsCreateThrows: true });
    __setStripeForTest(asStripeProxy(stripeStub));

    const { admin } = makeFakeAdmin({
      user: { id: 'user-uuid-1' },
      affiliateRow: {
        id: 'aff-uuid-1',
        status: 'approved',
        stripe_connect_account_id: null,
      },
    });
    __setAdminForTest(admin);

    const req = new Request('http://localhost/functions/v1/stripe-connect-onboard', {
      method: 'POST',
      headers: { Authorization: 'Bearer stub-jwt' },
    });

    const res = await handleOnboard(req);
    assertEquals(res.status, 500);
    const body = await res.json();
    assertEquals(body, { error: 'internal' });
    // V7: Stripe error message (contains 'stripe-secret-error-do-not-echo') MUST NOT
    // appear in the response body.
    const bodyText = JSON.stringify(body);
    assertEquals(bodyText.includes('stripe-secret'), false);
  },
});
