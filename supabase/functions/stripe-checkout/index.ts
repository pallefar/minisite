/**
 * `stripe-checkout` Edge Function — Phase 14 Plan 14-04.
 *
 * See: leanshot/.planning/phases/14-monetization-foundation-stripe-web-clinic-seats/14-04-A3-RESULT.md
 * for the sandbox confirmation context (A3 outcome: PASS — 2-line-item clinic sessions).
 *
 * Single Deno.serve dispatcher serving two endpoints by URL pathname:
 *
 *   /functions/v1/stripe-checkout/session   POST  JWT-authed user/clinic-owner
 *   /functions/v1/stripe-checkout/portal    POST  JWT-authed user/clinic-owner
 *
 * Invariants enforced:
 *
 *   1. **JWT auth via admin.auth.getUser (D-15).** Every request must carry
 *      `Authorization: Bearer <jwt>`. The admin client resolves the JWT to a
 *      real user before any Stripe call. Pitfall #11: no cookies, no credentials
 *      header in CORS.
 *
 *   2. **Pitfall 4 (HARD GATE): payment_method_collection: 'always'.**
 *      Every Checkout session created in /session includes this. Default
 *      'if_required' + trial = users skip card entry and never convert.
 *
 *   3. **D-13: trial_period_days = 7.** Hard-coded; not env-driven. No A/B
 *      trial-length test in v1.2 per 14-CONTEXT.md deferred.
 *
 *   4. **D-01: clinic hybrid billing.** Clinic Checkout attaches BOTH
 *      STRIPE_PRICE_CLINIC_BASE and STRIPE_PRICE_CLINIC_OVERAGE as line_items,
 *      each with quantity: 1. A3 = PASS (see 14-04-A3-RESULT.md).
 *
 *   5. **D-14: webhook is source of truth.** /session MUST NOT pre-create rows
 *      in subscriptions. Only stripe_customers / clinic_stripe_customers mapping
 *      rows are written here (stable Stripe customer ID for repeat checkouts).
 *
 *   6. **Pitfall 5 (manual post-deploy step):** Customer Portal return_url must
 *      be in Stripe Dashboard Portal allow-list. See SUMMARY.md for the exact
 *      dashboard steps.
 *
 *   7. **Pitfall 8 (no upstream error echo):** On stripe.* failure, log to
 *      console.error and return generic 500. Never JSON.stringify(stripeErr)
 *      into the response body.
 *
 *   8. **Customer mapping idempotency:** SELECT-first, INSERT-on-miss with
 *      UNIQUE-conflict (23505) re-SELECT fallback for races.
 *
 * Stripe SDK: pinned to v19, API version 2026-04-22.dahlia
 * (see 14-RESEARCH.md §Pattern 1).
 */

import Stripe from 'https://esm.sh/stripe@19?target=denonext';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getCookies } from 'https://deno.land/std@0.224.0/http/cookie.ts';
import { corsHeaders } from './cors.ts';
// Phase 43 Plan 04 — MEMBER-03 D-06/D-07: multiplicative discount-stack clamp
// with 70% cap. clampCombinedDiscount(clippable, preserved) — promo is the
// first arg (lower priority → clippable); SAVE-offer is preserved.
import { clampCombinedDiscount } from '../_shared/clamp-combined-discount.ts';

// Phase 19 Plan 19-04 — affiliate-code propagation (AFF-02, D-23).
// Validates the same 4–80 lowercase/digit/dash format used by `affiliate-attribute`.
const REFERRAL_CODE_PATTERN = /^[a-z0-9-]{4,80}$/;

// =============================================================================
// Environment helpers (lazy reads — resolved at handler call time, not import)
// =============================================================================

// Note: env vars are intentionally read lazily (inside getter functions) so
// that tests can call Deno.env.set() before the first handler invocation.
// Module-level const reads would capture '' for any var set after import.

function env(name: string, fallback = ''): string {
  return Deno.env.get(name) ?? fallback;
}

