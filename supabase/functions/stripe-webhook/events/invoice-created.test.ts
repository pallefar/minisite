/**
 * invoice-created.test.ts
 *
 * Phase 29 Plan 03 — Tests for the invoice.created variance handler (D-04).
 *
 * Behaviors under test:
 *  T1: Early-return when BOTH path A (subscription_details.metadata.clinic_id absent)
 *      AND path B (clinic_stripe_customers lookup returns no row) fail.
 *      → No RPC call, no Sentry call.
 *  T1b: Handler proceeds when path A resolves clinic_id.
 *  T1c: Handler proceeds when path A absent but path B resolves clinic_id.
 *  T2: Early-return when invoice.lines has no item with price.meter === 'active_patient_month'.
 *  T3: No Sentry call when variance ≤10% (stripeCount=100, localCount=95 → 5%).
 *  T4: Sentry.captureMessage called with level='warning', tag billing_variance:'true',
 *      extra includes clinicId+stripeCount+localCount+variance (stripeCount=100, localCount=80 → 20%).
 *  T5: Boundary — stripeCount=10, localCount=11 → 10% variance — NO Sentry call (strict >).
 *  T6: RPC error → Sentry.captureException called, handler does NOT throw upstream.
 */

import { assertEquals, assertExists } from 'jsr:@std/assert';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type Stripe from 'https://esm.sh/stripe@19?target=denonext';
import { handle, type SentryStub } from './invoice-created.ts';

// ─── Sentry spy factory ────────────────────────────────────────────────────────

interface SentryMessageCall {
  message: string;
  options?: {
    level?: string;
    extra?: Record<string, unknown>;
    tags?: Record<string, string>;
  };
}

interface SentryExceptionCall {
  err: unknown;
  hint?: { tags?: Record<string, string> };
}

function makeSentrySpy(): SentryStub & {
  messages: SentryMessageCall[];
  exceptions: SentryExceptionCall[];
} {
  const messages: SentryMessageCall[] = [];
  const exceptions: SentryExceptionCall[] = [];
  return {
    messages,
    exceptions,
    captureMessage: (msg: string, opts?: Record<string, unknown>) => {
      messages.push({ message: msg, options: opts as SentryMessageCall['options'] });
    },
    captureException: (err: unknown, hint?: Record<string, unknown>) => {
      exceptions.push({ err, hint: hint as SentryExceptionCall['hint'] });
    },
  };
}

// ─── Mock admin builder ────────────────────────────────────────────────────────

interface MockAdminOpts {
  clinicStripeRow?: { clinic_id: string } | null; // path B lookup result
  rpcCount?: number;                               // count_active_patients result
  rpcError?: Error;                                // simulate RPC failure
}

interface FromBuilder {
  rpcCalled: boolean;
}

