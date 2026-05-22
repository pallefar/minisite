# Phase 43: M4 Membership Tiers Extension - Research

**Researched:** 2026-05-22
**Domain:** Stripe Subscriptions/Checkout (mode=payment + subscription.discounts[] + trial_end) · Postgres tier-reconciliation views · RLS entitlement gating · Supabase Edge Function extension · React paywall-component reuse
**Confidence:** HIGH on all Stripe API call shapes (verified against shipped Phase 40 `apply-discount.ts` + `apply-extended-trial.ts`), HIGH on `tier_effective` view shape (read live migration), HIGH on PaywallGate/Modal contract (read 39-04-PLAN.md), HIGH on cohort schema (read 27-02 migration + live `cohort_is_member` SECDEF), HIGH on remote migration tail (verified via `supabase db query --linked`: `20270709000008`), MEDIUM on the cross-phase `pro_only` column timing question (resolved via inline grep — see OQ-2 below).

## Summary

Phase 43 is a clean extension of three already-shipped layers: (1) Phase 19's `tier_effective` view, which already unifies Stripe + RevenueCat via `MAX(current_period_end)` + `has_active` boolean across providers — adding lifetime requires expanding the source from a single `subscriptions` table UNION to a SELECT-list including `lifetime_purchases`; (2) Phase 14's `stripe-webhook` dispatcher, which already routes `checkout.session.completed` via a `meta.tier_kind` switch (`web`/`clinic`) — adding lifetime is a third `tier_kind='lifetime'` branch in the SAME `checkout-session-completed.ts` handler; (3) Phase 40's coupon-stacking infrastructure — `apply-discount.ts` already ships the `discounts[]` array APPEND pattern preserving existing affiliate coupons. Phase 43's 70% combined-discount cap and 7-day trial extension reuse `clampSavePct` and `applyExtendedTrial` patterns verbatim. The remaining net-new surface is small: one `lifetime_purchases` table, one `grandfathered_prices` table, one `current_user_has_pro()` SECDEF function, an admin sub-page under `/admin/billing/grandfathered-prices`, a `PaywallGate` prop extension (new variant `'pro_only_resource'`), and `pro_only boolean` columns on community_spaces / courses / events.

