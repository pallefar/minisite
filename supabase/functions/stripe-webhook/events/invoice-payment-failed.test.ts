/**
 * invoice-payment-failed.test.ts
 *
 * Tests for the invoice.payment_failed handler (D-08 banner trigger).
 *
 * Behaviors:
 *  2.16: invoice.payment_failed with a valid subId → writes ux_tier=past_due + status=past_due
 *  2.17: invoice.payment_failed is ALWAYS unconditional — a second payment_failed on any sub
 *        still writes ux_tier=past_due (idempotent direction; handler reads no subscription status).
 *        NOTE: The old test 2.17 asserted that a "first failure within retry window" produced
 *        ux_tier='paid'. That behaviour was the inverted-trigger bug (CR-04): the handler was
 *        reading the non-existent `invoice.subscription_status` field (always `undefined`),
 *        defaulting to 'active', then mapping 'active' → 'paid'. The old test encoded the bug.
 *        The corrected behaviour is: invoice.payment_failed ALWAYS starts dunning (past_due),
 *        regardless of any prior state. Smart Retries and the recovery path are reflected by
 *        the separate `invoice.paid` / `customer.subscription.updated` events.
 *  2.17b: invoice.payment_failed with no subscription_id → no-op (zero update calls)
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { handle } from './invoice-payment-failed.ts';

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

/** Build an invoice.payment_failed event */
function buildPaymentFailedEvent(subId: string | null): Stripe.Event {
  return {
    id: 'evt_payment_failed_test',
    object: 'event',
    type: 'invoice.payment_failed',
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'in_failed_test',
        object: 'invoice',
        subscription: subId,
      } as unknown as Stripe.Invoice,
    },
    api_version: '2026-04-22.dahlia',
  } as unknown as Stripe.Event;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test('2.16: payment_failed with valid subId → ux_tier=past_due + status=past_due', async () => {
  const event = buildPaymentFailedEvent('sub_test_001');
  const [admin, getCalls] = buildMockAdmin();

  await handle(event, admin);

  const calls = getCalls();
  assertEquals(calls.length, 1);
  assertEquals(calls[0].table, 'subscriptions');
  assertEquals(calls[0].data.ux_tier, 'past_due');
  assertEquals(calls[0].data.status, 'past_due');
  assertEquals(calls[0].eqCol, 'id');
  assertEquals(calls[0].eqVal, 'sub_test_001');
});

Deno.test('2.17: payment_failed is unconditional — second failure still writes past_due (idempotent direction)', async () => {
  // CR-04 fix: the handler no longer reads invoice.subscription_status (which does not
  // exist on the Stripe Invoice object). It writes past_due directly and unconditionally.
  // A second invoice.payment_failed on the same subscription still writes past_due.
  const event = buildPaymentFailedEvent('sub_test_002');
  const [admin, getCalls] = buildMockAdmin();

  await handle(event, admin);

  const calls = getCalls();
  assertEquals(calls.length, 1);
  assertEquals(calls[0].data.ux_tier, 'past_due');
  assertEquals(calls[0].data.status, 'past_due');
});

Deno.test('2.17b: payment_failed with no subscription_id → no-op (zero update calls)', async () => {
  const event = buildPaymentFailedEvent(null);
  const [admin, getCalls] = buildMockAdmin();

  await handle(event, admin);

  const calls = getCalls();
  assertEquals(calls.length, 0, 'No update expected when no subscription_id');
});
