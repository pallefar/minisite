/**
 * Deno tests for `cancellation-seed-coupons` Edge Function — Phase 40 Plan 40-01.
 *
 * Test plan:
 *   T1 missing bearer → 401
 *   T2 all 6 coupons created → created:6, skipped:0
 *   T3 3 succeed + 3 resource_already_exists → created:3, skipped:3 (no exception)
 *   T4 non-resource_already_exists Stripe error → 500 (error bubbles)
 *
 * Pattern: supabase/functions/challenge-evaluate-cron/index.test.ts
 */
import { assertEquals, assertRejects } from 'jsr:@std/assert@^1';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_dummy');

const { __internal } = await import('./index.ts');

const VALID_HEADERS = {
  Authorization: 'Bearer test-service-role-key',
  'Content-Type': 'application/json',
};

function makeReq(headers = VALID_HEADERS): Request {
  return new Request('http://localhost/cancellation-seed-coupons', {
    method: 'POST',
    headers,
    body: '{}',
  });
}

/** Build a mock Stripe client with configurable coupon.create behavior. */
function makeMockStripe(
  createImpl: (params: { id: string }) => Promise<unknown>,
): unknown {
  return {
    coupons: {
      create: createImpl,
    },
  };
}

Deno.test('T1 — missing bearer → 401', async () => {
  const req = makeReq({ 'Content-Type': 'application/json' });
  const res = await __internal.handler(req);
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'unauthorized');
});

Deno.test('T2 — all 6 coupons succeed → created:6 skipped:0', async () => {
  const createdIds: string[] = [];
  const mockStripe = makeMockStripe(async (params) => {
    createdIds.push(params.id);
    return { id: params.id };
  });

  __internal.setStripeForTest(mockStripe as never);
  try {
    const res = await __internal.handler(makeReq());
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.created, 6);
    assertEquals(body.skipped, 0);
    assertEquals(createdIds.length, 6);
    // Verify all 6 catalog IDs were passed to Stripe
    assertEquals(createdIds.includes('SAVE-20-2MO'), true);
    assertEquals(createdIds.includes('SAVE-20-3MO'), true);
    assertEquals(createdIds.includes('SAVE-25-2MO'), true);
    assertEquals(createdIds.includes('SAVE-25-3MO'), true);
    assertEquals(createdIds.includes('SAVE-30-2MO'), true);
    assertEquals(createdIds.includes('SAVE-30-3MO'), true);
  } finally {
    __internal.setStripeForTest(null);
  }
});

Deno.test('T3 — 3 succeed + 3 resource_already_exists → created:3 skipped:3 no exception', async () => {
  // First 3 IDs succeed, next 3 throw resource_already_exists
  const succeedIds = new Set(['SAVE-20-2MO', 'SAVE-25-2MO', 'SAVE-30-2MO']);

  const mockStripe = makeMockStripe(async (params) => {
    if (succeedIds.has(params.id)) {
      return { id: params.id };
    }
    // Simulate Stripe resource_already_exists error
    const err = new Error(`Coupon already exists: ${params.id}`);
    (err as unknown as Record<string, string>).code = 'resource_already_exists';
    throw err;
  });

  __internal.setStripeForTest(mockStripe as never);
  try {
    const res = await __internal.handler(makeReq());
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.created, 3);
    assertEquals(body.skipped, 3);
    // Verify correct IDs in each bucket
    assertEquals(body.created_ids.sort(), ['SAVE-20-2MO', 'SAVE-25-2MO', 'SAVE-30-2MO']);
    assertEquals(body.skipped_ids.sort(), ['SAVE-20-3MO', 'SAVE-25-3MO', 'SAVE-30-3MO']);
  } finally {
    __internal.setStripeForTest(null);
  }
});

Deno.test('T4 — non-resource_already_exists Stripe error → exception bubbles → handler throws', async () => {
  const mockStripe = makeMockStripe(async (_params) => {
    const err = new Error('Your card was declined');
    (err as unknown as Record<string, string>).code = 'card_declined';
    throw err;
  });

  __internal.setStripeForTest(mockStripe as never);
  try {
    await assertRejects(
      async () => {
        await __internal.handler(makeReq());
      },
      Error,
      'Your card was declined',
    );
  } finally {
    __internal.setStripeForTest(null);
  }
});
