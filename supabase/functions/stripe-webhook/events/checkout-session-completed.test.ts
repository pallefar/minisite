/**
 * checkout-session-completed.test.ts
 *
 * Tests for the checkout.session.completed handler (Pitfall 8 — first access grant).
 *
 * Behaviors:
 *  2.1: web Checkout session (tier_kind='web') → upserts subscriptions + stripe_customers
 *  2.2: clinic Checkout session (tier_kind='clinic') → upserts subscriptions + clinic_stripe_customers
 *  2.3: missing tier_kind → throws "metadata-missing" error
 */

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { handle } from './checkout-session-completed.ts';

// ─── Mock SupabaseClient builder ─────────────────────────────────────────────
interface UpsertCall {
  table: string;
  data: Record<string, unknown>;
  options?: Record<string, unknown>;
}

function buildMockAdmin(upsertResult: { error: null | { message: string; code: string } } = {
  error: null,
}): [SupabaseClient, () => UpsertCall[]] {
  const calls: UpsertCall[] = [];

  const mockAdmin = {
    from: (table: string) => ({
      upsert: (data: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.push({ table, data, options });
        return Promise.resolve(upsertResult);
      },
      update: (_data: Record<string, unknown>) => ({
        eq: (_col: string, _val: unknown) => Promise.resolve(upsertResult),
      }),
    }),
  } as unknown as SupabaseClient;

  return [mockAdmin, () => calls];
}

/** Build a minimal Stripe Event for checkout.session.completed */
function buildCheckoutEvent(
  overrides: {
    metadata?: Record<string, string>;
    subscriptionDataMetadata?: Record<string, string>;
    subscription?: string;
    customer?: string;
  } = {},
): Stripe.Event {
  const meta = overrides.metadata ?? {};
  const subDataMeta = overrides.subscriptionDataMetadata ?? {
    tier_kind: 'web',
    user_id: 'user-uuid-test-123',
    provider: 'stripe',
  };

  return {
    id: 'evt_checkout_test_123',
    object: 'event',
    type: 'checkout.session.completed',
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'cs_test_123',
        object: 'checkout.session',
        subscription: overrides.subscription ?? 'sub_test_web_123',
        customer: overrides.customer ?? 'cus_test_123',
        metadata: meta,
        subscription_data: { metadata: subDataMeta },
        line_items: { data: [{ price: { id: 'price_monthly_test' } }] },
      } as unknown as Stripe.Checkout.Session,
    },
    api_version: '2026-04-22.dahlia',
  } as unknown as Stripe.Event;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test('2.1: web checkout — upserts stripe_customers + subscriptions with ux_tier=paid', async () => {
  const event = buildCheckoutEvent({
    subscriptionDataMetadata: { tier_kind: 'web', user_id: 'user-uuid-abc', provider: 'stripe' },
    subscription: 'sub_web_abc',
    customer: 'cus_abc',
  });

  const [admin, getCalls] = buildMockAdmin();
  await handle(event, admin);

  const calls = getCalls();
  // Should have called upsert on stripe_customers and subscriptions
  assertEquals(calls.length >= 2, true, 'Expected at least 2 upsert calls');

  const custCall = calls.find((c) => c.table === 'stripe_customers');
  assertEquals(custCall !== undefined, true, 'stripe_customers upsert expected');
  assertEquals(custCall!.data.user_id, 'user-uuid-abc');
  assertEquals(custCall!.data.stripe_customer_id, 'cus_abc');

  const subCall = calls.find((c) => c.table === 'subscriptions');
  assertEquals(subCall !== undefined, true, 'subscriptions upsert expected');
  assertEquals(subCall!.data.id, 'sub_web_abc');
  assertEquals(subCall!.data.user_id, 'user-uuid-abc');
  assertEquals(subCall!.data.clinic_id, null);
  assertEquals(subCall!.data.ux_tier, 'paid');
  assertEquals(subCall!.data.provider, 'stripe');
});

