/**
 * customer-subscription-deleted.test.ts
 *
 * Tests for the customer.subscription.deleted handler (cancellation finalization).
 *
 * Behaviors:
 *  2.18: customer.subscription.deleted → sets ux_tier='free' and status='canceled'
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { handle } from './customer-subscription-deleted.ts';

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

/** Build a customer.subscription.deleted event */
function buildSubDeletedEvent(subId: string = 'sub_deleted_test'): Stripe.Event {
  return {
    id: 'evt_sub_deleted_test',
    object: 'event',
    type: 'customer.subscription.deleted',
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: subId,
        object: 'subscription',
        status: 'canceled',
        current_period_end: Math.floor(Date.now() / 1000) - 86400, // past
        metadata: { tier_kind: 'web', user_id: 'user-deleted-test' },
      } as unknown as Stripe.Subscription,
    },
    api_version: '2026-04-22.dahlia',
  } as unknown as Stripe.Event;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test('2.18: customer.subscription.deleted → ux_tier=free, status=canceled', async () => {
  const event = buildSubDeletedEvent('sub_deleted_test');
  const [admin, getCalls] = buildMockAdmin();

  await handle(event, admin);

  const calls = getCalls();
  assertEquals(calls.length, 1, 'Expected 1 update call');
  assertEquals(calls[0].table, 'subscriptions');
  assertEquals(calls[0].data.ux_tier, 'free');
  assertEquals(calls[0].data.status, 'canceled');
  assertEquals(calls[0].eqCol, 'id');
  assertEquals(calls[0].eqVal, 'sub_deleted_test');
});
