---
phase: 43
slug: m4-membership-tiers-extension
status: closed-with-carry-over
created: 2026-05-22
updated: 2026-05-22
---

# Phase 43 — Carry-Over

Items scoped out of Phase 43 (v1.3) during plan-checker iter-1 review (Items 1, 2) + Plan 43-06 close-out (Items 3..6, vendor-gated UAT signals).

**Phase 43 close state:** schema + RPCs + Edge Fn binaries LIVE on linked project (`ytnsipxxmzgaebkqmokp`); 7 migrations + 3 Edge Fns deployed in Plan 43-06 (commit `71623c2` + deploy outcomes recorded in `43-DEPLOY-NOTES.md`). 4 HUMAN-UAT signals carried to milestone v1.3 close-out (vendor pre-conditions not yet satisfied).

---

## Deferred Item 1: Stripe-checkout-side promo-driven 7-day trial extension at new-subscription creation

**Source:** Plan 43-04 Task 2 step (e) — D-08 idempotency contract

**Reason for deferral:** The originally-planned stripe-checkout `subscription_data.trial_period_days` promo-driven extension path required a "pending:<session_id>" holding key that violates the `promo_trial_extensions_log` PK schema `(subscription_id, promo_code_id)`. It also referenced a `subscription.created` webhook reconciliation Fn that Plan 43-01 does not ship.

**v1.3 scope:** D-08 idempotency contract is **cancellation-flow-only**. `applyExtendedTrial.ts` (Phase 40) reuse is at the `cancellation-accept-offer` surface where `subscription_id` IS known. `promo_trial_extensions_log` PK `(subscription_id, promo_code_id)` is honored at write time.

**Destination:** Future phase (post-v1.3).

**Acceptance criteria for closure:**

1. Dedicated `subscription.created` webhook reconciliation Edge Fn that backfills `promo_trial_extensions_log` rows once `subscription_id` is known.
2. Refactor `promo_trial_extensions_log` PK to accept holding keys (e.g., add a `holding_key text` column with a partial unique index on `(holding_key)` for pre-subscription rows, plus a follow-up reconciliation UPDATE setting `subscription_id` from the holding key on `subscription.created`).
3. Re-wire `stripe-checkout` to insert a holding-key row and append `subscription_data.trial_period_days` with the extension.
4. End-to-end test: new subscription via Stripe Checkout with a promo coupon carrying `metadata.extension_days=7` → trial_period reflects extension + log row reconciled to real `subscription_id` after webhook fires.

---

## Deferred Item 2: Existing-subscriber grandfathered price renewal-time update

**Source:** Plan 43-04 + ROADMAP SC #2 — D-04 "grandfathered price at next renewal" semantics

**Reason for deferral:** `resolve_user_effective_price` runs only at new `stripe-checkout` session creation. For EXISTING subscriptions, no cron / reconciliation Fn calls `stripe.subscriptions.update(...)` to swap the price when a grandfathered_prices row changes. SC #2 silently fails for in-flight subscriptions without this path.

**v1.3 scope:** Grandfathered-price routing at NEW `stripe-checkout` only via `resolve_user_effective_price`. Existing subscribers continue at their current Stripe price until they create a new subscription.

**Destination:** Future phase (post-v1.3).

**Acceptance criteria for closure:**

1. Cron Edge Fn that reconciles existing subscriptions against `grandfathered_prices` changes (scheduled via pg_cron, calls Fn with vault service_role per [[reference_supabase_pg_cron_vault_service_role_pattern]]).
2. Call `stripe.subscriptions.update(subId, { items: [{ price: newPriceId }], proration_behavior: 'none', billing_cycle_anchor: 'unchanged' })` for affected subscribers.
3. `audit_log` row per update via `log_admin_action` (action_name `grandfathered_price_subscription_synced`).
4. HUMAN-UAT signal exercising the in-flight-subscription renewal path (existing subscriber + admin changes cohort price → next-cycle invoice reflects new price without subscription cancellation).

---

## Deferred Item 3: Signal A — Lifetime purchase smoke (MEMBER-01)

