/// <reference types="node" />
/**
 * stripe-namespace-separation.test.ts
 *
 * Phase 29 Plan 03 — ORG-08 CI proof: same email produces two distinct Stripe
 * customers (one consumer-scoped, one clinic-scoped) via independent DB tables.
 *
 * This test REQUIRES live credentials (Stripe Test Mode + Supabase service-role).
 * When credentials are absent the entire suite is skipped via `describe.skip`.
 * This matches the pattern from [[feedback_rls_per_file_slug_prefix]]:
 *   - file-scoped TEST_SLUG_PREFIX via makeSlugPrefix
 *   - SHOULD_RUN guard from p28-rls-fixture
 *
 * Namespace-separation invariant (A2 from 29-CONTEXT):
 *   public.stripe_customers (consumer)  keyed by user_id     → Stripe customer A
 *   public.clinic_stripe_customers (clinic) keyed by clinic_id → Stripe customer B
 *   For the SAME email, customer A !== customer B.
 *
 * This test replicates the logic of `ensureWebCustomer` and `ensureClinicCustomer`
 * from `supabase/functions/stripe-checkout/index.ts` inline, exercising the
 * Stripe API calls and DB writes directly rather than going through the full
 * checkout Edge Function.
 *
 * Cleanup: both test-mode Stripe customers are deleted in afterAll to avoid
 * accumulating stale test customers in the Stripe Dashboard (T-29-03-04).
 */

import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { SHOULD_RUN, cleanupByPrefix, makeSlugPrefix, createTwoOrgsTwoUsers } from './_fixtures/p28-rls-fixture';

// ─── File-scoped slug prefix (per [[feedback_rls_per_file_slug_prefix]]) ──────
const TEST_SLUG_PREFIX = makeSlugPrefix(path.basename(__filename));

// ─── Live-run gate ────────────────────────────────────────────────────────────
// Skip the entire suite if required credentials are absent.
// STRIPE_SECRET_KEY must be a test-mode key (sk_test_...).
const STRIPE_SK = process.env['STRIPE_SECRET_KEY'];
const describeIfLive = SHOULD_RUN && STRIPE_SK ? describe : describe.skip;

// ─── Test state ───────────────────────────────────────────────────────────────
let cusConsumer: string | null = null;
let cusClinic: string | null = null;
let testOrgId: string | null = null;
let testUserId: string | null = null;

