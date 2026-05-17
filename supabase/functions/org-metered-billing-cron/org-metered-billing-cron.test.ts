/**
 * Deno tests for org-metered-billing-cron Edge Function.
 *
 * Per plan 29-04:
 *   Test 1: value passed to Stripe is a STRING (Pitfall 3 — not a number).
 *   Test 2: identifier format = org_${uuid}_YYYYMM (D-03 idempotency key).
 *   Test 3: PHI lint — payload contains ONLY value + stripe_customer_id (D-11).
 *   Test 4: Per-org error isolation — one failure does not stop the loop.
 *   Test 5: Zero count still fires meter event (back-out prorate).
 *
 * Filename: org-metered-billing-cron.test.ts
 * Matches Deno test discovery glob: {*_,*.,}test.* — see [[reference_deno_test_discovery]].
 */

import { assertEquals, assertMatch } from 'jsr:@std/assert';
import { buildMeterEventPayload, runForOrgs } from './index.ts';

Deno.test('value is a string (Pitfall 3)', () => {
  const p = buildMeterEventPayload('abc-1234', 42, 'cus_xyz');
  assertEquals(typeof p.payload.value, 'string');
  assertEquals(p.payload.value, '42');
});

Deno.test('identifier format = org_${uuid}_YYYYMM', () => {
  const p = buildMeterEventPayload(
    '11111111-2222-3333-4444-555555555555',
    10,
    'cus_x',
    new Date(Date.UTC(2026, 4, 17)),
  );
  assertEquals(p.identifier, 'org_11111111-2222-3333-4444-555555555555_202605');
  assertMatch(p.identifier, /^org_[0-9a-f-]{36}_[0-9]{6}$/);
});

Deno.test('payload contains ONLY value + stripe_customer_id (D-11 PHI lint)', () => {
  const p = buildMeterEventPayload('abc', 1, 'cus_a');
  assertEquals(Object.keys(p.payload).sort(), ['stripe_customer_id', 'value']);
});

Deno.test('per-org error isolation: one failure does not stop the loop', async () => {
  const calls: string[] = [];
  // deno-lint-ignore no-explicit-any
  const stripe = {
    billing: {
      meterEvents: {
        create: async (p: any) => {
          calls.push(p.identifier);
          if (p.identifier.includes('aaaa')) throw new Error('stripe boom');
          return { id: 'me_x' };
        },
      },
    },
  } as any;
  // deno-lint-ignore no-explicit-any
  const admin = { rpc: async (_fn: string, _args: any) => ({ data: 3, error: null }) } as any;
  const results = await runForOrgs({
    stripe,
    admin,
    orgs: [
      { clinic_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', stripe_customer_id: 'cus_a' },
      { clinic_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', stripe_customer_id: 'cus_b' },
    ],
  });
  assertEquals(results.length, 2);
  assertEquals(results[0].ok, false);
  assertEquals(results[1].ok, true);
  assertEquals(calls.length, 2); // BOTH attempted
});

Deno.test('zero count still fires meter event (back-out prorate)', async () => {
  const created: any[] = [];
  // deno-lint-ignore no-explicit-any
  const stripe = {
    billing: {
      meterEvents: { create: async (p: any) => { created.push(p); return { id: 'me_0' }; } },
    },
  } as any;
  // deno-lint-ignore no-explicit-any
  const admin = { rpc: async () => ({ data: 0, error: null }) } as any;
  await runForOrgs({
    stripe,
    admin,
    orgs: [{ clinic_id: 'org-x', stripe_customer_id: 'cus_x' }],
  });
  assertEquals(created.length, 1);
  assertEquals(created[0].payload.value, '0');
});
