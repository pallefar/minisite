/**
 * invoice-paid.test.ts
 *
 * Tests for the invoice.paid handler (past_due → paid recovery, D-08 banner clearing).
 *
 * Behaviors:
 *  2.14: invoice.paid on past_due sub → flips ux_tier=paid and updates current_period_end
 *  2.15: invoice.paid on already-paid sub → no-op (idempotent UPDATE)
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
  subId: string,
  subscriptionStatus: string = 'active',
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
        subscription_status: subscriptionStatus,
        period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
      } as unknown as Stripe.Invoice,
    },
    api_version: '2026-04-22.dahlia',
  } as unknown as Stripe.Event;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test('2.14: invoice.paid flips ux_tier to paid and updates current_period_end', async () => {
  const event = buildInvoicePaidEvent('sub_past_due_123', 'active');
  const [admin, getCalls] = buildMockAdmin();

  await handle(event, admin);

  const calls = getCalls();
  assertEquals(calls.length, 1, 'Expected 1 update call');
  assertEquals(calls[0].table, 'subscriptions');
  assertEquals(calls[0].data.ux_tier, 'paid');
  assertEquals(calls[0].eqCol, 'id');
  assertEquals(calls[0].eqVal, 'sub_past_due_123');
  assertEquals(typeof calls[0].data.current_period_end === 'string', true);
});

Deno.test('2.15: invoice.paid on already-paid sub → idempotent (still writes paid)', async () => {
  // Even for an already-paid sub, we still write the update (no-op at DB level because
  // values don't change). The handler doesn't pre-read the current state — it just syncs.
  const event = buildInvoicePaidEvent('sub_already_paid', 'active');
  const [admin, getCalls] = buildMockAdmin();

  await handle(event, admin);

  const calls = getCalls();
  assertEquals(calls.length, 1);
  assertEquals(calls[0].data.ux_tier, 'paid');
});

Deno.test('2.14b: invoice.paid with no subscription_id → no-op (skips)', async () => {
  const event = buildInvoicePaidEvent('', 'active');
  // Override with null subscription
  (event.data.object as unknown as Record<string, unknown>).subscription = null;

  const [admin, getCalls] = buildMockAdmin();
  await handle(event, admin);

  const calls = getCalls();
  assertEquals(calls.length, 0, 'No update expected when no subscription_id');
});
