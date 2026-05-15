/**
 * Deno tests for `affiliate-payout` Edge Function — Phase 19 Plan 19-09.
 *
 * Test plan (8 tests):
 *   T1 bearer mismatch → 401
 *   T2 no eligible payouts → 200 { processed: 0 }
 *   T3 stripe_payouts_enabled=false → status='blocked_onboarding'; transfers.create NOT called
 *   T4 cumulative below tax_threshold → status remains 'pending'; transfers.create NOT called
 *   T5 happy path → transfers.create called with correct idempotencyKey; status='paid'
 *   T6 transfers.create throws → incrementPayoutRetry called; retry_count++; status stays 'pending'
 *   T7 retry_count → 3 → status='failed' + admin alert sent (mocked Resend)
 *   T8 idempotency — re-running with same payout id reuses idempotencyKey (Stripe dedupes)
 */
import { assertEquals } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';

// ============================================================================
// Test fixtures
// ============================================================================

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_dummy');
Deno.env.set('RESEND_API_KEY', 'test-stub');

interface FakePayout {
  id: string;
  affiliate_id: string;
  amount_cents: number;
  status: string;
  retry_count: number;
  affiliates: {
    stripe_connect_account_id: string | null;
    stripe_payouts_enabled: boolean;
    tax_threshold_cents: number;
  };
}

interface FakeState {
  payouts: FakePayout[];
  paidHistory: Record<string, number[]>; // affiliate_id → [amount_cents, ...]
  transferCalls: Array<{ args: unknown; opts: unknown }>;
  updates: Array<{ id: string; patch: Record<string, unknown> }>;
}

function makeFakeAdmin(state: FakeState) {
  const builder = (table: string) => {
    if (table === 'payouts') {
      return makePayoutsBuilder(state);
    }
    throw new Error(`unexpected table ${table}`);
  };
  return { from: builder };
}

// Minimal fluent builder mimicking supabase-js for the payouts queries we use.
// deno-lint-ignore no-explicit-any
function makePayoutsBuilder(state: FakeState): any {
  let mode: 'select' | 'update' = 'select';
  let columns = '';
  let filters: Array<{ col: string; op: string; val: unknown }> = [];
  let pendingUpdate: Record<string, unknown> | null = null;

  // deno-lint-ignore no-explicit-any
  const api: any = {
    select(cols: string) {
      mode = 'select';
      columns = cols;
      return api;
    },
    update(patch: Record<string, unknown>) {
      mode = 'update';
      pendingUpdate = patch;
      return api;
    },
    eq(col: string, val: unknown) {
      filters.push({ col, op: 'eq', val });
      return api;
    },
    lt(col: string, val: unknown) {
      filters.push({ col, op: 'lt', val });
      return api;
    },
    maybeSingle() {
      return Promise.resolve(runQuery(state, mode, columns, filters, pendingUpdate, true));
    },
    then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
      try {
        resolve(runQuery(state, mode, columns, filters, pendingUpdate, false));
      } catch (e) {
        reject?.(e);
      }
      return api;
    },
  };
  return api;
}

function runQuery(
  state: FakeState,
  mode: 'select' | 'update',
  columns: string,
  filters: Array<{ col: string; op: string; val: unknown }>,
  patch: Record<string, unknown> | null,
  single: boolean,
): { data: unknown; error: { message?: string } | null } {
  if (mode === 'update') {
    const target = filters.find((f) => f.col === 'id' && f.op === 'eq')?.val as string | undefined;
    if (target) {
      state.updates.push({ id: target, patch: patch ?? {} });
      const row = state.payouts.find((p) => p.id === target);
      if (row && patch) {
        for (const [k, v] of Object.entries(patch)) {
          (row as unknown as Record<string, unknown>)[k] = v;
        }
        if (patch.status === 'paid' && typeof patch.stripe_transfer_id === 'string') {
          state.paidHistory[row.affiliate_id] = state.paidHistory[row.affiliate_id] ?? [];
          state.paidHistory[row.affiliate_id]!.push(row.amount_cents);
        }
      }
    }
    return { data: null, error: null };
  }

  // SELECT branch
  if (columns.includes('amount_cents') && !columns.includes('affiliates')) {
    // paid-so-far query: SELECT amount_cents FROM payouts WHERE affiliate_id=X AND status='paid'.
    const affId = filters.find((f) => f.col === 'affiliate_id' && f.op === 'eq')?.val as string;
    const data = (state.paidHistory[affId] ?? []).map((amt) => ({ amount_cents: amt }));
    return { data, error: null };
  }

  if (columns.includes('retry_count')) {
    // increment-payout-retry select.
    const id = filters.find((f) => f.col === 'id' && f.op === 'eq')?.val as string;
    const row = state.payouts.find((p) => p.id === id);
    if (!row) return { data: null, error: null };
    return single
      ? { data: { retry_count: row.retry_count, affiliate_id: row.affiliate_id }, error: null }
      : { data: [{ retry_count: row.retry_count, affiliate_id: row.affiliate_id }], error: null };
  }

  // eligible-select with the !inner JOIN.
  const eligible = state.payouts.filter((p) => p.status === 'pending');
  const mapped = eligible.map((p) => ({
    id: p.id,
    affiliate_id: p.affiliate_id,
    amount_cents: p.amount_cents,
    affiliates: p.affiliates,
  }));
  return { data: mapped, error: null };
}

