/**
 * Deno test suite for `partner-account-status` Edge Function — Phase 19 Plan 19-03.
 *
 * Test list mirrors the plan's <action> verify section:
 *   1. missing JWT → 401
 *   2. no affiliate row → 200 { state: 'pending', requirements: [] }
 *   3. acct with disabled_reason → state 'restricted'
 *   4. charges_enabled && payouts_enabled → state 'active'; stripe_payouts_enabled UPDATEd
 *   5. currently_due.length > 0 && details_submitted → state 'needs_info'
 *   6. details_submitted=false → state 'pending'
 *
 * Plus a unit test for the pure `deriveState` helper covering all 4 branches.
 */

// ---------------------------------------------------------------------------
// Env vars — must be set before importing index.ts (ESM hoisting)
// ---------------------------------------------------------------------------
Deno.env.set('SUPABASE_URL', 'https://stub.supabase.co');
Deno.env.set('SUPABASE_ANON_KEY', 'stub-anon');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'stub-service-role');
Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_dummy');

import { assertEquals } from 'jsr:@std/assert';
import { __internal } from './index.ts';

const { handleStatus, deriveState, __setStripeForTest, __setAdminForTest } = __internal;

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

function makeStripeProxyForRetrieve(retrieveImpl: (...a: unknown[]) => unknown): unknown {
  return {
    accounts: { retrieve: retrieveImpl },
  };
}

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
// Unit test: deriveState — all 4 branches
// ---------------------------------------------------------------------------

Deno.test('deriveState: 4-branch state machine', () => {
  // restricted (disabled_reason wins over everything)
  assertEquals(
    deriveState({
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { currently_due: [], disabled_reason: 'requirements.past_due' },
    }),
    'restricted',
  );

  // active
  assertEquals(
    deriveState({
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { currently_due: [], disabled_reason: null },
    }),
    'active',
  );

  // needs_info
  assertEquals(
    deriveState({
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
      requirements: { currently_due: ['individual.dob.day'], disabled_reason: null },
    }),
    'needs_info',
  );

  // pending (details NOT submitted yet)
  assertEquals(
    deriveState({
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      requirements: { currently_due: ['individual.dob.day'], disabled_reason: null },
    }),
    'pending',
  );

  // pending (empty currently_due, not active, not submitted)
  assertEquals(
    deriveState({
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      requirements: { currently_due: [], disabled_reason: null },
    }),
    'pending',
  );
});

// ---------------------------------------------------------------------------
// Test 1: missing JWT → 401
// ---------------------------------------------------------------------------

Deno.test({
  name: 'status: missing JWT → 401 unauthenticated',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = new Request('http://localhost/functions/v1/partner-account-status', {
      method: 'GET',
    });

    const res = await handleStatus(req);
    assertEquals(res.status, 401);
    const body = await res.json();
    assertEquals(body, { error: 'unauthenticated' });
  },
});

// ---------------------------------------------------------------------------
// Test 2: no affiliate row → 200 pending + no Stripe call
// ---------------------------------------------------------------------------

Deno.test({
  name: 'status: no affiliate row → 200 { state: pending, requirements: [] } (no Stripe call)',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const retrieveSpy = makeThrowSpy('accounts.retrieve must NOT be called when no affiliate row');
    __setStripeForTest(makeStripeProxyForRetrieve(retrieveSpy.fn));

    const { admin, updateCalls } = makeFakeAdmin({
      user: { id: 'user-uuid-1' },
      affiliateRow: null,
    });
    __setAdminForTest(admin);

    const req = new Request('http://localhost/functions/v1/partner-account-status', {
      method: 'GET',
      headers: { Authorization: 'Bearer stub-jwt' },
    });

    const res = await handleStatus(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.state, 'pending');
    assertEquals(body.requirements, []);
    assertEquals(body.disabled_reason, null);

    assertEquals(retrieveSpy.calls.length, 0);
    assertEquals(updateCalls.length, 0);
  },
});

// ---------------------------------------------------------------------------
// Test 3: acct with disabled_reason → state 'restricted'
// ---------------------------------------------------------------------------

