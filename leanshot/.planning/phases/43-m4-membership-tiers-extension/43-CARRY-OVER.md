---
phase: 43
slug: m4-membership-tiers-extension
status: open
created: 2026-05-22
---

# Phase 43 — Carry-Over

Items scoped out of Phase 43 (v1.3) during plan-checker iter-1 review. Each item has explicit acceptance criteria for closure in a future phase.

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