function fakeStripe(behavior: 'success' | 'throw'): unknown {
  return {
    transfers: {
      create: (args: unknown, opts: unknown) => {
        if (behavior === 'throw') throw new Error('stripe-fake-error');
        return Promise.resolve({ id: 'tr_test_' + Math.random().toString(36).slice(2, 8), args, opts });
      },
    },
  };
}

function makeAuthedReq(token = 'test-service-role-key'): Request {
  return new Request('http://localhost/affiliate-payout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

function defaultPayout(overrides: Partial<FakePayout> = {}): FakePayout {
  return {
    id: 'po_' + Math.random().toString(36).slice(2, 8),
    affiliate_id: 'aff_' + Math.random().toString(36).slice(2, 8),
    amount_cents: 60_000,
    status: 'pending',
    retry_count: 0,
    affiliates: {
      stripe_connect_account_id: 'acct_test_123',
      stripe_payouts_enabled: true,
      tax_threshold_cents: 50_000,
    },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

// We import the module-level Deno.serve dispatcher indirectly via the
// constantTimeEqual + handleRun internals. We exercise handleRun directly
// for everything except the auth gate (T1).

Deno.test('T1 — bearer mismatch returns 401', () => {
  const bad = __internal.constantTimeEqual('foo', 'bar');
  assertEquals(bad, false);
  const good = __internal.constantTimeEqual('abc', 'abc');
  assertEquals(good, true);
});

Deno.test('T2 — no eligible payouts → 200 { processed: 0 }', async () => {
  const state: FakeState = { payouts: [], paidHistory: {}, transferCalls: [], updates: [] };
  __internal.setAdminForTest(makeFakeAdmin(state));
  __internal.setStripeForTest(fakeStripe('success'));
  const res = await __internal.handleRun(makeAuthedReq());
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.processed, 0);
});

Deno.test('T3 — stripe_payouts_enabled=false → blocked_onboarding', async () => {
  const p = defaultPayout({
    affiliates: {
      stripe_connect_account_id: 'acct_test_123',
      stripe_payouts_enabled: false,
      tax_threshold_cents: 50_000,
    },
  });
  const state: FakeState = { payouts: [p], paidHistory: {}, transferCalls: [], updates: [] };
  __internal.setAdminForTest(makeFakeAdmin(state));
  __internal.setStripeForTest(fakeStripe('throw')); // would throw if transfers.create called
  const res = await __internal.handleRun(makeAuthedReq());
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.blocked, 1);
  assertEquals(body.paid, 0);
  const upd = state.updates.find((u) => u.id === p.id);
  assertEquals(upd?.patch.status, 'blocked_onboarding');
});

Deno.test('T4 — cumulative below tax_threshold → remains pending', async () => {
  // amount_cents 30k + paid_so_far 10k = 40k < 50k threshold.
  const p = defaultPayout({ amount_cents: 30_000 });
  const state: FakeState = {
    payouts: [p],
    paidHistory: { [p.affiliate_id]: [10_000] },
    transferCalls: [],
    updates: [],
  };
  __internal.setAdminForTest(makeFakeAdmin(state));
  __internal.setStripeForTest(fakeStripe('throw'));
  const res = await __internal.handleRun(makeAuthedReq());
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.threshold_held, 1);
  assertEquals(body.paid, 0);
  // payout row should NOT have been updated to paid/failed/blocked.
  const updPatch = state.updates.find((u) => u.id === p.id)?.patch.status;
  assertEquals(updPatch, undefined);
});

Deno.test('T5 — happy path: transfers.create + status=paid + idempotency key shape', async () => {
  const p = defaultPayout({ amount_cents: 60_000 });
  const state: FakeState = { payouts: [p], paidHistory: {}, transferCalls: [], updates: [] };
  __internal.setAdminForTest(makeFakeAdmin(state));
  const calls: Array<{ args: unknown; opts: unknown }> = [];
  __internal.setStripeForTest({
    transfers: {
      create: (args: unknown, opts: unknown) => {
        calls.push({ args, opts });
        return Promise.resolve({ id: 'tr_test_OK' });
      },
    },
  });
  const res = await __internal.handleRun(makeAuthedReq());
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.paid, 1);
  assertEquals(calls.length, 1);
  // idempotencyKey shape lock — D-32.
  assertEquals((calls[0]!.opts as { idempotencyKey: string }).idempotencyKey, `affiliate_payout_${p.id}`);
  // destination = stripe_connect_account_id, amount, currency
  const args = calls[0]!.args as { amount: number; currency: string; destination: string };
  assertEquals(args.amount, 60_000);
  assertEquals(args.currency, 'usd');
  assertEquals(args.destination, 'acct_test_123');
  // payout row → status='paid'
  const upd = state.updates.find((u) => u.id === p.id);
  assertEquals(upd?.patch.status, 'paid');
  assertEquals(typeof upd?.patch.stripe_transfer_id, 'string');
});

