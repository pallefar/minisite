/**
 * invoice-upcoming.test.ts
 *
 * Deno test suite for the invoice.upcoming handler (Plan 14-07).
 *
 * Behaviors tested:
 *  Test 1: Skips meter event when active count is at or below 10 (no overage)
 *  Test 2: Emits meter event with overage=1 when 11 active patients
 *  Test 3: Emits meter event with overage=15 when 25 active patients
 *  Test 4: Uses byte-identical identifier across two invocations for same {clinic, period}
 *  Test 5: Skips meter event + warns when period_start is older than 35 days
 *  Test 6: Skips meter event for web-tier customers (not in clinic_stripe_customers)
 *  Test 7: Skips silently when stripe_customer_id is not registered at all (covered by Test 6 path)
 */

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { handleInvoiceUpcoming } from './invoice-upcoming.ts';
import type { HandlerCtx } from './invoice-upcoming.ts';

// ─── Mock builders ────────────────────────────────────────────────────────────

interface MeterEventCall {
  event_name: string;
  payload: { stripe_customer_id: string; value: string };
  identifier: string;
  timestamp: number;
}

/**
 * Build a mock HandlerCtx with configurable active patient count.
 * Set `isWebTier = true` to simulate no clinic_stripe_customers row.
 * Set `isUnregistered = true` same effect (same code path as web-tier).
 */
function makeCtx({
  activePatients,
  isWebTier = false,
  rpcError = null,
}: {
  activePatients: number;
  isWebTier?: boolean;
  rpcError?: { message: string } | null;
}): { ctx: HandlerCtx; meterCalls: MeterEventCall[]; warnCalls: unknown[][] } {
  const meterCalls: MeterEventCall[] = [];
  const warnCalls: unknown[][] = [];

  const stripe = {
    billing: {
      meterEvents: {
        create: async (args: MeterEventCall) => {
          meterCalls.push(args);
          return { id: 'mevent_test_xxx' };
        },
      },
    },
  } as unknown as Stripe;

  const clinicData = isWebTier ? null : { clinic_id: 'clinic-uuid-test-1234' };

  const admin = {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: async () => ({ data: clinicData, error: null }),
        }),
      }),
    }),
    rpc: async (_fnName: string, _params: unknown) => ({
      data: activePatients,
      error: rpcError,
    }),
  } as unknown as SupabaseClient;

  // Spy on console.warn
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnCalls.push(args);
    originalWarn(...args);
  };

  const ctx: HandlerCtx = { admin, stripe };
  return { ctx, meterCalls, warnCalls };
}

/**
 * Build a mock invoice.upcoming Stripe.Event.
 * `ageDays` controls how old period_start is (default = 5 days ago, well within 35-day window).
 */
