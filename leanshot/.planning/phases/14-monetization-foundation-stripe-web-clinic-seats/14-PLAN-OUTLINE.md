# Phase 14: Monetization Foundation — Plan Outline

**Phase:** 14 — Monetization Foundation (Stripe web + clinic seats)
**Mode:** mvp (vertical-slice planning)
**Generated:** 2026-05-14 (chunked outline; per-plan PLAN.md files spawned next)

## Phase Goal (user story)

**As a** GLP-1 user (web), **I want to** subscribe to LeanShot Plus via Stripe Checkout with a 7-day card-required trial and manage my subscription via Stripe Customer Portal, **so that** I unlock the 7-day pharmacology forecast curve, the advanced AI coach model selector, and the ad-free experience — while my clinic operator gets per-active-patient metered billing and dunning surfaces fall back to the past-due banner if my card fails.

## Coverage Summary

| Source Type | Items Covered | Status |
|---|---|---|
| GOAL (ROADMAP Phase 14) | 5 SCs → fully covered by plan set | ✓ |
| REQ (phase_req_ids) | MONEY-01, 02, 03, 04, 05, 08, 09 → every ID has primary owner | ✓ |
| RESEARCH (14-RESEARCH.md) | 10 patterns + 10 pitfalls + Architectural Responsibility Map → mapped to plans | ✓ |
| CONTEXT (14-CONTEXT.md) | D-01..D-17 → every locked decision has implementing plan | ✓ |
| PATTERNS (14-PATTERNS.md) | 18 file analogs + 9 cross-cutting patterns A-I → embedded in plans | ✓ |

## Plan Table

