/**
 * invoice-payment-failed.test.ts
 *
 * Tests for the invoice.payment_failed handler (D-08 banner trigger).
 *
 * Behaviors (Phase 14 — D-08 banner trigger / CR-04 fix):
 *  2.16: invoice.payment_failed with a valid subId → writes ux_tier=past_due + status=past_due
 *  2.17: invoice.payment_failed is ALWAYS unconditional — a second payment_failed on any sub
 *        still writes ux_tier=past_due (idempotent direction; handler reads no subscription status).
 *  2.17b: invoice.payment_failed with no subscription_id → no-op (zero update calls)
 *
 * Phase 65-04 — PAY-07 dunning state machine extension:
 *  65-T1: prior dunning_state=null → advances to first_failed
 *  65-T2: prior dunning_state=first_failed → advances to second_failed
 *  65-T3: prior dunning_state=second_failed → advances to final_warning
 *  65-T4: prior dunning_state=final_warning → stays at final_warning (no skip past terminal-warning)
 *  65-T5: prior dunning_state=cancelled_for_payment → ux_tier write still happens; dunning_state untouched
 *  65-T6: every transition also writes last_dunning_email_at=null (orchestrator pick-up signal)
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

/**
 * Mock admin supports:
 *   - .from(t).update(data).eq(col, val) → resolves { error: null }
 *   - .from(t).select(cols).eq(col, val).maybeSingle() → resolves { data: prevRow, error: null }
 */
function buildMockAdmin(
  prevRow: Record<string, unknown> | null = null,
): [SupabaseClient, () => UpdateCall[]] {
  const calls: UpdateCall[] = [];
  const mockAdmin = {
    from: (table: string) => ({
      update: (data: Record<string, unknown>) => ({
        eq: (col: string, val: unknown) => {
          calls.push({ table, data, eqCol: col, eqVal: val });
          return Promise.resolve({ error: null });
        },
      }),
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          maybeSingle: () => Promise.resolve({ data: prevRow, error: null }),
        }),
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
  const [admin, getCalls] = buildMockAdmin(null);

  await handle(event, admin);

  const calls = getCalls();
  // Phase 65-04: an additional update call may occur, but the first must carry past_due.
  const subUpdate = calls.find((c) => c.table === 'subscriptions');
  assertEquals(subUpdate !== undefined, true);
  assertEquals(subUpdate!.data.ux_tier, 'past_due');
  assertEquals(subUpdate!.data.status, 'past_due');
  assertEquals(subUpdate!.eqCol, 'id');
  assertEquals(subUpdate!.eqVal, 'sub_test_001');
});

Deno.test('2.17: payment_failed is unconditional — second failure still writes past_due (idempotent direction)', async () => {
  const event = buildPaymentFailedEvent('sub_test_002');
  const [admin, getCalls] = buildMockAdmin({ dunning_state: 'first_failed' });

  await handle(event, admin);

  const calls = getCalls();
  const subUpdate = calls.find((c) => c.table === 'subscriptions');
  assertEquals(subUpdate !== undefined, true);
  assertEquals(subUpdate!.data.ux_tier, 'past_due');
  assertEquals(subUpdate!.data.status, 'past_due');
});

Deno.test('2.17b: payment_failed with no subscription_id → no-op (zero update calls)', async () => {
  const event = buildPaymentFailedEvent(null);
  const [admin, getCalls] = buildMockAdmin(null);

  await handle(event, admin);

  const calls = getCalls();
  assertEquals(calls.length, 0, 'No update expected when no subscription_id');
});

// ─── Phase 65-04 dunning state machine tests ────────────────────────────────

Deno.test('65-T1: prior dunning_state=null → advances to first_failed + last_dunning_email_at=null', async () => {
  const event = buildPaymentFailedEvent('sub_dun_t1');
  const [admin, getCalls] = buildMockAdmin({ dunning_state: null });

  await handle(event, admin);

  const subUpdate = getCalls().find((c) => c.table === 'subscriptions');
  assertEquals(subUpdate !== undefined, true);
  assertEquals(subUpdate!.data.dunning_state, 'first_failed');
  assertEquals(subUpdate!.data.last_dunning_email_at, null);
  assertEquals(subUpdate!.data.ux_tier, 'past_due');
  assertEquals(subUpdate!.data.status, 'past_due');
});