**Source:** Plan 43-06 Task 2 HUMAN-UAT signal A

**Reason for deferral:** Operator has not yet pre-created the Stripe Lifetime Product + Price object in the test-mode dashboard. The `STRIPE_PRICE_LIFETIME` Function Secret is unset; `stripe_price_lookup.lifetime` row holds the empty-string sentinel. Per the vendor-gated-send pattern ([[reference_vendor_gated_send_health_check]]), the `stripe-checkout` Edge Fn returns 503 `vendor_unconfigured` for `plan: 'lifetime'` until both are populated. Deploy-time evidence (binary live + idempotency PK enforced) accepted per [[feedback_spike_accept_deploy_evidence_defer_runtime_verify]].

**Destination:** Milestone v1.3 close-out UAT batch (consolidated into `<milestone>-uat-deferred.md` per [[feedback_milestone_uat_deferral_consolidation]]).

**Acceptance criteria for closure:**

1. Operator pre-creates Stripe Lifetime Product + one-time Price (e.g., $499) in test-mode dashboard.
2. Operator sets `STRIPE_PRICE_LIFETIME` Function Secret via `supabase secrets set --project-ref ytnsipxxmzgaebkqmokp`.
3. Operator populates `stripe_price_lookup.lifetime` row via Supabase Studio (`UPDATE … SET stripe_price_id = '<price_xxx>'`).
4. End-to-end test (operator runs): `/pricing` → "Buy Lifetime $499" CTA → Stripe Checkout (card 4242) → redirect → `lifetime_purchases` row inserted (UNIQUE PK on `stripe_payment_intent_id` enforced) → `tier_effective.tier_label='lifetime'` for the test user → LIFETIME badge visible in dashboard UI.
5. Resume signal: `approved-A`.

---

## Deferred Item 4: Signal B — Grandfathered pricing silent at NEW stripe-checkout (MEMBER-02)

**Source:** Plan 43-06 Task 2 HUMAN-UAT signal B

**Reason for deferral:** Requires an existing P27 cohort + a pre-created Stripe Price (lower than the default) + a NEW non-subscribed test user matching that cohort. Admin Grandfathered Prices CRUD page is shipped (Plan 43-05) but the operator has not yet seeded a test override row.

**Destination:** Milestone v1.3 close-out UAT batch.

**Acceptance criteria for closure:**

1. Operator picks any existing P27 cohort the test user is a member of.
2. Operator creates a second Stripe Price (lower than `STRIPE_PRICE_PLUS_MONTHLY` default) in the dashboard.
3. Admin opens `/admin/billing/grandfathered-prices`, creates an override row: `(cohort_id, stripe_price_id_lower, effective_from=now, effective_until=null)`.
4. NEW non-subscribed test user matching that cohort visits `/pricing` → confirms displayed amount == grandfathered price, NO banner, NO badge, NO upgrade prompt (D-05 silent stability).
5. DB-layer verify: `SELECT public.resolve_user_effective_price('<test_user_id>'::uuid, 'plus_monthly');` returns the grandfathered price.id.
6. Resume signal: `approved-B`.

**Scope reminder:** existing-subscriber renewal-time price update is OUT OF SCOPE for v1.3 (deferred per Item 2 above). Only NEW stripe-checkout sessions are gated by the resolver in v1.3.

---

## Deferred Item 5: Signal C — 70%-cap discount-stack hit (MEMBER-03)

**Source:** Plan 43-06 Task 2 HUMAN-UAT signal C

**Reason for deferral:** Requires Stripe test-mode coupon (`TEST50` 50%-off) + a test subscription with an existing 50% SAVE-offer already accepted. Operator setup needed. Unit-test coverage (`clamp-combined-discount.test.ts` 6 cases + `stripe-checkout/index.test.ts` Test 4 + `cancellation-accept-offer/index.test.ts` Test 2) all green at deploy time.

**Destination:** Milestone v1.3 close-out UAT batch.

**Acceptance criteria for closure:**