// Convenience accessors used throughout the handlers.
const getSupabaseUrl = () => env('SUPABASE_URL');
const getSupabaseServiceRoleKey = () => env('SUPABASE_SERVICE_ROLE_KEY');
const getStripeSecretKey = () => env('STRIPE_SECRET_KEY');
const getPricePlusMonthly = () => env('STRIPE_PRICE_PLUS_MONTHLY');
const getPricePlusYearly = () => env('STRIPE_PRICE_PLUS_YEARLY');
const getPriceClinicBase = () => env('STRIPE_PRICE_CLINIC_BASE');
const getPriceClinicOverage = () => env('STRIPE_PRICE_CLINIC_OVERAGE');
// Phase 43 Plan 04 — MEMBER-01 D-02 default lifetime price (env-var fallback
// chain: resolve_user_effective_price → STRIPE_PRICE_LIFETIME → 503).
const getPriceLifetime = () => env('STRIPE_PRICE_LIFETIME');
const getPublicAppOrigin = () => env('PUBLIC_APP_ORIGIN', 'https://app.leanshot.app');

// =============================================================================
// Stripe SDK (singleton + test-injectable)
// =============================================================================

// Lazy initialization: the Stripe SDK validates the key format at construction
// time. We defer construction to the first use so tests can set env vars and
// swap in a stub via __setStripeForTest before any handler runs.
// deno-lint-ignore no-explicit-any
let _stripeInstance: any = null;

// deno-lint-ignore no-explicit-any
function getStripe(): any {
  if (_stripeInstance === null) {
    _stripeInstance = new Stripe(getStripeSecretKey(), {
      apiVersion: '2026-04-22.dahlia' as Parameters<typeof Stripe>[1]['apiVersion'],
      httpClient: Stripe.createFetchHttpClient(),
    });
  }
  return _stripeInstance;
}

// Proxy object: reads _stripeInstance lazily so __setStripeForTest works even
// after the first import. If a test calls __setStripeForTest(stub), that stub
// is returned; if not, we lazy-initialize the real Stripe client.
const stripeInstance = new Proxy({} as Record<string | symbol, unknown>, {
  // deno-lint-ignore no-explicit-any
  get(_target: any, prop: string | symbol): unknown {
    const s = getStripe();
    const val = s[prop];
    return typeof val === 'function' ? val.bind(s) : val;
  },
});

export function __setStripeForTest(stub: unknown): void {
  _stripeInstance = stub;
}

// =============================================================================
// Admin Supabase client (singleton + test-injectable)
// =============================================================================

// Lazy initialization: supabase-js validates supabaseUrl at construction time.
// Tests inject a fake admin via __setAdminForTest before any handler runs.
// deno-lint-ignore no-explicit-any
let _adminInstance: any = null;

// deno-lint-ignore no-explicit-any
function getAdmin(): any {
  if (_adminInstance === null) {
    _adminInstance = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}

// Proxy object: reads _adminInstance lazily.
const adminInstance = new Proxy({} as Record<string | symbol, unknown>, {
  // deno-lint-ignore no-explicit-any
  get(_target: any, prop: string | symbol): unknown {
    const a = getAdmin();
    const val = a[prop];
    return typeof val === 'function' ? val.bind(a) : val;
  },
});

export function __setAdminForTest(fakeAdmin: unknown): void {
  _adminInstance = fakeAdmin;
}

// =============================================================================
// Helpers
// =============================================================================

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}

function jwtFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(s: string): boolean {
  return UUID_RE.test(s);
}

// =============================================================================
// Customer-mapping helpers
// =============================================================================

/**
 * Ensure a stripe_customers row exists for the given user.
 * If missing, creates a Stripe customer and inserts the row.
 * On UNIQUE conflict (race), re-SELECTs and returns the existing customer ID.
 */
