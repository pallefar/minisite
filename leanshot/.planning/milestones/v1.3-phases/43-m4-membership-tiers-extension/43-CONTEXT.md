---
phase: 43
phase_name: "M4 Membership Tiers Extension"
status: ready-for-research
gathered: 2026-05-22
---

# Phase 43: M4 Membership Tiers Extension — Context

**Gathered:** 2026-05-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 43 extends v1.2 Phase 14's `tier_effective` view with a permanent Lifetime entitlement (one-time Stripe payment) + per-cohort grandfathered pricing override + coupon stacking with the Phase 40 SAVE-offer flow + entitlement gating for M4 community/courses/events.

**In scope:**
- Lifetime tier added to `tier_effective` as a new tier_label value; one-time Stripe Checkout payment → permanent Pro entitlement.
- Per-cohort grandfathered pricing override: admin sets prices for cohorts; affected users see no upgrade prompt + pay the grandfathered price at next renewal.
- Coupon-driven Pro upgrade with 7-day trial extension that compounds multiplicatively with the Phase 40 SAVE-offer discount; hard-capped at 70% combined discount.
- `pro_only` boolean on community_spaces / courses / events tables; gated via RLS at the table level + RPC fallback for service-role contexts. Free-tier users see a soft paywall (200 + PaywallGate component) for view; hard 403 for write actions.
- 60-second in-memory cache per user for the tier_effective lookup.

**Out of scope (explicit):**
- Multiple lifetime tiers (Pro Lifetime vs Founder Lifetime distinct SKUs) — single Lifetime SKU in v1.3.
- Refund handling for Lifetime purchases (operator processes refunds manually via Stripe; data-side cleanup via maintenance script v1.4 if volume warrants).
- Grandfathered pricing migration UI (no bulk-move tool — admin sets per-cohort once via the existing P27 cohort builder + new grandfathered_prices admin page).
- Cross-tier (Pro→Lifetime) upgrade pricing (user paying $9.99/mo for 6 months gets no credit toward Lifetime purchase in v1.3).
- Entitlement caching beyond 60s (no Redis cache layer).
- Per-resource (per-space, per-course) custom-price entitlements — only the binary `pro_only` flag.

</domain>

<decisions>
## Implementation Decisions

### Lifetime Tier Representation (MEMBER-01)

- **D-01: Lifetime added as a NEW row in `tier_effective` with `tier_label='lifetime'`.** tier_effective gets a 4th tier value: free / trial / pro / lifetime. `has_active=true` for both `pro` and `lifetime`. Downstream code that needs "is this a one-time-permanent-Pro?" can check `tier_label='lifetime'`. UI shows a "LIFETIME" badge when applicable.
- **D-02: Lifetime entitlement granted via Stripe Checkout one-time payment + webhook idempotent upsert into `lifetime_purchases` table.** Stripe Checkout session in `mode='payment'` (NOT 'subscription'). `checkout.session.completed` webhook (already shipped in v1.2) fires; handler checks `mode='payment'` AND `price.id` matches the Lifetime SKU; INSERT `lifetime_purchases(user_id, stripe_payment_intent_id, paid_at, amount_cents)` on conflict do nothing (idempotent on `stripe_payment_intent_id`). `tier_effective` UNION ALL selects active lifetime_purchases rows alongside active subscriptions.

### Grandfathering Mechanism (MEMBER-02)

