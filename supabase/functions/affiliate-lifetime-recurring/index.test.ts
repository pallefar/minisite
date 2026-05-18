/**
 * Deno tests for `affiliate-lifetime-recurring` Edge Function — Phase 26 Plan 26-06.
 *
 * Test plan (8 tests):
 *   T1 401 on missing/wrong bearer
 *   T2 returns {processed:0} on empty result set
 *   T3 status filter — only subscriptions.status='active' processed
 *   T4 frozen-affiliate skip — affiliates.frozen_at IS NOT NULL → skipped
 *   T5 plan-change scaling — commission tracks current Stripe price × 25%
 *   T6 idempotent on retry — 23505 swallowed; second invocation writes 0 new rows
 *   T7 dedup — multiple historical conversion rows for one (aff,sub) → 1 ledger row
 *   T8 PII safety — no PHI keywords in source (smoke-grep via deno read)
 *
 * Discovered via `<name>.test.ts` per [[reference_deno_test_discovery]].
 */
import { assertEquals, assertStrictEquals } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';

// ============================================================================
// Test fixtures
// ============================================================================

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_dummy');

const VALID_BEARER = 'test-service-role-key';

function buildAuthedRequest(): Request {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${VALID_BEARER}` },
  });
}

interface DriverSubRow {
  id: string;
  plan_id: string | null;
  status: string;
  affiliate_conversions: Array<{
    id: string;
    affiliate_id: string;
    tier_at_conversion_time: string;
    affiliates: { id: string; frozen_at: string | null } | null;
  }>;
}

interface MockOpts {
  /** Pre-filter the input: only subs with status='active' & every embedded conv
   *  tier='lifetime' & every embedded affiliate frozen_at=null returned. The mock
   *  emulates Postgres-side embed filtering. */
  subs: DriverSubRow[];
  /** idempotency_keys that should respond with a 23505 conflict on ledger insert. */
  ledgerConflicts?: Set<string>;
  /** invoice_ids that should respond with a 23505 on conversion insert. */
  convConflicts?: Set<string>;
}

interface MockAdmin {
  from: (table: string) => unknown;
  _ledgerInserts: () => Array<Record<string, unknown>>;
  _convInserts: () => Array<Record<string, unknown>>;
}

function applyEmbeddedFilters(rows: DriverSubRow[]): DriverSubRow[] {
  // Emulates Postgres `!inner` + per-embed eq/is filters.
  return rows
    .filter((s) => s.status === 'active')
    .map((s) => ({
      ...s,
      affiliate_conversions: (s.affiliate_conversions ?? [])
        .filter((c) => c.tier_at_conversion_time === 'lifetime')
        .filter((c) => c.affiliates && c.affiliates.frozen_at === null),
    }))
    .filter((s) => s.affiliate_conversions.length > 0);
}

function makeMockAdmin(opts: MockOpts): MockAdmin {
  const ledgerInserts: Array<Record<string, unknown>> = [];
  const convInserts: Array<Record<string, unknown>> = [];

  const filteredSubs = applyEmbeddedFilters(opts.subs);

  const subsBuilder = {
    _filter: { status: '', convTier: '', frozenIsNull: false },
    select(_cols: string) {
      return this;
    },
    eq(col: string, val: string) {
      if (col === 'status') this._filter.status = val;
      if (col === 'affiliate_conversions.tier_at_conversion_time') this._filter.convTier = val;
      return this;
    },
    is(col: string, val: unknown) {
      if (col === 'affiliate_conversions.affiliates.frozen_at' && val === null) {
        this._filter.frozenIsNull = true;
      }
      return this;
    },
    then(resolve: (v: unknown) => void) {
      // Mock returns the pre-filtered driver rows. The handler then iterates.
      resolve({ data: filteredSubs, error: null });
      return this;
    },
  };

  return {
    from(table: string) {
      if (table === 'subscriptions') {
        // Each call gets a fresh chain so multiple invocations work.
        return {
          select(_cols: string) {
            return subsBuilder;
          },
        };
      }
      if (table === 'affiliate_lifetime_recurring_payments') {
        return {
          insert(payload: Record<string, unknown>) {
            const key = String(payload.idempotency_key ?? '');
            if (opts.ledgerConflicts?.has(key)) {
              return Promise.resolve({ data: null, error: { code: '23505' } });
            }
            ledgerInserts.push(payload);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      if (table === 'affiliate_conversions') {
        return {
          insert(payload: Record<string, unknown>) {
            const inv = String(payload.invoice_id ?? '');
            if (opts.convConflicts?.has(inv)) {
              return Promise.resolve({ data: null, error: { code: '23505' } });
            }
            convInserts.push(payload);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    _ledgerInserts: () => ledgerInserts,
    _convInserts: () => convInserts,
  };
}

function makeMockStripe(priceCents: number) {
  return {
    prices: {
      retrieve: (_id: string) =>
        Promise.resolve({ unit_amount: priceCents } as { unit_amount: number }),
    },
  };
}

function thisMonthYyyymm(): number {
  const d = new Date();
  return d.getUTCFullYear() * 100 + (d.getUTCMonth() + 1);
}

// ============================================================================
// Tests
// ============================================================================

Deno.test('T1: 401 on missing bearer', async () => {
  __internal.resetForTest();
  const res = await __internal.handleRun(new Request('http://localhost/', { method: 'POST' }));
  assertEquals(res.status, 401);
});

Deno.test('T1b: 401 on wrong bearer', async () => {
  __internal.resetForTest();
  const res = await __internal.handleRun(
    new Request('http://localhost/', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-key' },
    }),
  );
  assertEquals(res.status, 401);
});

Deno.test('T2: returns processed=0 on empty result set', async () => {
  __internal.setAdminForTest(makeMockAdmin({ subs: [] }));
  __internal.setStripeForTest(makeMockStripe(1299));
  const res = await __internal.handleRun(buildAuthedRequest());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.processed, 0);
  assertEquals(body.skipped, 0);
  assertEquals(body.errors, 0);
});

Deno.test('T3: status filter — only active subs processed', async () => {
  const mock = makeMockAdmin({
    subs: [
      {
        id: 'sub_active',
        plan_id: 'price_1',
        status: 'active',
        affiliate_conversions: [
          {
            id: 'c1',
            affiliate_id: 'aff_1',
            tier_at_conversion_time: 'lifetime',
            affiliates: { id: 'aff_1', frozen_at: null },
          },
        ],
      },
      {
        id: 'sub_trialing',
        plan_id: 'price_2',
        status: 'trialing',
        affiliate_conversions: [
          {
            id: 'c2',
            affiliate_id: 'aff_2',
            tier_at_conversion_time: 'lifetime',
            affiliates: { id: 'aff_2', frozen_at: null },
          },
        ],
      },
      {
        id: 'sub_canceled',
        plan_id: 'price_3',
        status: 'canceled',
        affiliate_conversions: [
          {
            id: 'c3',
            affiliate_id: 'aff_3',
            tier_at_conversion_time: 'lifetime',
            affiliates: { id: 'aff_3', frozen_at: null },
          },
        ],
      },
    ],
  });
  __internal.setAdminForTest(mock);
  __internal.setStripeForTest(makeMockStripe(1299));
  await __internal.handleRun(buildAuthedRequest());
  assertEquals(mock._ledgerInserts().length, 1);
  assertEquals((mock._ledgerInserts()[0]?.stripe_subscription_id as string) ?? '', 'sub_active');
});

Deno.test('T4: frozen-affiliate skip', async () => {
  const mock = makeMockAdmin({
    subs: [
      {
        id: 'sub_1',
        plan_id: 'price_1',
        status: 'active',
        affiliate_conversions: [
          {
            id: 'c1',
            affiliate_id: 'aff_frozen',
            tier_at_conversion_time: 'lifetime',
            affiliates: { id: 'aff_frozen', frozen_at: '2026-01-01T00:00:00Z' },
          },
        ],
      },
    ],
  });
  __internal.setAdminForTest(mock);
  __internal.setStripeForTest(makeMockStripe(1299));
  await __internal.handleRun(buildAuthedRequest());
  assertEquals(mock._ledgerInserts().length, 0);
  assertEquals(mock._convInserts().length, 0);
});

Deno.test('T5: plan-change scaling — commission tracks current Stripe price', async () => {
  const mock = makeMockAdmin({
    subs: [
      {
        id: 'sub_1',
        plan_id: 'price_upgraded',
        status: 'active',
        affiliate_conversions: [
          {
            id: 'c1',
            affiliate_id: 'aff_1',
            tier_at_conversion_time: 'lifetime',
            affiliates: { id: 'aff_1', frozen_at: null },
          },
        ],
      },
    ],
  });
  __internal.setAdminForTest(mock);
  __internal.setStripeForTest(makeMockStripe(1499)); // post-upgrade price
  await __internal.handleRun(buildAuthedRequest());
  const ins = mock._ledgerInserts()[0];
  assertStrictEquals(ins?.gross_subscription_cents, 1499);
  assertStrictEquals(ins?.commission_cents, Math.round(1499 * 0.25)); // 375
});

Deno.test('T6: idempotent on retry — 23505 swallowed', async () => {
  const yyyymm = thisMonthYyyymm();
  const idemKey = `aff_1|sub_1|${yyyymm}`;
  const mock = makeMockAdmin({
    subs: [
      {
        id: 'sub_1',
        plan_id: 'price_1',
        status: 'active',
        affiliate_conversions: [
          {
            id: 'c1',
            affiliate_id: 'aff_1',
            tier_at_conversion_time: 'lifetime',
            affiliates: { id: 'aff_1', frozen_at: null },
          },
        ],
      },
    ],
    ledgerConflicts: new Set([idemKey]),
  });
  __internal.setAdminForTest(mock);
  __internal.setStripeForTest(makeMockStripe(1299));
  const res = await __internal.handleRun(buildAuthedRequest());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.skipped >= 1, true);
  assertEquals(body.errors, 0);
});

Deno.test('T7: dedup — multiple historical conversion rows for one (aff,sub) → 1 ledger row', async () => {
  const mock = makeMockAdmin({
    subs: [
      {
        id: 'sub_1',
        plan_id: 'price_1',
        status: 'active',
        affiliate_conversions: [
          {
            id: 'c_initial',
            affiliate_id: 'aff_1',
            tier_at_conversion_time: 'lifetime',
            affiliates: { id: 'aff_1', frozen_at: null },
          },
          {
            id: 'c_renewal_jan',
            affiliate_id: 'aff_1',
            tier_at_conversion_time: 'lifetime',
            affiliates: { id: 'aff_1', frozen_at: null },
          },
          {
            id: 'c_renewal_feb',
            affiliate_id: 'aff_1',
            tier_at_conversion_time: 'lifetime',
            affiliates: { id: 'aff_1', frozen_at: null },
          },
        ],
      },
    ],
  });
  __internal.setAdminForTest(mock);
  __internal.setStripeForTest(makeMockStripe(1299));
  await __internal.handleRun(buildAuthedRequest());
  assertEquals(mock._ledgerInserts().length, 1);
  assertEquals(mock._convInserts().length, 1);
  const inv = mock._convInserts()[0]?.invoice_id as string;
  assertEquals(inv.startsWith('lifetime_recurring_aff_1_sub_1_'), true);
});

Deno.test('T8: PII safety — no PHI keywords in source', async () => {
  const src = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  const hits = src.match(/patient|medication|diagnosis|dose|lab/gi);
  assertEquals(hits, null);
});