Deno.test({
  name: 'status: disabled_reason set → state restricted',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const retrieveSpy = makeSpy({
      id: 'acct_77',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
      requirements: {
        currently_due: ['individual.id_number'],
        disabled_reason: 'requirements.past_due',
      },
    });
    __setStripeForTest(makeStripeProxyForRetrieve(retrieveSpy.fn));

    const { admin } = makeFakeAdmin({
      user: { id: 'user-uuid-1' },
      affiliateRow: { id: 'aff-uuid-1', stripe_connect_account_id: 'acct_77' },
    });
    __setAdminForTest(admin);

    const req = new Request('http://localhost/functions/v1/partner-account-status', {
      method: 'GET',
      headers: { Authorization: 'Bearer stub-jwt' },
    });

    const res = await handleStatus(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.state, 'restricted');
    assertEquals(body.requirements, ['individual.id_number']);
    assertEquals(body.disabled_reason, 'requirements.past_due');

    assertEquals(retrieveSpy.calls.length, 1);
    assertEquals(retrieveSpy.calls[0]![0], 'acct_77');
  },
});

// ---------------------------------------------------------------------------
// Test 4: charges_enabled && payouts_enabled → 'active'; affiliate UPDATE
// ---------------------------------------------------------------------------

Deno.test({
  name: 'status: charges+payouts enabled → state active; affiliates.stripe_payouts_enabled UPDATEd to true',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const retrieveSpy = makeSpy({
      id: 'acct_active',
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { currently_due: [], disabled_reason: null },
    });
    __setStripeForTest(makeStripeProxyForRetrieve(retrieveSpy.fn));

    const { admin, updateCalls } = makeFakeAdmin({
      user: { id: 'user-uuid-1' },
      affiliateRow: { id: 'aff-uuid-1', stripe_connect_account_id: 'acct_active' },
    });
    __setAdminForTest(admin);

    const req = new Request('http://localhost/functions/v1/partner-account-status', {
      method: 'GET',
      headers: { Authorization: 'Bearer stub-jwt' },
    });

    const res = await handleStatus(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.state, 'active');
    assertEquals(body.requirements, []);
    assertEquals(body.disabled_reason, null);

    // affiliates.stripe_payouts_enabled mirrored to TRUE (Pitfall 7).
    assertEquals(updateCalls.length, 1);
    const upd = updateCalls[0]![0] as Record<string, unknown>;
    assertEquals(upd['stripe_payouts_enabled'], true);
  },
});

// ---------------------------------------------------------------------------
// Test 5: currently_due > 0 && details_submitted → 'needs_info'
// ---------------------------------------------------------------------------

Deno.test({
  name: 'status: currently_due + details_submitted → state needs_info',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const retrieveSpy = makeSpy({
      id: 'acct_needs',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
      requirements: {
        currently_due: ['individual.ssn_last_4', 'tos_acceptance.date'],
        disabled_reason: null,
      },
    });
    __setStripeForTest(makeStripeProxyForRetrieve(retrieveSpy.fn));

    const { admin, updateCalls } = makeFakeAdmin({
      user: { id: 'user-uuid-1' },
      affiliateRow: { id: 'aff-uuid-1', stripe_connect_account_id: 'acct_needs' },
    });
    __setAdminForTest(admin);

    const req = new Request('http://localhost/functions/v1/partner-account-status', {
      method: 'GET',
      headers: { Authorization: 'Bearer stub-jwt' },
    });

    const res = await handleStatus(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.state, 'needs_info');
    assertEquals(body.requirements, ['individual.ssn_last_4', 'tos_acceptance.date']);

    // payouts_enabled mirror should write FALSE.
    assertEquals(updateCalls.length, 1);
    const upd = updateCalls[0]![0] as Record<string, unknown>;
    assertEquals(upd['stripe_payouts_enabled'], false);
  },
});

// ---------------------------------------------------------------------------
// Test 6: details_submitted=false → 'pending'
// ---------------------------------------------------------------------------

Deno.test({
  name: 'status: details_submitted=false → state pending',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const retrieveSpy = makeSpy({
      id: 'acct_pending',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      requirements: {
        currently_due: ['individual.dob.day', 'individual.first_name'],
        disabled_reason: null,
      },
    });
    __setStripeForTest(makeStripeProxyForRetrieve(retrieveSpy.fn));

    const { admin } = makeFakeAdmin({
      user: { id: 'user-uuid-1' },
      affiliateRow: { id: 'aff-uuid-1', stripe_connect_account_id: 'acct_pending' },
    });
    __setAdminForTest(admin);

    const req = new Request('http://localhost/functions/v1/partner-account-status', {
      method: 'GET',
      headers: { Authorization: 'Bearer stub-jwt' },
    });

    const res = await handleStatus(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.state, 'pending');
    // requirements still surfaced even in pending state (UI shows "we need: …").
    assertEquals(body.requirements, ['individual.dob.day', 'individual.first_name']);
  },
});
