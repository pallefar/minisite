/**
 * invoice-paid.test.ts
 *
 * Tests for the invoice.paid handler (past_due → paid recovery, D-08 banner clearing).
 *
 * Behaviors:
 *  2.14: invoice.paid with a valid subId and period_end → writes ux_tier=paid + status=active
 *        + current_period_end (ISO string)
 *  2.15: invoice.paid on an already-paid sub → still writes ux_tier=paid (idempotent direction)
 *  2.14b: invoice.paid with no subscription_id → no-op (zero update calls)
 *
 * NOTE (CR-04): The handler previously read the non-existent `invoice.subscription_status`
 * field via an `as unknown as { subscription_status?: string }` cast. That field is always
 * `undefined` at runtime on any real Stripe Invoice object, so the cast defaulted to 'active',
 * then called `mapStripeStatusToUxTier('active')` → 'paid'. While this accidentally produced
 * the correct outcome for `invoice.paid` (paid is correct), the handler was structurally broken
 * and carried dead code (`invoiceObj` + `void invoiceObj`). Both have been removed.
 * The `subscriptionStatus` arg has been dropped from `buildInvoicePaidEvent()` since it was
 * never read by the handler and was misleading.
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { handle } from './invoice-paid.ts';

// ─── Mock admin builder ───────────────────────────────────────────────────────
interface UpdateCall {
  table: string;
  data: Record<string, unknown>;
  eqCol: string;
  eqVal: unknown;
}

function buildMockAdmin(): [SupabaseClient, () => UpdateCall[]] {
  const calls: UpdateCall[] = [];
  const mockAdmin = {
    from: (table: string) => ({
      update: (data: Record<string, unknown>) => ({
        eq: (col: string, val: unknown) => {
          calls.push({ table, data, eqCol: col, eqVal: val });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  } as unknown as SupabaseClient;
  return [mockAdmin, () => calls];
}

/** Build an invoice.paid event */
function buildInvoicePaidEvent(
  subId: string | null,
  periodEnd: number | null = Math.floor(Date.now() / 1000) + 30 * 86400,
): Stripe.Event {
  return {
    id: 'evt_invoice_paid_test',
    object: 'event',
    type: 'invoice.paid',
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'in_test_123',
        object: 'invoice',
        subscription: subId,
        period_end: periodEnd,
      } as unknown as Stripe.Invoice,
    },
    api_version: '2026-04-22.dahlia',
  } as unknown as Stripe.Event;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test('2.14: invoice.paid flips ux_tier to paid, status to active, and updates current_period_end', async () => {
  const event = buildInvoicePaidEvent('sub_past_due_123');
  const [admin, getCalls] = buildMockAdmin();

  await handle(event, admin);

  const calls = getCalls();
  assertEquals(calls.length, 1, 'Expected 1 update call');
  assertEquals(calls[0].table, 'subscriptions');
  assertEquals(calls[0].data.ux_tier, 'paid');
  assertEquals(calls[0].data.status, 'active');
  assertEquals(calls[0].eqCol, 'id');
  assertEquals(calls[0].eqVal, 'sub_past_due_123');
  assertEquals(typeof calls[0].data.current_period_end === 'string', true);
});

Deno.test('2.15: invoice.paid on already-paid sub → idempotent (still writes paid)', async () => {
  // Even for an already-paid sub, we still write the update (no-op at DB level because
  // values don't change). The handler doesn't pre-read the current state — it just syncs.
  const event = buildInvoicePaidEvent('sub_already_paid');
  const [admin, getCalls] = buildMockAdmin();

  await handle(event, admin);

  const calls = getCalls();
  assertEquals(calls.length, 1);
  assertEquals(calls[0].data.ux_tier, 'paid');
  assertEquals(calls[0].data.status, 'active');
});

Deno.test('2.14b: invoice.paid with no subscription_id → no-op (skips)', async () => {
  const event = buildInvoicePaidEvent(null);

  const [admin, getCalls] = buildMockAdmin();
  await handle(event, admin);

  const calls = getCalls();
  assertEquals(calls.length, 0, 'No update expected when no subscription_id');
});

// ============================================================================
// Phase 19 Plan 19-04 — affiliate-conversion path (AFF-02, D-36, D-30)
// ============================================================================