Deno.test('2.2: clinic checkout — upserts clinic_stripe_customers + subscriptions with ux_tier=paid', async () => {
  const event = buildCheckoutEvent({
    subscriptionDataMetadata: {
      tier_kind: 'clinic',
      clinic_id: 'clinic-uuid-xyz',
      provider: 'stripe',
    },
    subscription: 'sub_clinic_xyz',
    customer: 'cus_clinic_xyz',
  });

  const [admin, getCalls] = buildMockAdmin();
  await handle(event, admin);

  const calls = getCalls();
  assertEquals(calls.length >= 2, true, 'Expected at least 2 upsert calls for clinic');

  const custCall = calls.find((c) => c.table === 'clinic_stripe_customers');
  assertEquals(custCall !== undefined, true, 'clinic_stripe_customers upsert expected');
  assertEquals(custCall!.data.clinic_id, 'clinic-uuid-xyz');
  assertEquals(custCall!.data.stripe_customer_id, 'cus_clinic_xyz');

  const subCall = calls.find((c) => c.table === 'subscriptions');
  assertEquals(subCall !== undefined, true, 'subscriptions upsert expected');
  assertEquals(subCall!.data.id, 'sub_clinic_xyz');
  assertEquals(subCall!.data.clinic_id, 'clinic-uuid-xyz');
  assertEquals(subCall!.data.user_id, null);
  assertEquals(subCall!.data.ux_tier, 'paid');
});

Deno.test('2.3: missing tier_kind → throws metadata-missing error', async () => {
  const event = buildCheckoutEvent({
    subscriptionDataMetadata: { provider: 'stripe' }, // no tier_kind
    metadata: {},
  });

  const [admin] = buildMockAdmin();

  await assertRejects(
    () => handle(event, admin),
    Error,
    'metadata-missing',
  );
});

// ─── P43 Plan 01 Task 3: Lifetime branch tests ───────────────────────────────
//
// Behaviors (from 43-01-PLAN <behavior>):
//   - 3.1 (RED→GREEN): meta.tier_kind='lifetime' triggers lifetime_purchases upsert with
//                      onConflict='stripe_payment_intent_id' + ignoreDuplicates=true.
//   - 3.2 (idempotency): replay of the SAME event produces identical upsert call signatures
//                        across both invocations (no duplicate-row error).
//   - 3.3 (negative):   unknown tier_kind falls through to terminal else with the updated
//                        'tier_kind not in {web,clinic,lifetime}' message.
//   - 3.4 (Slack-unset): SLACK_WEBHOOK_EXPERIMENTS_URL unset → handler still succeeds (Slack
//                        call is non-blocking; errors swallowed).
//   - 3.5 (upsert-error): upsert returns { error: { message: ... } } → handler throws
//                          Error('lifetime-purchases-upsert-failed').

/** Build a lifetime-tier Stripe Checkout Session event (mode=payment, payment_intent set). */
function buildLifetimeCheckoutEvent(
  overrides: {
    paymentIntent?: string;
    sessionId?: string;
    userId?: string;
    amountTotal?: number;
    customer?: string;
  } = {},
): Stripe.Event {
  const userId = overrides.userId ?? '00000000-0000-0000-0000-000000000abc';
  return {
    id: 'evt_checkout_lifetime_test_001',
    object: 'event',
    type: 'checkout.session.completed',
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: overrides.sessionId ?? 'cs_test_001',
        object: 'checkout.session',
        payment_intent: overrides.paymentIntent ?? 'pi_test_lifetime_001',
        customer: overrides.customer ?? 'cus_test_001',
        amount_total: overrides.amountTotal ?? 49900,
        metadata: { user_id: userId, tier_kind: 'lifetime' },
        subscription_data: {
          metadata: { tier_kind: 'lifetime', user_id: userId, provider: 'stripe' },
        },
      } as unknown as Stripe.Checkout.Session,
    },
    api_version: '2026-04-22.dahlia',
  } as unknown as Stripe.Event;
}

