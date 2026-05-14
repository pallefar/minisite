/**
 * Idempotent Stripe product + price + meter creator for LeanShot Phase 14.
 *
 * Usage:
 *   export STRIPE_SECRET_KEY=sk_test_...
 *   npx tsx scripts/stripe-bootstrap.ts
 *
 * Re-running is safe — all helpers search before create (idempotency).
 * Outputs 4 STRIPE_PRICE_* + 1 STRIPE_METER_* lines to stdout for copy-paste
 * into .env.local + Vercel env + Supabase Function secrets per
 * [[feedback_cli_over_paste_back]] (Stripe MCP-fetchable).
 *
 * Source: 14-CONTEXT.md D-09/D-10/D-11 + 14-RESEARCH.md §"Bootstrap script" lines 523-585.
 * Pinned apiVersion: '2026-04-22.dahlia' per RESEARCH.
 * Pricing: $12.99/mo, $132.49/yr (D-09); $99 base + $9/active-patient (D-10).
 */

import Stripe from 'stripe';

// Env-presence guard — bail early with a clear error before constructing the client.
if (!process.env.STRIPE_SECRET_KEY) {
  console.error(
    '[stripe-bootstrap] STRIPE_SECRET_KEY not set. Set it in your shell ' +
      '(export STRIPE_SECRET_KEY=sk_test_...) then re-run.',
  );
  process.exit(1);
}

// Pin to research-verified API version. Stripe SDK v17 types pin to 2025-02-24.acacia,
// but the API version string is just a header value — casting via `as any` bypasses
// the type constraint while keeping the correct runtime behaviour.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-04-22.dahlia' as Stripe.LatestApiVersion,
});

/**
 * Ensure a product exists by name (idempotent — name is the dedup key).
 * Search before create: lists up to 100 active products then finds by name.
 */
export async function ensureProduct(
  name: string,
  description: string,
): Promise<Stripe.Product> {
  const existing = await stripe.products.list({ limit: 100 });
  const found = existing.data.find((p) => p.name === name);
  if (found) return found;
  return stripe.products.create({ name, description });
}

/**
 * Ensure a price exists by lookup_key (idempotent — lookup_key is the dedup key).
 * Uses stripe.prices.list({ lookup_keys }) which is the Stripe-canonical dedup pattern.
 */
export async function ensurePrice(
  productId: string,
  lookupKey: string,
  params: Stripe.PriceCreateParams,
): Promise<Stripe.Price> {
  const existing = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  if (existing.data[0]) return existing.data[0];
  return stripe.prices.create({ ...params, product: productId, lookup_key: lookupKey });
}

/**
 * Ensure a Billing Meter exists by event_name (idempotent — event_name is the dedup key).
 * Uses Billing Meters v1 API (NOT legacy usage_records.create — removed 2025-03-31).
 * customer_mapping shape from 14-RESEARCH.md §"Pattern 5: Billing Meters".
 */
export async function ensureMeter(
  eventName: string,
  displayName: string,
): Promise<Stripe.Billing.Meter> {
  const existing = await stripe.billing.meters.list({ limit: 100 });
  const found = existing.data.find((m) => m.event_name === eventName);
  if (found) return found;
  return stripe.billing.meters.create({
    display_name: displayName,
    event_name: eventName,
    customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
    default_aggregation: { formula: 'sum' },
    value_settings: { event_payload_key: 'value' },
  });
}

/**
 * Main orchestration — creates 2 products + 4 prices + 1 Billing Meter.
 * Safe to re-run (all helpers are idempotent via search-before-create).
 */
export async function main(): Promise<void> {
  // ── Web tier: LeanShot Plus ────────────────────────────────────────────────
  const plus = await ensureProduct('LeanShot Plus', 'Web subscription — premium features');

  // $12.99/month (D-09)
  const plusMonthly = await ensurePrice(plus.id, 'plus_monthly_v1', {
    currency: 'usd',
    unit_amount: 1299,
    recurring: { interval: 'month' },
  });

  // $132.49/year ≈ 15% discount on monthly × 12 = $155.88 (D-09)
  const plusYearly = await ensurePrice(plus.id, 'plus_yearly_v1', {
    currency: 'usd',
    unit_amount: 13249,
    recurring: { interval: 'year' },
  });

  // ── Clinic tier: LeanShot Clinic ──────────────────────────────────────────
  const clinic = await ensureProduct('LeanShot Clinic', 'Clinic operator subscription');

  // $99/month base (includes up to 10 active patients) (D-10)
  const clinicBase = await ensurePrice(clinic.id, 'clinic_base_v1', {
    currency: 'usd',
    unit_amount: 9900,
    recurring: { interval: 'month' },
  });

  // Billing Meter for active_patients event (D-10 / RESEARCH §"Pattern 5")
  // event_name: 'active_patients' — note plural per 14-02-PLAN.md interface contract
  const meter = await ensureMeter('active_patients', 'Active patients');

  // $9/active-patient/month overage from patient #11 (D-10)
  // usage_type: 'metered' links to Billing Meter via meter.id (NOT legacy usage_records)
  const clinicOverage = await ensurePrice(clinic.id, 'clinic_overage_v1', {
    currency: 'usd',
    unit_amount: 900,
    recurring: { interval: 'month', usage_type: 'metered', meter: meter.id },
  });

  // ── Output: 4 STRIPE_PRICE_* + 1 STRIPE_METER_* ──────────────────────────
  console.log('Add these to .env.example + Vercel env + Supabase Function secrets:');
  console.log(`STRIPE_PRICE_PLUS_MONTHLY=${plusMonthly.id}`);
  console.log(`STRIPE_PRICE_PLUS_YEARLY=${plusYearly.id}`);
  console.log(`STRIPE_PRICE_CLINIC_BASE=${clinicBase.id}`);
  console.log(`STRIPE_PRICE_CLINIC_OVERAGE=${clinicOverage.id}`);
  console.log(`STRIPE_METER_ACTIVE_PATIENTS=${meter.id}`);
}

// Run main() only when invoked directly as a script (NOT when imported by the smoke test).
// Secondary argv[1]?.endsWith('stripe-bootstrap.ts') branch covers tsx invocation path
// which may rewrite import.meta.url differently across versions.
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('stripe-bootstrap.ts')
) {
  main().catch((err) => {
    console.error('[stripe-bootstrap] failed:', err);
    process.exit(1);
  });
}
