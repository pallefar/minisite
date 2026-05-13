# Phase 14 — Discussion Log

**Date:** 2026-05-13
**Workflow:** `/gsd-discuss-phase 14 leanshot`
**Mode:** default interactive

---

## Areas Selected for Discussion

User selected ALL 4 proposed gray areas (multiSelect):
1. Clinic seat metering model + "active patient" definition
2. Pharmacology projection paywall scope + timing
3. `<TierGate>` UX policy across gated features
4. Stripe product/price source + tier model granularity

---

## Area 1 — Clinic seat metering + "active patient" definition

### Q1: Clinic billing model

**Options:** Per-active-patient (Recommended) / Per-operator-seat / **Hybrid: base + overage**

**User chose:** Hybrid: base + per-active-patient overage
**Rationale captured:** D-01. Operator-friendly (no per-patient anxiety under base cap) + clinic LTV protection (overage scales with value). Floor revenue per clinic guaranteed by base.

### Q2: "Active" definition

**Options:** **Accepted-AND-logged-within-30d (Recommended)** / Accepted-only / Any-activity-only / Accepted-OR-recent-invite

**User chose:** Accepted invite AND logged within last 30 days (Recommended)
**Rationale captured:** D-02. Strictest defensible definition; protects operators from ghosts; new patients counted from first log within 30 days of acceptance.

---

## Area 2 — Pharmacology projection paywall

### Q1: Paywall timing

**Options:** Free at GA, paywall A/B in v1.2.x (Recommended) / Paywall at GA / **Past free, future paid**

**User chose:** Hybrid: 28-day past free, 7-day forecast paid
**Rationale captured:** D-03. Defensible value split. "See your data" free; "see the future" paid. Avoids retrofit-paywall problem AND blocks-headline-at-onboarding problem.

### Q2: Paywall scope

**Options:** **Just the 7-day forecast curve overlay (Recommended)** / Entire pharmacology card / Forecast + site-rotation v2

**User chose:** Just the 7-day forecast curve overlay (Recommended)
**Rationale captured:** D-04. Surgical paywall surface. One chart layer in MedLevelChart.tsx wrapped in `<TierGate tier="paid">`. Site-rotation, half-life math, titration, dose history all stay free.

---

## Area 3 — `<TierGate>` UX policy

### Q1: Default rendering

**Options:** **Blur+upsell overlay (Recommended)** / Hard block CTA / Hide entirely

**User chose:** Blur+upsell overlay (preview-then-pay)
**Rationale captured:** D-05. Activation-tuned (users see what they're missing). 8-12 px gaussian blur + centered upsell card. Spotify/Notion/Linear pattern. Respects `prefers-reduced-motion`.

### Q2: Per-feature exceptions (multiSelect)

**Options:** Ad-free hard block (Recommended) / Advanced AI coach hard block / Past_due banner always-on

**User chose:** ALL THREE
**Rationale captured:** D-06/D-07/D-08. Different UX for different "kinds of paywall": ad-free is *removed UI* (not gated UI); AI coach is *different UI* (free coach vs paid coach, not same UI blurred); past_due is *chrome*, not a feature gate.

---

## Area 4 — Stripe product/price source + tier model granularity

### Q1: Web tier granularity

**Options:** **Free + monthly + yearly (15% off) (Recommended)** / Single monthly tier / Add lifetime SKU

**User chose:** Free + paid-monthly + paid-yearly (15% annual discount) (Recommended)
**Rationale captured:** D-09. Standard SaaS pattern. Annual = +25% LTV typically. Single product, 2 recurring prices. Lifetime deferred to v1.3+.

### Q2: Clinic concrete numbers

**Options:** **$99 base + $9 overage (Recommended)** / $49 base + $12 overage / $0 + $15/patient

**User chose:** $99/mo base (up to 10 patients) + $9/active-patient overage
**Rationale captured:** D-10. Floor revenue $99 even at 1 patient. Defensible vs Healthie/SimplePractice. 50 patients = $459/mo.

### Q3: Product source

**Options:** **Bootstrap script (Recommended)** / Dashboard UI / DB-stored products table

**User chose:** Stripe CLI/API bootstrap script in repo (Recommended)
**Rationale captured:** D-11. `scripts/stripe-bootstrap.ts` idempotent creation. Repo-tracked = reproducible dev/staging. Live IDs via Stripe MCP + Vercel env + Supabase secrets per [[feedback_cli_over_paste_back]].

---

## Claude's Discretion (NOT asked — captured for transparency)

Locked from goal/ROADMAP without re-asking:
- **D-12** Checkout (not Elements) — goal phrasing.
- **D-13** 7-day card-required trial, auto-convert — SC #1.
- **D-14** Webhook = source of truth — goal phrasing.
- **D-15** RLS surface rule for `subscriptions` — project rule.
- **D-16** CSP additions for Stripe — Phase 12 CSP gate will catch.
- **D-17** Phase 14 = web + clinic only; mobile/cross-platform/cascade owned by 16/19.

**Concrete web monthly $ left to research/planner discretion:** $9.99 vs $12.99. Both market-comp positions are defensible (FitLog $9.99, RP Diet $12.99). Research can survey 3-5 comparables and recommend.

---

## Deferred Ideas

- Lifetime SKU (v1.3+)
- DB-stored `products` table for in-app pricing experiments
- Push notification on card failure (Phase 17 PUSH-05)
- Stripe Tax / `automatic_tax` flag (likely just-a-flag for v1.2; verify)
- Promo codes / `allow_promotion_codes: true` (defer to first promo campaign)
- Admin subscriptions dashboard (Phase 22)

---

## Open Pre-flight Items for Planner

- Stripe Connect Express approval status (Phase 12 scaffolded; needs vendor-approval confirmation).
- `supabase/functions/import_map.json` Stripe SDK addition.
- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` already in Supabase Function secrets?
- Stripe SDK Deno-version constraint for `constructEventAsync` (signature verify).
- Phase 12 reserved `stripe-elements` chunk cap → won't ship; plan-checker must not flag.
- Web monthly price point — TBD via research comparable survey.
