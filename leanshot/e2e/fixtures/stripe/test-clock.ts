/**
 * Phase 14 Plan 14-08 — Stripe test-clock fixture.
 *
 * Provides `createTestClock` and `advanceTestClock` wrappers around the Stripe
 * Node SDK's testHelpers.testClocks API.
 *
 * IMPORTANT INVARIANT: A subscription can only be advanced via test clock if the
 * customer was attached to a test clock at creation time. Always create the test
 * customer AFTER calling `createTestClock` and pass `test_clock: clock.id` to the
 * customer creation call (handled by `seedSubscription` in seed-subscription.ts).
 *
 * Lifecycle:
 *   1. Call `createTestClock(name)` → get clock.
 *   2. Create customer + subscription with the clock ID attached.
 *   3. Call `advanceTestClock(clockId, seconds)` to fast-forward time.
 *   4. Call `deleteTestClock(clockId)` in afterAll for cleanliness.
 *      (Stripe auto-deletes test clocks after 7 days, but explicit cleanup
 *       prevents orphaned test data building up in the Stripe dashboard.)
 */

import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? '';

/**
 * Create a Stripe SDK instance for use in fixtures.
 * Instantiated per-call so tests that change STRIPE_SECRET_KEY mid-suite get
 * a fresh instance (matches the stripe-webhook Edge Function pattern).
 */
function getStripe(): Stripe {
  return new Stripe(STRIPE_SECRET_KEY || 'sk_test_placeholder', {
    apiVersion: '2026-04-22.dahlia' as Parameters<typeof Stripe>[1]['apiVersion'],
  });
}

/**
 * Create a new Stripe test clock frozen at the current UTC time.
 *
 * @param name  Human-readable label for the test clock (appears in Stripe Dashboard)
 * @returns     Stripe.TestHelpers.TestClock object
 */
export async function createTestClock(name: string): Promise<Stripe.TestHelpers.TestClock> {
  const stripe = getStripe();
  return stripe.testHelpers.testClocks.create({
    frozen_time: Math.floor(Date.now() / 1000),
    name,
  });
}

/**
 * Advance a test clock by `advanceSeconds` seconds from its current frozen_time,
 * then poll until the clock returns to `status === 'ready'` (max 60s, 1s interval).
 *
 * @param clockId         Stripe test clock ID (clk_xxx)
 * @param advanceSeconds  Number of seconds to advance the clock
 * @throws                If the clock enters `internal_failure` status or times out
 */
export async function advanceTestClock(
  clockId: string,
  advanceSeconds: number,
): Promise<Stripe.TestHelpers.TestClock> {
  const stripe = getStripe();

  // Retrieve current frozen_time before advancing.
  const current = await stripe.testHelpers.testClocks.retrieve(clockId);
  const newFrozenTime = current.frozen_time + advanceSeconds;

  await stripe.testHelpers.testClocks.advance(clockId, {
    frozen_time: newFrozenTime,
  });

  // Poll until 'ready' or 'internal_failure' or timeout (60s).
  const startMs = Date.now();
  const maxMs = 60_000;
  const intervalMs = 1_000;

  while (Date.now() - startMs < maxMs) {
    const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (clock.status === 'ready') {
      return clock;
    }
    if (clock.status === 'internal_failure') {
      throw new Error(
        `Stripe test clock ${clockId} entered internal_failure after advance`,
      );
    }
    // Still 'advancing' — wait and retry.
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Stripe test clock ${clockId} did not become 'ready' within ${maxMs / 1000}s`,
  );
}

/**
 * Delete a test clock (best-effort cleanup in afterAll hooks).
 * Swallows all errors so a failed delete does not mask a test failure.
 */
export async function deleteTestClock(clockId: string): Promise<void> {
  try {
    const stripe = getStripe();
    await stripe.testHelpers.testClocks.del(clockId);
  } catch {
    // Best-effort cleanup — do not throw.
  }
}
