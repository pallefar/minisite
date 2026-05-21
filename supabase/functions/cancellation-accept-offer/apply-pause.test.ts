/**
 * apply-pause.test.ts — Unit tests for applyPause.
 * Phase 40 Plan 40-03 Task 2.
 */

import { assertEquals, assertRejects, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { applyPause } from './apply-pause.ts';
import type Stripe from 'https://esm.sh/stripe@19?target=denonext';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeStripe(
  opts: { rejectWithCode?: string } = {},
): Stripe {
  let capturedCall: { subscriptionId: string; params: unknown } | null = null;

  return {
    subscriptions: {
      update: async (subscriptionId: string, params: unknown) => {
        if (opts.rejectWithCode) {
          const err = new Error('Stripe rejected pause') as Error & { code: string; type: string };
          err.code = opts.rejectWithCode;
          err.type = 'invalid_request_error';
          throw err;
        }
        capturedCall = { subscriptionId, params };
        return { id: subscriptionId };
      },
      getCapturedCall: () => capturedCall,
    },
  } as unknown as Stripe;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

Deno.test('applyPause: 1-month pause returns correct resumesAt unix timestamp', async () => {
  const stripe = makeStripe();
  const before = Math.floor(Date.now() / 1000);
  const { resumesAt } = await applyPause('sub_test_1', 1, stripe);
  const after = Math.floor(Date.now() / 1000);

  const expectedMin = before + 1 * 30 * 24 * 60 * 60;
  const expectedMax = after + 1 * 30 * 24 * 60 * 60;
  assert(resumesAt >= expectedMin, `resumesAt ${resumesAt} < expectedMin ${expectedMin}`);
  assert(resumesAt <= expectedMax, `resumesAt ${resumesAt} > expectedMax ${expectedMax}`);
});

Deno.test('applyPause: 2-month pause returns correct resumesAt unix timestamp', async () => {
  const stripe = makeStripe();
  const before = Math.floor(Date.now() / 1000);
  const { resumesAt } = await applyPause('sub_test_2', 2, stripe);
  const after = Math.floor(Date.now() / 1000);

  const expectedMin = before + 2 * 30 * 24 * 60 * 60;
  const expectedMax = after + 2 * 30 * 24 * 60 * 60;
  assert(resumesAt >= expectedMin);
  assert(resumesAt <= expectedMax);
});

Deno.test('applyPause: 3-month pause returns correct resumesAt unix timestamp', async () => {
  const stripe = makeStripe();
  const before = Math.floor(Date.now() / 1000);
  const { resumesAt } = await applyPause('sub_test_3', 3, stripe);
  const after = Math.floor(Date.now() / 1000);

  const expectedMin = before + 3 * 30 * 24 * 60 * 60;
  const expectedMax = after + 3 * 30 * 24 * 60 * 60;
  assert(resumesAt >= expectedMin);
  assert(resumesAt <= expectedMax);
});

Deno.test('applyPause: calls stripe.subscriptions.update with pause_collection behavior=void', async () => {
  let capturedParams: unknown = null;
  const stripe = {
    subscriptions: {
      update: async (_subId: string, params: unknown) => {
        capturedParams = params;
        return { id: _subId };
      },
    },
  } as unknown as Stripe;

  await applyPause('sub_check', 2, stripe);

  const p = capturedParams as { pause_collection: { behavior: string; resumes_at: number } };
  assertEquals(p.pause_collection.behavior, 'void');
  assert(p.pause_collection.resumes_at > 0, 'resumes_at must be a positive unix timestamp');
});

Deno.test('applyPause: wraps Stripe error with PAUSE_FAILED prefix (A5 trial rejection)', async () => {
  const stripe = makeStripe({ rejectWithCode: 'invalid_request_error' });

  await assertRejects(
    () => applyPause('sub_trial', 1, stripe),
    Error,
    'PAUSE_FAILED:invalid_request_error',
  );
});

Deno.test('applyPause: wraps unknown Stripe error with PAUSE_FAILED prefix', async () => {
  const stripe = {
    subscriptions: {
      update: async () => {
        throw new Error('network_timeout');
      },
    },
  } as unknown as Stripe;

  await assertRejects(
    () => applyPause('sub_unknown', 1, stripe),
    Error,
    'PAUSE_FAILED:',
  );
});