Deno.test('65-T1b: prior dunning_state=none → advances to first_failed', async () => {
  const event = buildPaymentFailedEvent('sub_dun_t1b');
  const [admin, getCalls] = buildMockAdmin({ dunning_state: 'none' });

  await handle(event, admin);

  const subUpdate = getCalls().find((c) => c.table === 'subscriptions');
  assertEquals(subUpdate!.data.dunning_state, 'first_failed');
  assertEquals(subUpdate!.data.last_dunning_email_at, null);
});

Deno.test('65-T2: prior dunning_state=first_failed → advances to second_failed', async () => {
  const event = buildPaymentFailedEvent('sub_dun_t2');
  const [admin, getCalls] = buildMockAdmin({ dunning_state: 'first_failed' });

  await handle(event, admin);

  const subUpdate = getCalls().find((c) => c.table === 'subscriptions');
  assertEquals(subUpdate!.data.dunning_state, 'second_failed');
  assertEquals(subUpdate!.data.last_dunning_email_at, null);
});

Deno.test('65-T3: prior dunning_state=second_failed → advances to final_warning', async () => {
  const event = buildPaymentFailedEvent('sub_dun_t3');
  const [admin, getCalls] = buildMockAdmin({ dunning_state: 'second_failed' });

  await handle(event, admin);

  const subUpdate = getCalls().find((c) => c.table === 'subscriptions');
  assertEquals(subUpdate!.data.dunning_state, 'final_warning');
  assertEquals(subUpdate!.data.last_dunning_email_at, null);
});

Deno.test('65-T4: prior dunning_state=final_warning → stays at final_warning (no skip past terminal-warning)', async () => {
  const event = buildPaymentFailedEvent('sub_dun_t4');
  const [admin, getCalls] = buildMockAdmin({ dunning_state: 'final_warning' });

  await handle(event, admin);

  const subUpdate = getCalls().find((c) => c.table === 'subscriptions');
  // ux_tier/status still get written (idempotent past_due assertion); dunning_state must NOT advance.
  assertEquals(subUpdate!.data.ux_tier, 'past_due');
  // Either no dunning_state key in patch OR key === 'final_warning' (current state preserved).
  const dunVal = subUpdate!.data.dunning_state;
  assertEquals(
    dunVal === undefined || dunVal === 'final_warning',
    true,
    `dunning_state must not skip past final_warning, got: ${dunVal}`,
  );
});

Deno.test('65-T5: prior dunning_state=cancelled_for_payment → past_due still written, dunning_state untouched', async () => {
  const event = buildPaymentFailedEvent('sub_dun_t5');
  const [admin, getCalls] = buildMockAdmin({ dunning_state: 'cancelled_for_payment' });

  await handle(event, admin);

  const subUpdate = getCalls().find((c) => c.table === 'subscriptions');
  assertEquals(subUpdate!.data.ux_tier, 'past_due');
  const dunVal = subUpdate!.data.dunning_state;
  assertEquals(
    dunVal === undefined || dunVal === 'cancelled_for_payment',
    true,
    `dunning_state must not advance past terminal cancelled_for_payment, got: ${dunVal}`,
  );
});

Deno.test('65-T6: every transition sets last_dunning_email_at=null (orchestrator pick-up signal)', async () => {
  // Test multiple priors; each that ADVANCES must include last_dunning_email_at=null in the patch.
  const advancingPriors: Array<string | null> = [null, 'none', 'first_failed', 'second_failed'];
  for (const prior of advancingPriors) {
    const event = buildPaymentFailedEvent(`sub_t6_${prior ?? 'null'}`);
    const [admin, getCalls] = buildMockAdmin({ dunning_state: prior });
    await handle(event, admin);
    const subUpdate = getCalls().find((c) => c.table === 'subscriptions');
    assertEquals(
      subUpdate!.data.last_dunning_email_at,
      null,
      `last_dunning_email_at must be null after advancing from ${prior}`,
    );
  }
});
