# Phase 43 — Discussion Log

**Date:** 2026-05-22
**Mode:** discuss (default)
**Areas selected:** 4 of 4 presented

---

## Gray Areas Selected

User selected all 4 presented gray areas:
1. Lifetime tier representation in tier_effective (MEMBER-01)
2. Grandfathering mechanism (MEMBER-02)
3. Coupon stacking semantics (MEMBER-03)
4. Entitlement gating shape (MEMBER-04)

---

## Area 1: Lifetime Tier Representation

### Q1 — How is 'Lifetime' represented in tier_effective?
**Selected:** New row in tier_effective with tier_label='lifetime' (Recommended).
**→ D-01.**

### Q2 — Stripe one-time payment → entitlement flow
**Selected:** Stripe Checkout one-time price + webhook payment_intent.succeeded → INSERT lifetime_purchases (idempotent on stripe_payment_intent_id).
**→ D-02.**

---

## Area 2: Grandfathering Mechanism

### Q1 — Storage location
**Selected:** LeanShot-side override table `grandfathered_prices(cohort_id, stripe_price_id, effective_from, effective_until)`.
**→ D-03.**

### Q2 — Effective timing
**Selected:** Next renewal cycle (no proration).
**→ D-04.**

### Q3 — UX disclosure
**Selected:** Silent — no upgrade prompt; pricing page shows grandfathered price.
**→ D-05.**

---

## Area 3: Coupon Stacking Semantics

### Q1 — Stacking rule when promo + SAVE-offer both apply
**Selected:** Compound multiplicatively. `total = price × (1−coupon%) × (1−save_offer%)`. Implemented via subscription.discounts[] override.
**→ D-06.**

### Q2 — Abuse cap
**Selected:** Hard cap at 70% combined discount.
**→ D-07.**

### Q3 — Trial extension mechanism
**Selected:** Stripe trial_end push (subscription.trial_end += 7 days). Idempotent on (subscription_id, promo_code_id).
**→ D-08.**

---

## Area 4: Entitlement Gating Shape

### Q1 — Gate tier (RLS / app / centralized Fn)
**Selected:** RLS at table level + RPC fallback for service-role contexts. `current_user_has_pro()` SECDEF.
**→ D-10.**

### Q2 — Free-tier user response shape
**Selected:** Soft block for VIEW (200 + PaywallGate component). Hard 403 for WRITE.
**→ D-11 + D-12.**

### Q3 — Cache TTL
**Selected:** 60-second in-memory cache per user.
**→ D-13.**

---

## Out-of-Scope Items Captured (Deferred)

See CONTEXT.md `<deferred>` section. No scope-creep redirects required during this discussion — user stayed in-domain throughout.

---

## Decisions Captured

13 locked decisions D-01..D-13 spanning Lifetime tier model, grandfathering, coupon stacking, and entitlement gating.

## Claude's Discretion items
- Stripe webhook extension shape (`stripe-webhook` Fn branch)
- Admin UI for grandfathered_prices CRUD (sub-page under /admin/billing/)
- pro_only column migration shape + RLS predicate index
- PaywallGate component reuse (Phase 39 → extend with new prop)
- 70% cap server-side validator placement
- LIFETIME badge UI

All documented in CONTEXT.md `<decisions>` `### Claude's Discretion` subsection.