| Plan ID | Objective | Wave | Depends On | Requirements |
|---|---|---|---|---|
| 14-01 | Postgres schema slice: `subscriptions` + `subscription_events` + `stripe_customers` + `clinic_stripe_customers` tables, RLS policies, `count_active_patients()` SECURITY DEFINER function, cross-tenant impersonation proof test, pgTAP test for active-patient counter (per D-01, D-02, D-15; RESEARCH §"Postgres schema" lines 607-700 + Pattern A) | 1 | — | MONEY-01 |
| 14-02 | Foundation slice: CSP edit (vercel.json + tests/csp/csp-snapshot.txt in ONE commit per Pattern H), `scripts/stripe-bootstrap.ts` idempotent product/price/meter creation, `.env.example` price-ID placeholders, env-presence smoke test (per D-09, D-10, D-11, D-16; RESEARCH §"Bootstrap script" lines 523-585) | 1 | — | MONEY-08 |
| 14-03 | Webhook slice: `supabase/functions/stripe-webhook/index.ts` with `constructEventAsync` + `createSubtleCryptoProvider()` + raw-body verify + `ON CONFLICT (event_id) DO NOTHING` idempotency + per-event-type dispatchers under `events/` (checkout-session-completed, subscription-updated, invoice-paid, invoice-payment-failed, customer-subscription-deleted) collapsing Stripe statuses to UX tier per Pitfall 6, Deno tests for each handler (per D-14, RESEARCH Pattern 1 + Pitfalls 2, 3, 6, 8 + Patterns B, C) | 2 | 14-01 | MONEY-01, MONEY-09 |
| 14-04 | Checkout slice: `supabase/functions/stripe-checkout/index.ts` JWT-authed POST that ensures `stripe_customers` row + creates Checkout session for web (`mode=subscription`, `trial_period_days=7`, `payment_method_collection='always'`) OR clinic (2 line_items: base + metered overage per Pattern 2), PLUS Customer Portal session creation endpoint (`stripe.billingPortal.sessions.create`), Wave-0 A3 sandbox-confirm task (combined line_items renders cleanly in Checkout UI per RESEARCH Open Question 4), Deno tests (per D-01, D-12, D-13, RESEARCH Pattern 2 + Pitfalls 4, 5) | 2 | 14-01, 14-02 | MONEY-02, MONEY-03 |
| 14-05 | Frontend gating slice: `tier` Zustand slice added to `store.ts` partialize (`tier`, `paid_until`, `plan_id`, `provider`) + `src/lib/billing.ts` (`getActiveTier()` Stripe-status→UX-tier collapse, `TIER_GATE_REGISTRY` policy object, `clearTierCache()` on signout per analog `clinic-permissions.ts`) + `<TierGate>` primitive supporting `blur-upsell` / `hard-block-no-ui` / `hard-block-cta` modes with `useReducedMotion()` gating + `<PaywallUpsell>` upsell card (Phase 13 tokens) + surgical edits to `MedLevelChart.tsx` (gate 7-day forecast layer per D-03, D-04) and `AIChatPanel.tsx` (wrap NEW model selector in `<TierGate mode="hard-block-cta">` per D-07) + Vitest tests for TierGate modes + registry-orphan grep gate per Pattern I (per D-03..D-07, D-09, RESEARCH Patterns 3 + 4 + Pitfall 10 + Patterns D, E, I) | 3 | 14-03 | MONEY-04, MONEY-08 |
| 14-06 | Dashboard chrome + manage slice: `<PastDueBanner>` (warm-orange `var(--color-warning)`, `role="alert"`, "Update card" CTA opens Portal in new tab) + `<ManageSubscriptionLink>` Settings entry calling `stripe-checkout` portal endpoint + "Upgrade" CTA wired into Settings header (dynamic-import safe, plain `window.location.href = session.url` per Pitfall 10 — NO `@stripe/stripe-js` static import) + AppShell wiring so banner renders above every dashboard view when `tier='past_due'` + Vitest tests (per D-08, RESEARCH Pitfalls 5, 10 + Pattern D) | 4 | 14-04, 14-05 | MONEY-03, MONEY-09 |
| 14-07 | Clinic metered slice: `supabase/functions/stripe-meter-true-up/index.ts` (Vercel Cron OR `invoice.upcoming` webhook handler per RESEARCH Open Question 1 — planner picks based on Vercel plan audit) that iterates clinics with active subscription, calls `count_active_patients()`, emits `stripe.v1.billing.meterEvents.create` with `identifier = sha256({clinic_id}_{YYYY-MM})` (NOT legacy `usage_records.create` per Pitfall 1), respects 35-day meter window per Pitfall 9, Deno tests for idempotency + window-edge cases (per D-01, D-02, D-10, RESEARCH §"Billing Meters" + Pitfalls 1, 9 + Assumption A10) | 4 | 14-01, 14-03 | MONEY-05 |
| 14-08 | End-to-end verification slice: Playwright specs `e2e/checkout-trial-flow.spec.ts` (`HAS_LIVE`-gated, Stripe test mode, `addInitScript` seed per `reference_playwright_state_seeding`, day-8 conversion via Stripe test clock), `e2e/portal-plan-change.spec.ts` (Manage subscription → Portal → plan change → tier reflects within 10s), `e2e/past-due-banner.spec.ts` (Stripe test mode `invoice.payment_failed` trigger → banner renders → `invoice.paid` recovery → banner clears), `e2e/clinic-metered-billing.spec.ts` (Stripe test clock + meter event verification — 11th active patient triggers overage=1 on next invoice.upcoming) + fixture scripts under `e2e/fixtures/stripe/` (per RESEARCH §"Validation Architecture" Wave 0 gaps lines 829-863) | 5 | 14-04, 14-05, 14-06, 14-07 | MONEY-02, MONEY-03, MONEY-05, MONEY-09 |

**Total:** 8 plans, 5 waves.

## Wave Visualization

