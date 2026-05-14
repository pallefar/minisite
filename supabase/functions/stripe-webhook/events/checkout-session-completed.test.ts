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