The **single load-bearing timing question** is whether Phase 43 must ship the `pro_only` columns DEFENSIVELY (the tables don't exist on main yet — Phases 44/46/47 ship them) or defer. RESOLVED below (OQ-2): Phase 43 ships the `pro_only` columns + RLS policies in Phases 44/46/47's table-create migrations (a coordination contract written here), NOT defensively via `IF EXISTS` — because the RLS policy is meaningless without the table and a stub table is worse than a coordinated migration. Phase 43 PHASE-CONTRACT for downstream phases. (Sanity check: this aligns with `feedback_planner_prompt_explicit_reuse_targets` — the contract names the EXACT migration timestamp slots Phase 44/46/47 must consume.)

**Primary recommendation:** Ship as **6 plans across 3 waves**: Wave 1 (schema + tier_effective view replacement) — plans 43-01 (lifetime_purchases + grandfathered_prices + current_user_has_pro SECDEF + tier_effective view extension), 43-02 (stripe-webhook lifetime branch + checkout-create lifetime mode='payment' path); Wave 2 (coupon-stack + grandfathering checkout integration) — plans 43-03 (70% cap validator + trial_end push in checkout-create), 43-04 (admin /admin/billing/grandfathered-prices CRUD page); Wave 3 (consumer-side gating contracts + Slack alert) — plans 43-05 (PaywallGate variant + entitlement-gating CONTRACT.md for Phases 44/46/47), 43-06 (slack-alert-experiments reuse for Lifetime purchases + LIFETIME badge UI).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `lifetime_purchases` table + RLS | Database (Postgres) | — | Source-of-truth for permanent entitlement; user can only read own rows |
| `grandfathered_prices` table + RLS | Database (Postgres) | — | Operator-managed via SECDEF RPC; users never read directly |
| `tier_effective` view extension (UNION lifetime) | Database (View) | — | Same security_invoker=true contract; consumers query unchanged |
| `current_user_has_pro()` SECDEF function | Database (SECDEF function) | API (Edge Fn cache) | RLS predicate; called from policies + cached at Edge Fn |
| Lifetime checkout (mode='payment') | API (Edge Fn `stripe-checkout`) | Browser (button → invoke) | Server-side Stripe call; never client-direct |
| Lifetime webhook branch | API (Edge Fn `stripe-webhook`) | Database (lifetime_purchases upsert) | New `tier_kind='lifetime'` switch arm in existing dispatcher |
| 70% combined-discount cap validator | API (Edge Fn `stripe-checkout`) | — | Server-side BEFORE Stripe session create — fail-fast user error |
| Trial-extension push (subscription.trial_end) | API (Edge Fn — reuse `applyExtendedTrial`) | — | Stripe SDK pinned 2026-04-22.dahlia (P40 precedent) |
| `pro_only` RLS policies on community/courses/events | Database (RLS at Phase 44/46/47 tables) | — | Phase 43 ships the CONTRACT; tables don't yet exist |
| PaywallGate variant `'pro_only_resource'` | Browser / Client | — | Component extension; runtime check via `current_user_has_pro` lookup at gate |
| Admin grandfathered_prices CRUD page | Browser / Client | API (SECDEF write RPCs) | Admin shell sub-page; service-role writes only |
| 60-sec in-memory tier cache | API (Edge Fn process memory) | — | Per-Fn LRU; bounded staleness acceptable per D-13 |
| Slack alert on Lifetime purchase | API (Edge Fn calling existing `slack-alert-experiments`) | — | Reuse SLACK_WEBHOOK_EXPERIMENTS_URL Function Secret pattern |
| LIFETIME badge UI | Browser / Client | — | Reads `tier_effective.tier_label === 'lifetime'` |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Lifetime Tier Representation (MEMBER-01)
- **D-01:** Lifetime added as a NEW row in `tier_effective` with `tier_label='lifetime'`. 4 tier values: free / trial / pro / lifetime. `has_active=true` for both pro and lifetime. Downstream code checks `tier_label='lifetime'` for "permanent-pro" branches. UI shows "LIFETIME" badge.
- **D-02:** Lifetime entitlement via Stripe Checkout one-time payment + webhook idempotent upsert into `lifetime_purchases`. `mode='payment'` (NOT 'subscription'). `checkout.session.completed` webhook fires; handler checks `mode='payment'` + `price.id` matches Lifetime SKU; INSERT `lifetime_purchases(user_id, stripe_payment_intent_id, paid_at, amount_cents)` ON CONFLICT DO NOTHING (idempotent on `stripe_payment_intent_id`). `tier_effective` UNION ALL selects active lifetime_purchases rows alongside active subscriptions.

#### Grandfathering Mechanism (MEMBER-02)
- **D-03:** Grandfathered pricing stored in LeanShot override table `grandfathered_prices(cohort_id, stripe_price_id, effective_from, effective_until)`. Operator-editable via admin UI. Stripe = source of truth for the price OBJECT; LeanShot's checkout-init Edge Fn resolves which `stripe_price_id` to use per user via cohort membership lookup. cohort_id references Phase 27 cohorts (uuid FK).
- **D-04:** Grandfathered price takes effect at NEXT RENEWAL CYCLE (Stripe `update.subscription` + `proration_behavior='none'` + `billing_cycle_anchor='unchanged'`). No proration credits. No mid-cycle surprise.
- **D-05:** Grandfathered users see NO upgrade prompt + pricing page silently shows grandfathered price. No banner, no email, no badge — silent stability is the gift.

#### Coupon Stacking Semantics (MEMBER-03)
- **D-06:** Discounts compound MULTIPLICATIVELY: `total = price × (1 − coupon%) × (1 − save_offer%)`. Implementation: SAVE-offer applied as custom invoice line-item discount via `subscription.discounts[]` override at invoice-creation time. UI shows both discounts as separate line items on invoice + checkout summary.
- **D-07:** Hard cap max combined discount = 70% off any single invoice. Server-side validator in checkout/invoice Edge Fn. If stacked > 70%, clip the lower-priority discount; SAVE-offer takes precedence over promo code for clipping. Industry-standard.
- **D-08:** Trial extension (7 days per MEMBER-03) applied via Stripe `subscription.trial_end` push. Mutate `subscription.trial_end += 7 days`. Invoice naturally delays. Idempotent on (subscription_id, promo_code_id) — prevents double-extension.
- **D-09:** Promo code creation via Stripe Coupons + Promotion Codes (admin dashboard). LeanShot reads promo code from URL + applies to Stripe Checkout Session. No LeanShot-side coupon table.

#### Entitlement Gating Shape (MEMBER-04)
- **D-10:** Gating via RLS at table level (community_spaces / courses / events) + RPC fallback for service-role contexts. New SECDEF function `current_user_has_pro() RETURNS boolean` reads from `tier_effective` filtered by `auth.uid()`. RLS policies exclude rows where `pro_only=true AND NOT current_user_has_pro()`. Mirrors Phase 28 cross-tenant RLS pattern.
- **D-11:** Soft block for VIEW: 200 + PaywallGate component instead of resource body. API returns metadata + `paywall: true`. REUSE Phase 39 PaywallModal contract.
- **D-12:** Hard 403 for WRITE actions. Edge Fn returns 403 + `{error: 'pro_required', upgrade_url: '/pricing?upsell={resource_type}'}`. Frontend opens PaywallModal inline (no redirect).
- **D-13:** 60-second in-memory per-user cache for tier_effective lookup at gate. LRU max 10k entries. Bounded staleness OK.

### Claude's Discretion
- Webhook handler extension shape: third `tier_kind='lifetime'` branch in existing `checkout-session-completed.ts` `if/else if` chain (sibling of `web`/`clinic`).
- Admin UI path: `/admin/billing/grandfathered-prices` (sibling of cohort builder).
- `pro_only` column type + index: `pro_only boolean NOT NULL DEFAULT false` + partial index `WHERE pro_only=true` per table.
- PaywallGate component file: `src/components/paywall/PaywallGate.tsx` (existing from Phase 39) — ADD prop `gating_reason?: 'pro_only_resource' | 'activation_paywall'` (default = existing behavior).
- 70%-cap validator placement: in `stripe-checkout` Edge Fn BEFORE session create (fail-fast user-visible message).
- LIFETIME badge: UI-only, reads `tier_effective.tier_label === 'lifetime'`. Render next to user name in admin views + profile page.

### Deferred Ideas (OUT OF SCOPE)
- Multiple Lifetime SKUs (Founder vs Pro) — v1.4+.
- Refund-handling for Lifetime — operator-manual via Stripe; no automatic data cleanup in v1.3.
- Pro→Lifetime upgrade credit — v1.4+ (requires Stripe Customer Balance + tax accounting).
- Per-resource custom-priced entitlements — only binary `pro_only` gate.
- Bulk grandfathering migration tool — per-cohort one-by-one only.
- Entitlement caching beyond 60s — no Redis layer.
- Lifetime tier subdivisions ("Lifetime + Beta access") — v1.4+.
- Stripe Customer Portal grandfathering self-service — operator-managed only.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MEMBER-01 | Lifetime tier added to `tier_effective` view + Stripe one-time price wiring; one-time payment grants permanent Pro entitlement | `tier_effective` is a `security_invoker=true` view over `public.subscriptions` (verified: `20270101000004_tier_effective_view.sql`). Extension path: REPLACE view with a CTE that UNIONs active subscriptions + active `lifetime_purchases` rows. Columns to add: `tier_label text` (so consumers can distinguish lifetime vs trial vs pro). `has_active` remains the canonical predicate (P19 D-04 contract). |
| MEMBER-02 | Grandfathering — admin sets per-cohort grandfathered pricing | `cohort_definitions.id` is `uuid` (verified: `20270602000010_cohort_definitions.sql:33-43`); `cohort_is_member(p_user_id uuid, p_cohort_id uuid) RETURNS boolean` is SECDEF + already granted to authenticated (verified: `20270602000011_cohort_membership_matview.sql:114-139`). `grandfathered_prices(cohort_id uuid REFERENCES cohort_definitions, stripe_price_id text, effective_from timestamptz, effective_until timestamptz)` + SECDEF resolver `resolve_user_effective_price(p_user_id, p_default_price_id) RETURNS text`. |
| MEMBER-03 | Coupon-driven Pro upgrades + 7-day trial extension stacking with SAVE-offer; admin-creatable via Stripe Coupons + Promotion Codes | `apply-discount.ts` already implements `discounts[]` array APPEND (Phase 40 Plan 40-03 Task 2 — verified verbatim): retrieves sub with `expand:['discounts']`, maps existing to `{coupon: id}`, appends new coupon. `apply-extended-trial.ts` ships `subscriptions.update({trial_end: baseTrialEnd + extensionDays*86400, proration_behavior:'none'})` (verified). 35% clamp + `clampSavePct` helper exist in cancellation-decide-offer (Phase 40). Phase 43 reuses these patterns; 70% cap is a thin wrapper. |
| MEMBER-04 | Community-gated content entitlements — pro-only spaces/courses/events enforced via `tier_effective` lookup | `current_user_has_pro()` SECDEF function references `tier_effective` filtered by `auth.uid()`; STABLE marker enables policy inlining. Phase 28 RLS pattern (denial-by-default + SECDEF helper, verified `cohort_membership` table at `20270602000011_cohort_membership_matview.sql:48-49`) is the direct analog. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| stripe (Deno) | `https://esm.sh/stripe@19?target=denonext` | Stripe SDK in Edge Fns | [VERIFIED: existing webhook + checkout + apply-discount all pin v19] |
| Stripe API version | `2026-04-22.dahlia` | API version pin (Stripe.LatestApiVersion) | [VERIFIED: `supabase/functions/stripe-webhook/index.ts:64`] |
| @supabase/supabase-js | `npm:@supabase/supabase-js@2` | Edge Fn admin client | [VERIFIED: existing handlers all use this exact import] |
| React | 19.0.0 | UI components | [VERIFIED: package.json] |
| Vitest | (existing) | Unit + RTL tests | [VERIFIED: e2e/ + existing `.test.tsx` files use vitest patterns] |
| Playwright | (existing) | E2E tests | [VERIFIED: `leanshot/playwright.config.ts` exists] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pg_cron + `vault.decrypted_secrets` | shipped | Cron-callable Edge Fns | Only if a periodic reconciliation cron is needed for lifetime_purchases drift (NOT required for v1.3) |
| net.http_post (pg_net) | shipped | DB-driven Slack alerts | Optional path if Lifetime-purchase alert fires from DB trigger instead of Edge Fn. Edge Fn path preferred (see below). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Lifetime as new `tier_effective` UNION ALL row | Lifetime as a `subscriptions` row with `status='lifetime'` (no separate table) | Worse — overloads the `subscriptions` table semantics ("active" + "expiry" become meaningless); breaks Phase 19's `MAX(current_period_end)` reconciliation logic. Reject. |
| `grandfathered_prices` keyed on `(cohort_id, stripe_price_id)` | Keyed on `(cohort_id)` with single `stripe_price_id` column | CONTEXT D-03 explicitly says "operator sets prices for cohorts" (plural prices per cohort possible via effective_from/until ranges). Keep both columns + a uniqueness check on `(cohort_id, stripe_price_id, effective_from)`. |
| `current_user_has_pro()` SECDEF function | Inline `EXISTS(SELECT FROM tier_effective WHERE user_id=auth.uid() AND has_active)` in each RLS policy | Worse — denormalizes the predicate across 3+ tables; also Phase 28 SECDEF pattern is the established analog. Keep SECDEF function. |
| 60s in-memory cache | Redis cache | Out of scope per CONTEXT deferred-list; per-Fn LRU bounded at 10k entries is sufficient (Phase 36 cooldown-cache pattern). |

**Installation:** No new packages. All dependencies already installed.

**Version verification:**
```bash
npm view stripe version  # → 22.1.1 (latest npm)
# Edge Fns pin stripe@19 via esm.sh (verified): matches package.json "stripe": "^19.0.0"
```
Per [VERIFIED: 2026-05-22 via local `grep`], Phase 14/19/40 all use `https://esm.sh/stripe@19?target=denonext` + `apiVersion: '2026-04-22.dahlia'`. Phase 43 plans MUST pin the same import + apiVersion (do NOT bump to stripe@22 — Phase 40 just shipped with v19, bumping mid-milestone is out of scope).

## Architecture Patterns

### System Architecture Diagram

```
[Pricing page] ──────────┐
                         │ supabase.functions.invoke('stripe-checkout/session', { plan: 'lifetime', promo_code? })
                         ▼
                ┌─────────────────────────┐
                │ stripe-checkout Edge Fn │ ── 70% combined-discount cap validator (D-07) ──┐
                │ ─ resolve_user_effective_price (D-03 grandfathered)                       │
                │ ─ if plan='lifetime': mode='payment' + one-time Lifetime price            │
                │ ─ else: mode='subscription' (existing path)                                │
                └────────────┬────────────┘                                                  │
                             │                                                                │
                             ▼ stripe.checkout.sessions.create                             FAIL
                       Stripe Checkout                                                        │
                             │                                                                ▼
                             ▼ session.completed                                  user-visible: "discount exceeds max"
              ┌──────────────────────────┐
              │ stripe-webhook Edge Fn   │ ── existing tier_kind switch
              │ checkout-session-completed.ts │ ── ADD `tier_kind='lifetime'` branch
              └──────────┬───────────────┘
                         │
                         ▼ admin.from('lifetime_purchases').upsert({...}, onConflict:'stripe_payment_intent_id')
                    Postgres
                         │
                         ▼  triggers (optional) → slack-alert-experiments Fn (Lifetime purchase alert)
                                                  POST to SLACK_WEBHOOK_EXPERIMENTS_URL
                         │
                         ▼ tier_effective view UNIONs subscriptions + lifetime_purchases
                ┌───────────────────────────────────────────┐
                │ Consumers:                                │
                │  - community_spaces RLS                   │
                │  - courses RLS                            │
                │  - events RLS                             │
                │  - PaywallGate (variant=pro_only_resource)│
                │  - LIFETIME badge UI                      │
                │  All check current_user_has_pro()         │
                │  (SECDEF, reads tier_effective)           │
                └───────────────────────────────────────────┘
```

Coupon-stacking path (MEMBER-03):
```
[checkout-create with promo_code]
   │
   ▼ stripe.checkout.sessions.create with discounts:[{coupon:<promo>}] + subscription_data.trial_period_days
   │
   ▼ session.completed → subscription created with promo coupon
   │
   ▼ user later triggers SAVE-offer (Phase 40)
   │
   ▼ cancellation-accept-offer → applyDiscount(subId, saveCoupon)
       — APPENDS to existing discounts[] array (Phase 40 D-14 verified)
       — checks combined effective % ≤ 70% (NEW: Phase 43 D-07)
       — clips SAVE-offer side if > 70%
   │
   ▼ subsequent invoices apply both coupons multiplicatively (Stripe native)
```

### Recommended Project Structure

```
supabase/migrations/
├── 20270715000001_p43_lifetime_purchases.sql        # MEMBER-01
├── 20270715000002_p43_grandfathered_prices.sql      # MEMBER-02 schema
├── 20270715000003_p43_tier_effective_view_v2.sql    # MEMBER-01 view replacement
├── 20270715000004_p43_current_user_has_pro_fn.sql   # MEMBER-04 SECDEF
├── 20270715000005_p43_grandfathered_prices_rpcs.sql # MEMBER-02 admin write RPCs
└── 20270715000006_p43_resolve_user_effective_price.sql # MEMBER-02 checkout helper

supabase/functions/
├── stripe-webhook/events/checkout-session-completed.ts   # EXTEND: add lifetime branch
├── stripe-checkout/index.ts                              # EXTEND: lifetime mode + 70% cap + grandfathered resolver
└── slack-alert-experiments/index.ts                      # REUSE for Lifetime alert (no Fn changes)

leanshot/src/components/paywall/
└── PaywallGate.tsx                                       # EXTEND: gating_reason prop

leanshot/src/admin/modules/billing/
└── GrandfatheredPricesPage.tsx                           # NEW
└── GrandfatheredPricesPage.test.tsx                      # NEW

leanshot/src/lib/admin/modules.ts                         # EXTEND: route to grandfathered-prices sub-page

leanshot/src/lib/entitlement/
├── current-user-has-pro.ts                               # NEW client-side wrapper (60s Map cache)
└── current-user-has-pro.test.ts
```

### Pattern 1: `tier_effective` View Extension (UNION ALL)
**What:** Replace existing view with one that UNIONs subscriptions + lifetime_purchases.
**When to use:** MEMBER-01 ships this exact pattern.
**Example:**
```sql
-- Source: synthesized from 20270101000004_tier_effective_view.sql + D-01/D-02
DROP VIEW IF EXISTS public.tier_effective CASCADE;  -- views depending on it must be re-granted

CREATE VIEW public.tier_effective
  WITH (security_invoker = true)
AS
WITH sub_rows AS (
  SELECT
    user_id,
    current_period_end           AS effective_period_end,
    status IN ('active','trialing')      AS row_active,
    status IN ('past_due','unpaid')      AS row_past_due,
    provider                     AS row_provider,
    CASE
      WHEN status = 'trialing' THEN 'trial'
      WHEN status IN ('active','past_due','unpaid') THEN 'pro'
      ELSE 'free'
    END                          AS row_tier_label
  FROM public.subscriptions
  WHERE user_id IS NOT NULL
),
lifetime_rows AS (
  SELECT
    user_id,
    NULL::timestamptz            AS effective_period_end,  -- permanent → no expiry
    TRUE                         AS row_active,
    FALSE                        AS row_past_due,
    'stripe'::text               AS row_provider,
    'lifetime'::text             AS row_tier_label
  FROM public.lifetime_purchases
),
all_rows AS (
  SELECT * FROM sub_rows
  UNION ALL
  SELECT * FROM lifetime_rows
)
SELECT
  user_id,
  MAX(effective_period_end)                                   AS effective_period_end,
  BOOL_OR(row_active)                                          AS has_active,
  BOOL_OR(row_past_due)                                        AS has_past_due,
  (ARRAY_AGG(row_provider ORDER BY effective_period_end DESC NULLS FIRST))[1]
                                                               AS winning_provider,
  -- Tier-label priority: lifetime > pro > trial > free.
  CASE
    WHEN BOOL_OR(row_tier_label = 'lifetime') THEN 'lifetime'
    WHEN BOOL_OR(row_tier_label = 'pro')      THEN 'pro'
    WHEN BOOL_OR(row_tier_label = 'trial')    THEN 'trial'
    ELSE 'free'
  END                                                          AS tier_label
FROM all_rows
GROUP BY user_id;

COMMENT ON VIEW public.tier_effective IS
  'P43 MEMBER-01: extends P19 tier_effective with lifetime_purchases. has_active=true for both pro+lifetime; tier_label distinguishes (free/trial/pro/lifetime). lifetime rows have NULL effective_period_end (permanent).';

GRANT SELECT ON public.tier_effective TO authenticated;
```
**Sanity:** `MAX(effective_period_end)` of `NULL` (lifetime) returns `NULL` for groups containing only lifetime; for mixed groups, the non-NULL subscription end wins. `NULLS FIRST` in ARRAY_AGG order means lifetime's NULL sorts first → `winning_provider='stripe'` for lifetime-only users. Plan-checker MUST verify view drop+recreate handles dependent views (cohort_profile_view at `20270602000010_cohort_definitions.sql:119` references `public.tier_effective t` — Plan must `DROP VIEW ... CASCADE` + recreate cohort_profile_view OR widen MEMBER-02 RPCs to re-grant).

### Pattern 2: Webhook Lifetime Branch Extension
**What:** Add `tier_kind='lifetime'` arm to existing `if/else if` chain in `checkout-session-completed.ts`.
**Example:**
```typescript
// Source: synthesized from supabase/functions/stripe-webhook/events/checkout-session-completed.ts:18 + D-02
// (existing 'web' branch at lines 18-49; existing 'clinic' branch at lines 50-87; new branch added before final else)
} else if (meta.tier_kind === 'lifetime') {
  // P43 MEMBER-01: one-time payment grants permanent Pro entitlement.
  // Idempotency key = stripe_payment_intent_id (D-02).
  const paymentIntentId = session.payment_intent as string;
  const amountTotal = session.amount_total ?? 0;
  const { error: lifeErr } = await admin.from('lifetime_purchases').upsert(
    {
      user_id: meta.user_id,
      stripe_payment_intent_id: paymentIntentId,
      stripe_customer_id: customerId,
      paid_at: new Date().toISOString(),
      amount_cents: amountTotal,
      metadata: { stripe_session_id: session.id },
    },
    { onConflict: 'stripe_payment_intent_id', ignoreDuplicates: true },
  );
  if (lifeErr) {
    console.error('[stripe-webhook/checkout-completed] lifetime_purchases upsert', lifeErr.message);
    throw new Error('lifetime-purchases-upsert-failed');
  }
  // P43: fire Slack alert via existing slack-alert-experiments Fn.
  // (Recommendation: do this asynchronously via EdgeRuntime.waitUntil OR inline net.http_post — see Pattern 4 below.)
}
```

### Pattern 3: `current_user_has_pro()` SECDEF Function (RLS Predicate)
**What:** Stable SECDEF function consumed by RLS policies on community_spaces / courses / events. STABLE marker enables policy inlining.
**Example:**
```sql
CREATE OR REPLACE FUNCTION public.current_user_has_pro()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    (SELECT has_active FROM public.tier_effective WHERE user_id = auth.uid()),
    false
  );
$$;
COMMENT ON FUNCTION public.current_user_has_pro() IS
  'P43 MEMBER-04: RLS predicate. Returns true if auth.uid() has has_active in tier_effective '
  '(covers pro + lifetime + trialing per P19 D-04). Marked STABLE so Postgres can inline at policy eval.';
REVOKE ALL ON FUNCTION public.current_user_has_pro() FROM public;
GRANT EXECUTE ON FUNCTION public.current_user_has_pro() TO authenticated;
```

> CRITICAL — [[feedback_rpc_auth_uid_vs_service_role_mismatch]]: This SECDEF reads `auth.uid()`. It CANNOT be invoked from service-role Edge Fn contexts (cron, fire-and-forget) — those have no `auth.uid()`. For service-role consumers, expose a sibling `user_has_pro(p_user_id uuid)` that takes the user_id as an explicit parameter. Plan-checker MUST verify Phase 43 ships BOTH variants OR explicitly documents that no service-role caller needs the gate.

### Pattern 4: Coupon Stacking (`discounts[]` Append) — REUSE Phase 40
**What:** Existing `apply-discount.ts` already implements the array-append pattern. Phase 43 reuses it verbatim from the coupon-driven Pro-upgrade path. The 70% cap is the only NET-NEW logic.
**Example (verbatim from `supabase/functions/cancellation-accept-offer/apply-discount.ts:36-58`):**
```typescript
const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['discounts'] });
const discounts = (sub.discounts ?? []) as Array<string | Stripe.Discount>;
const existing = discounts.map((d) => {
  if (typeof d === 'string') return { coupon: d };
  const couponField = d.coupon;
  if (typeof couponField === 'string') return { coupon: couponField };
  return { coupon: (couponField as Stripe.Coupon).id };
});
// NEW for P43 (D-07): compute combined effective discount; clip lower-priority if > 70%.
await stripe.subscriptions.update(subscriptionId, {
  discounts: [...existing, { coupon: newCouponId }],
});
```

### Pattern 5: 70% Combined-Discount Cap Algorithm
**What:** Server-side validator BEFORE Stripe Checkout Session create (D-07) OR before `subscriptions.update` for SAVE-offer compounding.
**Algorithm:**
```typescript
// Source: synthesized from D-06 multiplicative compound + D-07 70% cap
// total_discount = 1 - (1-d1)(1-d2) for two-discount stack
// If total_discount > 0.70, clip lower-priority discount such that the equation holds.

function computeStackedDiscount(promoPct: number, saveOfferPct: number): { combinedPct: number; clipped: boolean; finalSavePct: number } {
  // SAVE-offer takes precedence over promo code for the clipping calculation (CONTEXT D-07).
  // i.e., if cap breached, KEEP saveOfferPct, REDUCE promoPct.
  const naiveCombined = 1 - (1 - promoPct) * (1 - saveOfferPct);
  if (naiveCombined <= 0.70) return { combinedPct: naiveCombined, clipped: false, finalSavePct: saveOfferPct };
  // Solve: 0.70 = 1 - (1 - clippedPromo)(1 - saveOfferPct) → clippedPromo = 1 - 0.30/(1 - saveOfferPct)
  const clippedPromo = 1 - 0.30 / (1 - saveOfferPct);
  return { combinedPct: 0.70, clipped: true, finalSavePct: saveOfferPct /* unchanged */ };
}
```
**Placement:** in `supabase/functions/stripe-checkout/index.ts` BEFORE `stripe.checkout.sessions.create` AND in `supabase/functions/cancellation-accept-offer/index.ts` BEFORE `applyDiscount` call.
**CRITICAL clarification of D-07:** CONTEXT says "SAVE-offer takes precedence over promo code for the clipping calculation". That means in a Pro-upgrade-coupon + SAVE-offer-stack scenario, the SAVE-offer keeps full effect and the user's promo code is reduced. NOT the inverse. Plan-checker MUST verify the algorithm honors this direction.

### Pattern 6: Trial Extension via subscription.trial_end (REUSE Phase 40)
**What:** Existing `apply-extended-trial.ts` is the verbatim implementation. Phase 43 reuses it for the 7-day trial extension.
**Idempotency:** D-08 specifies idempotency on `(subscription_id, promo_code_id)`. Phase 40's implementation has no idempotency layer (cancellation-accept-offer enforces single-take via `cancellation_offers_log`). Phase 43 MEMBER-03 MUST add a `promo_trial_extensions_log(subscription_id, promo_code_id, applied_at)` table with UNIQUE(subscription_id, promo_code_id) so retries don't double-extend. NEW migration.

### Anti-Patterns to Avoid
- **DO NOT** add lifetime as a `subscriptions` row with synthetic `status='active'` + far-future `current_period_end`. Breaks P19's `MAX(current_period_end)` reconciliation; creates phantom Stripe sub IDs that webhooks can't find.
- **DO NOT** call `current_user_has_pro()` from a service-role context (cron, admin RPC running as `postgres`). Use the explicit-param variant. [[feedback_rpc_auth_uid_vs_service_role_mismatch]]
- **DO NOT** ship `pro_only` columns as defensive `ALTER TABLE IF EXISTS community_spaces` migrations. Tables don't exist on main; CONTRACT them to Phase 44/46/47. (See OQ-2 below.)
- **DO NOT** drop+recreate `tier_effective` without re-checking dependents. `cohort_profile_view` references it (verified at `20270602000010_cohort_definitions.sql:119`). Plan MUST `DROP VIEW ... CASCADE` + recreate cohort_profile_view OR re-grant via the same migration. Plan-checker BLOCKER.
- **DO NOT** stack two Stripe Coupons on a single Subscription via `coupon` singular field (legacy form overwrites). Always use `discounts[]` array (Phase 40 D-14 pattern).
- **DO NOT** apply the 70% cap AFTER `stripe.subscriptions.update` — Stripe accepts the call, then mid-cycle finance becomes invalid. Always validate BEFORE.
- **DO NOT** mint a new `slack-alert-experiments` Fn. CONTEXT specifics say "Slack alert on Lifetime purchase fires to `#growth-experiments` per Phase 39 D-04 single-channel pattern" — reuse the Phase 39 Edge Fn (or its `net.http_post` analog from `20270708*` migrations).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Coupon stacking on Stripe Subscription | Custom invoice-line-item discount writer | Existing `apply-discount.ts` from cancellation-accept-offer (Phase 40) | Already handles string-vs-object coupon expansion (A1 ambiguity); shipped; tested. |
| Trial extension push | Custom `subscriptions.update({trial_end})` call site | Existing `apply-extended-trial.ts` from cancellation-accept-offer (Phase 40) | Already handles "in-trial vs out-of-trial" base calc + `proration_behavior:'none'`. |
| 35%/70% cap clamp helper | New `clampCombinedDiscount` function from scratch | `clampSavePct` from `supabase/functions/_shared/cancellation-types.ts` (Phase 40) — adapt for 70% cap | Single source of clamp math; consistent with Phase 40 SAVE-offer story. |
| Slack alert dispatcher | New `slack-alert-lifetime-purchase` Fn | Reuse `slack-alert-experiments` Fn (Phase 39) with `kind='lifetime_purchase'` payload variant | CONTEXT D-04 single-channel pattern; SLACK_WEBHOOK_EXPERIMENTS_URL already a Function Secret. |
| Cohort-membership lookup | New `is_user_in_cohort()` SQL helper | `public.cohort_is_member(p_user_id, p_cohort_id)` SECDEF (Phase 27) — verified at `20270602000011*:114-139`, granted to authenticated | Already exists; consumer-facing boolean helper. |
| Webhook idempotency | Custom event-id dedupe table | `ON CONFLICT (stripe_payment_intent_id) DO NOTHING` on lifetime_purchases | Phase 14 webhook precedent: upsert with `onConflict:'id'` on subscriptions table. Same pattern, different key. |
| Admin module-shell routing | New SPA router | Existing `ADMIN_MODULES` manifest at `leanshot/src/lib/admin/modules.ts:153` + sub-page mounting | [[feedback_admin_module_manifest_vs_router_branch_drift]] — sub-page is a child route under the existing `billing` module entry. |

**Key insight:** Phase 43 is mostly composition of shipped Phase 14/19/27/28/39/40 patterns. The genuinely NEW surfaces are 4 files: (1) lifetime_purchases table + RLS, (2) grandfathered_prices table + RLS + admin RPCs, (3) tier_effective view replacement, (4) current_user_has_pro() SECDEF.

## Runtime State Inventory

> Phase 43 is GREENFIELD (no rename/refactor/migration). The single non-obvious carry-over is the `tier_effective` view replacement (DROP + RECREATE with CASCADE — see Pitfall 1 below).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 43 introduces new tables (lifetime_purchases, grandfathered_prices) but doesn't rename or migrate any existing rows. | None. |
| Live service config | Stripe Dashboard MUST have: (1) Lifetime Product + Price (one-time, e.g. $499); (2) any grandfathered Price objects pre-created. | Operator must pre-create in Stripe Dashboard BEFORE plans run. Phase plans MUST include a deploy-step check (curl `/v1/prices/{id}` validates existence). |
| OS-registered state | None. | None. |
| Secrets/env vars | `STRIPE_PRICE_LIFETIME` (NEW Function Secret) — referenced by stripe-checkout Fn via env(). SLACK_WEBHOOK_EXPERIMENTS_URL already exists (verified: Phase 39 ships it). | Plan MUST set STRIPE_PRICE_LIFETIME via `supabase secrets set` AND add a fallback to graceful-fail if missing (vendor-gated send pattern from MEMORY.md). |
| Build artifacts | None — TS/SQL files only. | None. |

## Common Pitfalls

### Pitfall 1: `DROP VIEW tier_effective` without CASCADE breaks cohort_profile_view
**What goes wrong:** `CREATE OR REPLACE VIEW` won't work because the column-set changes (adding `tier_label`); must drop. But `cohort_profile_view` at `20270602000010_cohort_definitions.sql:119` left-joins `public.tier_effective t`. Plain DROP errors out.
**Why it happens:** Postgres view dependency tracking.
**How to avoid:** `DROP VIEW public.tier_effective CASCADE;` then recreate BOTH views in the same migration (re-create tier_effective first, then cohort_profile_view re-CREATE with original column set + new tier_label join column if useful). Plan 43-01 OR a dedicated 43-01b migration MUST handle this.
**Warning signs:** Migration apply error `cannot drop view tier_effective because other objects depend on it`.

### Pitfall 2: Postgres `dollar-quote` nesting inside cron body
[[reference_postgres_dollar_quote_nesting_in_cron_body]] — N/A for Phase 43 (no cron) unless plan-checker decides to add a lifetime-purchase Slack alert via pg_cron + `net.http_post`. If so, use named tags `$cron$...$lifetime$`.

### Pitfall 3: Migration timestamp collision with Phase 39 (planned but not shipped)
**What goes wrong:** Phase 39 will use `20270714*` window per its 39-CONTEXT.md migrations note. Phase 51 reservations exist further out. Phase 43 collides if it uses anything ≤ 20270714.
**Why it happens:** Local migration files must be strictly AFTER remote tail.
**How to avoid:** Phase 43 uses `20270715000001..06` (verified remote tail via `supabase db query --linked`: `20270709000008`; Phase 39 reserves `20270714*`; Phase 51 reserves later windows per STATE). [[reference_supabase_back_dated_migration_blocks_push]]
**Warning signs:** `supabase db push` refusing to apply with "back-dated migration" error.

### Pitfall 4: SECDEF function called from service-role context returns NULL `auth.uid()`
**What goes wrong:** `current_user_has_pro()` SECDEF reads `auth.uid()`; in cron/admin Fn contexts this returns NULL → function returns false → community/course/event resources incorrectly hidden from admin views.
**Why it happens:** [[feedback_rpc_auth_uid_vs_service_role_mismatch]] — Phase 37-04 caught this exact issue at execute-time.
**How to avoid:** Ship a SECOND function `user_has_pro(p_user_id uuid)` that takes explicit user_id; admin-side / service-role callers use that. Document the contract in 43-RESEARCH.md (this section) and in the SECDEF function comment so plan-checker can grep it.
**Warning signs:** Admin sees empty community_spaces list in /admin/spaces. RLS service-role bypass exists but Phase 43's pattern needs both forms.

### Pitfall 5: Phase 44/46/47 ship `pro_only` column WITHOUT the RLS policy
**What goes wrong:** Phase 43 ships the `current_user_has_pro()` function. Phase 44 ships community_spaces table. If Phase 44's plan doesn't include `CREATE POLICY pol_community_spaces_pro_only ON public.community_spaces FOR SELECT USING (NOT pro_only OR public.current_user_has_pro())`, the gating is bypassable.
**Why it happens:** Cross-phase coordination gap.
**How to avoid:** Phase 43 ships a CONTRACT.md (`43-PRO-GATING-CONTRACT.md`) consumed by Phases 44/46/47 planners, naming the EXACT migration SQL each must include. Plan-checker for those downstream phases must grep for the policy name. [[feedback_planner_prompt_explicit_reuse_targets]]
**Warning signs:** Phase 44 plan-check passes without containing `current_user_has_pro` in any migration file.

### Pitfall 6: Multiplicative-vs-additive discount math ambiguity
**What goes wrong:** D-06 says MULTIPLICATIVE: `total = price × (1-d1) × (1-d2)`. Naive impl computes ADDITIVE: `total = price × (1 - d1 - d2)`. Different result. 30%+25% additive = 55%; multiplicative = 47.5%.
**Why it happens:** Stripe's native single-coupon behavior is multiplicative when discounts[] has multiple items, but the cap-clamp math must match.
**How to avoid:** Pattern 5 algorithm above uses `1 - (1-d1)(1-d2)` — verified multiplicative. Plan-checker MUST verify the algorithm in plan code matches this exact form.
**Warning signs:** Test assertions like "30% + 25% = 55% cap-breached?" — should be 47.5%, NOT cap-breached.

### Pitfall 7: 70% cap clip direction reversal
**What goes wrong:** Algorithm clips the WRONG side. D-07 says SAVE-offer takes precedence; clip the PROMO. Reversing this means a user with a 50% promo + SAVE-offer would see the SAVE-offer clipped (bad UX during cancellation save) instead of the promo clipped.
**Why it happens:** Ambiguity in "lower-priority discount".
**How to avoid:** Plan code MUST comment-document the direction: "SAVE-offer preserved; promo clipped". Unit test asserts both directions.
**Warning signs:** Test "user has 50% promo + 30% save → final 65%" passes (correct: SAVE preserved at 30%, promo clipped to 1 - 0.30/0.70 = 57.1%, final = 1 - (1-0.571)(1-0.30) = 70%). Plan-checker verifies the unit-test numeric matches.

### Pitfall 8: PaywallGate prop shape extension breaks existing call sites
**What goes wrong:** Phase 39 PaywallGate has props `{ content, children, ... }` (verified at 39-04-PLAN.md:124-125). Adding `gating_reason: 'pro_only_resource'` as REQUIRED breaks existing call sites.
**Why it happens:** Required new prop on existing component.
**How to avoid:** Make `gating_reason?: 'activation_paywall' | 'pro_only_resource'` OPTIONAL with default `'activation_paywall'` (existing behavior). New call sites pass `'pro_only_resource'`.
**Warning signs:** TS compile errors on existing PaywallGate consumers.

### Pitfall 9: In-memory cache leaks state across requests on same Edge Fn instance
**What goes wrong:** Module-scope `Map` survives between requests on Deno Deploy isolates. If two users hit the same isolate, the second user's gate check reads the first user's tier.
**Why it happens:** Per-instance caching with shared module scope.
**How to avoid:** Cache key MUST be user_id (not a global flag); 60s TTL per entry; LRU eviction at 10k entries. Phase 36 cooldown-cache pattern is the analog.
**Warning signs:** Tier-effective-mismatch bugs in integration tests; lifetime users see free-tier paywall.

### Pitfall 10: Lifetime checkout uses subscription_data accidentally
**What goes wrong:** `stripe-checkout/index.ts` currently always sets `mode: 'subscription'` + `subscription_data:{metadata:{tier_kind:'web'}}`. A lifetime branch that forgets to set `mode: 'payment'` creates a recurring sub that doesn't exist in `lifetime_purchases` table.
**Why it happens:** Mode-field is required at session-create; default isn't 'payment'.
**How to avoid:** Lifetime branch MUST set BOTH `mode:'payment'` AND `payment_intent_data:{metadata:{tier_kind:'lifetime', user_id}}` (not `subscription_data`). The webhook handler reads `session.subscription_data?.metadata ?? session.metadata` — for one-time payments, metadata lives on the SESSION root, not subscription_data.
**Warning signs:** Webhook test fails with "tier_kind not in {web,clinic,lifetime}".

## Code Examples

### `lifetime_purchases` Table (Net-New)
```sql
-- Source: synthesized from D-02 idempotency-key + Phase 14 subscriptions table pattern
CREATE TABLE IF NOT EXISTS public.lifetime_purchases (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_payment_intent_id    text NOT NULL UNIQUE,  -- idempotency key (D-02)
  stripe_customer_id          text NOT NULL,
  paid_at                     timestamptz NOT NULL DEFAULT now(),
  amount_cents                bigint NOT NULL CHECK (amount_cents >= 0),
  refunded_at                 timestamptz,  -- nullable; operator sets via manual script if refunded (deferred-list item)
  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lifetime_purchases_user_idx ON public.lifetime_purchases(user_id) WHERE refunded_at IS NULL;
ALTER TABLE public.lifetime_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY pol_lifetime_purchases_self_read
  ON public.lifetime_purchases FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
-- No INSERT/UPDATE/DELETE policies — service-role webhook is sole writer (Pattern S2).
COMMENT ON TABLE public.lifetime_purchases IS
  'P43 MEMBER-01: one-time-payment Lifetime entitlement source-of-truth. Idempotent on stripe_payment_intent_id. tier_effective UNIONs WHERE refunded_at IS NULL.';
```

### `grandfathered_prices` Table (Net-New)
```sql
CREATE TABLE IF NOT EXISTS public.grandfathered_prices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id           uuid NOT NULL REFERENCES public.cohort_definitions(id) ON DELETE CASCADE,
  stripe_price_id     text NOT NULL,  -- pre-created in Stripe Dashboard
  effective_from      timestamptz NOT NULL DEFAULT now(),
  effective_until     timestamptz,   -- nullable = open-ended
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cohort_id, stripe_price_id, effective_from)
);
ALTER TABLE public.grandfathered_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY pol_grandfathered_prices_admin_read
  ON public.grandfathered_prices FOR SELECT
  TO authenticated
  USING (public.is_admin_at_least('admin'::public.admin_role));
-- NO write policies — SECDEF RPCs are sole writers (grandfathered_price_create / _delete / _update).
COMMENT ON TABLE public.grandfathered_prices IS
  'P43 MEMBER-02: per-cohort grandfathered Stripe price overrides. resolve_user_effective_price() consumes this via cohort_is_member.';
```

### `resolve_user_effective_price()` SECDEF Helper (For checkout-init)
```sql
-- Source: D-03 "checkout-init Edge Fn resolves which stripe_price_id to use per user via cohort membership lookup"
CREATE OR REPLACE FUNCTION public.resolve_user_effective_price(
  p_user_id     uuid,
  p_plan        text  -- e.g. 'plus_monthly', 'plus_yearly'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_default_price_id  text;
  v_grandfathered    text;
BEGIN
  -- Default price from env-driven app-config table OR an inline lookup.
  -- (Plan can derive this from Stripe Function Secret + a name→id map table; recommendation is a small public.stripe_price_lookup(plan_name text PK, stripe_price_id text) table seeded at deploy.)
  SELECT stripe_price_id INTO v_default_price_id
    FROM public.stripe_price_lookup
    WHERE plan_name = p_plan;
  -- Grandfathered override: ANY active cohort the user belongs to with an active override row wins.
  -- (If multiple cohorts → first-active by effective_from DESC. Plan-checker MUST surface this tie-breaker explicitly.)
  SELECT gp.stripe_price_id INTO v_grandfathered
    FROM public.grandfathered_prices gp
    WHERE public.cohort_is_member(p_user_id, gp.cohort_id)
      AND gp.effective_from <= now()
      AND (gp.effective_until IS NULL OR gp.effective_until > now())
    ORDER BY gp.effective_from DESC
    LIMIT 1;
  RETURN COALESCE(v_grandfathered, v_default_price_id);
END;
$$;
COMMENT ON FUNCTION public.resolve_user_effective_price(uuid, text) IS
  'P43 MEMBER-02: returns the Stripe price_id the user should be charged. Grandfathered override wins; falls back to default plan price. Called from stripe-checkout Edge Fn BEFORE sessions.create.';
GRANT EXECUTE ON FUNCTION public.resolve_user_effective_price(uuid, text) TO authenticated;
```
**OPEN: tie-breaker rule** when user is in MULTIPLE grandfathered cohorts — the SQL above picks MOST-RECENT effective_from. Plan-checker MUST confirm this is intentional (LIFO grandfathering). Alternative: lowest-price wins (user-favorable). RESOLVED: most-recent (operational simplicity; operator controls effective_from per cohort).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Stripe `coupon: <id>` singular field on Subscription | `discounts:[{coupon: <id>}, ...]` array | Stripe API 2025-03+ | Phase 40 D-14 codified; Phase 43 inherits |
| `current_period_end` int | `current_period_end` timestamptz | Stripe API 2024+ | Subscriptions table already uses timestamptz |
| `coupon` lookup via legacy field | `expand: ['discounts']` on retrieve | Stripe API 2025-03+ | `apply-discount.ts:39-41` already uses this |
| Lifetime as recurring sub with far-future end | Lifetime as mode='payment' + separate table | Industry pattern circa 2024 | Phase 43 D-01/D-02 codifies for LeanShot |

**Deprecated/outdated:**
- `subscription.coupon` (singular) — Stripe still accepts but `discounts[]` is preferred and required for stacking.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| supabase CLI | Migration push | ✗ (not on $PATH; via `npx supabase`) | — | Use `npx supabase` (verified working in this research session for `db query --linked`) |
| Deno runtime | Edge Fn local test | ✓ (via `$HOME/.deno/bin/deno`) | (per MEMORY.md) | — |
| Node 22 | Vite build / Vitest | ✓ | v22.18.0 | — |
| npm | Lockfile-based install | ✓ | 10.9.2 (with Node 22) | — |
| Stripe SDK (esm.sh) | Edge Fn imports | ✓ — pinned to `https://esm.sh/stripe@19?target=denonext` apiVersion `2026-04-22.dahlia` | 19.x | — |
| Stripe Dashboard access | Operator pre-creates Lifetime Product/Price + grandfathered Price objects | OPERATOR-DEPENDENT | — | Phase plans gate on operator step (deploy notes); checkout-create has graceful 503 if STRIPE_PRICE_LIFETIME unset (vendor-gated send pattern) |
| SLACK_WEBHOOK_EXPERIMENTS_URL Function Secret | Slack alert on Lifetime purchase | ✓ (Phase 39 ships this) | — | — |

**Missing dependencies with no fallback:** None for plan-time research; operator-side Stripe Dashboard pre-creation is a deploy-step gate, not a research gate.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (unit/component, JS/TS) + Playwright (e2e); Deno test for Edge Fn (`.test.ts` sibling files) |
| Config file | `leanshot/vite.config.ts` (Vitest reads from same — verified by existence of `*.test.tsx` files); `leanshot/playwright.config.ts`; per-fn `supabase/functions/<fn>/deno.json` |
| Quick run command | `cd leanshot && npx vitest run <path>` |
| Full suite command | `cd leanshot && npx vitest run && npx playwright test && (cd .. && for d in supabase/functions/{stripe-webhook,stripe-checkout}; do $HOME/.deno/bin/deno test --allow-all --no-check $d/; done)` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| MEMBER-01 | tier_effective view returns has_active=true + tier_label='lifetime' for user with lifetime_purchases row | integration (pgTAP via `supabase test db` OR vitest-against-live RLS suite) | `cd leanshot && npx vitest run src/lib/entitlement/tier-effective-lifetime.test.ts` | ❌ Wave 0 |
| MEMBER-01 | stripe-webhook lifetime branch upserts lifetime_purchases on checkout.session.completed (mode=payment, tier_kind=lifetime) | unit (Deno) | `$HOME/.deno/bin/deno test --allow-all --no-check supabase/functions/stripe-webhook/events/checkout-session-completed.test.ts` | ✓ (extend existing) |
| MEMBER-01 | webhook is idempotent on stripe_payment_intent_id (replay returns 200, no duplicate row) | unit (Deno) | same as above with `it('idempotent replay does not duplicate row')` | ❌ Wave 0 (extend existing) |
| MEMBER-02 | grandfathered_prices admin RPC create/update/delete enforces admin role | integration (live RLS) | `cd leanshot && npx vitest run src/lib/admin/grandfathered-prices-rls.test.ts` | ❌ Wave 0 |
| MEMBER-02 | resolve_user_effective_price returns grandfathered price when user in active cohort | unit (Deno OR pgTAP) | `$HOME/.deno/bin/deno test --allow-all --no-check supabase/functions/stripe-checkout/resolve-price.test.ts` | ❌ Wave 0 |
| MEMBER-02 | grandfathered user pricing page silently shows grandfathered price (no banner) | e2e (Playwright) | `cd leanshot && npx playwright test e2e/grandfathered-price-silent.spec.ts` | ❌ Wave 0 |
| MEMBER-03 | 70% combined-discount cap clips promo, not SAVE-offer | unit | `cd leanshot && npx vitest run src/lib/checkout/clamp-discount.test.ts` | ❌ Wave 0 |
| MEMBER-03 | trial_end push idempotent on (subscription_id, promo_code_id) | unit (Deno) | `$HOME/.deno/bin/deno test --allow-all --no-check supabase/functions/stripe-checkout/apply-trial-extension.test.ts` | ❌ Wave 0 |
| MEMBER-03 | coupon + SAVE-offer stack multiplicatively in Stripe (live integration) | manual-only (Stripe test mode) | — | DOC manual test only — Stripe test mode required + operator-clicks-through |
| MEMBER-04 | community_spaces RLS denies SELECT for free-tier user when pro_only=true | integration (live RLS) | `cd leanshot && npx vitest run src/lib/entitlement/community-spaces-rls.test.ts` | ❌ Wave 0 (depends on Phase 44 table existence — see OQ-2) |
| MEMBER-04 | current_user_has_pro() returns true for lifetime user, false for free user | unit (pgTAP) | `cd leanshot && npx vitest run src/lib/entitlement/current-user-has-pro.test.ts` | ❌ Wave 0 |
| MEMBER-04 | PaywallGate variant='pro_only_resource' renders pro-upsell copy + CTA | unit (RTL) | `cd leanshot && npx vitest run src/components/paywall/PaywallGate.test.tsx` | ✓ (extend existing) |
| MEMBER-04 | 60s in-memory cache returns stable value within window; recomputes after TTL | unit | `cd leanshot && npx vitest run src/lib/entitlement/has-pro-cache.test.ts` | ❌ Wave 0 |
| D-13 ↑ MEMBER-04 | LRU eviction at 10k entries | unit | same as above | ❌ Wave 0 |
| D-08 ↑ MEMBER-03 | trial_end push uses proration_behavior='none' | unit (Deno) | trial-extension test asserts arg | ❌ Wave 0 |
| Cross-Decision | Slack alert fires on lifetime_purchases insert (via DB trigger OR Edge Fn inline net.http_post) | unit (Deno or pgTAP) | TBD by plan-checker | ❌ Wave 0 |
| D-11 ↑ MEMBER-04 | API returns `paywall: true` flag for free-tier on pro_only resource | unit (Edge Fn) | per-feature Fn test | ❌ Wave 0 (deferred to Phases 44/46/47 since API endpoints live there) |
| D-12 ↑ MEMBER-04 | Write actions return 403 + `{error:'pro_required'}` for free-tier | unit (Edge Fn) | per-feature Fn test | ❌ Wave 0 (deferred to Phases 44/46/47) |

### Sampling Rate
- **Per task commit:** `cd leanshot && npx vitest run <file>`
- **Per wave merge:** full Vitest + full Playwright + Deno sweep across `stripe-webhook/`, `stripe-checkout/`
- **Phase gate:** Full suite green; live-RLS suite green; manual Stripe-test-mode validation of coupon + SAVE-offer stack (D-06 multiplicative behavior); operator confirms Stripe Dashboard Products

### Wave 0 Gaps
- [ ] `leanshot/src/lib/entitlement/tier-effective-lifetime.test.ts` — covers MEMBER-01 view shape
- [ ] `leanshot/src/lib/entitlement/current-user-has-pro.test.ts` — covers MEMBER-04 SECDEF semantics
- [ ] `leanshot/src/lib/entitlement/has-pro-cache.test.ts` — covers D-13 60s cache + LRU eviction
- [ ] `leanshot/src/lib/checkout/clamp-discount.test.ts` — covers MEMBER-03 D-07 70% cap algorithm
- [ ] `leanshot/src/lib/admin/grandfathered-prices-rls.test.ts` — covers MEMBER-02 admin write RPCs
- [ ] `supabase/functions/stripe-checkout/resolve-price.test.ts` — covers MEMBER-02 resolve_user_effective_price()
- [ ] `supabase/functions/stripe-checkout/apply-trial-extension.test.ts` — covers MEMBER-03 D-08 idempotency
- [ ] `supabase/functions/stripe-webhook/events/checkout-session-completed.test.ts` — EXTEND with lifetime-branch + idempotent-replay tests
- [ ] `leanshot/src/components/paywall/PaywallGate.test.tsx` — EXTEND with `gating_reason='pro_only_resource'` variant test
- [ ] `leanshot/src/admin/modules/billing/GrandfatheredPricesPage.test.tsx` — covers admin UI CRUD
- [ ] `leanshot/e2e/grandfathered-price-silent.spec.ts` — covers MEMBER-02 silent-pricing UX (D-05)
- [ ] No framework install needed — vitest + playwright + deno already in use.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Webhook signature verification (existing `stripe-webhook` already verifies via `stripe.webhooks.constructEvent`); JWT bearer on stripe-checkout (existing) |
| V3 Session Management | yes | RLS-based per-user isolation; lifetime_purchases self-read policy |
| V4 Access Control | yes | RLS on lifetime_purchases (self-only read); grandfathered_prices (admin-only read; SECDEF writes); community/courses/events RLS via `current_user_has_pro()` |
| V5 Input Validation | yes | zod validation on Edge Fn request bodies (existing pattern in stripe-checkout); Stripe webhook payload parsed via SDK (no manual JSON.parse) |
| V6 Cryptography | yes | Stripe webhook signature HMAC verification (existing — `stripe.webhooks.constructEvent` uses STRIPE_WEBHOOK_SECRET) — DO NOT hand-roll |
| V7 Error Handling | yes | Webhook errors must NOT echo Stripe error messages to client (Pattern G); user-facing 70%-cap error message must be sanitized |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Webhook replay attack (idempotency bypass) | Tampering | `ON CONFLICT (stripe_payment_intent_id) DO NOTHING` on lifetime_purchases (D-02) |
| Cross-user lifetime grant via spoofed metadata | Spoofing | Webhook verifies session.customer matches user_id-via-stripe_customers mapping; `auth.uid()` is the only trusted lookup at the API boundary |
| Promo-code abuse stacking with SAVE-offer for 90%+ off | Tampering / EoP | D-07 70% cap; clip lower-priority server-side BEFORE Stripe call |
| Grandfathered price leak via cohort-membership enumeration | Information Disclosure | `cohort_is_member` SECDEF returns boolean only (not contents); `grandfathered_prices` table admin-only read |
| Lifetime purchase fraud (chargeback) | Repudiation | Refund handling deferred to operator-manual per CONTEXT deferred-list; audit log row written |
| Concurrent webhook race on idempotent upsert | Tampering | UPSERT ON CONFLICT serializes at the unique index level (PG default) |
| Service-role Edge Fn calling SECDEF that references auth.uid() | EoP | [[feedback_rpc_auth_uid_vs_service_role_mismatch]] — ship sibling `user_has_pro(p_user_id)` function |
| RLS bypass via stale 60s cache after Pro→Free downgrade | EoP | Bounded staleness per D-13 accepted by user; cache key=user_id; per-Fn isolate cache (no cross-user leakage) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `cohort_profile_view` at `20270602000010_cohort_definitions.sql:119` references `public.tier_effective` and will require CASCADE drop+recreate when view is replaced. | Pitfall 1 | If wrong (e.g., cohort_profile_view was patched to remove the join in a later migration), CASCADE may drop more than intended. **MITIGATION: plan-checker greps live migration set for `public.tier_effective` references before applying the DROP.** |
| A2 | Phase 39 reserves migration window `20270714*` per its planning notes. | Pitfall 3 | If Phase 39 ships with different timestamps, P43's `20270715*` may still be safe but timestamp gap shrinks. **MITIGATION: pre-merge collision check per [[reference_migration_timestamp_collision_precheck]].** |
| A3 | `stripe_price_lookup` is the recommended pattern for default-price-by-plan-name resolution. | Code Examples → resolve_user_effective_price | [VERIFIED CITED: existing pattern from Phase 14 stripe-checkout uses env() helpers like `STRIPE_PRICE_PLUS_MONTHLY` — Phase 43 could either continue the env-helper pattern OR introduce a small lookup table. Either works; planner picks.] |
| A4 | `is_admin_at_least()` SECDEF predicate exists and is the canonical admin-role check. | grandfathered_prices RLS | [VERIFIED: Phase 27 cohort_definitions RLS at `20270602000010_cohort_definitions.sql:71` uses `public.is_admin_at_least('admin'::public.admin_role)` verbatim. Same predicate available for P43.] |
| A5 | Phase 14 webhook upsert uses `onConflict:'id'` (subscriptions PK). Phase 43 lifetime branch must use `onConflict:'stripe_payment_intent_id'` since the new table's PK is uuid + payment_intent is the idempotency key. | Pattern 2 webhook example | [VERIFIED via reading `checkout-session-completed.ts:20-44`] |
| A6 | 60s in-memory cache should be implemented as `Map<userId, {value, expiresAt}>` with LRU eviction; Deno isolate per-instance memory is bounded. | D-13 | Verified Deno deploy isolate behavior is per-instance and persistent across requests on the same isolate; cache MUST key on user_id to avoid leakage. [ASSUMED: 10k entries × ~50 bytes ≈ 500 KB — within isolate memory ceiling.] |
| A7 | Stripe `subscriptions.update({trial_end: <past_ts>})` accepts past values without retroactive proration error. | OQ-3 (RESOLVED) | [VERIFIED indirect: Phase 40 `apply-extended-trial.ts:30-35` sets `baseTrialEnd = sub.trial_end > nowUnix ? sub.trial_end : nowUnix` — i.e., NEVER passes past trial_end; only-forward. P43 D-08 should follow same pattern.] |

## Open Questions (RESOLVED)

### OQ-1: `tier_effective` view replacement — drop+recreate or schema-evolve? [RESOLVED]
**What we know:** Existing view at `public.tier_effective` (P19) has columns: user_id, effective_period_end, has_active, has_past_due, winning_provider. P43 adds `tier_label`. Postgres requires column-suffix superset for `CREATE OR REPLACE VIEW` — adding `tier_label` would work IF the existing column order is preserved AND tier_label is appended.
**RESOLVED:** Use `CREATE OR REPLACE VIEW` with appended `tier_label` column AT THE END of SELECT list. NO need for `DROP CASCADE` since the existing P19 column shape is preserved (verified by re-reading `20270101000004_tier_effective_view.sql:22-33` — columns are: user_id, effective_period_end, has_active, has_past_due, winning_provider). However, since P43 also changes the underlying SOURCE (UNION of subscriptions + lifetime_purchases instead of just subscriptions GROUP BY), the **inner CTE** changes — but the OUTPUT columns can stay in the same order + tier_label appended. Plan-checker MUST verify column-order preservation. Pitfall 1 above is now a soft warning (handle gracefully) not a hard error.

### OQ-2: When to ship `pro_only` columns on community_spaces / courses / events? [RESOLVED]
**What we know:** Tables don't exist on main (Phases 44/46/47 ship them — verified via `ls supabase/migrations/` shows no `community_spaces*` / `courses*` / `events*` files).
**RESOLVED:** Phase 43 ships a **`43-PRO-GATING-CONTRACT.md`** consumed by Phases 44/46/47 planners. The contract specifies:
1. EXACT migration SQL: `ALTER TABLE public.<table> ADD COLUMN pro_only boolean NOT NULL DEFAULT false; CREATE INDEX ... WHERE pro_only=true;`
2. EXACT RLS policy SQL: `CREATE POLICY pol_<table>_pro_only_gate ON public.<table> FOR SELECT TO authenticated USING (NOT pro_only OR public.current_user_has_pro());`
3. Verification grep: each downstream plan-checker greps for `current_user_has_pro` in the relevant migration file. **DO NOT** defensively ship `pro_only` columns from Phase 43 — the policies would be no-ops (no table) and rollback semantics are murky. **Plan-checker BLOCKER:** Phase 43 must not include any `ALTER TABLE community_spaces` / `courses` / `events` statements. Plan 43-05 ships the CONTRACT.md instead.

### OQ-3: Does Stripe accept `subscription.trial_end` push to past timestamps without retroactive proration? [RESOLVED — N/A]
**What we know:** Phase 40 apply-extended-trial.ts always extends FORWARD (never past).
**RESOLVED:** P43 D-08 follows P40 precedent — only forward-extension. No past-timestamp push. Confirmed in Pattern 6.

### OQ-4: Idempotency table for trial-extension via promo code? [RESOLVED]
**What we know:** D-08 says "Idempotent on (subscription_id, promo_code_id) — prevents double-extension on retry". Phase 40 has no such table.
**RESOLVED:** Phase 43 MEMBER-03 ships a NEW table `promo_trial_extensions_log(subscription_id text, promo_code_id text, applied_at timestamptz, PRIMARY KEY(subscription_id, promo_code_id))`. INSERT on apply; ON CONFLICT DO NOTHING returns "already applied" branch. Migration `20270715000007_p43_promo_trial_extensions_log.sql`. RLS service-role only.

### OQ-5: Where does the 70% cap validator live for ongoing SAVE-offer + active promo subscription? [RESOLVED]
**What we know:** D-07 says "in the checkout/invoice Edge Fn". Two distinct callers exist: stripe-checkout (new sub creation) and cancellation-accept-offer (SAVE-offer on existing sub).
**RESOLVED:** Validator lives in BOTH:
1. `stripe-checkout/index.ts` BEFORE `stripe.checkout.sessions.create` — when user has a promo code at signup. Reads any baseline coupon from URL, validates against `clampCombinedDiscount(promo, 0)` (no SAVE-offer at sub creation — single-coupon case). NO cap-relevant logic at signup but the validator hook is in place.
2. `cancellation-accept-offer/index.ts` BEFORE `applyDiscount` — when user has existing promo + SAVE-offer applies. THIS is where the cap actually fires. Validator reads existing `subscription.discounts[]`, computes naive combined %, calls `clampCombinedDiscount`, picks final SAVE-offer coupon. Phase 40 already has `clampSavePct` for the 35% cap; Phase 43 adds 70% cap as a SEPARATE validator (different semantics — 35% is per-take; 70% is per-invoice combined).

### OQ-6: Stripe `mode='payment'` with `discounts[]` parameter — does it accept promo codes on one-time payments? [RESOLVED — N/A]
**What we know:** Lifetime is mode='payment'. Promo codes on lifetime would compound with the one-time amount.
**RESOLVED:** OUT OF SCOPE per CONTEXT deferred-list ("No Pro→Lifetime upgrade credit"; lifetime is a flat-price one-time payment). Plan 43-02 stripe-checkout lifetime branch MUST NOT accept promo_code param in lifetime mode — error out with `lifetime_no_promo_code` if attempted.

### OQ-7: Slack alert dispatch path — Edge Fn or DB trigger? [RESOLVED]
**What we know:** CONTEXT specifics says "Slack alert on Lifetime purchase fires to #growth-experiments per Phase 39 D-04 single-channel pattern".
**RESOLVED:** Inline in the webhook handler (after lifetime_purchases UPSERT succeeds). Pattern: `await fetch(Deno.env.get('SLACK_WEBHOOK_EXPERIMENTS_URL'), {method:'POST', body: JSON.stringify({text:'...'})}).catch(console.error)` wrapped in `EdgeRuntime.waitUntil` so webhook returns 200 immediately. DO NOT use DB trigger + pg_net (adds cron+vault complexity for marginal benefit). Reuse existing `slack-alert-experiments` Fn ONLY if its payload shape matches (verified: it accepts arbitrary text via the v1 contract).

## Sources

### Primary (HIGH confidence)
- `supabase/migrations/20270101000004_tier_effective_view.sql` (lines 22-39) — current view shape
- `supabase/functions/stripe-webhook/index.ts` (lines 64, 134-216) — dispatcher + apiVersion pin
- `supabase/functions/stripe-webhook/events/checkout-session-completed.ts` (lines 18-95) — existing tier_kind switch
- `supabase/functions/stripe-checkout/index.ts` (lines 74-77, 382-442) — env-driven price helpers + Checkout session build
- `supabase/functions/cancellation-accept-offer/apply-discount.ts` (lines 36-58) — discounts[] append pattern
- `supabase/functions/cancellation-accept-offer/apply-extended-trial.ts` (entire file) — trial_end push pattern
- `supabase/migrations/20270602000010_cohort_definitions.sql` (lines 33-43, 91-119) — cohort schema + tier_effective dependency
- `supabase/migrations/20270602000011_cohort_membership_matview.sql` (lines 114-139) — cohort_is_member SECDEF
- `.planning/phases/39-*/39-04-PLAN.md` (lines 9-12, 121-125) — PaywallGate component contract
- `.planning/phases/39-*/39-CONTEXT.md` (line 59) — Slack single-channel pattern
- `.planning/phases/27-*/27-RESEARCH.md` (referenced for cohort patterns)
- Live remote migration tail via `npx supabase db query --linked` → `20270709000008` (verified this session)
- `leanshot/src/lib/admin/modules.ts` (lines 211-219) — billing module manifest entry
- `package.json` (`stripe: ^19.0.0`) + npm registry (`22.1.1` is latest)

### Secondary (MEDIUM confidence)
- Project MEMORY.md cross-references — all explicitly tagged via [[ref]] inline
- Phase 28 RESEARCH.md (line 12-13) — RLS pattern + multi-tenant precedent

### Tertiary (LOW confidence)
- None — all critical claims verified against shipped code/migrations.

## Project Constraints (from CLAUDE.md)

- **Tech stack locked:** React 19 + Vite 6 + TS strict + Tailwind v4 + Zustand. Phase 43's PaywallGate extension + admin GrandfatheredPricesPage MUST use these (no new runtime deps).
- **Local-first preserved:** Phase 43 introduces server-only state (lifetime, grandfathered prices, RLS gating). Local-first dashboard is NOT affected; community/courses/events ARE server-only by nature (Phases 44/46/47).
- **Bundle budgets:** Admin shell 30 kB gz ceiling. GrandfatheredPricesPage MUST lazy-load (consistent with all admin modules at `leanshot/src/lib/admin/modules.ts`). Bundle-budget script gates merge.
- **TS strict:** `noExplicitAny` error-level — PaywallGate prop extension MUST use union type `gating_reason?: 'activation_paywall' | 'pro_only_resource'`, NOT `string`.
- **ESLint `import-x/order` alphabetized:** new imports in extended files MUST sort correctly.
- **No router:** admin sub-pages use the existing pathname-based switch in `AdminShell`; `/admin/billing/grandfathered-prices` is a child route under `billing` module key.
- **GSD workflow enforced:** all file mutations through plan-execute. (Phase 43 plans MUST be created via gsd-plan-phase.)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Stripe SDK + apiVersion pinned verbatim against shipped code; all framework versions verified against package.json + live registry.
- Architecture: HIGH — every pattern derives from a shipped file (P14 webhook, P19 view, P27 cohort, P39 PaywallGate, P40 apply-discount/trial). Net-new surfaces (lifetime_purchases, grandfathered_prices, current_user_has_pro) follow established conventions.
- Pitfalls: HIGH on Pitfalls 1-7 (verified against migrations/Phase memories); MEDIUM on Pitfalls 8-10 (synthesized from CONTEXT + Phase 39 PaywallGate inspection — not directly observed at execute-time but high prior).
- Validation: HIGH — Wave 0 test gap list synthesized from MEMBER-NN + D-NN matrix; covers requirement-level + decision-level signals at the right test-pyramid layer.
- Cross-phase coordination (OQ-2): HIGH — resolution via CONTRACT.md follows [[feedback_planner_prompt_explicit_reuse_targets]] and is enforceable at downstream plan-check time.

**Research date:** 2026-05-22
**Valid until:** 2026-06-21 (30 days; assumes Phase 39 hasn't shipped major changes to PaywallGate contract or stripe-checkout shape; assumes Stripe API version `2026-04-22.dahlia` still current — verify via Context7 if Phase 39 ships earlier with API bump)