Deno.test('3.1: lifetime checkout — upserts lifetime_purchases with onConflict=stripe_payment_intent_id', async () => {
  const event = buildLifetimeCheckoutEvent({
    userId: '00000000-0000-0000-0000-000000000abc',
    paymentIntent: 'pi_test_lifetime_001',
    customer: 'cus_test_001',
    amountTotal: 49900,
    sessionId: 'cs_test_001',
  });

  const [admin, getCalls] = buildMockAdmin();
  await handle(event, admin);

  const calls = getCalls();
  const lpCall = calls.find((c) => c.table === 'lifetime_purchases');
  assertEquals(lpCall !== undefined, true, 'lifetime_purchases upsert expected');
  assertEquals(lpCall!.data.user_id, '00000000-0000-0000-0000-000000000abc');
  assertEquals(lpCall!.data.stripe_payment_intent_id, 'pi_test_lifetime_001');
  assertEquals(lpCall!.data.stripe_customer_id, 'cus_test_001');
  assertEquals(lpCall!.data.amount_cents, 49900);
  assertEquals(
    (lpCall!.data.metadata as Record<string, unknown>).stripe_session_id,
    'cs_test_001',
  );
  assertEquals(lpCall!.options?.onConflict, 'stripe_payment_intent_id');
  assertEquals(lpCall!.options?.ignoreDuplicates, true);
});

Deno.test('3.2: lifetime checkout idempotent replay — same call signature on second invocation', async () => {
  const event = buildLifetimeCheckoutEvent();

  const [admin, getCalls] = buildMockAdmin();
  await handle(event, admin);
  await handle(event, admin);

  const lpCalls = getCalls().filter((c) => c.table === 'lifetime_purchases');
  assertEquals(lpCalls.length, 2, 'Two upsert invocations expected (one per handle call)');
  // Both calls share the same payload (idempotency at Postgres layer via UNIQUE constraint;
  // handler does NOT short-circuit — onConflict+ignoreDuplicates handles dedupe).
  assertEquals(
    lpCalls[0].data.stripe_payment_intent_id,
    lpCalls[1].data.stripe_payment_intent_id,
    'Both calls must reference the same stripe_payment_intent_id',
  );
  assertEquals(lpCalls[0].options?.onConflict, 'stripe_payment_intent_id');
  assertEquals(lpCalls[0].options?.ignoreDuplicates, true);
  assertEquals(lpCalls[1].options?.onConflict, 'stripe_payment_intent_id');
  assertEquals(lpCalls[1].options?.ignoreDuplicates, true);
});

Deno.test('3.3: unknown tier_kind → terminal else with updated message including lifetime', async () => {
  const event = buildCheckoutEvent({
    subscriptionDataMetadata: { tier_kind: 'unknown', provider: 'stripe' },
  });

  const [admin] = buildMockAdmin();

  await assertRejects(
    () => handle(event, admin),
    Error,
    'tier_kind not in {web,clinic,lifetime}',
  );
});

Deno.test('3.4: lifetime handler succeeds when SLACK_WEBHOOK_EXPERIMENTS_URL is unset', async () => {
  // Ensure env var is unset for this test path.
  const prev = Deno.env.get('SLACK_WEBHOOK_EXPERIMENTS_URL');
  Deno.env.delete('SLACK_WEBHOOK_EXPERIMENTS_URL');

  try {
    const event = buildLifetimeCheckoutEvent({ paymentIntent: 'pi_test_no_slack' });
    const [admin] = buildMockAdmin();
    // Should NOT throw — Slack call is wrapped in EdgeRuntime.waitUntil + .catch.
    await handle(event, admin);
  } finally {
    if (prev !== undefined) Deno.env.set('SLACK_WEBHOOK_EXPERIMENTS_URL', prev);
  }
});

Deno.test('3.5: lifetime upsert error → throws lifetime-purchases-upsert-failed', async () => {
  const event = buildLifetimeCheckoutEvent({ paymentIntent: 'pi_test_err' });

  const [admin] = buildMockAdmin({
    error: { message: 'db unavailable', code: '08006' },
  });

  await assertRejects(
    () => handle(event, admin),
    Error,
    'lifetime-purchases-upsert-failed',
  );
});

// ============================================================================
// Phase 65-04 — PAY-03 (tax_id mirror) + PAY-01 (tax_collection_log audit)
// ============================================================================
//
// Behaviors (from 65-04-PLAN <behavior>):
//   65-T10: clinic session with customer_tax_ids=[{ type, value }] writes
//           org_subscriptions.tax_id=value keyed by clinic_id.
//   65-T11: consumer (web) session with no customer_tax_ids does NOT touch
//           org_subscriptions.
//   65-T12: clinic session with customer_tax_ids=[] (empty) does NOT touch
//           org_subscriptions.
//   65-T13: session with automatic_tax.status='complete' writes one
//           tax_collection_log row with state/postal + tax/subtotal/total cents.
//   65-T14: session with automatic_tax.status='requires_location_inputs' STILL
//           writes a tax_collection_log row (visibility into failures).
//   65-T15: session without automatic_tax field does NOT write a tax_collection_log row.
//   65-T16: tax_id is NEVER logged via console.log/console.error (PII safety, T-65-04-02).

