/**
 * invoice-payment-failed.test.ts
 *
 * Tests for the invoice.payment_failed handler (D-08 banner trigger).
 *
 * Behaviors:
 *  2.16: invoice.payment_failed + subscription.status=past_due → flips ux_tier=past_due
 *  2.17: invoice.payment_failed + subscription.status=active (first failure, retry window) →
 *        no change to ux_tier (still maps to 'paid' from 'active' status)
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
function buildPaymentFailedEvent(subId: string, subscriptionStatus: string): Stripe.Event {
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
        subscription_status: subscriptionStatus,
      } as unknown as Stripe.Invoice,
    },
    api_version: '2026-04-22.dahlia',
  } as unknown as Stripe.Event;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test('2.16: payment_failed + status=past_due → ux_tier=past_due', async () => {
  const event = buildPaymentFailedEvent('sub_past_due_test', 'past_due');
  const [admin, getCalls] = buildMockAdmin();

  await handle(event, admin);

  const calls = getCalls();
  assertEquals(calls.length, 1);
  assertEquals(calls[0].table, 'subscriptions');
  assertEquals(calls[0].data.ux_tier, 'past_due');
  assertEquals(calls[0].data.status, 'past_due');
  assertEquals(calls[0].eqVal, 'sub_past_due_test');
});

Deno.test('2.17: payment_failed + status=active (first failure, retry window) → ux_tier=paid (no-op)', async () => {
  // First failure within Smart Retries window — Stripe still has status='active'.
  // Handler maps 'active' → 'paid', so ux_tier stays 'paid'. This is correct:
  // Stripe will fire subscription.updated with status='past_due' when retries exhaust.
  const event = buildPaymentFailedEvent('sub_active_test', 'active');
  const [admin, getCalls] = buildMockAdmin();

  await handle(event, admin);

  const calls = getCalls();
  assertEquals(calls.length, 1);
  assertEquals(calls[0].data.ux_tier, 'paid'); // 'active' maps to 'paid' — no premature flip
  assertEquals(calls[0].data.status, 'active');
});
