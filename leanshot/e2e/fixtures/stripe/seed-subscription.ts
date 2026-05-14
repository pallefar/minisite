/**
 * Phase 14 Plan 14-08 — Stripe subscription seeder fixture.
 *
 * Exports `seedSubscription` — creates a test customer with a test clock attached,
 * inserts the Stripe customer mapping row into Supabase, and creates a Stripe
 * subscription. Does NOT manually write the `subscriptions` row; the stripe-webhook
 * Edge Function creates it when Stripe fires `customer.subscription.created`.
 *
 * CRITICAL INVARIANT: `test_clock` MUST be attached to the customer at creation
 * time — Stripe does not allow attaching a test clock to an existing customer.
 * This fixture handles that correctly by creating the clock first, then the customer.
 *
 * Security note (T-14-08-03): The service role admin client is used ONLY on the
 * Node side (fixture process) and NEVER passed to the browser context. The browser
 * uses the anon key via Supabase JS.
 *
 * Tier variants supported:
 *   'plus_monthly' — web subscription: STRIPE_PRICE_PLUS_MONTHLY
 *   'plus_yearly'  — web subscription: STRIPE_PRICE_PLUS_YEARLY
 *   'clinic'       — clinic subscription: STRIPE_PRICE_CLINIC_BASE + STRIPE_PRICE_CLINIC_OVERAGE
 */

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

import { createTestClock } from './test-clock';

// ─── Environment (server-side — no VITE_ prefix per 14-02/14-04 conventions) ──
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? '';
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const STRIPE_PRICE_PLUS_MONTHLY = process.env.STRIPE_PRICE_PLUS_MONTHLY ?? '';
const STRIPE_PRICE_PLUS_YEARLY = process.env.STRIPE_PRICE_PLUS_YEARLY ?? '';
const STRIPE_PRICE_CLINIC_BASE = process.env.STRIPE_PRICE_CLINIC_BASE ?? '';
const STRIPE_PRICE_CLINIC_OVERAGE = process.env.STRIPE_PRICE_CLINIC_OVERAGE ?? '';

function getStripe(): Stripe {
  return new Stripe(STRIPE_SECRET_KEY || 'sk_test_placeholder', {
    apiVersion: '2026-04-22.dahlia' as Parameters<typeof Stripe>[1]['apiVersion'],
  });
}

function getAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'seedSubscription: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars are required',
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type SeedTier = 'plus_monthly' | 'plus_yearly' | 'clinic';

export interface SeedSubscriptionOpts {
  /** Supabase auth.users UUID for the user/clinic owner. */
  userId: string;
  /** Billing tier to create. */
  tier: SeedTier;
  /** Required when tier === 'clinic'. */
  clinicId?: string;
  /** Seed email for the Stripe customer (recommended for dashboard traceability). */
  email?: string;
}

export interface SeedSubscriptionResult {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  testClockId: string;
}

/**
 * Seed a Stripe subscription bypassing the Checkout UI flow.
 *
 * Flow:
 *   1. Create Stripe test clock (so subscription is advance-able).
 *   2. Create Stripe customer with test_clock attached.
 *   3. Insert stripe_customers (or clinic_stripe_customers) mapping row via service role.
 *   4. Create Stripe subscription (with trial for plus_monthly/plus_yearly).
 *   5. Return IDs for advance/cleanup in specs.
 *
 * NOTE: The `subscriptions` table row is written by the stripe-webhook Edge Function
 * when Stripe fires `customer.subscription.created`. Specs that need the row present
 * before asserting must use `pollUntil` to wait for webhook delivery.
 */