/**
 * Enhanced mock admin that tracks both upsert AND update+eq + insert calls.
 * Mirrors the supabase-js builder pattern.
 */
interface AdminCall {
  table: string;
  op: 'upsert' | 'update' | 'insert';
  data: Record<string, unknown>;
  filter?: { col: string; val: unknown };
  options?: Record<string, unknown>;
}

function buildExtendedMockAdmin(): [SupabaseClient, () => AdminCall[]] {
  const calls: AdminCall[] = [];
  const mockAdmin = {
    from: (table: string) => ({
      upsert: (data: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.push({ table, op: 'upsert', data, options });
        return Promise.resolve({ error: null });
      },
      update: (data: Record<string, unknown>) => ({
        eq: (col: string, val: unknown) => {
          calls.push({ table, op: 'update', data, filter: { col, val } });
          return Promise.resolve({ error: null });
        },
      }),
      insert: (data: Record<string, unknown>) => {
        calls.push({ table, op: 'insert', data });
        return Promise.resolve({ error: null });
      },
    }),
  } as unknown as SupabaseClient;
  return [mockAdmin, () => calls];
}

/** Build a clinic Checkout session event with optional tax_id_collection + automatic_tax. */
function buildClinicTaxEvent(opts: {
  clinicId?: string;
  customerTaxIds?: Array<{ type: string; value: string }>;
  automaticTaxStatus?: 'complete' | 'requires_location_inputs' | 'failed' | null;
  customerState?: string;
  customerPostal?: string;
  amountSubtotal?: number;
  amountTax?: number;
  amountTotal?: number;
  sessionId?: string;
  subId?: string;
}): Stripe.Event {
  const obj: Record<string, unknown> = {
    id: opts.sessionId ?? 'cs_clinic_tax_001',
    object: 'checkout.session',
    subscription: opts.subId ?? 'sub_clinic_tax_001',
    customer: 'cus_clinic_tax',
    metadata: { clinic_id: opts.clinicId ?? 'clinic-uuid-001' },
    subscription_data: {
      metadata: {
        tier_kind: 'clinic',
        clinic_id: opts.clinicId ?? 'clinic-uuid-001',
        provider: 'stripe',
      },
    },
    line_items: { data: [{ price: { id: 'price_clinic_base' } }] },
  };
  if (opts.customerTaxIds !== undefined) {
    obj.customer_tax_ids = opts.customerTaxIds;
  }
  if (opts.automaticTaxStatus !== undefined && opts.automaticTaxStatus !== null) {
    obj.automatic_tax = { status: opts.automaticTaxStatus, enabled: true };
  }
  if (
    opts.customerState !== undefined ||
    opts.customerPostal !== undefined
  ) {
    obj.customer_details = {
      address: {
        state: opts.customerState ?? null,
        postal_code: opts.customerPostal ?? null,
      },
    };
  }
  if (opts.amountSubtotal !== undefined) obj.amount_subtotal = opts.amountSubtotal;
  if (opts.amountTax !== undefined) obj.total_details = { amount_tax: opts.amountTax };
  if (opts.amountTotal !== undefined) obj.amount_total = opts.amountTotal;

  return {
    id: `evt_clinic_tax_${opts.sessionId ?? '001'}`,
    object: 'event',
    type: 'checkout.session.completed',
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object: obj as unknown as Stripe.Checkout.Session },
    api_version: '2026-04-22.dahlia',
  } as unknown as Stripe.Event;
}

