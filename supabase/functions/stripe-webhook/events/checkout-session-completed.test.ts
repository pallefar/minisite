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