async function ensureWebCustomer(user: { id: string; email?: string }): Promise<string> {
  // deno-lint-ignore no-explicit-any
  const { data: existing } = await (adminInstance.from('stripe_customers')
    .select('stripe_customer_id')
    .eq('user_id', user.id) as any).maybeSingle();

  if (existing?.stripe_customer_id) {
    return existing.stripe_customer_id as string;
  }

  // Create Stripe customer
  let stripeCustomer: { id: string };
  try {
    stripeCustomer = await stripeInstance.customers.create({
      email: user.email,
      metadata: { user_id: user.id },
    });
  } catch (err) {
    console.error('[stripe-checkout] stripe.customers.create (web) failed', err instanceof Error ? err.message : 'unknown');
    throw err;
  }

  // Insert into stripe_customers
  const { error: insertErr } = await adminInstance.from('stripe_customers').insert({
    user_id: user.id,
    stripe_customer_id: stripeCustomer.id,
  });

  if (insertErr) {
    // deno-lint-ignore no-explicit-any
    const pgCode = (insertErr as any).code;
    if (pgCode === '23505') {
      // Race: another invocation already inserted. Re-SELECT.
      // deno-lint-ignore no-explicit-any
      const { data: race } = await (adminInstance.from('stripe_customers')
        .select('stripe_customer_id')
        .eq('user_id', user.id) as any).maybeSingle();
      if (race?.stripe_customer_id) return race.stripe_customer_id as string;
    }
    console.error('[stripe-checkout] stripe_customers insert failed', insertErr.message);
    throw new Error('customer_mapping_failed');
  }

  return stripeCustomer.id;
}

/**
 * Ensure a clinic_stripe_customers row exists for the given clinic.
 * If missing, creates a Stripe customer and inserts the row.
 * On UNIQUE conflict (race), re-SELECTs and returns the existing customer ID.
 */
async function ensureClinicCustomer(clinicId: string, ownerEmail: string): Promise<string> {
  // deno-lint-ignore no-explicit-any
  const { data: existing } = await (adminInstance.from('clinic_stripe_customers')
    .select('stripe_customer_id')
    .eq('clinic_id', clinicId) as any).maybeSingle();

  if (existing?.stripe_customer_id) {
    return existing.stripe_customer_id as string;
  }

  // Create Stripe customer
  let stripeCustomer: { id: string };
  try {
    stripeCustomer = await stripeInstance.customers.create({
      email: ownerEmail,
      metadata: { clinic_id: clinicId },
    });
  } catch (err) {
    console.error('[stripe-checkout] stripe.customers.create (clinic) failed', err instanceof Error ? err.message : 'unknown');
    throw err;
  }

  // Insert into clinic_stripe_customers
  const { error: insertErr } = await adminInstance.from('clinic_stripe_customers').insert({
    clinic_id: clinicId,
    stripe_customer_id: stripeCustomer.id,
  });

  if (insertErr) {
    // deno-lint-ignore no-explicit-any
    const pgCode = (insertErr as any).code;
    if (pgCode === '23505') {
      // Race: re-SELECT.
      // deno-lint-ignore no-explicit-any
      const { data: race } = await (adminInstance.from('clinic_stripe_customers')
        .select('stripe_customer_id')
        .eq('clinic_id', clinicId) as any).maybeSingle();
      if (race?.stripe_customer_id) return race.stripe_customer_id as string;
    }
    console.error('[stripe-checkout] clinic_stripe_customers insert failed', insertErr.message);
    throw new Error('customer_mapping_failed');
  }

  return stripeCustomer.id;
}

// =============================================================================
// Affiliate-code resolution (Phase 19 Plan 19-04 — AFF-02, D-23)
// =============================================================================

/**
 * Resolve an affiliate referral code from the request — best-effort, never blocks.
 *
 * Precedence (D-23):
 *   1. `?aff=<code>`        — Plan 19-02 attribution path (cookie-shadow).
 *   2. `?aff_manual=<code>` — D-23 / BL-1 manual-entry path (SignUpForm).
 *   3. `_aff` cookie        — Plan 19-02 cookie fallback (set on /r/{code}).
 *
 * Returns `null` on any of: missing, regex fail, lookup error, affiliate not
 * approved. Never throws — affiliate attribution is best-effort, the checkout
 * itself must always succeed (V11 silent-no-op contract).
 */
async function resolveAffCode(req: Request): Promise<string | null> {
  const url = new URL(req.url);
  const affFromQuery = url.searchParams.get('aff');
  const affManualFromQuery = url.searchParams.get('aff_manual');
  const affFromCookie = getCookies(req.headers)['_aff'] ?? null;
  const candidate = affFromQuery ?? affManualFromQuery ?? affFromCookie ?? null;

  if (!candidate || !REFERRAL_CODE_PATTERN.test(candidate)) return null;

  try {
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (adminInstance.from('affiliates')
      .select('id, status')
      .eq('referral_code', candidate) as any).maybeSingle();
    if (error) return null;
    const row = data as { id: string; status: string } | null;
    if (!row || row.status !== 'approved') return null;
    return candidate;
  } catch {
    return null;
  }
}

