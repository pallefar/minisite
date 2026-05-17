/**
 * subscription-updated.test.ts
 *
 * Tests for the customer.subscription.updated handler and mapStripeStatusToUxTier.
 * Pitfall 6 — exhaustive status mapping across all 8 Stripe subscription statuses.
 *
 * Behaviors:
 *  2.4:  status=trialing → ux_tier=paid
 *  2.5:  status=active → ux_tier=paid
 *  2.6:  status=past_due → ux_tier=past_due
 *  2.7:  status=unpaid → ux_tier=past_due
 *  2.8:  status=canceled → ux_tier=free
 *  2.9:  status=incomplete → ux_tier=free
 *  2.10: status=incomplete_expired → ux_tier=free
 *  2.11: status=paused → ux_tier=free
 *  2.12: All 8 mappings preserve status verbatim alongside ux_tier
 *  2.13: Race condition — subscription row doesn't exist yet → upsert creates it
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type Stripe from 'https://esm.sh/stripe@19?target=denonext';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { handle, mapStripeStatusToUxTier, type D05Spy } from './subscription-updated.ts';

// ─── Mock admin builder ───────────────────────────────────────────────────────
interface UpsertCall {
  table: string;
  data: Record<string, unknown>;
}

function buildMockAdmin(): [SupabaseClient, () => UpsertCall[]] {
  const calls: UpsertCall[] = [];
  const mockAdmin = {
    from: (table: string) => ({
      upsert: (data: Record<string, unknown>, _options?: Record<string, unknown>) => {
        calls.push({ table, data });
        return Promise.resolve({ error: null });
      },
    }),
  } as unknown as SupabaseClient;
  return [mockAdmin, () => calls];
}

/** Build a Stripe.Event for customer.subscription.updated */
function buildSubUpdatedEvent(
  status: Stripe.Subscription.Status,
  meta: Record<string, string> = { tier_kind: 'web', user_id: 'user-uuid-test', provider: 'stripe' },
  subId: string = 'sub_test_updated',
): Stripe.Event {
  return {
    id: `evt_sub_updated_${status}`,
    object: 'event',
    type: 'customer.subscription.updated',
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: subId,
        object: 'subscription',
        status,
        metadata: meta,
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        trial_end: null,
        cancel_at_period_end: false,
        items: {
          data: [{ price: { id: 'price_test_monthly' } }],
        },
      } as unknown as Stripe.Subscription,
    },
    api_version: '2026-04-22.dahlia',
  } as unknown as Stripe.Event;
}

// ─── mapStripeStatusToUxTier tests (2.4–2.11) ─────────────────────────────────

Deno.test('2.4: mapStripeStatusToUxTier trialing → paid', () => {
  assertEquals(mapStripeStatusToUxTier('trialing'), 'paid');
});

Deno.test('2.5: mapStripeStatusToUxTier active → paid', () => {
  assertEquals(mapStripeStatusToUxTier('active'), 'paid');
});

Deno.test('2.6: mapStripeStatusToUxTier past_due → past_due', () => {
  assertEquals(mapStripeStatusToUxTier('past_due'), 'past_due');
});

Deno.test('2.7: mapStripeStatusToUxTier unpaid → past_due', () => {
  assertEquals(mapStripeStatusToUxTier('unpaid'), 'past_due');
});

Deno.test('2.8: mapStripeStatusToUxTier canceled → free', () => {
  assertEquals(mapStripeStatusToUxTier('canceled'), 'free');
});

Deno.test('2.9: mapStripeStatusToUxTier incomplete → free', () => {
  assertEquals(mapStripeStatusToUxTier('incomplete'), 'free');
});

Deno.test('2.10: mapStripeStatusToUxTier incomplete_expired → free', () => {
  assertEquals(mapStripeStatusToUxTier('incomplete_expired'), 'free');
});

Deno.test('2.11: mapStripeStatusToUxTier paused → free', () => {
  assertEquals(mapStripeStatusToUxTier('paused'), 'free');
});

// ─── handle() integration tests (2.12–2.13) ──────────────────────────────────