```
WAVE 1 (parallel batch, 2 plans, file-disjoint)
├── 14-01 schema + RLS + count_active_patients + impersonation proof
│   └── files: supabase/migrations/20260601000001_stripe_subscriptions.sql,
│              leanshot/tests/rls/subscriptions-impersonation.test.ts,
│              leanshot/tests/sql/count-active-patients.test.sql
└── 14-02 CSP edit + bootstrap script + env wiring
    └── files: vercel.json,
               leanshot/tests/csp/csp-snapshot.txt,
               leanshot/scripts/stripe-bootstrap.ts,
               leanshot/.env.example
                                   │
                                   ▼
WAVE 2 (parallel batch, 2 plans, file-disjoint)
├── 14-03 stripe-webhook Edge Function (depends on 14-01 schema)
│   └── files: supabase/functions/stripe-webhook/**
└── 14-04 stripe-checkout Edge Function + Portal endpoint (depends on 14-01 schema + 14-02 price IDs)
    └── files: supabase/functions/stripe-checkout/**
                                   │
                                   ▼
WAVE 3 (single plan — gating primitive must land before consumers)
└── 14-05 tier slice + billing.ts + TierGate + PaywallUpsell + MedLevelChart + AIChatPanel surgical edits (depends on 14-03 webhook writes tier)
    └── files: leanshot/src/lib/store.ts (surgical),
               leanshot/src/lib/billing.ts (new),
               leanshot/src/components/billing/{TierGate,PaywallUpsell}.tsx (new),
               leanshot/src/components/dashboard/charts/MedLevelChart.tsx (surgical),
               leanshot/src/components/dashboard/ai/AIChatPanel.tsx (surgical),
               leanshot/src/types/index.ts (Tier type)
                                   │
                                   ▼
WAVE 4 (parallel batch, 2 plans, file-disjoint)
├── 14-06 PastDueBanner + ManageSubscriptionLink + Upgrade CTA + AppShell wiring (depends on 14-04 + 14-05)
│   └── files: leanshot/src/components/billing/{PastDueBanner,ManageSubscriptionLink}.tsx (new),
│              leanshot/src/components/dashboard/settings/SettingsPage.tsx (surgical),
│              leanshot/src/components/layout/AppShell.tsx (surgical)
└── 14-07 stripe-meter-true-up Edge Function (depends on 14-01 count_active_patients + 14-03 subscriptions writes)
    └── files: supabase/functions/stripe-meter-true-up/**,
               OR supabase/functions/stripe-webhook/events/invoice-upcoming.ts (planner-chosen)
                                   │
                                   ▼
WAVE 5 (single plan — verifies all upstream slices)
└── 14-08 E2E spec suite (depends on 14-04, 14-05, 14-06, 14-07)
    └── files: leanshot/e2e/{checkout-trial-flow,portal-plan-change,past-due-banner,clinic-metered-billing}.spec.ts,
               leanshot/e2e/fixtures/stripe/**
```

## MVP Vertical-Slice Discipline Check

Per `planner-mvp-mode.md`: after each plan, a real user can do something they could not do before.