1. Operator creates 50%-off promo coupon `TEST50` in Stripe Dashboard test mode.
2. Operator inserts a `cancellation_offers_log` row for the test subscription with `offer_payload->>'offer_type'='discount'` + `offer_payload->>'percent_off'='0.50'` + `status='accepted'`.
3. Operator calls `POST /functions/v1/stripe-checkout` with body `{"plan":"plus_monthly","promo_code":"TEST50"}` using the test user's JWT.
4. Response is HTTP 400 with body `{"error":"discount_combination_exceeds_max"}`.
5. Confirm in Stripe Dashboard: NO new Checkout Session created (fail-fast).
6. Resume signal: `approved-C`.

---

## Deferred Item 6: Signal D — RLS cross-tenant deny proof (MEMBER-02, MEMBER-04)

**Source:** Plan 43-06 Task 2 HUMAN-UAT signal D + [[reference_supabase_project]] standing rule

**Reason for deferral:** Requires 2 distinct non-admin authenticated test users + browser-console JWT-impersonated session pair using the live-RLS-fixture pattern from prior phases ([[reference_rls_fixture_gotrueclient_flake]] admin.generateLink + /auth/v1/verify variant). Operator setup needed.

**Destination:** Milestone v1.3 close-out UAT batch.

**Acceptance criteria for closure:**

1. As user_A (non-admin authenticated): `supabase.from('grandfathered_prices').select('*')` → returns `[]` (admin-only-read RLS denies).
2. As user_A: `supabase.from('lifetime_purchases').select('*').neq('user_id', user_A_id)` → returns `[]` (self-only-read RLS).
3. As user_A: `supabase.rpc('current_user_has_pro')` → returns `tier_effective.has_active` for user_A.
4. As user_B: `supabase.rpc('current_user_has_pro')` → returns `tier_effective.has_active` for user_B (different from step 3 if entitlements differ).
5. Capture browser-console transcript in `43-DEPLOY-NOTES.md § HUMAN-UAT Signals § Signal D § Outcome`.
6. Resume signal: `approved-D`.

---

## Deferred Item 7: `SLACK_WEBHOOK_EXPERIMENTS_URL` Function Secret unset (Lifetime alert wiring)

**Source:** Plan 43-01 D-04 single-channel alert pattern; surfaced again at Plan 43-06 deploy

**Reason for deferral:** Slack webhook URL for `#growth-experiments` not configured at v1.3 close. Plan 43-01 Test 3.4 covers graceful degradation when unset — handler completes without throwing, Slack dispatch skipped. Alert is acknowledgment-only (no operator action gated on it). Pattern is the same vendor-gated-send fallback used by Phase 35-vault and Phase 38 ad-platform credentials.

**Destination:** Milestone v1.3 close-out vendor-secret batch (alongside other un-configured webhooks from Phases 38/39).

**Acceptance criteria for closure:**

1. Operator creates / locates the `#growth-experiments` Slack channel webhook URL.
2. Operator sets the Function Secret: `echo "$URL" | npx supabase secrets set --project-ref ytnsipxxmzgaebkqmokp SLACK_WEBHOOK_EXPERIMENTS_URL`.
3. Manual probe: trigger a test-mode Lifetime purchase → confirm Slack message lands in `#growth-experiments` channel.

---

## Phase 43 Plan SUMMARY confirmation list

All 5 sub-plan SUMMARYs landed:

- ✅ `43-01-SUMMARY.md` — Lifetime tier persistence layer (4 commits, 345 lines)
- ✅ `43-02-SUMMARY.md` — Grandfathered prices table + SECDEF RPCs (2 commits, 338 lines)
- ✅ `43-03-SUMMARY.md` — Entitlement helpers + resolver + PRO-gating contract (3 commits)
- ✅ `43-04-SUMMARY.md` — Stripe-checkout + cancellation-accept-offer wiring (5 commits, 17 tests)
- ✅ `43-05-SUMMARY.md` — PaywallUpsell + LifetimeBadge + Grandfathered Prices admin UI (4 commits, 22 vitest cases)
- ✅ `43-06-SUMMARY.md` — closeout (this plan)