// =============================================================================
// /session handler
// =============================================================================

// Phase 43 Plan 04 — MEMBER-01 D-02 adds 'lifetime' to the plan enum.
type Plan = 'plus_monthly' | 'plus_yearly' | 'clinic' | 'lifetime';

interface SessionBody {
  plan?: Plan;
  clinic_id?: string;
  /** Phase 43 Plan 04 — MEMBER-03 D-06: optional Stripe coupon ID to apply. */
  promo_code?: string;
}

export async function handleSession(req: Request): Promise<Response> {
  // 1. JWT presence + resolution
  const jwt = jwtFromReq(req);
  if (!jwt) return jsonError(401, 'unauthenticated');

  const { data: userData, error: userErr } = await adminInstance.auth.getUser(jwt);
  if (userErr || !userData?.user) return jsonError(401, 'unauthenticated');
  const user = userData.user;

  // 2. Parse body
  let body: SessionBody;
  try {
    body = (await req.json()) as SessionBody;
  } catch {
    return jsonError(400, 'bad_json');
  }

  const plan = body.plan;
  // Phase 43 Plan 04 — MEMBER-01 D-02: 'lifetime' added to plan enum.
  const validPlans: Plan[] = ['plus_monthly', 'plus_yearly', 'clinic', 'lifetime'];
  if (!plan || !validPlans.includes(plan)) {
    return jsonError(400, 'invalid_plan');
  }

  // Phase 43 Plan 04 — OQ-6 RESOLVED: lifetime + promo_code is an EoP attempt
  // (T-43-04-01). Reject BEFORE any Stripe call.
  if (plan === 'lifetime' && body.promo_code) {
    return jsonError(400, 'lifetime_no_promo_code');
  }

  // 3. Clinic-specific validation
  let clinicId: string | undefined;
  if (plan === 'clinic') {
    clinicId = (body.clinic_id ?? '').trim();
    if (!clinicId || !isUUID(clinicId)) {
      return jsonError(400, 'invalid_clinic_id');
    }

    // Verify caller is clinic owner (using memberships table — Phase 9 schema)
    // deno-lint-ignore no-explicit-any
    const { data: memberRow } = await (adminInstance.from('memberships')
      .select('memberships.*, roles!inner(name)')
      .eq('org_id', clinicId)
      .eq('user_id', user.id)
      .is('revoked_at', null) as any).maybeSingle();

    // deno-lint-ignore no-explicit-any
    const roleName = (memberRow as any)?.roles?.name ?? '';
    if (!memberRow || roleName !== 'Owner') {
      return jsonError(403, 'forbidden');
    }
  }

  // 4. Build line_items
  //
  // A3 = PASS: clinic uses 2 line_items (base + overage, each quantity 1).
  //
  // Phase 43 Plan 04 — MEMBER-02 D-03/D-04: plus_monthly / plus_yearly /
  // lifetime route through resolve_user_effective_price for grandfathered
  // cohort routing. Fallback chain: RPC → env helper → 503. v1.3 scope: NEW
  // stripe-checkout only; existing-subscriber renewal-time update DEFERRED
  // per 43-CARRY-OVER.md item #2. Clinic grandfathering also deferred —
  // clinic branch unchanged from Phase 14.
  type LineItem = { price: string; quantity: number };
  let lineItems: LineItem[];
  if (plan === 'plus_monthly' || plan === 'plus_yearly' || plan === 'lifetime') {
    // deno-lint-ignore no-explicit-any
    const resolved = await (adminInstance as any).rpc('resolve_user_effective_price', {
      p_user_id: user.id,
      p_plan: plan,
    });
    const grandfathered = (resolved?.data as string | null) ?? null;
    const fallback =
      plan === 'plus_monthly'
        ? getPricePlusMonthly()
        : plan === 'plus_yearly'
          ? getPricePlusYearly()
          : getPriceLifetime();
    const priceId = grandfathered && grandfathered !== '' ? grandfathered : fallback;
    if (!priceId) {
      // Vendor-gated-send: neither cohort nor stripe_price_lookup configured.
      // No Stripe call.
      return jsonError(503, 'vendor_unconfigured');
    }
    lineItems = [{ price: priceId, quantity: 1 }];
  } else {
    // clinic — A3 PASS branch: 2 line_items (unchanged from Phase 14).
    lineItems = [
      { price: getPriceClinicBase(), quantity: 1 },
      { price: getPriceClinicOverage(), quantity: 1 },
    ];
  }

  // Phase 43 Plan 04 — MEMBER-03 D-06/D-07: 70%-cap multiplicative clamp
  // applied BEFORE sessions.create. Only fires on subscription plans with a
  // user-supplied promo_code (lifetime rejects promo upstream). If the user
  // has an accepted SAVE-offer in cancellation_offers_log AND a promo_code is
  // requested, the multiplicative combination must not exceed 70%.
  if (
    body.promo_code &&
    (plan === 'plus_monthly' || plan === 'plus_yearly')
  ) {
    // Look up the promo coupon's percent_off via Stripe.
    let promoPct = 0;
    try {
      // deno-lint-ignore no-explicit-any
      const coupon: any = await stripeInstance.coupons.retrieve(body.promo_code);
      const pctOff = typeof coupon?.percent_off === 'number' ? coupon.percent_off : 0;
      promoPct = pctOff / 100;
    } catch (err) {
      console.error('[stripe-checkout] coupons.retrieve failed', err instanceof Error ? err.message : 'unknown');
      // Defensive: refuse rather than silently letting an unverified coupon through.
      return jsonError(400, 'invalid_promo_code');
    }

    // Find any most-recent accepted SAVE-discount offer for this user.
    let savePct = 0;
    try {
      // deno-lint-ignore no-explicit-any
      const { data: saveRow } = await (adminInstance.from('cancellation_offers_log')
        .select('offer_payload')
        .eq('user_id', user.id)
        .eq('status', 'accepted') as any)
        .order('decided_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      // deno-lint-ignore no-explicit-any
      const payload = (saveRow as any)?.offer_payload as
        | { offer_type?: string; percent_off?: number }
        | null
        | undefined;
      if (payload && payload.offer_type === 'discount' && typeof payload.percent_off === 'number') {
        // percent_off may be stored as 0..1 OR 0..100 depending on producer.
        savePct = payload.percent_off > 1 ? payload.percent_off / 100 : payload.percent_off;
      }
    } catch (err) {
      // Best-effort lookup; absent row → savePct stays 0.
      console.warn('[stripe-checkout] save-offer lookup failed', err instanceof Error ? err.message : 'unknown');
    }

    const clamp = clampCombinedDiscount(promoPct, savePct);
    if (clamp.clipped) {
      // D-07 strict reading: fail fast with user-visible error.
      return jsonError(400, 'discount_combination_exceeds_max');
    }
  }

  // 5. Resolve Stripe customer
  let customerId: string;
  try {
    if (plan === 'clinic' && clinicId) {
      customerId = await ensureClinicCustomer(clinicId, user.email ?? '');
    } else {
      // plus_monthly / plus_yearly / lifetime all use ensureWebCustomer (user-scoped).
      customerId = await ensureWebCustomer({ id: user.id, email: user.email });
    }
  } catch {
    return jsonError(500, 'checkout_failed');
  }

  // 6. Build success/cancel URLs
  const isClinic = plan === 'clinic';
  const basePath = isClinic ? '/clinic/settings' : '/settings';
  const origin = getPublicAppOrigin();
  const successUrl = `${origin}${basePath}?from=checkout&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${origin}${basePath}?from=cancel`;

  // 7. Build metadata
  // Phase 19 Plan 19-04: resolve aff code (?aff= → ?aff_manual= → _aff cookie)
  // and propagate into BOTH session.metadata AND subscription_data.metadata so
  // invoice.paid renewal events can still read it from the subscription
  // (RESEARCH Pitfall 2 — session metadata is one-shot, sub metadata persists).
  //
  // Phase 43 Plan 04 — MEMBER-01 D-02: lifetime uses payment_intent_data
  // instead of subscription_data because mode='payment' has no subscription
  // metadata channel. tier_kind='lifetime' propagates through PaymentIntent.
  const affCode = await resolveAffCode(req);
  const subMetadata: Record<string, string> = isClinic
    ? { clinic_id: clinicId!, provider: 'stripe', tier_kind: 'clinic', aff_code: affCode ?? '' }
    : { user_id: user.id, provider: 'stripe', tier_kind: 'web', aff_code: affCode ?? '' };

  // 8. Create Stripe Checkout session
  //
  // Phase 65 Plan 03 — Stripe Tax + B2B tax_id_collection (PAY-01/02/03, D-01/D-02/D-03).
  //
  // - `automatic_tax: { enabled: true }` — applied to EVERY session (web/lifetime/clinic).
  //   Defers tax calculation to Stripe Tax. Requires Stripe Tax to be enabled in the
  //   Dashboard BEFORE deploy — operator action documented in Plan 65-10 close-out
  //   (`stripe.tax.calculations.create()` smoke test at deploy time, see 65-CONTEXT.md
  //   "Stripe Tax + B2B tax_id Collection").
  //
  // - `customer_update: { address: 'auto', name: 'auto' }` — required so the
  //   address-on-file collected at Checkout flows back to the Stripe Customer record
  //   that subsequent invoice tax calculations read. Safe for mode='payment'
  //   (lifetime) because ensureWebCustomer creates the customer BEFORE this call.
  //
  // - `tax_id_collection: { enabled: true }` — ADDED on the clinic branch ONLY
  //   (B2B Owner purchasing an org subscription on behalf of a clinic entity).
  //   Consumer flows (web subscription + lifetime) deliberately skip this to avoid
  //   B2C checkout friction; `customer_update.address` is sufficient for consumer
  //   tax calc. Mirroring the collected tax_id to subscriptions.tax_id (clinic
  //   rows — where clinic_id IS NOT NULL per Phase 14 + Phase 29 D-14) is
  //   handled in Plan 65-04 via the `checkout.session.completed` webhook event
  //   handler — NOT this Edge Fn.
  //
  // Affiliate-payout flow (Stripe Connect Express payouts) is OUT OF SCOPE for
  // this Edge Fn — those are payouts, not Checkout sessions, and Phase 26 owns them.
  try {
    // deno-lint-ignore no-explicit-any
    const sessionParams: Record<string, any> = {
      customer: customerId,
      payment_method_collection: 'always',
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      // PAY-01 / D-01: Stripe Tax on every session.
      automatic_tax: { enabled: true },
      // PAY-02 / D-02: address-on-file feeds future invoice tax calc.
      customer_update: { address: 'auto', name: 'auto' },
      // Aff-code attribution at session-level (forward-compat for checkout.session.completed).
      metadata: { aff_code: affCode ?? '' },
      // client_reference_id remains the clinic_id/user_id linkage (Phase 14 contract).
      client_reference_id: clinicId ?? user.id,
    };

    // PAY-03 / D-03: B2B clinic-org sessions ALSO collect tax IDs. Consumer
    // (web + lifetime) flows must NOT set this — checked-explicitly so future
    // additions to the plan enum don't accidentally inherit it.
    if (plan === 'clinic') {
      sessionParams['tax_id_collection'] = { enabled: true };
    }

    if (plan === 'lifetime') {
      // Pitfall 10 (per 43-RESEARCH): lifetime MUST be mode='payment', never
      // 'subscription'. payment_intent_data carries the user/tier metadata.
      Object.assign(sessionParams, {
        mode: 'payment',
        payment_intent_data: {
          metadata: {
            user_id: user.id,
            provider: 'stripe',
            tier_kind: 'lifetime',
            aff_code: affCode ?? '',
          },
        },
      });
    } else {
      Object.assign(sessionParams, {
        mode: 'subscription',
        subscription_data: {
          trial_period_days: 7,
          metadata: subMetadata,
        },
      });
      // Phase 43 Plan 04: include promo coupon when present (subscription plans only).
      if (body.promo_code) {
        sessionParams['discounts'] = [{ coupon: body.promo_code }];
      }
    }

    const session = await stripeInstance.checkout.sessions.create(sessionParams);

    return jsonResponse(200, { url: session.url });
  } catch (err) {
    console.error('[stripe-checkout] session create failed', err instanceof Error ? err.message : 'unknown');
    return jsonError(500, 'checkout_failed');
  }
}

// =============================================================================
// /portal handler
// =============================================================================

interface PortalBody {
  clinic_id?: string;
}

export async function handlePortal(req: Request): Promise<Response> {
  // 1. JWT presence + resolution
  const jwt = jwtFromReq(req);
  if (!jwt) return jsonError(401, 'unauthenticated');

  const { data: userData, error: userErr } = await adminInstance.auth.getUser(jwt);
  if (userErr || !userData?.user) return jsonError(401, 'unauthenticated');
  const user = userData.user;

  // 2. Parse body
  let body: PortalBody;
  try {
    body = (await req.json()) as PortalBody;
  } catch {
    body = {};
  }

  const clinicId = body.clinic_id?.trim();
  const isClinic = !!clinicId && isUUID(clinicId);

  // 3. Verify clinic ownership if clinic mode
  if (isClinic) {
    // deno-lint-ignore no-explicit-any
    const { data: memberRow } = await (adminInstance.from('memberships')
      .select('memberships.*, roles!inner(name)')
      .eq('org_id', clinicId)
      .eq('user_id', user.id)
      .is('revoked_at', null) as any).maybeSingle();

    // deno-lint-ignore no-explicit-any
    const roleName = (memberRow as any)?.roles?.name ?? '';
    if (!memberRow || roleName !== 'Owner') {
      return jsonError(403, 'forbidden');
    }
  }

  // 4. Resolve customer ID (must already exist — portal requires a subscription)
  let customerId: string | null = null;

  if (isClinic) {
    // deno-lint-ignore no-explicit-any
    const { data } = await (adminInstance.from('clinic_stripe_customers')
      .select('stripe_customer_id')
      .eq('clinic_id', clinicId) as any).maybeSingle();
    customerId = (data?.stripe_customer_id as string) ?? null;
  } else {
    // deno-lint-ignore no-explicit-any
    const { data } = await (adminInstance.from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', user.id) as any).maybeSingle();
    customerId = (data?.stripe_customer_id as string) ?? null;
  }

  if (!customerId) {
    // Per Pitfall 5 rationale: portal is meaningless without a customer.
    // No Stripe API call should fire in this branch.
    return jsonError(404, 'no_subscription');
  }

  // 5. Build return URL
  const portalOrigin = getPublicAppOrigin();
  const returnUrl = isClinic
    ? `${portalOrigin}/clinic/settings?from=portal`
    : `${portalOrigin}/settings?from=portal`;

  // 6. Create Stripe Customer Portal session
  try {
    const session = await stripeInstance.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return jsonResponse(200, { url: session.url });
  } catch (err) {
    console.error('[stripe-checkout] portal create failed', err instanceof Error ? err.message : 'unknown');
    return jsonError(500, 'portal_failed');
  }
}

// =============================================================================
// Dispatcher
// =============================================================================

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight — applies to ALL endpoints under this function.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  // Supabase Edge Functions are mounted at `/functions/v1/<name>/...`
  const segments = url.pathname.split('/').filter(Boolean);
  // Find `stripe-checkout` segment and take the next segment as action.
  const fnIdx = segments.indexOf('stripe-checkout');
  const action = fnIdx >= 0 ? (segments[fnIdx + 1] ?? '') : (segments[segments.length - 1] ?? '');

  try {
    // Phase 69.7 — operational smoke endpoint (GET only, no auth, returns 200).
    if (action === 'healthz' && req.method === 'GET') {
      return new Response(
        JSON.stringify({ ok: true, fn: 'stripe-checkout' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (action === 'session') {
      if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
      return await handleSession(req);
    }
    if (action === 'portal') {
      if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
      return await handlePortal(req);
    }
    return jsonError(404, 'unknown_action');
  } catch (e) {
    console.error('[stripe-checkout] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal_error');
  }
});

// =============================================================================
// Internal exports for the Deno test suite
// =============================================================================
export const __internal = {
  handleSession,
  handlePortal,
  ensureWebCustomer,
  ensureClinicCustomer,
  __setStripeForTest,
  __setAdminForTest,
};
