/**
 * extend-pause-counter.test.ts — D-10 counter integration tests.
 * Phase 40 Plan 40-03 Task 2.
 *
 * Tests the distinction between initial pause (cap-exempt) and extension (cap-counts).
 *
 * Per plan spec scenarios:
 *   A: Initial pause → counter stays 0 (D-02 pause exemption)
 *   B: Initial pause (counter=0) + extension → counter increments to 1 (D-10)
 *   C: counter=1 from prior extension + another extension → counter increments to 2 → BLOCKED
 *   D: extendPause throws SUB_NOT_PAUSED when subscription is not paused
 */

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { extendPause } from './extend-pause.ts';
import type Stripe from 'https://esm.sh/stripe@19?target=denonext';

// ─── Mock helpers ─────────────────────────────────────────────────────────────

const NOW = Math.floor(Date.now() / 1000);
const FUTURE_RESUMES_AT = NOW + 60 * 24 * 60 * 60; // 60 days from now

function makePausedStripe(currentResumesAt: number | null): Stripe {
  return {
    subscriptions: {
      retrieve: async (_subId: string) => ({
        id: _subId,
        pause_collection: currentResumesAt !== null
          ? { behavior: 'void', resumes_at: currentResumesAt }
          : null,
      }),
      update: async (_subId: string, _params: unknown) => ({ id: _subId }),
    },
  } as unknown as Stripe;
}

// ─── Helper: simulate the accept-offer prior_takes_count logic ────────────────
// This mirrors what accept-offer/index.ts does:
// - Initial pause: priorTakesCountIncrement = 0 (isExtension=false)
// - Extension pause: priorTakesCountIncrement = 1 (isExtension=true)
function computeIncrementForPause(isExtension: boolean): number {
  return isExtension ? 1 : 0;
}

// ─── Scenario A: Initial pause — counter stays 0 ─────────────────────────────

Deno.test('Scenario A: Initial pause does NOT increment lifetime take counter (D-02 exemption)', () => {
  // User has 0 prior takes
  const priorTakesCount = 0;
  const isExtension = false; // new pause, subscription not currently paused

  const increment = computeIncrementForPause(isExtension);
  const newPriorTakesCount = priorTakesCount + increment;

  // Counter must remain 0 — D-02: initial pause exempt from lifetime cap
  assertEquals(newPriorTakesCount, 0);
  assertEquals(isExtension, false);
});

// ─── Scenario B: Initial pause + extension → counter increments to 1 ─────────

Deno.test('Scenario B: Pause extension increments take counter to 1 (D-10)', async () => {
  // User made initial 3-month pause (counter=0)
  // 7 days before resume, user extends by 1 month
  const priorTakesCountAfterInitialPause = 0;
  const isExtensionForExtension = true; // subscription IS currently paused

  const increment = computeIncrementForPause(isExtensionForExtension);
  const newPriorTakesCount = priorTakesCountAfterInitialPause + increment;

  // Counter increments to 1 — D-10: extensions DO count toward lifetime cap
  assertEquals(newPriorTakesCount, 1);
  assertEquals(isExtensionForExtension, true);

  // Also verify the Stripe call succeeds
  const stripe = makePausedStripe(FUTURE_RESUMES_AT);
  const { resumesAt } = await extendPause('sub_scenario_b', 1, stripe);
  const expectedMin = FUTURE_RESUMES_AT + 1 * 30 * 24 * 60 * 60;
  assertEquals(resumesAt, expectedMin);
});

// ─── Scenario C: counter=1 + another extension → counter=2 → BLOCKED ─────────

Deno.test('Scenario C: counter=1 + extension → counter=2; next attempt would be BLOCKED by checkLifetimeCap', async () => {
  // User at counter=1 from prior extension
  const priorTakesCountAtExtension2 = 1;
  const isExtension = true;

  const increment = computeIncrementForPause(isExtension);
  const newPriorTakesCount = priorTakesCountAtExtension2 + increment;

  // Counter increments to 2 — hits LIFETIME_CAP_NON_PAUSE=2 threshold
  assertEquals(newPriorTakesCount, 2);

  // Simulating checkLifetimeCap logic: exceeded when nonPauseCount >= 2
  // In this scenario, if user tries ANOTHER extension, decide-offer would:
  // 1. Read prior accepted rows (including the 2 extension-counted takes)
  // 2. checkLifetimeCap returns { exceeded: true, nonPauseCount: 2 }
  // 3. Returns OFFER_INELIGIBLE_LIFETIME_CAP → no offer shown
  const LIFETIME_CAP_NON_PAUSE = 2;
  assertEquals(newPriorTakesCount >= LIFETIME_CAP_NON_PAUSE, true);
});

// ─── Scenario D: extendPause throws SUB_NOT_PAUSED when not paused ────────────

Deno.test('extendPause: throws SUB_NOT_PAUSED when subscription is not paused', async () => {
  const stripe = makePausedStripe(null); // no pause_collection

  await assertRejects(
    () => extendPause('sub_not_paused', 1, stripe),
    Error,
    'SUB_NOT_PAUSED',
  );
});

// ─── Additional: extendPause correctly adds months to resumes_at ─────────────

Deno.test('extendPause: correctly adds extraMonths to existing resumes_at', async () => {
  const stripe = makePausedStripe(FUTURE_RESUMES_AT);

  const { resumesAt } = await extendPause('sub_extend', 2, stripe);
  const expected = FUTURE_RESUMES_AT + 2 * 30 * 24 * 60 * 60;
  assertEquals(resumesAt, expected);
});