/** Build a web (consumer) Checkout session event with optional automatic_tax. */
function buildWebTaxEvent(opts: {
  automaticTaxStatus?: 'complete' | 'requires_location_inputs' | 'failed' | null;
  customerState?: string;
  amountSubtotal?: number;
  amountTax?: number;
  amountTotal?: number;
  sessionId?: string;
} = {}): Stripe.Event {
  const obj: Record<string, unknown> = {
    id: opts.sessionId ?? 'cs_web_tax_001',
    object: 'checkout.session',
    subscription: 'sub_web_tax_001',
    customer: 'cus_web_tax',
    metadata: {},
    subscription_data: {
      metadata: { tier_kind: 'web', user_id: 'user-web-tax', provider: 'stripe' },
    },
    line_items: { data: [{ price: { id: 'price_web_monthly' } }] },
  };
  if (opts.automaticTaxStatus !== undefined && opts.automaticTaxStatus !== null) {
    obj.automatic_tax = { status: opts.automaticTaxStatus, enabled: true };
  }
  if (opts.customerState !== undefined) {
    obj.customer_details = { address: { state: opts.customerState, postal_code: null } };
  }
  if (opts.amountSubtotal !== undefined) obj.amount_subtotal = opts.amountSubtotal;
  if (opts.amountTax !== undefined) obj.total_details = { amount_tax: opts.amountTax };
  if (opts.amountTotal !== undefined) obj.amount_total = opts.amountTotal;

  return {
    id: `evt_web_tax_${opts.sessionId ?? '001'}`,
    object: 'event',
    type: 'checkout.session.completed',
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object: obj as unknown as Stripe.Checkout.Session },
    api_version: '2026-04-22.dahlia',
  } as unknown as Stripe.Event;
}

// ─── 65-T10: clinic session with customer_tax_ids → org_subscriptions.tax_id ────

Deno.test('65-T10: clinic session with customer_tax_ids writes org_subscriptions.tax_id', async () => {
  const event = buildClinicTaxEvent({
    clinicId: 'clinic-uuid-T10',
    customerTaxIds: [{ type: 'us_ein', value: '12-3456789' }],
  });
  const [admin, getCalls] = buildExtendedMockAdmin();
  await handle(event, admin);

  const taxIdUpdate = getCalls().find(
    (c) => c.table === 'org_subscriptions' && c.op === 'update' && c.data.tax_id === '12-3456789',
  );
  assertEquals(taxIdUpdate !== undefined, true, 'org_subscriptions.tax_id update expected');
  assertEquals(taxIdUpdate!.filter?.col, 'org_id');
  assertEquals(taxIdUpdate!.filter?.val, 'clinic-uuid-T10');
});

// ─── 65-T11: consumer session without tax_ids → no org_subscriptions update ────

Deno.test('65-T11: consumer (web) session with no customer_tax_ids does NOT touch org_subscriptions', async () => {
  const event = buildWebTaxEvent({});
  const [admin, getCalls] = buildExtendedMockAdmin();
  await handle(event, admin);

  const orgSubTouched = getCalls().find((c) => c.table === 'org_subscriptions');
  assertEquals(orgSubTouched, undefined, 'No org_subscriptions write expected for consumer session');
});

// ─── 65-T12: clinic session with empty customer_tax_ids → no org_subscriptions update ─

Deno.test('65-T12: clinic session with customer_tax_ids=[] does NOT touch org_subscriptions', async () => {
  const event = buildClinicTaxEvent({
    clinicId: 'clinic-uuid-T12',
    customerTaxIds: [], // empty array — operator skipped Stripe UI
  });
  const [admin, getCalls] = buildExtendedMockAdmin();
  await handle(event, admin);

  const orgSubTouched = getCalls().find(
    (c) => c.table === 'org_subscriptions' && c.op === 'update',
  );
  assertEquals(
    orgSubTouched,
    undefined,
    'No org_subscriptions.tax_id update when customer_tax_ids is empty',
  );
});

// ─── 65-T13: automatic_tax.status='complete' writes tax_collection_log ──────

Deno.test('65-T13: automatic_tax.status=complete writes tax_collection_log row', async () => {
  const event = buildClinicTaxEvent({
    clinicId: 'clinic-uuid-T13',
    automaticTaxStatus: 'complete',
    customerState: 'CA',
    customerPostal: '94105',
    amountSubtotal: 10000,
    amountTax: 825,
    amountTotal: 10825,
    sessionId: 'cs_t13',
    subId: 'sub_t13',
  });
  const [admin, getCalls] = buildExtendedMockAdmin();
  await handle(event, admin);

  const logInsert = getCalls().find((c) => c.table === 'tax_collection_log' && c.op === 'insert');
  assertEquals(logInsert !== undefined, true, 'tax_collection_log insert expected');
  assertEquals(logInsert!.data.customer_state, 'CA');
  assertEquals(logInsert!.data.customer_postal, '94105');
  assertEquals(logInsert!.data.tax_amount_cents, 825);
  assertEquals(logInsert!.data.subtotal_cents, 10000);
  assertEquals(logInsert!.data.total_cents, 10825);
  assertEquals(logInsert!.data.automatic_tax_status, 'complete');
  assertEquals(logInsert!.data.stripe_session_id, 'cs_t13');
});

