/**
 * account-updated.test.ts — Phase 19 Plan 19-04 (AFF-03).
 *
 * Tests for the Stripe Connect `account.updated` handler — mirrors
 * `acct.payouts_enabled` into `affiliates.stripe_payouts_enabled` (Pitfall 7).
 *
 * Behaviors:
 *  Test 1: account.id not in affiliates → no-op, no UPDATE call.
 *  Test 2: account with payouts_enabled=true → UPDATE writes true.
 *  Test 3: account with payouts_enabled=false → UPDATE writes false (KYC re-verify).
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { handle } from './account-updated.ts';

// ─── Mock admin builder ───────────────────────────────────────────────────────
interface UpdateCall {
  table: string;
  data: Record<string, unknown>;
  eqCol: string;
  eqVal: unknown;
}

function buildMockAdmin(opts: { existingAffiliateId?: string | null }): [
  SupabaseClient,
  () => UpdateCall[],
] {
  const updates: UpdateCall[] = [];
  const mockAdmin = {
    from: (table: string) => {
      if (table !== 'affiliates') {
        throw new Error(`Unexpected table: ${table}`);
      }
      return {
        select: (_: string) => ({
          eq: (_c: string, _v: unknown) => ({
            maybeSingle: () =>
              Promise.resolve({
                data: opts.existingAffiliateId
                  ? { id: opts.existingAffiliateId }
                  : null,
                error: null,
              }),
          }),
        }),
        update: (data: Record<string, unknown>) => ({
          eq: (col: string, val: unknown) => {
            updates.push({ table, data, eqCol: col, eqVal: val });
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
  } as unknown as SupabaseClient;
  return [mockAdmin, () => updates];
}

/** Build an account.updated event. */
function buildAccountUpdatedEvent(opts: {
  acctId: string;
  payoutsEnabled: boolean;
}): Stripe.Event {
  return {
    id: 'evt_account_updated_test',
    object: 'event',
    type: 'account.updated',
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: opts.acctId,
        object: 'account',
        payouts_enabled: opts.payoutsEnabled,
      } as unknown as Stripe.Account,
    },
    api_version: '2026-04-22.dahlia',
  } as unknown as Stripe.Event;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test('19-04 / account-updated Test 1: account not in affiliates → no UPDATE call', async () => {
  const event = buildAccountUpdatedEvent({ acctId: 'acct_unknown', payoutsEnabled: true });
  const [admin, getCalls] = buildMockAdmin({ existingAffiliateId: null });
  await handle(event, admin);
  const calls = getCalls();
  assertEquals(calls.length, 0, 'Non-affiliate account.updated must NOT write to affiliates');
});

Deno.test('19-04 / account-updated Test 2: payouts_enabled=true → UPDATE affiliates.stripe_payouts_enabled=true', async () => {
  const event = buildAccountUpdatedEvent({ acctId: 'acct_aff_1', payoutsEnabled: true });
  const [admin, getCalls] = buildMockAdmin({ existingAffiliateId: 'aff-row-1' });
  await handle(event, admin);
  const calls = getCalls();
  assertEquals(calls.length, 1);
  assertEquals(calls[0].table, 'affiliates');
  assertEquals(calls[0].data.stripe_payouts_enabled, true);
  assertEquals(calls[0].eqCol, 'stripe_connect_account_id');
  assertEquals(calls[0].eqVal, 'acct_aff_1');
  assertEquals(typeof calls[0].data.updated_at === 'string', true);
});

Deno.test('19-04 / account-updated Test 3: payouts_enabled=false → UPDATE writes false (KYC re-verify)', async () => {
  const event = buildAccountUpdatedEvent({ acctId: 'acct_aff_1', payoutsEnabled: false });
  const [admin, getCalls] = buildMockAdmin({ existingAffiliateId: 'aff-row-1' });
  await handle(event, admin);
  const calls = getCalls();
  assertEquals(calls.length, 1);
  assertEquals(calls[0].data.stripe_payouts_enabled, false);
});