/**
 * Extended mock admin: supports both the Phase 14 subscription UPDATE path
 * AND the Phase 19 affiliate-conversion SELECT/INSERT path.
 *
 * Behavior:
 *   - from('subscriptions').update(...).eq(...) → records to updates[]; resolves null error.
 *   - from('affiliates').select(...).eq(...).maybeSingle() → returns staged affRow.
 *   - from('stripe_customers').select(...).eq(...).maybeSingle() → returns staged custRow.
 *   - from('affiliate_conversions').insert(...) → records to inserts[]; resolves staged error.
 */
interface AffInsert {
  data: Record<string, unknown>;
}
interface AffMockState {
  affRow?: { id: string; commission_rate_cents: number; status: string } | null;
  custRow?: { user_id: string } | null;
  insertError?: { code: string; message: string } | null;
}
function buildAffAdmin(state: AffMockState): [SupabaseClient, () => { updates: UpdateCall[]; affInserts: AffInsert[] }] {
  const updates: UpdateCall[] = [];
  const affInserts: AffInsert[] = [];
  const mockAdmin = {
    from: (table: string) => {
      if (table === 'subscriptions') {
        return {
          update: (data: Record<string, unknown>) => ({
            eq: (col: string, val: unknown) => {
              updates.push({ table, data, eqCol: col, eqVal: val });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === 'affiliates') {
        return {
          select: (_: string) => ({
            eq: (_c: string, _v: unknown) => ({
              maybeSingle: () => Promise.resolve({ data: state.affRow ?? null, error: null }),
            }),
          }),
        };
      }
      if (table === 'stripe_customers') {
        return {
          select: (_: string) => ({
            eq: (_c: string, _v: unknown) => ({
              maybeSingle: () => Promise.resolve({ data: state.custRow ?? null, error: null }),
            }),
          }),
        };
      }
      if (table === 'affiliate_conversions') {
        return {
          insert: (data: Record<string, unknown>) => {
            affInserts.push({ data });
            return Promise.resolve({ error: state.insertError ?? null });
          },
        };
      }
      throw new Error(`Unexpected table in test mock: ${table}`);
    },
  } as unknown as SupabaseClient;
  return [mockAdmin, () => ({ updates, affInserts })];
}

/** Build an invoice.paid event with optional aff metadata + billing_reason. */
function buildInvoicePaidWithAff(opts: {
  subId?: string;
  billingReason?: string;
  affCodeOnSubDetails?: string | null;
  affCodeOnLine?: string | null;
  customerId?: string;
  paidAtSec?: number;
}): Stripe.Event {
  const {
    subId = 'sub_aff_123',
    billingReason = 'subscription_create',
    affCodeOnSubDetails = null,
    affCodeOnLine = null,
    customerId = 'cus_test_1',
    paidAtSec = 1_750_000_000,
  } = opts;

  const subDetailsMeta = affCodeOnSubDetails !== null
    ? { aff_code: affCodeOnSubDetails }
    : {};

  const lineItem = affCodeOnLine !== null
    ? { metadata: { aff_code: affCodeOnLine } }
    : { metadata: {} };

  return {
    id: 'evt_invoice_paid_aff_test',
    object: 'event',
    type: 'invoice.paid',
    livemode: false,
    created: paidAtSec,
    data: {
      object: {
        id: 'in_test_aff_xyz',
        object: 'invoice',
        subscription: subId,
        period_end: paidAtSec + 30 * 86400,
        billing_reason: billingReason,
        customer: customerId,
        status_transitions: { paid_at: paidAtSec },
        subscription_details: { metadata: subDetailsMeta },
        lines: { data: [lineItem] },
      } as unknown as Stripe.Invoice,
    },
    api_version: '2026-04-22.dahlia',
  } as unknown as Stripe.Event;
}

Deno.test('19-04 / Test X: billing_reason=subscription_cycle (renewal) → tier sync runs, NO conversion insert (D-36)', async () => {
  const event = buildInvoicePaidWithAff({
    billingReason: 'subscription_cycle', // renewal
    affCodeOnSubDetails: 'valid-code', // even with an aff code present
  });
  const [admin, getCalls] = buildAffAdmin({
    affRow: { id: 'aff-1', commission_rate_cents: 1000, status: 'approved' },
    custRow: { user_id: 'user-1' },
  });
  await handle(event, admin);
  const { updates, affInserts } = getCalls();
  // Tier sync must still happen (Phase 14 contract).
  assertEquals(updates.length, 1);
  assertEquals(updates[0].data.ux_tier, 'paid');
  // BUT no affiliate insert — D-36 filter.
  assertEquals(affInserts.length, 0, 'Renewals must NOT credit the affiliate');
});

Deno.test('19-04 / Test Y: subscription_create + valid aff_code + approved → INSERT with eligible_at = paid_at + 60d', async () => {
  const paidAtSec = 1_750_000_000;
  const event = buildInvoicePaidWithAff({
    billingReason: 'subscription_create',
    affCodeOnSubDetails: 'valid-code',
    paidAtSec,
  });
  const [admin, getCalls] = buildAffAdmin({
    affRow: { id: 'aff-1', commission_rate_cents: 1000, status: 'approved' },
    custRow: { user_id: 'user-1' },
  });
  await handle(event, admin);
  const { updates, affInserts } = getCalls();
  assertEquals(updates.length, 1); // tier sync still runs
  assertEquals(affInserts.length, 1);
  const row = affInserts[0].data;
  assertEquals(row.affiliate_id, 'aff-1');
  assertEquals(row.user_id, 'user-1');
  assertEquals(row.subscription_id, 'sub_aff_123');
  assertEquals(row.invoice_id, 'in_test_aff_xyz');
  assertEquals(row.commission_cents, 1000);
  assertEquals(row.status, 'pending');
  // eligible_at = paid_at + 60 days
  const expectedEligibleMs = paidAtSec * 1000 + 60 * 24 * 60 * 60 * 1000;
  assertEquals(row.eligible_at, new Date(expectedEligibleMs).toISOString());
  assertEquals(row.invoice_paid_at, new Date(paidAtSec * 1000).toISOString());
});

Deno.test('19-04 / Test Z: subscription_create + no aff_code anywhere → no conversion insert', async () => {
  const event = buildInvoicePaidWithAff({
    billingReason: 'subscription_create',
    affCodeOnSubDetails: null,
    affCodeOnLine: null,
  });
  const [admin, getCalls] = buildAffAdmin({
    affRow: null,
    custRow: null,
  });
  await handle(event, admin);
  const { updates, affInserts } = getCalls();
  assertEquals(updates.length, 1);
  assertEquals(affInserts.length, 0);
});

Deno.test('19-04 / Test W: subscription_create + aff_code points to SUSPENDED affiliate → no insert (silent V11)', async () => {
  const event = buildInvoicePaidWithAff({
    billingReason: 'subscription_create',
    affCodeOnSubDetails: 'suspended-code',
  });
  const [admin, getCalls] = buildAffAdmin({
    affRow: { id: 'aff-suspended', commission_rate_cents: 1000, status: 'suspended' },
    custRow: { user_id: 'user-1' },
  });
  await handle(event, admin);
  const { affInserts } = getCalls();
  assertEquals(affInserts.length, 0, 'Suspended affiliates must NOT receive new conversions');
});

Deno.test('19-04 / Test V: duplicate invoice.paid (replay) → UNIQUE violation 23505 swallowed (idempotent)', async () => {
  const event = buildInvoicePaidWithAff({
    billingReason: 'subscription_create',
    affCodeOnSubDetails: 'valid-code',
  });
  const [admin, _getCalls] = buildAffAdmin({
    affRow: { id: 'aff-1', commission_rate_cents: 1000, status: 'approved' },
    custRow: { user_id: 'user-1' },
    insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
  });
  // Must NOT throw despite the simulated UNIQUE conflict.
  await handle(event, admin);
});

Deno.test('19-04 / Test U: tier-sync runs FIRST (regression safety — Phase 14 contract preserved)', async () => {
  // Even when the affiliate path bails out, tier sync must still run for any
  // subId. Verified explicitly because re-ordering the two concerns would
  // silently break the past_due → paid banner clearance behavior.
  const event = buildInvoicePaidWithAff({
    billingReason: 'subscription_cycle',
    affCodeOnSubDetails: null,
  });
  const [admin, getCalls] = buildAffAdmin({});
  await handle(event, admin);
  const { updates } = getCalls();
  assertEquals(updates.length, 1);
  assertEquals(updates[0].data.ux_tier, 'paid');
  assertEquals(updates[0].data.status, 'active');
});
