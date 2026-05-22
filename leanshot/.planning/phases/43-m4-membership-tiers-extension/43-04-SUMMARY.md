---
phase: 43-m4-membership-tiers-extension
plan: 04
subsystem: payments
tags: [stripe, lifetime, grandfathered-pricing, discount-stack, idempotency, edge-function]
requires: [43-01, 43-02, 43-03]
provides:
  - stripe-checkout supports `plan: 'lifetime'` with mode='payment'
  - stripe-checkout routes plus/lifetime price via resolve_user_effective_price (grandfathered cohorts)
  - 70%-cap multiplicative discount-stack clamp at both stripe-checkout AND cancellation-accept-offer
  - promo_trial_extensions_log idempotency for cancellation-flow trial extensions (D-08)
affects:
  - supabase/functions/stripe-checkout/index.ts
  - supabase/functions/cancellation-accept-offer/index.ts
tech_stack:
  added:
    - supabase/functions/_shared/clamp-combined-discount.ts (new pure utility)
    - supabase/migrations/20270715000007_p43_promo_trial_extensions_log.sql (new table)
  patterns:
    - vendor-gated-send 503 fallback (Phase 14 + Phase 25 pattern reused)
    - INSERT ... ON CONFLICT DO NOTHING idempotency keyed on (sub, promo)
    - clampCombinedDiscount(clippable, preserved) convention (plan-checker iter-1 fix W3)
key_files:
  created:
    - supabase/migrations/20270715000007_p43_promo_trial_extensions_log.sql
    - supabase/functions/_shared/clamp-combined-discount.ts
    - supabase/functions/_shared/clamp-combined-discount.test.ts
  modified:
    - supabase/functions/stripe-checkout/index.ts
    - supabase/functions/stripe-checkout/index.test.ts
    - supabase/functions/cancellation-accept-offer/index.ts
    - supabase/functions/cancellation-accept-offer/index.test.ts
decisions:
  - "clampCombinedDiscount(promoPct, saveOfferPct): first arg is clippable, second is preserved (D-07)"
  - "Stripe-checkout-side promo-driven trial extension at new-subscription creation DEFERRED to 43-CARRY-OVER.md (PK schema incompatible with pre-subscription holding key)"
  - "Existing-subscriber grandfathered renewal-time price update DEFERRED to 43-CARRY-OVER.md (no reconciliation Fn ships in v1.3)"
  - "Lifetime mode='payment' uses payment_intent_data.metadata (subscription_data has no channel for one-time PaymentIntent metadata)"
metrics:
  duration_minutes: ~35
  completed_date: 2026-05-22
  tasks_completed: 3
  files_created: 4
  files_modified: 4
  tests_added: 17  # 6 clamp + 6 stripe-checkout + 5 cancellation-accept-offer
  tests_passing: 36  # full Deno suite across all three files
requirements: [MEMBER-01, MEMBER-02, MEMBER-03]
---

# Phase 43 Plan 04: Stripe-checkout + Cancellation-accept-offer Wiring Summary

Wired server-side checkout to honor lifetime payment-mode (D-02), grandfathered-cohort price routing at NEW stripe-checkout (D-03/D-04), 70%-cap multiplicative discount-stack clamp (D-06/D-07) at both checkout-init and cancellation-accept surfaces, and PK-protected trial-extension idempotency at the cancellation-flow surface (D-08). v1.3 scope: cancellation-flow-only idempotency + NEW-checkout grandfathering; existing-subscriber renewal price update and stripe-checkout-side trial-extension are documented in 43-CARRY-OVER.md.

## Tasks Completed

### Task 1: Migration 07 + shared clampCombinedDiscount utility (commit `aaebeb9`)

**Files created:**
- `supabase/migrations/20270715000007_p43_promo_trial_extensions_log.sql` (55 LOC) — Idempotency log table. PK `(subscription_id, promo_code_id)` per D-08. `CHECK (extension_days > 0)`. RLS enabled with NO policies — Postgres-default-DENY restricts writes to service_role. Column comments document the idempotency-PK contract.
- `supabase/functions/_shared/clamp-combined-discount.ts` (97 LOC) — Pure function `clampCombinedDiscount(promoPct, saveOfferPct): ClampResult` implementing the multiplicative-stack math (D-06) with 70% cap and SAVE-offer preservation (D-07). Save=100% edge case (T-43-04-07) guarded against division-by-zero. Invalid inputs throw `Error('clamp:invalid_input')`. Epsilon-tolerant cap check (1e-9) so exact `0.70` is below-cap.
- `supabase/functions/_shared/clamp-combined-discount.test.ts` (65 LOC) — 6 Deno tests covering pass-through, exact-cap boundary, clip-promo-preserve-save, save=100%, invalid inputs, and the RESEARCH Pitfall 7 example. **All 6 pass.**