- **D-03: Grandfathered pricing stored in LeanShot-side override table `grandfathered_prices(cohort_id, stripe_price_id, effective_from, effective_until)`.** Operator-editable via admin UI; Stripe stays the source of truth for the price OBJECT, but LeanShot's checkout-init Edge Fn resolves which `stripe_price_id` to use per user via cohort membership lookup. Cohort_id references Phase 27 cohorts; admin pre-creates the Stripe Price objects + adds the override row.
- **D-04: Grandfathered price takes effect at next renewal cycle.** In-flight billing cycle uses the existing price. The new price kicks in at the NEXT renewal (via Stripe's `update.subscription` with `proration_behavior='none'` + `billing_cycle_anchor='unchanged'`). No proration credits. No mid-cycle surprise charges. Aligned with Stripe's renewal-time price-update pattern.
- **D-05: Grandfathered users see NO upgrade prompt + pricing page silently shows the grandfathered price.** Per ROADMAP Success Criterion #2. Pricing surface queries `grandfathered_prices` joined with the user's cohort membership; renders their effective price. No admin-banner, no email, no badge — silent stability is the gift.

### Coupon Stacking Semantics (MEMBER-03)

- **D-06: Discounts compound MULTIPLICATIVELY: `total = price × (1 − coupon%) × (1 − save_offer%)`.** Stripe doesn't natively stack two Coupons on one Subscription; implementation applies the SAVE-offer as a custom invoice line-item discount via `subscription.discounts[]` override at invoice-creation time. UI shows both discounts as separate line items on the invoice + checkout summary.
- **D-07: Hard cap: max combined discount = 70% off any single invoice.** Server-side validator in the checkout/invoice Edge Fn. If stacked discount > 70%, apply the 70% cap (clip the lower-priority discount; SAVE-offer takes precedence over promo code for the clipping calculation). Prevents 100%-off compounding. Industry-standard cap for compound promos.
- **D-08: Trial extension (7 days per MEMBER-03) applied via Stripe `subscription.trial_end` push.** Mutate `subscription.trial_end += 7 days` via Stripe API. Native trial accounting; invoice naturally delays by 7 days. Idempotent on (subscription_id, promo_code_id) — prevents double-extension on retry. Already a v1.2 capability per Phase 14.
- **D-09: Promo code creation via Stripe Coupons + Promotion Codes.** Admin creates Coupons (e.g., 30% off, 6 months) + Promotion Codes (e.g., "WELCOMEBACK") via the Stripe dashboard. LeanShot's checkout reads the promo code from the URL + applies to the Stripe Checkout Session. No LeanShot-side coupon table — Stripe is source of truth.

### Entitlement Gating Shape (MEMBER-04)

- **D-10: Gating enforced via RLS at the table level (community_spaces / courses / events) + RPC fallback for service-role contexts.** New SECDEF function `current_user_has_pro() RETURNS boolean` reads from `tier_effective` filtered by `auth.uid()`. Tables get RLS policies that exclude rows where `pro_only=true AND NOT current_user_has_pro()`. Service-role contexts (admin, system jobs) bypass RLS naturally. Defense-in-depth: even if app-tier check is missed, RLS blocks the read. Mirrors Phase 28 cross-tenant RLS pattern.
- **D-11: Soft block for VIEW: 200 + PaywallGate component instead of resource body.** API returns resource metadata (name, description, thumbnail) + `paywall: true` flag. Consumer renders the resource header but replaces body with the PaywallGate component (REUSE Phase 39 PaywallModal contract). User understands what they're missing; SEO + sharing preserved.
- **D-12: Hard 403 for WRITE actions (post / RSVP / enroll / comment).** Edge Fn endpoints return 403 + `{error: 'pro_required', upgrade_url: '/pricing?upsell={resource_type}'}` JSON. Frontend catches 403 and opens the PaywallModal inline (no full-page redirect). Hybrid view-soft / write-hard pattern preserves browsing while gating actions.
- **D-13: 60-second in-memory per-user cache for tier_effective lookup at the gate.** Cache user_id → has_active for 60s in the Edge Fn process memory (LRU max 10k entries). Bounded staleness: Lifetime entitlement doesn't change in 60s; SAVE-offer downgrade may take up to 60s to reflect (acceptable). Mirrors Phase 36 cooldown-check cache pattern.

### Claude's Discretion (implementation details for planner)

- Webhook handler extension: existing `stripe-webhook` Edge Fn gains a branch for `checkout.session.completed` with `mode='payment'` → lifetime_purchases INSERT. Idempotency key = stripe_payment_intent_id.
- Admin UI for grandfathered_prices CRUD: new sub-page under `/admin/billing/grandfathered-prices` (sibling of cohort builder). 4 columns: cohort name, stripe_price_id, effective_from, effective_until + add/remove/edit form.
- pro_only column migration: ADD COLUMN `pro_only boolean NOT NULL DEFAULT false` on community_spaces / courses / events. Index on `(pro_only) WHERE pro_only=true` for the RLS predicate.
- PaywallGate component (Phase 39 reuse): props `{resource_type, resource_id, resource_name, upsell_copy}`. Consumer modal opens on click; routes to Stripe Checkout with the user's effective price (grandfathered if applicable).
- 70% combined-discount cap: validation lives in the checkout-create Edge Fn BEFORE the Stripe Checkout Session is created (fails fast with a user-visible "this discount combination exceeds the allowed maximum" message).
- LIFETIME badge: UI-only; reads tier_effective.tier_label === 'lifetime'. Renders next to the user's name in admin views + on the profile page.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### ROADMAP + REQUIREMENTS
- `.planning/ROADMAP.md` §"Phase 43: M4 Membership Tiers Extension" — 4 success criteria
- `.planning/REQUIREMENTS.md` §WS19 — MEMBER-01..04

### Cross-phase reuse mandates
- `.planning/phases/14-*/14-*-SUMMARY.md` — Stripe + tier_effective + `has_active` semantics (v1.2; source of truth)
- `.planning/phases/19-*/19-*-SUMMARY.md` — P19 D-04 `has_active` contract (NOT string match on tier='paid')
- `.planning/phases/27-*/27-*-SUMMARY.md` — cohort builder (cohort_id references for grandfathered_prices)
- `.planning/phases/28-*/28-*-SUMMARY.md` — RLS pattern for table-level entitlement gating
- `.planning/phases/39-*/39-CONTEXT.md` — PaywallModal contract (REUSE for PaywallGate)
- `.planning/phases/40-*/40-CONTEXT.md` — SAVE-offer flow (coupon-compounds with MEMBER-03)
- Existing `stripe-webhook` Edge Fn — extension point for checkout.session.completed mode=payment branch

### Project memory invariants
- [[reference_supabase_migration_filename_regex]] — strict 14-digit underscore regex
- [[reference_supabase_back_dated_migration_blocks_push]] — migrations must be strictly ahead of remote tail
- [[feedback_rpc_auth_uid_vs_service_role_mismatch]] — SECDEF RPCs called from service-role Edge Fns must forward user JWT (or mirror the write set inline)
- [[reference_tailwind_v4_unlayered_reset]] — Tailwind v4 reset rule for admin UI work
- [[feedback_aggressive_foundations]] — revenue/billing infrastructure: pick max-coverage on gray areas
- [[reference_ui_checker_dimension_traps]] — cap typography at ≤4 sizes / ≤2 weights when admin UI ships
- [[feedback_ui_researcher_prebake_constraints]] — bake the typography ceiling into the ui-researcher prompt up-front
- [[feedback_planner_prompt_explicit_reuse_targets]] — name the EXACT analog file (PaywallModal, stripe-webhook) in planner prompt

### External docs
- Stripe Checkout — one-time payments + mode='payment'
- Stripe Coupons + Promotion Codes API
- Stripe subscription.trial_end + subscription.discounts API
- Stripe webhook.checkout.session.completed event shape

</canonical_refs>

<specifics>
## Specific Ideas

- **`tier_effective` UNION**: query unions active `subscriptions` (tier_label=pro from existing logic) with active `lifetime_purchases` (tier_label=lifetime). View materialization or live SELECT — planner picks based on Phase 14 precedent.
- **Stripe Lifetime SKU**: operator pre-creates one Stripe Product + one Price (`mode=one_time`, e.g., $499). LeanShot stores the SKU ID as `VITE_STRIPE_LIFETIME_PRICE_ID` env var (NOT VITE_ for the key itself — that's still server-only). Server-side checkout-init reads it.
- **grandfathered_prices admin page** lives at `/admin/billing/grandfathered-prices`. Reuses the cohort-picker from Phase 27.
- **PaywallGate component path**: extend `src/components/paywall/PaywallGate.tsx` (Phase 39) with new prop `gating_reason: 'pro_only_resource'` to differentiate from the activation-paywall use case. New copy specific to community/courses/events.
- **`pro_only` columns** added in a single migration spanning community_spaces + courses + events tables. Filtered partial index per table for the RLS predicate hot path.
- **Slack alert** on Lifetime purchase fires to `#growth-experiments` (per Phase 39 D-04 single-channel pattern) when a new lifetime_purchases row lands. Acknowledgment-only — no operator action required.

</specifics>

<deferred>
## Deferred Ideas

- **Multiple Lifetime SKUs** (Founder Lifetime $999 vs Pro Lifetime $499) — v1.4+ if demand emerges.
- **Refund-handling for Lifetime** — operator runs Stripe refund manually; no automatic data cleanup in v1.3.
- **Pro→Lifetime upgrade credit** — paying-subscriber gets no Stripe-side credit toward Lifetime purchase. v1.4 if demand emerges (would require Stripe Customer Balance + tax-accounting work).
- **Per-resource custom-priced entitlements** — e.g., single course = $49 instead of Pro-tier-included. Only binary `pro_only` gate in v1.3.
- **Bulk grandfathering migration tool** — admin must set per-cohort one-by-one. v1.4 if backfill scenario emerges.
- **Entitlement caching beyond 60s** — no Redis layer. Revisit if tier_effective view load becomes hot.
- **Lifetime tier subdivisions** (e.g., "Lifetime + Beta access") — separate tier_label values v1.4+.
- **Stripe Customer Portal grandfathering** — users can self-service downgrade or cancel via the existing portal, but cannot self-toggle grandfathered status. Operator-managed only.

</deferred>

---

*Phase: 43-m4-membership-tiers-extension*
*Context gathered: 2026-05-22*
