/**
 * Vitest smoke test for scripts/stripe-bootstrap.ts
 *
 * Test 1 (always runs): asserts the env-presence guard fires when STRIPE_SECRET_KEY is unset.
 * Test 2 (gated on HAS_STRIPE=true): runs end-to-end against Stripe test mode and
 *   asserts stdout prints all 5 ID lines (4 STRIPE_PRICE_* + 1 STRIPE_METER_*).
 *
 * CI runs without HAS_STRIPE set → live test skips automatically.
 * Local dev with a test key: HAS_STRIPE=true STRIPE_SECRET_KEY=sk_test_... npm test
 *
 * Source: 14-02-PLAN.md Task 2c.
 */

import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const describeIfStripe = process.env.HAS_STRIPE === 'true' ? describe : describe.skip;

describe('stripe-bootstrap env-guard', () => {
  it('bails with clear error when STRIPE_SECRET_KEY unset', () => {
    const result = spawnSync('npx', ['tsx', 'scripts/stripe-bootstrap.ts'], {
      env: { ...process.env, STRIPE_SECRET_KEY: '' },
      cwd: process.cwd(),
      encoding: 'utf-8',
    });

    // Must exit with non-zero code when STRIPE_SECRET_KEY is empty
    expect(result.status).not.toBe(0);

    // Must print a clear, actionable error message to stderr
    const stderr = result.stderr ?? '';
    expect(stderr).toContain('STRIPE_SECRET_KEY not set');
  });
});

describeIfStripe('stripe-bootstrap live API (HAS_STRIPE=true)', () => {
  it(
    'runs end-to-end against Stripe test mode and prints 5 IDs',
    { timeout: 30000 },
    async () => {
      const result = spawnSync('npx', ['tsx', 'scripts/stripe-bootstrap.ts'], {
        env: {
          ...process.env,
          STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
        },
        cwd: process.cwd(),
        encoding: 'utf-8',
      });

      expect(result.status).toBe(0);

      const stdout = result.stdout ?? '';
      expect(stdout).toMatch(/STRIPE_PRICE_PLUS_MONTHLY=price_/);
      expect(stdout).toMatch(/STRIPE_PRICE_PLUS_YEARLY=price_/);
      expect(stdout).toMatch(/STRIPE_PRICE_CLINIC_BASE=price_/);
      expect(stdout).toMatch(/STRIPE_PRICE_CLINIC_OVERAGE=price_/);
      expect(stdout).toMatch(/STRIPE_METER_ACTIVE_PATIENTS=mtr_/);
    },
  );
});