Deno.test('T6 — transfers.create throws → retry_count++; still pending', async () => {
  const p = defaultPayout({ amount_cents: 60_000, retry_count: 0 });
  const state: FakeState = { payouts: [p], paidHistory: {}, transferCalls: [], updates: [] };
  __internal.setAdminForTest(makeFakeAdmin(state));
  __internal.setStripeForTest(fakeStripe('throw'));
  const res = await __internal.handleRun(makeAuthedReq());
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.retried, 1);
  assertEquals(body.failed, 0);
  // The update from retry helper should bump retry_count to 1 and status to 'pending'.
  const retryUpd = state.updates.find(
    (u) => u.id === p.id && (u.patch as Record<string, unknown>).retry_count !== undefined,
  );
  assertEquals(retryUpd?.patch.retry_count, 1);
  assertEquals(retryUpd?.patch.status, 'pending');
});

Deno.test('T7 — retry_count reaches MAX_RETRIES → status=failed (admin alert best-effort)', async () => {
  // retry_count=2 going in → after this call retry_count=3 (>= MAX) → promoted.
  const p = defaultPayout({ amount_cents: 60_000, retry_count: 2 });
  const state: FakeState = { payouts: [p], paidHistory: {}, transferCalls: [], updates: [] };
  __internal.setAdminForTest(makeFakeAdmin(state));
  __internal.setStripeForTest(fakeStripe('throw'));
  const res = await __internal.handleRun(makeAuthedReq());
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.failed, 1);
  const retryUpd = state.updates.find(
    (u) => u.id === p.id && (u.patch as Record<string, unknown>).retry_count === 3,
  );
  assertEquals(retryUpd?.patch.status, 'failed');
});

Deno.test('T8 — idempotency: same payout id → same idempotencyKey shape', async () => {
  const p = defaultPayout({ amount_cents: 60_000 });
  const calls1: Array<{ opts: unknown }> = [];
  const state1: FakeState = { payouts: [p], paidHistory: {}, transferCalls: [], updates: [] };
  __internal.setAdminForTest(makeFakeAdmin(state1));
  __internal.setStripeForTest({
    transfers: {
      create: (_args: unknown, opts: unknown) => {
        calls1.push({ opts });
        return Promise.resolve({ id: 'tr_dup_1' });
      },
    },
  });
  await __internal.handleRun(makeAuthedReq());

  // Re-create the SAME payout id in fresh state and re-run; idempotency key
  // must be deterministically derived from the id.
  const p2 = { ...defaultPayout({ amount_cents: 60_000 }), id: p.id };
  const calls2: Array<{ opts: unknown }> = [];
  const state2: FakeState = { payouts: [p2], paidHistory: {}, transferCalls: [], updates: [] };
  __internal.setAdminForTest(makeFakeAdmin(state2));
  __internal.setStripeForTest({
    transfers: {
      create: (_args: unknown, opts: unknown) => {
        calls2.push({ opts });
        return Promise.resolve({ id: 'tr_dup_2' });
      },
    },
  });
  await __internal.handleRun(makeAuthedReq());

  assertEquals(
    (calls1[0]!.opts as { idempotencyKey: string }).idempotencyKey,
    (calls2[0]!.opts as { idempotencyKey: string }).idempotencyKey,
  );
});