function makeMockAdmin(opts: MockAdminOpts): { admin: SupabaseClient; state: FromBuilder } {
  const state: FromBuilder = { rpcCalled: false };
  const admin = {
    from: (table: string) => {
      if (table === 'clinic_stripe_customers') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: opts.clinicStripeRow ?? null,
                  error: null,
                }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected from(${table}) in test`);
    },
    rpc: (fn: string, _args: unknown) => {
      if (fn !== 'count_active_patients') throw new Error(`Unexpected RPC: ${fn}`);
      state.rpcCalled = true;
      if (opts.rpcError) return Promise.resolve({ data: null, error: opts.rpcError });
      return Promise.resolve({ data: opts.rpcCount ?? 0, error: null });
    },
  } as unknown as SupabaseClient;
  return { admin, state };
}

// ─── Invoice + Event builders ──────────────────────────────────────────────────

function makeInvoice(opts: {
  clinicIdInSubMeta?: string;   // undefined = key absent from subscription_details.metadata
  customerId?: string;
  meterQty?: number | null;    // null = no metered line
  meterName?: string;
}): Stripe.Invoice {
  const subDetailsMeta = opts.clinicIdInSubMeta != null
    ? { clinic_id: opts.clinicIdInSubMeta }
    : undefined;

  const linesData = opts.meterQty != null
    ? [{
        quantity: opts.meterQty,
        price: { meter: opts.meterName ?? 'active_patient_month' },
      }]
    : [];

  return {
    id: 'in_test_001',
    object: 'invoice',
    customer: opts.customerId ?? 'cus_test_001',
    // subscription_details.metadata is the Stripe ≥2024-09-30 path A field
    ...(subDetailsMeta != null ? { subscription_details: { metadata: subDetailsMeta } } : {}),
    lines: { data: linesData },
  } as unknown as Stripe.Invoice;
}

function makeEvent(invoice: Stripe.Invoice): Stripe.Event {
  return {
    id: 'evt_test_001',
    object: 'event',
    type: 'invoice.created',
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object: invoice },
    api_version: '2026-04-22.dahlia',
  } as unknown as Stripe.Event;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

Deno.test('T1: early-return when both path A and path B fail to resolve clinic_id', async () => {
  const spy = makeSentrySpy();
  const { admin, state } = makeMockAdmin({ clinicStripeRow: null });

  // No subscription_details.metadata and clinic_stripe_customers returns null
  const invoice = makeInvoice({ customerId: 'cus_no_clinic' });
  await handle(makeEvent(invoice), admin, spy);

  assertEquals(state.rpcCalled, false, 'RPC should not be called when no clinic_id resolved');
  assertEquals(spy.messages.length, 0, 'No Sentry message expected');
  assertEquals(spy.exceptions.length, 0, 'No Sentry exception expected');
});

Deno.test('T1b: proceeds when path A (subscription_details.metadata.clinic_id) resolves clinic_id', async () => {
  const spy = makeSentrySpy();
  const { admin } = makeMockAdmin({ rpcCount: 100 });

  const invoice = makeInvoice({
    clinicIdInSubMeta: 'org_abc',
    meterQty: 100,
  });
  await handle(makeEvent(invoice), admin, spy);

  // No variance (100 == 100) → no Sentry message, but also no exception
  assertEquals(spy.exceptions.length, 0, 'No exception when path A resolves and variance ok');
  assertEquals(spy.messages.length, 0, 'No message when variance is 0%');
});

Deno.test('T1c: proceeds when path A absent but path B (clinic_stripe_customers) resolves clinic_id', async () => {
  const spy = makeSentrySpy();
  const { admin } = makeMockAdmin({
    clinicStripeRow: { clinic_id: 'org_clinic_path_b' },
    rpcCount: 50,
  });

  const invoice = makeInvoice({
    // No clinicIdInSubMeta → path A absent
    customerId: 'cus_clinic_001',
    meterQty: 50,
  });
  await handle(makeEvent(invoice), admin, spy);

  assertEquals(spy.exceptions.length, 0, 'No exception when path B resolves and variance ok');
  assertEquals(spy.messages.length, 0, 'No message when variance is 0%');
});

Deno.test('T2: early-return when no metered line item with price.meter === active_patient_month', async () => {
  const spy = makeSentrySpy();
  const { admin, state } = makeMockAdmin({ rpcCount: 100 });

  // clinic_id present via sub meta, but no matching metered line
  const invoice = makeInvoice({
    clinicIdInSubMeta: 'org_abc',
    meterQty: null, // no lines
  });
  await handle(makeEvent(invoice), admin, spy);

  assertEquals(state.rpcCalled, false, 'RPC should not be called when no metered line');
  assertEquals(spy.messages.length, 0, 'No Sentry call');
});

Deno.test('T3: no Sentry call when variance ≤10% (stripeCount=100, localCount=95 → 5%)', async () => {
  const spy = makeSentrySpy();
  const { admin } = makeMockAdmin({ rpcCount: 95 });

  const invoice = makeInvoice({ clinicIdInSubMeta: 'org_abc', meterQty: 100 });
  await handle(makeEvent(invoice), admin, spy);

  assertEquals(spy.messages.length, 0, 'No Sentry warning at 5% variance');
  assertEquals(spy.exceptions.length, 0, 'No Sentry exception');
});

Deno.test('T4: Sentry.captureMessage fired with level=warning when variance >10% (stripeCount=100, localCount=80 → 20%)', async () => {
  const spy = makeSentrySpy();
  const { admin } = makeMockAdmin({ rpcCount: 80 });

  const invoice = makeInvoice({ clinicIdInSubMeta: 'org_abc', meterQty: 100 });
  await handle(makeEvent(invoice), admin, spy);

  assertEquals(spy.messages.length, 1, 'Expected 1 Sentry message at 20% variance');
  assertExists(spy.messages[0]);
  assertEquals(spy.messages[0].options?.level, 'warning', 'Level must be warning');
  assertEquals(
    spy.messages[0].options?.tags?.['billing_variance'],
    'true',
    'Tag billing_variance must be true',
  );
  assertExists(spy.messages[0].options?.extra?.['clinicId'], 'extra.clinicId must be present');
  assertExists(spy.messages[0].options?.extra?.['stripeCount'], 'extra.stripeCount must be present');
  assertExists(spy.messages[0].options?.extra?.['localCount'], 'extra.localCount must be present');
  assertExists(spy.messages[0].options?.extra?.['variance'], 'extra.variance must be present');
});

Deno.test('T5: boundary — stripeCount=10, localCount=11 → exact 10% — NO Sentry call (strict >)', async () => {
  const spy = makeSentrySpy();
  // |10 - 11| / max(10, 1) = 1/10 = 0.10 — exactly at threshold, not above
  const { admin } = makeMockAdmin({ rpcCount: 11 });

  const invoice = makeInvoice({ clinicIdInSubMeta: 'org_abc', meterQty: 10 });
  await handle(makeEvent(invoice), admin, spy);

  assertEquals(spy.messages.length, 0, 'Exactly 10% should NOT fire Sentry (strict >)');
  assertEquals(spy.exceptions.length, 0, 'No exception at boundary');
});

Deno.test('T6: RPC error → Sentry.captureException called, handler does NOT throw upstream', async () => {
  const spy = makeSentrySpy();
  const rpcErr = new Error('count_active_patients: relation not found');
  const { admin } = makeMockAdmin({ rpcError: rpcErr });

  const invoice = makeInvoice({ clinicIdInSubMeta: 'org_abc', meterQty: 100 });

  // Must not throw
  await handle(makeEvent(invoice), admin, spy);

  assertEquals(spy.exceptions.length, 1, 'Expected 1 Sentry exception on RPC error');
  assertEquals(spy.messages.length, 0, 'No variance message when RPC errored');
});