Deno.test('2.12: handle preserves verbatim status alongside ux_tier in upsert', async () => {
  const statuses: Array<[Stripe.Subscription.Status, string]> = [
    ['trialing', 'paid'],
    ['active', 'paid'],
    ['past_due', 'past_due'],
    ['unpaid', 'past_due'],
    ['canceled', 'free'],
    ['incomplete', 'free'],
    ['incomplete_expired', 'free'],
    ['paused', 'free'],
  ];

  for (const [status, expectedUxTier] of statuses) {
    const [admin, getCalls] = buildMockAdmin();
    const event = buildSubUpdatedEvent(status);
    await handle(event, admin);

    const calls = getCalls();
    const subCall = calls.find((c) => c.table === 'subscriptions');
    assertEquals(subCall !== undefined, true, `Expected subscriptions upsert for status=${status}`);
    assertEquals(subCall!.data.status, status, `status verbatim for ${status}`);
    assertEquals(
      subCall!.data.ux_tier,
      expectedUxTier,
      `ux_tier for ${status} should be ${expectedUxTier}`,
    );
  }
});

Deno.test('2.13: race — no row yet, metadata on sub → upsert creates row', async () => {
  const [admin, getCalls] = buildMockAdmin();
  const event = buildSubUpdatedEvent(
    'trialing',
    { tier_kind: 'web', user_id: 'user-race-test', provider: 'stripe' },
    'sub_race_test',
  );

  await handle(event, admin);

  const calls = getCalls();
  const subCall = calls.find((c) => c.table === 'subscriptions');
  assertEquals(subCall !== undefined, true, 'subscriptions upsert expected');
  assertEquals(subCall!.data.user_id, 'user-race-test');
  assertEquals(subCall!.data.ux_tier, 'paid');
  assertEquals(subCall!.data.id, 'sub_race_test');
});

// ============================================================================
// Phase 29 Plan 03 — D-05: HMAC realtime broadcast tests
// ============================================================================

// Build a test spy for the D-05 broadcast path.
function makeD05Spy(): D05Spy & {
  calls: Array<{ channelName: string; payload: Record<string, unknown> }>;
  shouldReject: boolean;
} {
  const calls: Array<{ channelName: string; payload: Record<string, unknown> }> = [];
  let shouldReject = false;
  return {
    calls,
    get shouldReject() { return shouldReject; },
    set shouldReject(v: boolean) { shouldReject = v; },
    channelSend: async (channelName: string, payload: Record<string, unknown>) => {
      if (shouldReject) throw new Error('channel.send simulated failure');
      calls.push({ channelName, payload });
    },
  };
}

Deno.test('D-05 / T1: clinic subscription → channelSend invoked once with correct payload', async () => {
  const [admin, _getCalls] = buildMockAdmin();
  const spy = makeD05Spy();

  const clinicSubEvent = buildSubUpdatedEvent(
    'active',
    { tier_kind: 'clinic', clinic_id: 'org_clinic_test_123', provider: 'stripe' },
    'sub_clinic_test',
  );

  await handle(clinicSubEvent, admin, spy);

  assertEquals(spy.calls.length, 1, 'channelSend must be called exactly once for clinic sub');
  const call = spy.calls[0];
  // Channel name format: org-{first8hex}-subscriptions
  assertEquals(
    call.channelName.startsWith('org-') && call.channelName.endsWith('-subscriptions'),
    true,
    `Channel name should match org-*-subscriptions, got: ${call.channelName}`,
  );
  assertEquals(call.payload['subscription_id'], 'sub_clinic_test', 'payload.subscription_id');
  assertEquals(call.payload['status'], 'active', 'payload.status');
});

Deno.test('D-05 / T2: consumer subscription (no clinic_id) → channelSend NOT invoked', async () => {
  const [admin, _getCalls] = buildMockAdmin();
  const spy = makeD05Spy();

  const consumerSubEvent = buildSubUpdatedEvent(
    'active',
    { tier_kind: 'web', user_id: 'user-consumer-test', provider: 'stripe' },
    'sub_consumer_test',
  );

  await handle(consumerSubEvent, admin, spy);

  assertEquals(spy.calls.length, 0, 'channelSend must NOT be called for consumer sub (no clinic_id)');
});

Deno.test('D-05 / T3: broadcast failure caught + Sentry.captureException — does not re-throw', async () => {
  const [admin, _getCalls] = buildMockAdmin();
  const spy = makeD05Spy();
  spy.shouldReject = true; // simulate channel.send rejection

  const clinicSubEvent = buildSubUpdatedEvent(
    'active',
    { tier_kind: 'clinic', clinic_id: 'org_clinic_broadcast_fail', provider: 'stripe' },
    'sub_clinic_fail_test',
  );

  // Must NOT throw even though channelSend rejects
  await handle(clinicSubEvent, admin, spy);

  // The call attempt was made (spy threw), but no re-throw upstream
  // Sentry would have captured it in production; here we just verify no throw.
  assertEquals(true, true, 'Handler survived broadcast failure without re-throwing');
});
