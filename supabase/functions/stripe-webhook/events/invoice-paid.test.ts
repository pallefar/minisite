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