| Plan | User-observable capability gained |
|---|---|
| 14-01 | (foundation) — `count_active_patients()` returns valid integer for a clinic |
| 14-02 | (foundation) — bootstrap script run produces 5 live price IDs + meter ID; CSP allows `js.stripe.com` |
| 14-03 | Stripe sends `customer.subscription.updated` → webhook persists row + flips `subscriptions.ux_tier` (observable in DB) |
| 14-04 | Authenticated user POSTs `/stripe-checkout` → receives Stripe-hosted Checkout URL (visit → enter card → land on Stripe success page; tier NOT yet reflected in app — that's 14-05) |
| 14-05 | After 14-04 redirect, user lands back in app and sees `tier='paid'` in store + 7-day forecast curve unblurred + advanced AI coach selector visible — **FIRST FULL END-TO-END HAPPY PATH SUBSCRIBE → UNLOCK CHECK** |
| 14-06 | User on `past_due` sees warm-orange banner above every dashboard view; clicks "Manage subscription" → Stripe Portal opens → updates card → returns → banner clears within 10s |
| 14-07 | Clinic owner with 11+ active patients sees invoice.upcoming pre-period reflect overage=1 on Stripe Dashboard |
| 14-08 | (verification) — full regression suite green incl. clinic metered + dunning + portal flows |

## Cross-Cutting Concerns (every plan must address)

- **Pattern A (RLS impersonation proof):** 14-01 ships the proof for `subscriptions`/`stripe_customers`/`clinic_stripe_customers`. Plan-checker BLOCKER if missing.
- **Pattern B + C (webhook idempotency + raw-body):** 14-03 must include both. Plan-checker BLOCKER if missing.
- **Pattern D (design tokens):** 14-05 + 14-06 forbidden from emitting hex literals. ESLint already enforces; planners reference Phase 13 tokens.
- **Pattern E (reduced-motion):** 14-05 TierGate blur gating; 14-06 PastDueBanner slide-in.
- **Pattern F (pathspec discipline):** All commits in Wave 1, 2, 4 parallel batches MUST use `git commit -- <pathspec>` per `feedback_parallel_executor_git_isolation`.
- **Pattern G (bundle isolation):** 14-06 Upgrade CTA MUST use plain `window.location.href = session.url`; NO `@stripe/stripe-js` static import. Bundle budget CI catches regressions.
- **Pattern H (CSP commit atomicity):** 14-02 vercel.json + csp-snapshot.txt MUST be in same commit. Plan-checker BLOCKER.
- **Pattern I (TierGate registry orphan check):** 14-05 must include grep gate that every `TIER_GATE_REGISTRY` key has ≥1 non-test consumer.

## Memory-Aware Constraints Inherited from Plan-Phase Prompt

- Index chunk ≤50 kB gz (current 13.62 kB post-Phase-13). Phase 14 net additions: `tier` slice ~0.5 kB + TierGate ~1 kB + PastDueBanner ~0.5 kB. Well under ceiling.
- Phase 12 12-01 reserved `stripe-elements` chunk cap UNUSED (we picked Checkout, not Elements). **Plan-checker MUST NOT flag missing chunk as regression.**
- Phase 12 firewall (`src/lib/native/*` import-x) — Phase 14 touches NO native files. No risk.
- Phase 12 CSP snapshot test contract: `vercel.json` + `csp-snapshot.txt` in same commit (Pattern H). 14-02 enforces.
- Phase 13 design tokens consumed everywhere; no hex literals (Pattern D).
- Planner anti-pattern #6 (centralized constants/components need wired consumers): 14-05 TierGate registry orphan check (Pattern I).

## Source Audit (multi-source coverage)

### GOAL coverage (ROADMAP Phase 14 SCs)

| SC | Owning Plan(s) | Verifying Plan |
|---|---|---|
| SC #1 (Upgrade → Checkout → 7-day trial → tier=paid → day-8 auto-charge) | 14-04 (checkout), 14-03 (webhook), 14-05 (tier slice) | 14-08 (`checkout-trial-flow.spec.ts`) |
| SC #2 (Manage subs → Portal → change/cancel → tier reflects within 10s) | 14-04 (portal endpoint), 14-06 (ManageSubLink), 14-03 (webhook) | 14-08 (`portal-plan-change.spec.ts`) |
| SC #3 (Clinic 11th patient → metered invoice line) | 14-01 (counter), 14-07 (true-up Edge Function) | 14-08 (`clinic-metered-billing.spec.ts`) |
| SC #4 (Card fails → Smart Retries → past_due banner → recovers) | 14-03 (event handler), 14-06 (banner) | 14-08 (`past-due-banner.spec.ts`) |
| SC #5 (Pricing page consumes price IDs + TierGate blocks free) | 14-02 (price ID env vars), 14-05 (TierGate primitive). NOTE: pricing page UI is Phase 15. | n/a (Phase 15) |

### REQ coverage

| REQ ID | Primary Plan | Secondary/Verifier |
|---|---|---|
| MONEY-01 (schema + webhook) | 14-01 (schema) + 14-03 (webhook handler) | — |
| MONEY-02 (Checkout web + trial) | 14-04 | 14-08 |
| MONEY-03 (Customer Portal) | 14-04 (server) + 14-06 (client link) | 14-08 |
| MONEY-04 (TierGate + tier slice) | 14-05 | — (Vitest in 14-05) |
| MONEY-05 (clinic metered) | 14-07 | 14-08 |
| MONEY-08 (price IDs + TierGate primitive consumed by Phase 15) | 14-02 (bootstrap) + 14-05 (TierGate primitive) | — (Phase 15 consumes) |
| MONEY-09 (past_due) | 14-03 (event handler) + 14-06 (banner) | 14-08 |

**Every REQ-ID has a primary owner. No unplanned items.**

### CONTEXT decision coverage

| Decision | Implementing Plan(s) |
|---|---|
| D-01 (hybrid clinic billing) | 14-02 (bootstrap creates 2 prices), 14-04 (Checkout 2 line_items), 14-07 (metered true-up) |
| D-02 (active-patient definition) | 14-01 (`count_active_patients()`), 14-07 (consumer) |
| D-03 (paywall split — past free / future paid) | 14-05 (MedLevelChart forecast gate) |
| D-04 (paywall scope — only forecast layer) | 14-05 (surgical edit lines 157-210 only) |
| D-05 (blur-upsell default) | 14-05 (TierGate `blur-upsell` mode) |
| D-06 (ad-free hard-block-no-ui) | 14-05 (TierGate `hard-block-no-ui` mode primitive; ad consumer is Phase 20) |
| D-07 (advanced AI hard-block-cta) | 14-05 (AIChatPanel model selector wrap) |
| D-08 (past_due banner always-on) | 14-06 (PastDueBanner + AppShell wiring) |
| D-09 (web tier monthly+yearly 15% off) | 14-02 (bootstrap creates plus_monthly_v1 + plus_yearly_v1 at $12.99 / $132.49 per RESEARCH §"State of the Art") |
| D-10 (clinic $99 + $9 overage) | 14-02 (bootstrap creates clinic_base_v1 + clinic_overage_v1) |
| D-11 (bootstrap script source) | 14-02 |
| D-12..D-17 (informational restates) | All plans honor goal text + RESEARCH guidance |

### RESEARCH coverage

All 10 patterns + 10 pitfalls map to plans. Architectural Responsibility Map (RESEARCH lines 22-34) honored: server-side Edge Functions own checkout/webhook/meter; DB owns subscription state + idempotency; client owns TierGate UI + tier read.

### Deferred items (NOT in plan set per scope guardrail)

- MONEY-06 (iOS/Android IAP) → Phase 16
- MONEY-07 (cross-platform tier reconciliation) → Phase 19
- MONEY-10 (account-deletion Stripe cascade) → Phase 19
- Pricing page UI → Phase 15
- Push notification on card failure (PUSH-05) → Phase 17
- Stripe Tax, promo codes, lifetime SKU → deferred per CONTEXT

## Pre-flight Notes for Per-Plan Planners

- **14-02 + 14-04 coupling:** Bootstrap script (14-02) must publish price IDs in `.env.example` AND verify the user has run `vercel env add` + `supabase secrets set` BEFORE 14-04 Wave 2 execution. 14-04 includes a Wave-0 task to fetch IDs via Stripe MCP per `feedback_cli_over_paste_back`.
- **14-04 A3 sandbox-confirm:** Wave-0 task is a 30-min check — call `checkout.sessions.create` with 2 line_items, copy URL, visually verify metered line item renders with "billed monthly based on usage" label. If broken, fall back to add-metered-via-subscription-update in webhook handler.
- **14-05 store.ts overlap risk:** 14-05 is single-plan in Wave 3 specifically because it edits `store.ts` AND `billing.ts` AND TierGate AND 2 surgical UI edits — those are interdependent. Splitting would force a TierGate-without-tier-slice intermediate state.
- **14-06 Portal endpoint:** Server-side portal session creation lives in 14-04's Edge Function (one endpoint, two operations: `?op=checkout` vs `?op=portal`). 14-06 client just fetches it. Naming/path inside Edge Function = planner's discretion.
- **14-07 cron vs invoice.upcoming:** Per RESEARCH Open Question 1, planner audits Vercel cron availability first. Default fallback = `invoice.upcoming` webhook handler folded into 14-03 OR as own file under 14-07.
- **14-08 E2E env-gating:** All 4 specs MUST use `HAS_LIVE` env guard so CI doesn't run them by default (matches Phase 7/9/10 pattern). Stripe test clock fixtures require Stripe CLI OR Dashboard "Advance test clock" — planner picks based on env availability.

## OUTLINE COMPLETE

**Plan count:** 8
**Wave count:** 5
**Parallel batches per wave:**
- Wave 1: 2 plans (14-01, 14-02) — file-disjoint, parallel-safe
- Wave 2: 2 plans (14-03, 14-04) — file-disjoint, parallel-safe
- Wave 3: 1 plan (14-05) — single-plan wave by design (interdependent surgical edits)
- Wave 4: 2 plans (14-06, 14-07) — file-disjoint (frontend vs Edge Function), parallel-safe
- Wave 5: 1 plan (14-08) — verification owner

**Critical-path length:** 5 waves × ≈1 plan each = 5 plan-executions on critical path.
**Wall-clock saving from parallelism:** 8 plans → 5 sequential wave-equivalents = 37.5% saving.

**Ready for per-plan planners.** Each PLAN.md is now spawned in parallel against this outline.