**Argument-order convention** (per plan-checker iter-1 fix W3 + D-07): `clampCombinedDiscount(clippable, preserved)`. Caller passes the LOWER-PRIORITY discount as the first arg (existing promo) and the HIGHER-PRIORITY discount as the second (new SAVE-offer). The function clips the first arg to bring the combined back to 70% exactly; the second arg is returned at its original value (modulo the save=100% edge case where it's already past the cap on its own).

### Task 2: stripe-checkout lifetime + grandfathered resolver + 70%-cap (commits `82a4eba` test / `e04b9ae` impl)

**Behaviors wired** in `supabase/functions/stripe-checkout/index.ts`:

1. **Plan enum widened** to `'plus_monthly' | 'plus_yearly' | 'clinic' | 'lifetime'`.
2. **Lifetime + promo_code rejected** with HTTP 400 `lifetime_no_promo_code` BEFORE any Stripe call (OQ-6 RESOLVED, T-43-04-01).
3. **Grandfathered-price routing** via `admin.rpc('resolve_user_effective_price', { p_user_id, p_plan })` for plus_monthly / plus_yearly / lifetime. Fallback chain: RPC result → env helper (`STRIPE_PRICE_*`) → 503 `vendor_unconfigured`. Clinic branch unchanged (clinic grandfathering deferred per CONTEXT specifics).
4. **70%-cap clamp** applied BEFORE `stripe.checkout.sessions.create` on subscription plans when `body.promo_code` is set. Fetches existing SAVE-offer percent from `cancellation_offers_log` (most-recent `status='accepted'` with `offer_payload.offer_type='discount'`), fetches the promo coupon's `percent_off` via `stripe.coupons.retrieve`, calls the clamp. On clip → HTTP 400 `discount_combination_exceeds_max` (D-07 strict reading).
5. **mode='payment' for lifetime**: uses `payment_intent_data.metadata.{user_id, provider, tier_kind: 'lifetime', aff_code}` (Pitfall 10 — lifetime MUST be mode='payment', never subscription). Subscription plans continue to use mode='subscription' with `subscription_data.{trial_period_days: 7, metadata}` and add `discounts:[{coupon}]` when promo is present.
6. **No promo_trial_extensions_log reference** in stripe-checkout — DEFERRED per 43-CARRY-OVER.md item #1. Verified by `grep -c promo_trial_extensions_log supabase/functions/stripe-checkout/index.ts = 0`.

**Tests added** (`supabase/functions/stripe-checkout/index.test.ts` extended): 6 Deno tests. **All 16 (4 Phase 14 + 6 Phase 19-04 + 6 Phase 43-04) pass.** Pre-existing `makeFakeAdmin` and `makeQueueAdmin` helpers extended with default `rpc()` stub returning `null` so the Phase 14/19 tests still exercise the env-helper fallback path unchanged.

### Task 3: cancellation-accept-offer clamp + idempotency (commits `f734f30` test / `5d75f38` impl)

**Behaviors wired** in `supabase/functions/cancellation-accept-offer/index.ts`:

1. **Clamp BEFORE applyDiscount.** In the `discount` branch: retrieve subscription with `expand: ['discounts']`, iterate unique coupons, look up each `percent_off` (preferring the expanded coupon object, falling back to `stripe.coupons.retrieve`), multiplicatively combine into `existingPromoPct = 1 - product(1 - p_i)`. Pull `newSaveOfferPct` from `offerConfig.percent_off` (normalized 0..1) or via `stripe.coupons.retrieve(couponId)` as a fallback. Call `clampCombinedDiscount(existingPromoPct, newSaveOfferPct)`. If `clipped` → HTTP 400 `discount_combination_exceeds_max`.
2. **promo_trial_extensions_log idempotency** in the `extended_trial` branch. Before `applyExtendedTrial`: `INSERT { subscription_id, promo_code_id, extension_days }` with `onConflict: 'subscription_id,promo_code_id', ignoreDuplicates: true` and `.select()`. If insertedRows length > 0 → fresh write, call `applyExtendedTrial`. If empty array → PK collision (idempotent no-op), skip the Stripe call. Response carries `trial_extended: boolean` for the caller.
3. **applyDiscount.ts and applyExtendedTrial.ts unchanged** — verbatim Phase 40 reuse per RESEARCH Pattern 4/6 mandate.

**Tests added** (`supabase/functions/cancellation-accept-offer/index.test.ts` extended): 5 Deno tests including a source-order assertion (`clampCombinedDiscount` literal appears textually BEFORE `applyDiscount(` in `index.ts`). **All 14 pass.** Source-order also verified by the plan's `awk` check (last-clamp-line < last-applyDiscount(-line).

## Test Results

```
6  ./supabase/functions/_shared/clamp-combined-discount.test.ts        passed
16 ./supabase/functions/stripe-checkout/index.test.ts                  passed
14 ./supabase/functions/cancellation-accept-offer/index.test.ts        passed
---
36 total passed | 0 failed
```

17 net-new Deno test cases (6 clamp + 6 stripe-checkout + 5 cancellation-accept-offer).

## v1.3 Scope Clarifications

### Deferred Item 1 — Stripe-checkout-side promo-driven trial extension at new-sub creation
The original D-08 path needed a `pending:<session_id>` holding key that violates the `promo_trial_extensions_log` PK `(subscription_id, promo_code_id)` schema. v1.3 ships the cancellation-flow surface only (subscription_id IS known at that point). Future closure requires: a `subscription.created` webhook reconciliation Fn + a holding-key column with a partial unique index on the log table + re-wiring `stripe-checkout` to insert a holding-key row and append `subscription_data.trial_period_days`. See `43-CARRY-OVER.md` item #1.

### Deferred Item 2 — Existing-subscriber grandfathered price renewal-time update
`resolve_user_effective_price` is called at NEW stripe-checkout session creation only. v1.3 does NOT ship a cron/reconciliation Fn that calls `stripe.subscriptions.update(...)` to swap the price when `grandfathered_prices` rows change for in-flight subscribers. SC #2 ("grandfathered at renewal") silently fails for existing subs until the closure work in `43-CARRY-OVER.md` item #2 lands.

## Argument-Order Convention

```ts
clampCombinedDiscount(promoPct: number, saveOfferPct: number): ClampResult
```

- **First arg (`promoPct`)** = the CLIPPABLE side. Lower-priority discount. In Phase 43 contexts, this is the existing promo coupon already on the subscription (`stripe-checkout`) or the pre-existing discounts on the subscription (`cancellation-accept-offer`).
- **Second arg (`saveOfferPct`)** = the PRESERVED side. Higher-priority discount per D-07. This is the new SAVE-offer being accepted (either submitted at checkout time via `promo_code` body field, or the SAVE-offer the user is accepting in `cancellation-accept-offer`).
- Returns `{ combinedPct, clipped, finalPromoPct, finalSavePct }`. On `clipped:true` the caller must EITHER apply the new `finalPromoPct` (if it can mutate the existing promo) OR fail-fast with 400 `discount_combination_exceeds_max`. Both stripe-checkout AND cancellation-accept-offer currently fail-fast because Stripe doesn't permit per-coupon percent overrides on an active subscription.

## Carry-Over (Phase 43 Closeout 43-06)

Deferred to closeout:
- `supabase db push --linked` (will pick up `20270715000007_p43_promo_trial_extensions_log.sql` along with any Plan 01-03 migrations not yet pushed)
- `supabase functions deploy stripe-checkout cancellation-accept-offer` (no `--linked` flag per reference_supabase_functions_deploy_no_linked_flag)
- Operator action: seed `stripe_price_lookup` rows in Studio (`plus_monthly`, `plus_yearly`, `lifetime`, `clinic_base`, `clinic_overage`) with the Stripe price IDs from the live dashboard. Until seeded, all subscription/lifetime checkouts return 503 `vendor_unconfigured` — vendor-gated-send pattern by design.

## Self-Check: PASSED

- [x] `supabase/migrations/20270715000007_p43_promo_trial_extensions_log.sql` FOUND
- [x] `supabase/functions/_shared/clamp-combined-discount.ts` FOUND
- [x] `supabase/functions/_shared/clamp-combined-discount.test.ts` FOUND
- [x] Commit `aaebeb9` FOUND (Task 1 feat)
- [x] Commit `82a4eba` FOUND (Task 2 RED test)
- [x] Commit `e04b9ae` FOUND (Task 2 GREEN impl)
- [x] Commit `f734f30` FOUND (Task 3 RED test)
- [x] Commit `5d75f38` FOUND (Task 3 GREEN impl)
- [x] All 36 Deno tests pass across the three test files
- [x] `grep -c promo_trial_extensions_log supabase/functions/stripe-checkout/index.ts = 0` (deferral honored)
- [x] awk source-order check OK in `cancellation-accept-offer/index.ts` (clamp before applyDiscount)
- [x] Stripe SDK pin matches Phase 14/19/40 (`https://esm.sh/stripe@19?target=denonext`, `apiVersion: '2026-04-22.dahlia'`) — unchanged