// ─── 65-T14: automatic_tax.status='requires_location_inputs' STILL writes log ─

Deno.test('65-T14: automatic_tax.status=requires_location_inputs writes log (visibility)', async () => {
  const event = buildClinicTaxEvent({
    clinicId: 'clinic-uuid-T14',
    automaticTaxStatus: 'requires_location_inputs',
    amountSubtotal: 5000,
    amountTax: 0,
    amountTotal: 5000,
  });
  const [admin, getCalls] = buildExtendedMockAdmin();
  await handle(event, admin);

  const logInsert = getCalls().find((c) => c.table === 'tax_collection_log' && c.op === 'insert');
  assertEquals(logInsert !== undefined, true, 'tax_collection_log insert expected for visibility');
  assertEquals(logInsert!.data.automatic_tax_status, 'requires_location_inputs');
});

// ─── 65-T15: no automatic_tax field → no tax_collection_log row ─────────────

Deno.test('65-T15: session without automatic_tax does NOT write tax_collection_log', async () => {
  // Use the default web/consumer event which has no automatic_tax set.
  const event = buildWebTaxEvent({}); // no automaticTaxStatus
  const [admin, getCalls] = buildExtendedMockAdmin();
  await handle(event, admin);

  const logInsert = getCalls().find((c) => c.table === 'tax_collection_log');
  assertEquals(logInsert, undefined, 'No tax_collection_log row expected without automatic_tax');
});

// ─── 65-T16: tax_id never logged (PII safety, T-65-04-02) ────────────────────

Deno.test('65-T16: tax_id value is NEVER logged to console (T-65-04-02 PII guard)', async () => {
  const sensitiveTaxId = '99-9999999-SECRET';
  const event = buildClinicTaxEvent({
    clinicId: 'clinic-uuid-T16',
    customerTaxIds: [{ type: 'us_ein', value: sensitiveTaxId }],
  });
  const [admin] = buildExtendedMockAdmin();

  // Hook console.log + console.error to capture all output during handle().
  const captured: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  const origWarn = console.warn;
  console.log = (...args: unknown[]) => {
    captured.push(args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    captured.push(args.map(String).join(' '));
  };
  console.warn = (...args: unknown[]) => {
    captured.push(args.map(String).join(' '));
  };

  try {
    await handle(event, admin);
  } finally {
    console.log = origLog;
    console.error = origErr;
    console.warn = origWarn;
  }

  const leak = captured.find((line) => line.includes(sensitiveTaxId));
  assertEquals(
    leak,
    undefined,
    `tax_id value MUST NOT appear in console output (T-65-04-02). Found: ${leak}`,
  );
});

// ─── 65-T17: writeTaxCollectionLog helper exports + is unit-testable ────────

Deno.test('65-T17: writeTaxCollectionLog helper exists and writes a row', async () => {
  const { writeTaxCollectionLog } = await import('./tax-collection-log.ts');
  const [admin, getCalls] = buildExtendedMockAdmin();

  const session = {
    id: 'cs_helper_test',
    subscription: 'sub_helper_test',
    metadata: {},
    subscription_data: { metadata: { tier_kind: 'web', user_id: 'user-helper', provider: 'stripe' } },
    automatic_tax: { status: 'complete', enabled: true },
    customer_details: { address: { state: 'TX', postal_code: '78701' } },
    amount_subtotal: 4900,
    amount_total: 5304,
    total_details: { amount_tax: 404 },
  } as unknown as Stripe.Checkout.Session;

  await writeTaxCollectionLog(admin, session);

  const insertCall = getCalls().find((c) => c.table === 'tax_collection_log');
  assertEquals(insertCall !== undefined, true);
  assertEquals(insertCall!.data.customer_state, 'TX');
  assertEquals(insertCall!.data.tax_amount_cents, 404);
});