// ─── stripe customer namespace separation ─────────────────────────────────────
describeIfLive('stripe customer namespace separation (ORG-08)', () => {
  let stripe: Stripe;
  let adminClient: ReturnType<typeof createClient>;

  beforeAll(async () => {
    if (!STRIPE_SK) throw new Error('STRIPE_SECRET_KEY not set');
    stripe = new Stripe(STRIPE_SK, { apiVersion: '2025-04-30.basil' as Stripe.LatestApiVersion });
    adminClient = createClient(
      process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL'] ?? '',
      process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Create one org + one user as fixtures
    const fixture = await createTwoOrgsTwoUsers(TEST_SLUG_PREFIX);
    testOrgId = fixture.orgX;
    testUserId = fixture.userA;
  });

  afterAll(async () => {
    // T-29-03-04: clean up test-mode Stripe customers to avoid Dashboard bloat
    if (stripe) {
      if (cusConsumer) {
        try { await stripe.customers.del(cusConsumer); } catch { /* best-effort */ }
      }
      if (cusClinic) {
        try { await stripe.customers.del(cusClinic); } catch { /* best-effort */ }
      }
    }

    // Clean up Supabase test data
    if (adminClient && cusConsumer) {
      await adminClient.from('stripe_customers').delete().eq('stripe_customer_id', cusConsumer);
    }
    if (adminClient && cusClinic) {
      await adminClient.from('clinic_stripe_customers').delete().eq('stripe_customer_id', cusClinic);
    }

    // Clean up fixture orgs + users
    await cleanupByPrefix(TEST_SLUG_PREFIX);
  });

  // ─── ensureWebCustomer (consumer path) ─────────────────────────────────────

  async function ensureWebCustomer(userId: string, email: string): Promise<string> {
    // Match logic from supabase/functions/stripe-checkout/index.ts ensureWebCustomer
    const { data: existing } = await (adminClient.from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', userId) as { data: { stripe_customer_id: string } | null; error: unknown }).maybeSingle();

    if ((existing as { stripe_customer_id?: string } | null)?.stripe_customer_id) {
      return (existing as { stripe_customer_id: string }).stripe_customer_id;
    }

    const stripeCustomer = await stripe.customers.create({
      email,
      metadata: { user_id: userId },
    });

    await adminClient.from('stripe_customers').insert({
      user_id: userId,
      stripe_customer_id: stripeCustomer.id,
    });

    return stripeCustomer.id;
  }

  // ─── ensureClinicCustomer (clinic path) ────────────────────────────────────

  async function ensureClinicCustomer(clinicId: string, email: string): Promise<string> {
    // Match logic from supabase/functions/stripe-checkout/index.ts ensureClinicCustomer
    const { data: existing } = await (adminClient.from('clinic_stripe_customers')
      .select('stripe_customer_id')
      .eq('clinic_id', clinicId) as { data: { stripe_customer_id: string } | null; error: unknown }).maybeSingle();

    if ((existing as { stripe_customer_id?: string } | null)?.stripe_customer_id) {
      return (existing as { stripe_customer_id: string }).stripe_customer_id;
    }

    const stripeCustomer = await stripe.customers.create({
      email,
      metadata: { clinic_id: clinicId },
    });

    await adminClient.from('clinic_stripe_customers').insert({
      clinic_id: clinicId,
      stripe_customer_id: stripeCustomer.id,
    });

    return stripeCustomer.id;
  }

  // ─── The namespace-separation email (shared across T1-T6) ─────────────────

  const getEmail = () => `ns-${TEST_SLUG_PREFIX}@example.com`;

  it('T1: consumer ensure-customer returns a stripe customer ID', async () => {
    expect(testUserId).toBeTruthy();
    cusConsumer = await ensureWebCustomer(testUserId!, getEmail());
    expect(typeof cusConsumer).toBe('string');
    expect(cusConsumer.startsWith('cus_')).toBe(true);
  });

  it('T2: clinic ensure-customer returns a (different) stripe customer ID', async () => {
    expect(testOrgId).toBeTruthy();
    cusClinic = await ensureClinicCustomer(testOrgId!, getEmail());
    expect(typeof cusClinic).toBe('string');
    expect(cusClinic.startsWith('cus_')).toBe(true);
  });

  it('T3: cusConsumer !== cusClinic — THE namespace-separation invariant (ORG-08)', () => {
    expect(cusConsumer).not.toBeNull();
    expect(cusClinic).not.toBeNull();
    // THE central assertion: same email → two distinct Stripe customer IDs
    expect(cusConsumer).not.toBe(cusClinic);
  });

  it('T4: re-running consumer ensure-customer is idempotent (returns same cusConsumer)', async () => {
    const idempotentResult = await ensureWebCustomer(testUserId!, getEmail());
    expect(idempotentResult).toBe(cusConsumer);
  });

  it('T5: re-running clinic ensure-customer is idempotent (returns same cusClinic)', async () => {
    const idempotentResult = await ensureClinicCustomer(testOrgId!, getEmail());
    expect(idempotentResult).toBe(cusClinic);
  });

  it('T6: DB rows exist in correct tables with correct stripe_customer_id values', async () => {
    // Consumer row in stripe_customers
    const { data: consumerRow } = await (adminClient
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', testUserId!) as { data: { stripe_customer_id: string } | null; error: unknown }).maybeSingle();

    expect((consumerRow as { stripe_customer_id?: string } | null)?.stripe_customer_id).toBe(cusConsumer);

    // Clinic row in clinic_stripe_customers
    const { data: clinicRow } = await (adminClient
      .from('clinic_stripe_customers')
      .select('stripe_customer_id')
      .eq('clinic_id', testOrgId!) as { data: { stripe_customer_id: string } | null; error: unknown }).maybeSingle();

    expect((clinicRow as { stripe_customer_id?: string } | null)?.stripe_customer_id).toBe(cusClinic);

    // The central DB-level invariant: the two IDs are not equal
    expect(
      (consumerRow as { stripe_customer_id?: string } | null)?.stripe_customer_id,
    ).not.toBe(
      (clinicRow as { stripe_customer_id?: string } | null)?.stripe_customer_id,
    );
  });
});