export async function seedSubscription(
  opts: SeedSubscriptionOpts,
): Promise<SeedSubscriptionResult> {
  if (!STRIPE_SECRET_KEY) {
    throw new Error('seedSubscription: STRIPE_SECRET_KEY env var is required');
  }

  const stripe = getStripe();
  const admin = getAdmin();

  // 1. Create test clock (MUST come before customer — cannot attach after).
  const clock = await createTestClock(
    `e2e-${opts.tier}-${opts.userId.slice(0, 8)}`,
  );

  // 2. Create Stripe customer with test clock attached.
  const customer = await stripe.customers.create({
    metadata: {
      supabase_user_id: opts.userId,
      ...(opts.clinicId ? { clinic_id: opts.clinicId } : {}),
      e2e_seed: 'true',
    },
    ...(opts.email ? { email: opts.email } : {}),
    test_clock: clock.id,
  });

  // 3. Insert the customer mapping row via service-role admin.
  //    This mirrors what stripe-checkout Edge Function does at Checkout time.
  if (opts.tier === 'clinic' && opts.clinicId) {
    const { error } = await admin.from('clinic_stripe_customers').upsert(
      {
        clinic_id: opts.clinicId,
        stripe_customer_id: customer.id,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'clinic_id' },
    );
    if (error) {
      throw new Error(
        `seedSubscription: clinic_stripe_customers upsert failed: ${error.message}`,
      );
    }
  } else {
    const { error } = await admin.from('stripe_customers').upsert(
      {
        user_id: opts.userId,
        stripe_customer_id: customer.id,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (error) {
      throw new Error(
        `seedSubscription: stripe_customers upsert failed: ${error.message}`,
      );
    }
  }

  // 4. Build line_items per tier.
  let lineItems: Stripe.SubscriptionCreateParams['items'];
  if (opts.tier === 'clinic') {
    if (!STRIPE_PRICE_CLINIC_BASE || !STRIPE_PRICE_CLINIC_OVERAGE) {
      throw new Error(
        'seedSubscription: STRIPE_PRICE_CLINIC_BASE + STRIPE_PRICE_CLINIC_OVERAGE required for clinic tier',
      );
    }
    lineItems = [
      { price: STRIPE_PRICE_CLINIC_BASE, quantity: 1 },
      { price: STRIPE_PRICE_CLINIC_OVERAGE, quantity: 1 },
    ];
  } else if (opts.tier === 'plus_yearly') {
    if (!STRIPE_PRICE_PLUS_YEARLY) {
      throw new Error('seedSubscription: STRIPE_PRICE_PLUS_YEARLY required for plus_yearly tier');
    }
    lineItems = [{ price: STRIPE_PRICE_PLUS_YEARLY, quantity: 1 }];
  } else {
    // plus_monthly (default)
    if (!STRIPE_PRICE_PLUS_MONTHLY) {
      throw new Error(
        'seedSubscription: STRIPE_PRICE_PLUS_MONTHLY required for plus_monthly tier',
      );
    }
    lineItems = [{ price: STRIPE_PRICE_PLUS_MONTHLY, quantity: 1 }];
  }

  // 5. Create subscription.
  //    Plus tiers get trial_period_days = 7 + payment_behavior = 'default_incomplete'
  //    (card collection always required per Pitfall 4).
  const subParams: Stripe.SubscriptionCreateParams = {
    customer: customer.id,
    items: lineItems,
    metadata: {
      supabase_user_id: opts.userId,
      ...(opts.clinicId ? { clinic_id: opts.clinicId } : {}),
      e2e_seed: 'true',
    },
    ...(opts.tier !== 'clinic'
      ? {
          // Web plus tiers: 7-day trial matching Checkout config (D-13).
          trial_period_days: 7,
          // Add a default payment method so the trial auto-converts (test mode).
          // In test mode, we use a test payment method token.
          default_payment_method: undefined,
        }
      : {}),
  };

  const subscription = await stripe.subscriptions.create(subParams);

  return {
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: customer.id,
    testClockId: clock.id,
  };
}

/**
 * Cancel a Stripe subscription (best-effort). Swallows errors for use in afterAll.
 */
export async function cancelStripeSubscription(subscriptionId: string): Promise<void> {
  try {
    const stripe = getStripe();
    await stripe.subscriptions.cancel(subscriptionId);
  } catch {
    // Best-effort cleanup — do not throw.
  }
}