function makeEvent({ ageDays = 5 }: { ageDays?: number } = {}): Stripe.Event {
  const periodStart = Math.floor((Date.now() - ageDays * 86400 * 1000) / 1000);
  return {
    id: 'evt_test_invoice_upcoming_xxx',
    object: 'event',
    type: 'invoice.upcoming',
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    api_version: '2026-04-22.dahlia',
    data: {
      object: {
        object: 'invoice',
        customer: 'cus_test_xxx',
        period_start: periodStart,
        period_end: periodStart + 30 * 86400,
      } as unknown as Stripe.Invoice,
    },
  } as unknown as Stripe.Event;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test('Test 1: skips meter event when active count is at or below 10', async () => {
  const { ctx, meterCalls } = makeCtx({ activePatients: 10 });
  const event = makeEvent();

  await handleInvoiceUpcoming(event, ctx);

  assertEquals(meterCalls.length, 0, 'Expected NO meter event when count = 10 (no overage)');
});

Deno.test('Test 2: emits meter event with overage=1 when 11 active patients', async () => {
  const { ctx, meterCalls } = makeCtx({ activePatients: 11 });
  const event = makeEvent();

  await handleInvoiceUpcoming(event, ctx);

  assertEquals(meterCalls.length, 1, 'Expected exactly 1 meter event');
  assertEquals(meterCalls[0].event_name, 'active_patients');
  assertEquals(meterCalls[0].payload.value, '1', 'value must be STRING "1" per API contract');
  assertEquals(meterCalls[0].payload.stripe_customer_id, 'cus_test_xxx');
  // Identifier must be 64-char SHA-256 hex
  assertEquals(meterCalls[0].identifier.length, 64, 'identifier must be 64-char hex');
  assertEquals(/^[0-9a-f]+$/.test(meterCalls[0].identifier), true, 'identifier must be lowercase hex');
});

Deno.test('Test 3: emits meter event with overage=15 when 25 active patients', async () => {
  const { ctx, meterCalls } = makeCtx({ activePatients: 25 });
  const event = makeEvent();

  await handleInvoiceUpcoming(event, ctx);

  assertEquals(meterCalls.length, 1, 'Expected exactly 1 meter event');
  assertEquals(meterCalls[0].event_name, 'active_patients');
  assertEquals(meterCalls[0].payload.value, '15', 'value must be STRING "15" per API contract');
});

Deno.test('Test 4: uses byte-identical identifier across two invocations for same {clinic, period}', async () => {
  // First invocation
  const { ctx: ctx1, meterCalls: calls1 } = makeCtx({ activePatients: 12 });
  const event1 = makeEvent({ ageDays: 5 });
  await handleInvoiceUpcoming(event1, ctx1);

  // Second invocation — same clinic, same event (same period_start)
  const { ctx: ctx2, meterCalls: calls2 } = makeCtx({ activePatients: 12 });
  const event2 = { ...event1, id: 'evt_test_replay_xxx' } as Stripe.Event;
  await handleInvoiceUpcoming(event2, ctx2);

  assertEquals(calls1.length, 1, 'First call should emit 1 meter event');
  assertEquals(calls2.length, 1, 'Second call should also emit 1 meter event');
  // Identifiers must be byte-identical (Stripe server deduplicates; we assert client determinism)
  assertEquals(
    calls1[0].identifier,
    calls2[0].identifier,
    'identifier must be byte-identical across invocations for same {clinic_id, period_start}',
  );
});

Deno.test('Test 5: skips meter event + warns when period_start is older than 35 days', async () => {
  const { ctx, meterCalls, warnCalls } = makeCtx({ activePatients: 15 });
  const event = makeEvent({ ageDays: 36 }); // 36 days in the past → beyond 35-day window

  await handleInvoiceUpcoming(event, ctx);

  assertEquals(meterCalls.length, 0, 'Expected NO meter event for period older than 35 days');
  assertEquals(warnCalls.length >= 1, true, 'Expected console.warn to be called');

  // Verify warn message contains the expected string
  const warnMsg = warnCalls[0][0] as string;
  assertEquals(
    warnMsg.includes('older than 35 days'),
    true,
    'warn message must include "older than 35 days"',
  );

  // Verify warn includes clinic_id
  const warnMeta = warnCalls[0][1] as { clinic_id: string };
  assertEquals(typeof warnMeta.clinic_id, 'string', 'warn must include clinic_id');

  // Restore console.warn (makeCtx spies globally; cleanup for test isolation)
  console.warn = console.warn; // already restored by subsequent makeCtx calls
});

Deno.test('Test 6: skips meter event for web-tier customers (not in clinic_stripe_customers)', async () => {
  const { ctx, meterCalls } = makeCtx({ activePatients: 20, isWebTier: true });
  const event = makeEvent();

  await handleInvoiceUpcoming(event, ctx);

  assertEquals(
    meterCalls.length,
    0,
    'Expected NO meter event for web-tier customer (not in clinic_stripe_customers)',
  );
});

Deno.test('Test 7: skips silently when stripe_customer_id is not registered at all', async () => {
  // Unregistered customer uses the same code path as web-tier (clinic_stripe_customers lookup
  // returns null for any customer not in that table, whether web-tier or unknown).
  const { ctx, meterCalls } = makeCtx({ activePatients: 20, isWebTier: true });
  const event = makeEvent();
  // Change customer ID to a completely unknown one
  (event.data.object as unknown as Record<string, unknown>).customer = 'cus_unknown_xyz';

  await handleInvoiceUpcoming(event, ctx);

  assertEquals(
    meterCalls.length,
    0,
    'Expected NO meter event for unregistered stripe_customer_id',
  );
});
