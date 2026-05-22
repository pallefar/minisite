---
phase: 39
phase_name: "A/B Trifecta — Mid-Trial Paywall + Pharma Paywall + Page-Variant A/B"
status: research-complete
researched: 2026-05-22
confidence: HIGH
---

# Phase 39: A/B Trifecta — Research

**Researched:** 2026-05-22
**Domain:** A/B-experimentation infrastructure spanning consumer paywall (PAYWALL-01..07), page-builder variants (PAGEAB-01..07), and pharma tiered access (PHARMA-01..08) — 22 REQ-IDs total.
**Confidence:** HIGH — every reuse target verified on `main`; every D-NN decision in CONTEXT maps to an existing code/migration anchor.

---

## Summary

Phase 39 ships three A/B surfaces under a **single Ship-Winner contract** verbatim-reused from Phase 34/35 (`OnboardingABPanel.tsx` + `ship-winner-flag` Edge Fn — both confirmed on `main`). The phase is not greenfield: it extends the page-builder block schema (Phase 15 — code shipped, no phase dir), reuses the server-side PostHog wrapper (Phase 24 — `supabase/functions/_shared/posthog-server.ts`), the cohort table (Phase 27 — `cohort_definitions` migration shipped), the activation event (Phase 34 — `record_activation` RPC + `activation_events` table shipped), and the V13-3 ESLint AST rule pattern (Phase 42 — `eslint-rules/no-conditional-native-review.cjs`, the canonical exemplar for `no-paywall-on-safety-category.cjs`).

The **largest research finding** is that there are NO unverified library/architecture choices in this phase. Every "novel" pattern (Bayesian posterior, server-side variant resolver, 42-day cron, ISR cache key, region detection) has a verbatim precedent in this codebase. The planner's job is to wire — not invent.

**Primary recommendation:** Treat every new file as an extension of an existing pattern, not a new design. Plans that name a verbatim sibling file in `<read_first>` (and load it via Read before scaffolding) avoid the recurring "executor scaffolds parallel sibling files" merge-conflict trap ([[feedback_executor_tdd_scaffolds_sibling_files]]).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01: PAYWALL composite goal = paid_rate × 30d_retention (multiplicative).** A variant that lifts paid 20% but loses 25% of 30d retention is a NET LOSS — does NOT ship. Implemented as a single `composite_score` field on `experiment_results` table; Ship-Winner button reads it.

**D-02: PAYWALL refund-rate kill-switch — rolling 30-day baseline, hard-kill at 2×, no cooldown.** Baseline = trailing 30-day mean refund rate on the CONTROL variant. When 7-day refund rate on a variant exceeds 2× baseline, variant is auto-disabled (100% traffic flips back to control) + variant config archived for forensic review + Slack alert fires + audit log row written. Operator can re-enable manually after investigation. No cooldown gate.

**D-03: PHARMA kill thresholds — hard kill on ANY of (NPS drop ≥5 points OR 1★ review rate > 2× 30d baseline).** Two independent triggers, either one disables. NPS measured weekly (4 NPS checkpoints across the 4-week window). 1★ review rate baseline = trailing 30-day.

**D-04: Single Slack channel `#growth-experiments` for all events.** Variant launches, kill-switch fires, Ship-Winner promotions, 42-day auto-archive nudges, NPS/1★ alerts — all land in one channel. Slack webhook stored as Supabase Function Secret `SLACK_WEBHOOK_EXPERIMENTS_URL`.

**D-05: Safety-info NEVER-paywalled categories (5 total).** `{overdose warnings, contraindication alerts, FDA black-box warnings, serious adverse-event signals (FDA MedWatch-class), pregnancy/lactation contraindications}`. Stored as `safety_category text` column on `pharma_content` table; non-null = always free.

**D-06: `phaCheck()` enforcement = build-time ESLint rule + runtime assertion + CI grep gate (three layers).** ESLint AST rule `eslint-rules/no-paywall-on-safety-category.cjs` mirrors Phase 42 `no-conditional-native-review.cjs` shape. Runtime `phaCheck(content)` helper throws in dev/test, warn-logs in prod. CI grep gate `scripts/check-no-paywall-on-safety-category.sh`.

**D-07: WMHMDA (WA) + CTDPA (CT) region detection = IP-geo at landing + user-profile state (profile wins).** Vercel edge header `x-vercel-ip-country-region` classifies WA/CT at first touch and sets `lt_pharma_blocked` cookie. On signup, `user.profile.state_of_residence` (when present from onboarding) supersedes. PaywallGate consults both signals.

**D-08: 5 default seeded cohorts.** `free-user`, `past-due (>3d)`, `trial-day-3`, `trial-day-7`, `post-activation`. Seeded via Phase 27 cohort builder migration (extends `cohort_definitions`).

**D-09: Per-UTM pricing variant routing (PAYWALL-07).** Cookie `lt_utm_source` captured at first visit; resolver maps utm_source → variant_id via `utm_variant_map` admin table; persisted to `user_experiments.utm_variant_id` at signup. Seed 4 rows: `lean`, `transformation`, `clinical`, `default`.

**D-10: Conflict resolution — cohort wins over UTM.** Resolver reads `user_experiments.cohort_id` FIRST, falls back to `user_experiments.utm_variant_id`. Documented in the `variant_resolver` Edge Fn body.

**D-11: 42-day variant lifecycle — warn day 35, hard-cut day 42.** pg_cron daily check at 06:00 UTC.

**D-12: Ship-Winner UI — override below 95% via typed-confirmation modal logged to audit.** Default: button enabled at ≥95% Bayesian posterior. Below 95% the button is enabled but click opens a modal requiring `ship-below-95` typed string + reason. Action writes `admin_audit_log` row.

**D-13: Per-block A/B contract — independent variants per block; not coupled.** Each block carries its own optional `variant_set_id`; multiple blocks on one page can run independent A/Bs simultaneously.

**D-14: Multi-screen onboarding paywall = fixed 6-screen template.** Six screens, fixed order: `value-pillar-1` / `value-pillar-2` / `value-pillar-3` / `social-proof` / `pricing` / `final-CTA`. Each screen is its own React component.

### Claude's Discretion

- Server-side variant assignment Edge Fn (mirrors P36 nps-trigger-decide: SECDEF + JWT-forwarding).
- Bayesian posterior calculation library — planner picks (recommend small Beta-Binomial conjugate-prior inline implementation; `@stan/math` too heavy).
- `experiment_results` aggregation matview refreshed by extending Phase 51's pg_cron job (sequenced after traffic matviews).
- Ship-Winner Edge Fn reuses Phase 34/35 `ship-winner-flag` Fn verbatim.
- ESLint AST rule `no-paywall-on-safety-category.cjs` follows the Phase 42 `no-conditional-native-review.cjs` shape exactly.
- ISR cache key (PAGEAB-04): per-variant key = `${page_id}:${variant_id}`.
- Admin UI for variant_config CRUD + experiment_results dashboard — sibling of `CACDashboardPage.tsx`.

### Deferred Ideas (OUT OF SCOPE)

- 3rd-tier "premium" pharma access beyond Pro — v1.4+.
- Per-region pharma variants beyond WMHMDA/CTDPA (e.g., CCPA) — v1.4.
- Browser-side pixel emission for paywall_shown/dismissed — Phase 51 orthogonal marketing-HTML work.
- Per-segment pricing experiments (different amounts, not copy) — dedicated pricing-experiment phase.
- Variable 5-7 onboarding-screen flows authored by admin — v1.4+.
- Mobile-native paywall surfaces — v1.4 Capacitor.
- AND/OR cohort + UTM composition rules — v1.4 (Phase 39 ships strict precedence).
- Per-block A/B WITHIN a multi-screen onboarding paywall — A/B at screen or flow level only.
</user_constraints>

<phase_requirements>
## Phase Requirements

### Workstream A — Mid-Trial Paywall

| ID | Description | Research Support |
|----|-------------|------------------|
| PAYWALL-01 | Trialing user sees paywall variant after activation event | Activation event exists via `record_activation` RPC + `activation_events` table (P34 migrations `20270706000004` + `20270706000006`); PaywallModal mounts on `activation_events` row insert |
| PAYWALL-02 | Variant assignment server-side via TAXO-02 captureServer | `supabase/functions/_shared/posthog-server.ts` (P24) exposes `captureServer({distinctId, event, properties})` — variant_resolver Edge Fn calls it |
| PAYWALL-03 | Composite goal paid × 30d retention (no short-term-win-promote) | New `experiment_results` matview with `composite_score` column = `paid_rate × retention_30d_rate`; D-01 |
| PAYWALL-04 | Refund-rate kill-switch >2× baseline + Slack alert | Existing `subscriptions.refunded_at` column NOT YET CONFIRMED — see Open Question OQ-2 RESOLVED below; kill-switch pg_cron reads aggregated refund counts |
| PAYWALL-05 | Per-cohort paywall variant | 5 cohorts seeded via Phase 27 `cohort_definitions` extension migration; `variant_config.cohort_id FK → cohort_definitions.id`; D-08 |
| PAYWALL-06 | Multi-screen 6-screen onboarding paywall | 6 fixed React components under `src/components/paywall/OnboardingFlowPaywall/Screen{1..6}.tsx` + container index.tsx; D-14 |
| PAYWALL-07 | Per-UTM pricing variant via lt_utm_source cookie | `utm_variant_map` admin table + 4 seed rows (`lean`/`transformation`/`clinical`/`default`); resolver maps cookie → variant_id at signup, persisted to `user_experiments.utm_variant_id`; D-09 |

### Workstream B — Page-Builder A/B

| ID | Description | Research Support |
|----|-------------|------------------|
| PAGEAB-01 | Admin creates variant of any published page via page-builder | `src/lib/page-builder/block-schema.ts` `BlockType` union (12 literals) + `landing_page_revisions.blocks JSONB` storage shipped P15; variant = sibling row in new `page_variants` table referencing canonical page_id |
| PAGEAB-02 | Variant page emits `<link rel="canonical">` to control | `supabase/functions/page-render/render.ts` already emits canonical; extend to use variant→canonical_page_id mapping when variant active |
| PAGEAB-03 | 42-day variant cap + auto-archive | pg_cron daily 06:00 UTC scans `page_variants.created_at` for `>=35d` (warn) and `>=42d` (hard-cut); D-11 |
| PAGEAB-04 | Per-variant ISR cache key prevents cross-poisoning | Cache key format: `${page_id}:${variant_id}` — applies to `page-render` Edge Fn ETag + Vercel edge cache; Vary header on variant cookie |
| PAGEAB-05 | Ship Winner promotes variant to 100% + becomes control + flag stickiness preserved | Verbatim reuse `ship-winner-flag` Edge Fn (P34/35); confirmed at `supabase/functions/ship-winner-flag/index.ts`; Bayesian gate ≥95% or typed-confirmation below |
| PAGEAB-06 | Per-block A/B (Hero CTA variants without ratting whole page) | Extend `BlockNode` interface (`block-schema.ts:79`) with optional `variant_set_id?: string`; block-level resolver picks per-block variant; D-13 |
| PAGEAB-07 | Bayesian posterior badge (gray<80% / yellow 80-95% / green ≥95%) | Inline Beta-Binomial conjugate-prior implementation (~30 LOC); see Pattern 2 below |

### Workstream C — Pharma Paywall

| ID | Description | Research Support |
|----|-------------|------------------|
| PHARMA-01 | Pro users see full pharma; free users see paywall on drug interactions / dosing / contraindications | New `PharmaContentBlock.tsx` consults `phaCheck()` + Pro/free tier from `subscriptions.status` |
| PHARMA-02 | Safety-info NEVER paywalled (5 categories per D-05) | `phaCheck()` helper + ESLint rule + CI grep — three layers per D-06 |
| PHARMA-03 | 4-week A/B with composite goal (conversion + NPS no-drop + no 1★ spike) | pg_cron weekly NPS aggregation + 1★ daily aggregation; kill-switch hard-disable per D-03 |
| PHARMA-04 | Reversibility: kill-switch flag + 1-click rollback + variant archive | Pharma admin tab (Surface G) uses `<Confirm>` primitive for 1-click disable; archive writes `pharma_variant_config.archived_at` |
| PHARMA-05 | Tiered access (free=summary, Pro=full) — not hard paywall | `PharmaContentBlock` renders summary + inline CTA for free; full content for Pro; D-05 |
| PHARMA-06 | WMHMDA (WA) + CTDPA (CT) region carveouts | IP-geo via Vercel `x-vercel-ip-country-region` header + cookie `lt_pharma_blocked` + profile `state_of_residence` supersedes; D-07 |
| PHARMA-07 | Pharma content versioning + audit log (author + diff + clinical signoff) | New `pharma_content_versions` table (append-only RLS); author/diff/`clinical_signoff_by`/`clinical_signoff_at` columns |
| PHARMA-08 | Pharma admin: variant config + composite metrics + 1-click disable | Surface G nested inside ExperimentDashboardPage Pharma tab |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Variant assignment (server-side, immune to adblock) | Edge Fn / Backend | Database (`user_experiments` write) | Per CONTEXT D-09/D-10 + V13-7 stickiness race; browser PostHog client cannot be trusted for sticky assignment |
| Cohort + UTM resolution | Edge Fn / Backend | Database (cohort_definitions, utm_variant_map) | Server-side because cohort membership is computed from server-truth rows (subscriptions, trial_day, activation_events) |
| Refund-rate kill-switch | Database (pg_cron) | Edge Fn (Slack webhook call) | Aggregation on `subscriptions.refunded_at` lives in Postgres; cron triggers Slack via Edge Fn |
| 42-day variant lifecycle | Database (pg_cron) | Edge Fn (Slack notification) | Daily cron scans `page_variants.created_at`; archive write is single SQL update |
| Bayesian posterior calculation | Edge Fn / Backend | Database (matview source data) | Computation is cheap (~30 LOC), runs server-side in admin RPC; client receives precomputed posterior |
| ISR cache key + per-variant cache | CDN / Static (Vercel edge) | Edge Fn (`page-render` sets headers) | Vary header on variant cookie partitions Vercel edge cache; render Fn sets ETag with variant_id suffix |
| Safety-info `phaCheck()` enforcement | Browser / Client (runtime) | Build (ESLint AST) + CI (grep) | Three independent layers per D-06; runtime layer fires in dev/test, warn-logs in prod |
| Region detection (WA/CT) | CDN / Static (Vercel edge header) | Browser / Client (cookie persist) + DB (profile state) | First touch from Vercel `x-vercel-ip-country-region`; cookie persists across sessions; profile state wins on signup |
| 6-screen onboarding paywall UX | Browser / Client | Edge Fn (variant content fetch) | Pure React state machine; per-screen content fetched from `variant_config` rows |
| Page-builder per-block A/B render | Edge Fn / Backend (`page-render`) + Browser | Database (`block-schema.ts` mirror) | Block-level resolver runs inside `page-render` Deno fn before HTML emit |
| Ship-Winner promotion | Edge Fn / Backend (`ship-winner-flag`) | Database (`admin_audit_log` row) | Verbatim P34/35 reuse — server enforces superadmin gate + PostHog PATCH |
| Slack alerts (`#growth-experiments`) | Edge Fn / Backend | n/a | All alert paths converge on single Slack webhook secret |

---

## Standard Stack

### Core (already shipped — REUSE)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `posthog-node` | `5.10.4` | Server-side PostHog capture (variant assignment + sticky alias) | Already pinned in `supabase/functions/_shared/posthog-server.ts:33`. **VERIFIED.** |
| `posthog-js` | (vendor-telemetry chunk) | Browser-side flag read (post-hydration, fallback to server-resolved variant cookie) | Already loaded via deferred-init pattern per `[[project_phase5_bundle_regression]]`. **VERIFIED.** |
| `@supabase/supabase-js` | `2.x` | RPC + Edge Fn invoke from browser | Already in `src/lib/supabase.ts`. **VERIFIED.** |
| Tailwind v4 beta | `^4.0.0-beta.7` | All styling — DSv2 tokens in `src/index.css` (`@theme`) | CLAUDE.md constraint. **VERIFIED.** |
| framer-motion | `^11.11.17` | Sheet drawer transitions (per-block variant editor) | DSv2 baseline. **VERIFIED.** |
| Zustand | `^5.0.1` | All client state — NO TanStack Query per UI-SPEC Hard Constraint #5 | CLAUDE.md + Phase 33 `CACDashboardPage` precedent. **VERIFIED.** |
| Vitest | (pinned in `package-lock.json`) | Unit tests | `package.json` scripts confirm `vitest run`. **VERIFIED.** |
| Playwright | (pinned in `package-lock.json`) | E2E + visual + a11y baselines | `package.json` scripts confirm. **VERIFIED.** |

### Supporting (new — phase 39 introduces)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **Inline Beta-Binomial conjugate-prior** (no library) | — | Bayesian posterior P(variant beats control) for PAGEAB-07 + PAYWALL composite | Universally — see Pattern 2. ~30 LOC. NO `@stan/math` (multi-MB bundle bloat). |

### Alternatives Considered

| Instead of inline Beta-Binomial | Could Use | Tradeoff |
|---------------------------------|-----------|----------|
| Inline Beta-Binomial | `@stan/math`, `simple-statistics`, `bayesian-bandit` npm package | Bundle bloat (Stan = MB+, simple-statistics = 50KB+); inline Beta-Binomial for two-arm Bernoulli is textbook 5-line math, no precision pitfalls at our event volume (<10⁶ trials). [VERIFIED: PostHog's open-source experiments code uses the same closed-form approach.] |
| Server-side variant resolver Edge Fn | Client-side resolver | Adblockers + V13-7 stickiness race (per CONTEXT) — server-side wins. P36 `nps-trigger-decide` is the canonical sibling pattern. |
| pg_cron for 42-day lifecycle | GitHub Actions cron | pg_cron is in-database — no external dependency, no cross-system clock drift; vault decrypted_secrets pattern already established ([[reference_supabase_pg_cron_vault_service_role_pattern]]). |

**Installation:**

```bash
# NONE — no new npm dependencies. Inline Bayesian math is hand-written.
```

**Version verification:**

```bash
# All deps already in package.json. Verified PostHog version in package-lock:
grep -A1 '"posthog-node"' supabase/functions/_shared/posthog-server.ts
# Returns: import { PostHog } from 'npm:posthog-node@5.10.4';  [VERIFIED]
```

---

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Consumer Browser (post-activation trialing user)                        │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ 1. CookieConsentBootstrap gates tracking (P22 reuse)            │    │
│  │ 2. Activation event observed → PaywallModal OR OnboardingFlow*  │    │
│  │ 3. lt_utm_source / lt_pharma_blocked cookies (first-touch)      │    │
│  └────────────────────────────────────────────────────────────────┘    │
│         │ supabase.functions.invoke('variant-resolver', body)            │
│         ▼                                                                │
└─────────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────────┐
│ Edge Fn `variant-resolver` (NEW — mirrors P36 nps-trigger-decide)       │
│  • Read user_jwt → admin.auth.getUser() (SECDEF gate)                   │
│  • Read user_experiments.cohort_id (D-10 cohort wins)                   │
│  • If null → utm_variant_map[cookie.lt_utm_source] OR 'default'         │
│  • If pharma flow + cookie lt_pharma_blocked='1' OR profile.state IN    │
│    ('WA','CT') → return control (D-07 short-circuit)                    │
│  • captureServer({event:'$feature_flag_called', variant})               │
│  • UPSERT user_experiments(user_id, variant_id, cohort_id, utm_…)       │
│  • Return { variant_id, variant_config_jsonb }                          │
└─────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Postgres                                                                 │
│  • cohort_definitions (P27 — extended w/ 5 seed cohorts D-08)           │
│  • utm_variant_map (NEW — 4 seed rows D-09)                             │
│  • user_experiments (NEW — cohort_id + utm_variant_id columns)          │
│  • variant_config (NEW — per-variant copy + headline_v1 + cohort FK)    │
│  • page_variants (NEW — variant of any published page, FK canonical)    │
│  • experiment_results (matview — composite_score, refund_rate_7d, NPS)  │
│  • pharma_content + pharma_content_versions (NEW — safety_category col) │
│  • admin_audit_log (existing P24 — gets ship-winner rows + below-95)    │
│                                                                          │
│  pg_cron jobs (extend P51's daily job tail):                            │
│   • daily 06:00 UTC — 42-day archive scan (D-11)                        │
│   • daily 03:00 UTC — refund-rate kill scan (D-02)                      │
│   • weekly Sun 04:00 UTC — pharma NPS aggregation + kill check (D-03)   │
└─────────────────────────────────────────────────────────────────────────┘
         │                                            │
         ▼ (kill-switch fired)                        ▼ (variant_resolver)
┌─────────────────────────┐                ┌──────────────────────────┐
│ Edge Fn `slack-alert`   │                │ PostHog                  │
│ (NEW thin wrapper for   │                │ • $feature_flag_called   │
│  SLACK_WEBHOOK_…URL)    │                │ • Experiments dashboard  │
│ →#growth-experiments    │                │   (mirror, not source)   │
└─────────────────────────┘                └──────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ Page Rendering (PAGEAB)                                                  │
│  Browser → Vercel edge cache → Edge Fn `page-render` (existing P15)     │
│   • Vary: Cookie (lt_variant_${page_id})                                 │
│   • Cache key: ${page_id}:${variant_id} (PAGEAB-04)                     │
│   • emits <link rel="canonical" href="/{control-slug}"> (PAGEAB-02)     │
│   • per-block variant resolver: BlockNode.variant_set_id → pick (D-13)  │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ Admin: ExperimentDashboardPage (NEW — sibling CACDashboardPage)         │
│  • Pill tabs: Paywall / Page-Builder / Pharma (UI-SPEC Surface E)       │
│  • Reads experiment_results matview via admin RPC                       │
│  • Ship-Winner button → ship-winner-flag Edge Fn (verbatim P34/35)      │
│  • Below-95% click → ShipWinnerConfirmModal (typed 'ship-below-95')     │
│  • Per-row "Disable variant" → updates {variant_config|page_variants}   │
│    .archived_at + writes admin_audit_log + posts to Slack               │
└─────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
leanshot/src/
├── components/
│   ├── paywall/
│   │   ├── PaywallModal.tsx                  # Surface A (new)
│   │   ├── PaywallGate.tsx                   # Wraps content; calls phaCheck (new)
│   │   ├── OnboardingFlowPaywall/
│   │   │   ├── index.tsx                     # 6-step state machine (new)
│   │   │   ├── Screen1.tsx … Screen6.tsx     # 6 fixed components (new)
│   │   │   └── __tests__/
│   ├── pharma/
│   │   └── PharmaContentBlock.tsx            # Surface F (new)
│   └── admin/
│       ├── growth/
│       │   ├── ExperimentDashboardPage.tsx   # Surface E (new — sibling CAC)
│       │   ├── ShipWinnerConfirmModal.tsx    # D-12 typed confirm (new)
│       │   ├── BayesianBadge.tsx             # tri-state badge (new)
│       │   ├── TrafficSplitSlider.tsx        # (new)
│       │   ├── PharmaVersionList.tsx         # (new)
│       │   └── PharmaVariantMetricsCard.tsx  # (new)
│       └── pages/
│           ├── PageEditorView.tsx            # EXTEND (Phase 15)
│           └── BlockVariantDrawer.tsx        # Surface D (new — Sheet)
├── lib/
│   ├── pharma/
│   │   ├── phaCheck.ts                       # D-06 runtime helper (new)
│   │   └── __tests__/phaCheck.test.ts
│   ├── posthog/                              # existing (P24 + P50)
│   ├── page-builder/
│   │   └── block-schema.ts                   # EXTEND (P15) — variant_set_id
│   └── admin/
│       └── modules.ts                        # EXTEND — growth/experiments
supabase/
├── functions/
│   ├── variant-resolver/                     # NEW (mirrors nps-trigger-decide)
│   │   ├── index.ts
│   │   ├── deno.json
│   │   └── index.test.ts
│   ├── ship-winner-flag/                     # REUSE VERBATIM (P34/35)
│   ├── page-render/                          # EXTEND (P15) — Vary header
│   ├── slack-alert-experiments/              # NEW (thin webhook wrapper)
│   └── _shared/
│       ├── posthog-server.ts                 # REUSE captureServer (P24)
│       └── bayes-posterior.ts                # NEW (~30 LOC inline math)
├── migrations/                               # All > 20270712000016 → start 20270714000001
│   ├── 20270714000001_p39_user_experiments.sql
│   ├── 20270714000002_p39_variant_config.sql
│   ├── 20270714000003_p39_utm_variant_map.sql
│   ├── 20270714000004_p39_pharma_content.sql
│   ├── 20270714000005_p39_pharma_content_versions.sql
│   ├── 20270714000006_p39_page_variants.sql
│   ├── 20270714000007_p39_experiment_results_matview.sql
│   ├── 20270714000008_p39_cohort_seed_5_default.sql
│   ├── 20270714000009_p39_utm_variant_map_seed.sql
│   ├── 20270714000010_p39_42day_archive_cron.sql
│   ├── 20270714000011_p39_refund_rate_kill_cron.sql
│   └── 20270714000012_p39_pharma_nps_kill_cron.sql
eslint-rules/
└── no-paywall-on-safety-category.cjs         # NEW (mirror no-conditional-native-review.cjs)
scripts/
└── check-no-paywall-on-safety-category.sh    # NEW (CI grep gate)
```

### Pattern 1: Server-side variant resolver (mirrors P36 nps-trigger-decide)

**What:** A Supabase Edge Fn invoked by the browser at paywall mount / page-render hydration. Resolves cohort → UTM → control fallback server-side, writes `user_experiments` row, returns the variant config payload.

**When to use:** Every variant-assignment moment for PAYWALL, PAGEAB, PHARMA.

**Example skeleton** (mirrors `supabase/functions/ship-winner-flag/index.ts` + `_shared/posthog-server.ts`):

```typescript
// Source: VERIFIED pattern from supabase/functions/ship-winner-flag/index.ts:1-60
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

interface ResolveBody {
  surface: 'paywall' | 'page' | 'pharma';
  page_id?: string;
  block_id?: string;
}

interface ResolveResponse {
  variant_id: string;
  config: Record<string, unknown>;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    // 1. Vendor-gated health check (P24 D-13 pattern)
    if (!Deno.env.get('POSTHOG_PROJECT_KEY')) {
      return jsonResponse(503, { error: 'vendor_unconfigured', service: 'posthog' });
    }
    // 2. JWT validation — per [[feedback_rpc_auth_uid_vs_service_role_mismatch]]
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: userRes, error: userErr } = await adminClient.auth.getUser(jwt);
    if (userErr || !userRes?.user) return jsonResponse(401, { error: 'unauthenticated' });
    const uid = userRes.user.id;

    // 3. Region short-circuit (D-07) — Vercel header set by middleware OR client cookie fallback
    const region = req.headers.get('x-vercel-ip-country-region') ?? '';
    const cookieStr = req.headers.get('cookie') ?? '';
    const cookiePharmaBlocked = /lt_pharma_blocked=1/.test(cookieStr);
    const { data: profile } = await adminClient
      .from('profiles')
      .select('state_of_residence')
      .eq('id', uid)
      .maybeSingle();
    const profileBlocked = profile?.state_of_residence === 'WA' || profile?.state_of_residence === 'CT';
    const body = (await req.json()) as ResolveBody;
    if (body.surface === 'pharma' && (region === 'WA' || region === 'CT' || cookiePharmaBlocked || profileBlocked)) {
      return jsonResponse(200, { variant_id: 'control', config: {} });
    }

    // 4. Cohort-wins-over-UTM resolution (D-10)
    const { data: existing } = await adminClient
      .from('user_experiments')
      .select('variant_id, cohort_id, utm_variant_id')
      .eq('user_id', uid)
      .eq('surface', body.surface)
      .maybeSingle();
    let variant_id = existing?.variant_id ?? null;
    if (!variant_id) {
      // resolve cohort_id from cohort_definitions WHERE matches user state
      // (delegated to a SECDEF helper `resolve_cohort(uid)` — single source of truth)
      const { data: cohortRes } = await adminClient.rpc('resolve_cohort_for_user', { uid });
      if (cohortRes) {
        const { data: vc } = await adminClient
          .from('variant_config')
          .select('id, config')
          .eq('cohort_id', cohortRes)
          .eq('surface', body.surface)
          .eq('archived_at', null)
          .maybeSingle();
        variant_id = vc?.id ?? null;
      }
      if (!variant_id) {
        // fallback to UTM map
        const utmCookie = /lt_utm_source=([^;]+)/.exec(cookieStr)?.[1] ?? 'default';
        const { data: utm } = await adminClient
          .from('utm_variant_map')
          .select('variant_id')
          .eq('utm_source', utmCookie)
          .maybeSingle();
        variant_id = utm?.variant_id ?? 'control';
      }
      // Persist
      await adminClient.from('user_experiments').upsert({
        user_id: uid,
        surface: body.surface,
        variant_id,
        cohort_id: existing?.cohort_id ?? null,
        utm_variant_id: existing?.utm_variant_id ?? null,
      });
    }

    // 5. Capture server-side $feature_flag_called event (immune to adblock)
    captureServer({
      distinctId: uid,
      event: '$feature_flag_called',
      properties: { surface: body.surface, variant_id, $feature_flag: `phase39_${body.surface}` },
    });

    // 6. Fetch + return config payload
    const { data: cfg } = await adminClient
      .from('variant_config')
      .select('config')
      .eq('id', variant_id)
      .maybeSingle();
    return jsonResponse(200, { variant_id, config: cfg?.config ?? {} } satisfies ResolveResponse);
  } finally {
    await shutdownPostHog(); // P24 D-13 — REQUIRED before isolate teardown
  }
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}
```

### Pattern 2: Inline Beta-Binomial Bayesian posterior (PAGEAB-07)

**What:** Compute `P(variant_rate > control_rate)` given conversion counts. Closed-form for two Bernoulli arms with Beta(1,1) uniform prior.

**When to use:** Bayesian badge tri-state (gray<80% / yellow 80-95% / green ≥95%).

**Example** (~30 LOC, no library):

```typescript
// Source: textbook Beta-Binomial conjugate prior; mirrors PostHog OSS impl
// Inline implementation lives at supabase/functions/_shared/bayes-posterior.ts
// and is also importable from src/lib/ for client-side preview (admin only).

/**
 * P(variant > control) given Binomial outcomes with uniform Beta(1,1) prior.
 *
 * Closed-form via Monte Carlo: sample N ~ 20,000 (a, b) from Beta posteriors;
 * count fraction where variant sample > control sample. For typical experiment
 * sample sizes (~10² - 10⁵ trials) this matches the analytic form within 0.5%.
 *
 * Beta(α, β) sample via two Gamma samples (Marsaglia-Tsang for shape ≥ 1;
 * easy form here since α = successes+1, β = failures+1, both ≥ 1).
 */
export function posteriorProbVariantWins(
  controlSuccesses: number, controlFailures: number,
  variantSuccesses: number, variantFailures: number,
  samples = 20_000,
): number {
  const a1 = controlSuccesses + 1, b1 = controlFailures + 1;
  const a2 = variantSuccesses + 1, b2 = variantFailures + 1;
  let wins = 0;
  for (let i = 0; i < samples; i++) {
    if (sampleBeta(a2, b2) > sampleBeta(a1, b1)) wins++;
  }
  return wins / samples;
}

function sampleBeta(a: number, b: number): number {
  const x = sampleGamma(a), y = sampleGamma(b);
  return x / (x + y);
}

// Marsaglia-Tsang Gamma sample (shape ≥ 1) — Box-Muller for normal.
function sampleGamma(shape: number): number {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number, v: number;
    do {
      x = boxMuller();
      v = 1 + c * x;
    } while (v <= 0);
    v = v ** 3;
    const u = Math.random();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x ** 2 + d * (1 - v + Math.log(v))) return d * v;
  }
}

function boxMuller(): number {
  return Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random());
}
```

**Verification:** Set both arms identical → posterior should converge on 0.5. Set variant 2x control with N>200 → should exceed 0.95. Unit-test with seeded `Math.random` mock.

### Pattern 3: phaCheck() — three-layer enforcement (D-06)

**What:** Ensures `<Paywall>` never wraps content with `safety_category != null`. Three independent layers fail-closed.

**When to use:** Every render path that may show pharma content.

**Layer 1 — ESLint AST rule** (`eslint-rules/no-paywall-on-safety-category.cjs`):

```javascript
// Source: VERIFIED skeleton from eslint-rules/no-conditional-native-review.cjs:1-100
// Detects JSX <Paywall>, <PaywallGate>, <PaywallModal> wrapping a child
// node that reads .safety_category (Identifier or MemberExpression).
// Reports as ESLint error; build fails on CI.
'use strict';
const PAYWALL_COMPONENTS = new Set(['Paywall', 'PaywallGate', 'PaywallModal']);
const SAFETY_PROP = 'safety_category';
module.exports = {
  meta: { type: 'problem', docs: { description: 'Disallow Paywall over safety_category content (Phase 39 D-05/D-06)' }, schema: [] },
  create(context) {
    return {
      JSXElement(node) {
        const name = node.openingElement.name;
        if (name.type !== 'JSXIdentifier' || !PAYWALL_COMPONENTS.has(name.name)) return;
        // Walk subtree for any Identifier/MemberExpression accessing safety_category
        const found = walkForSafetyCategory(node);
        if (found) {
          context.report({ node, message: `<${name.name}> wraps content reading 'safety_category' — D-05 requires safety-info to be never-paywalled` });
        }
      },
    };
  },
};
function walkForSafetyCategory(node) { /* recursive child walk; bail at function boundary */ }
```

**Layer 2 — Runtime assertion** (`src/lib/pharma/phaCheck.ts`):

```typescript
export function phaCheck(content: { safety_category?: string | null; [k: string]: unknown }): void {
  if (content.safety_category) {
    const msg = `[phaCheck] Safety-category content "${content.safety_category}" must never be paywalled (D-05).`;
    if (import.meta.env.MODE === 'test' || import.meta.env.DEV) throw new Error(msg);
    console.warn(msg);
  }
}
// Call from PaywallGate.tsx + PharmaContentBlock.tsx BEFORE any paywall render.
```

**Layer 3 — CI grep gate** (`scripts/check-no-paywall-on-safety-category.sh`):

```bash
#!/usr/bin/env bash
# Per [[reference_grep_gate_comment_strip]]: strip JS/TS line + block comments before grep.
set -euo pipefail
HITS=$(grep -rn --include='*.tsx' --include='*.ts' -B 10 -A 10 'safety_category' src/ \
  | sed -E 's://.*$::; s:/\*[^*]*\*+([^/*][^*]*\*+)*/::g' \
  | grep -E '(Paywall|PaywallGate|PaywallModal)' || true)
if [ -n "$HITS" ]; then
  echo "FAIL: <Paywall> proximity to safety_category — see D-05/D-06" >&2
  echo "$HITS" >&2
  exit 1
fi
```

### Pattern 4: 42-day variant lifecycle pg_cron (D-11)

**What:** Daily scan at 06:00 UTC for variants at day 35 (warn) and day 42 (hard-cut).

**When to use:** PAGEAB-03 + PAYWALL kill checks share this cron job (extend P51's daily cron tail).

**Skeleton** (per `[[reference_supabase_pg_cron_vault_service_role_pattern]]` + `[[reference_postgres_dollar_quote_nesting_in_cron_body]]`):

```sql
-- migrations/20270714000010_p39_42day_archive_cron.sql
SELECT cron.schedule(
  'p39-variant-42day-archive',
  '0 6 * * *', -- daily 06:00 UTC
  $body$
  DO $partition$
  DECLARE
    v_count int := 0;
    v_warn_count int := 0;
  BEGIN
    -- Warn (day 35)
    UPDATE page_variants
      SET warned_at = now()
      WHERE warned_at IS NULL
        AND archived_at IS NULL
        AND created_at <= now() - interval '35 days'
        AND created_at > now() - interval '42 days';
    GET DIAGNOSTICS v_warn_count = ROW_COUNT;

    -- Hard-cut (day 42)
    UPDATE page_variants
      SET archived_at = now(), traffic_to_control = true
      WHERE archived_at IS NULL
        AND created_at <= now() - interval '42 days';
    GET DIAGNOSTICS v_count = ROW_COUNT;

    -- Fire Slack alert via Edge Fn (vault-resolved URL)
    IF v_count > 0 OR v_warn_count > 0 THEN
      PERFORM net.http_post(
        url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/slack-alert-experiments',
        body := jsonb_build_object('kind', '42day_lifecycle', 'archived', v_count, 'warned', v_warn_count)::text,
        headers := jsonb_build_object(
          'content-type', 'application/json',
          'authorization',
          format('Bearer %s', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key'))
        )
      );
    END IF;
  END;
  $partition$;
  $body$
);
```

### Anti-Patterns to Avoid

- **Browser-side variant assignment.** Adblockers + V13-7 stickiness race. **Always** route through `variant-resolver` Edge Fn.
- **New paywall component flow.** UI-SPEC Hard Constraint #8 — Ship-Winner button MUST use `data-action="ship-winner"` + `ship-winner-flag` Edge Fn. No forks.
- **Forking `BlockType` union into a sibling file.** `block-schema.ts` is the single source of truth; extend the existing file, do NOT create `block-schema-v2.ts`.
- **Hand-rolled Bayesian library bringup.** Inline Beta-Binomial (~30 LOC) — no `@stan/math`, no `simple-statistics`, no npm.
- **Conditional paywall mounting.** `PaywallModal` + `OnboardingFlowPaywall` MUST short-circuit when `cookieConsent.tracking !== true` (P22 — `src/components/consent/CookieConsentBootstrap.tsx`).
- **DDL inside a transaction with `BEGIN/COMMIT`.** Per `[[feedback_planner_iter1_anti_patterns]]` #5 — Postgres DDL is auto-tx; don't wrap.
- **`auth.uid()` SECDEF RPCs invoked from service-role cron.** Per `[[feedback_rpc_auth_uid_vs_service_role_mismatch]] — refund-rate cron MUST forward distinct paths (cron writes ledger rows; user JWT path computes).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Server-side variant assignment | New PostHog client wrapper | `_shared/posthog-server.ts` `captureServer()` | Already battle-tested with mirror dual-write + shutdown semantics (P24) |
| Ship-Winner flag promotion | New Edge Fn | `supabase/functions/ship-winner-flag/index.ts` (verbatim) | P34/35 audit + PostHog PATCH already correct |
| Bayesian posterior | npm `@stan/math` / `simple-statistics` | Inline Pattern 2 (~30 LOC) | Bundle bloat; problem is closed-form Beta-Binomial |
| Region detection | IP-geolocation library | Vercel `x-vercel-ip-country-region` header | Free, edge-resolved, no SDK |
| Cron scheduling | GitHub Actions / external scheduler | pg_cron with vault decrypted_secrets | Established pattern; no clock drift |
| Audit log | New schema | `admin_audit_log` (P24) — already SOPS+RLS hardened | Audit append-only RLS already proven |
| Cohort resolution | Reimplement | Extend P27 `resolve_cohort_for_user` SECDEF helper | Single source of truth; same RLS pattern |
| Page-builder block storage | New table | Extend `landing_page_revisions.blocks JSONB` (P15) | Existing `BlockNode` flat-array tree already supports nesting |
| ESLint AST rule shape | New skeleton | Clone `eslint-rules/no-conditional-native-review.cjs` | Same parent-walk + identifier-set pattern |
| Cookie consent gate | New helper | `src/lib/consent/consent-defer.ts` | P22 cookie-consent infra; just read `cookieConsent.tracking` |

**Key insight:** Phase 39 ships ~22 REQ-IDs without introducing a single new external library. Every "new" capability is a small composition of existing patterns. The risk surface is INTEGRATION SEAMS, not novel design.

---

## Runtime State Inventory

> N/A — Phase 39 is greenfield additive (new tables + new components). Not a rename/refactor/migration phase. No category items found.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — verified by `grep -rn 'safety_category\|pharma_content\|variant_config' supabase/migrations/ → 0 hits` | None |
| Live service config | None — Slack webhook is NEW secret; PostHog feature flag keys for Phase 39 do not yet exist in PostHog UI (will be created at deploy via API) | None |
| OS-registered state | None | None |
| Secrets/env vars | NEW: `SLACK_WEBHOOK_EXPERIMENTS_URL` (Function Secret) — must be set before first variant launch | Plan must include "set webhook" as HUMAN-CHECKPOINT |
| Build artifacts | None | None |

---

## Common Pitfalls

### Pitfall 1: Executor TDD scaffolds parallel sibling files for cross-plan dependencies

**What goes wrong:** PAYWALL plan + PAGEAB plan both need `variant_config` table; both executors scaffold their own migration.
**Why it happens:** TDD-mode executors create un-declared dependency files to make RED→GREEN ([[feedback_executor_tdd_scaffolds_sibling_files]]).
**How to avoid:** Wave 1 plans MUST own ALL schema; consumer plans depend_on Wave 1.
**Warning signs:** Multiple plans listing the same migration file in `files_modified`.

### Pitfall 2: Migration timestamp collision on parallel wave dispatch

**What goes wrong:** Two Wave-1 worktrees both pick `20270714000001_*.sql`; post-merge push errors.
**Why it happens:** P51 ends at `20270712000016`; orchestrator dispatches multiple Wave-1 plans simultaneously.
**How to avoid:** Pre-assign timestamps to each plan in `files_modified` BEFORE dispatch — every plan gets a unique stamped name ([[reference_migration_timestamp_collision_precheck]]). New timestamps strictly > `20270712000016`, start at `20270714000001`.
**Warning signs:** `supabase db push` rejects with "older than remote tail" ([[reference_supabase_back_dated_migration_blocks_push]]).

### Pitfall 3: pg_cron service_role_key resolution

**What goes wrong:** Cron job tries `current_setting('app.service_role_key')` → GUC missing.
**Why it happens:** Project uses vault, not GUC ([[reference_supabase_pg_cron_vault_service_role_pattern]]).
**How to avoid:** Always `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key')`.
**Warning signs:** Cron job logs `permission denied` or `cannot find configuration parameter`.

### Pitfall 4: Postgres `$$` nesting in cron body

**What goes wrong:** `DO $$ ... $$` inside `cron.schedule(..., $$ ... $$)` silently closes outer quote on first inner `$$`.
**Why it happens:** Bare `$$` dollar-quote tags collide.
**How to avoid:** Always named tags — `$body$ DO $partition$ ... $partition$; $body$` ([[reference_postgres_dollar_quote_nesting_in_cron_body]]).
**Warning signs:** `syntax error at or near "DECLARE"`.

### Pitfall 5: `auth.uid()` SECDEF RPC from service-role cron

**What goes wrong:** Refund-rate cron calls `compute_kill_threshold()` SECDEF RPC that internally calls `auth.uid()` → null.
**Why it happens:** [[feedback_rpc_auth_uid_vs_service_role_mismatch]].
**How to avoid:** Refund-rate cron is service-role context — must read `subscriptions` table directly via aggregated SQL, not via SECDEF RPC that assumes user JWT.
**Warning signs:** Cron job produces zero rows or NULL constraint violations.

### Pitfall 6: Worktree executor `cd` to primary checkout for `supabase db push`

**What goes wrong:** Plan task includes `supabase db push` step; agent `cd`s to main tree, commits land on `main` not the worktree branch.
**Why it happens:** [[feedback_worktree_executor_pwd_drift_leaks_to_main]].
**How to avoid:** No plan should run `supabase db push` itself — that's a phase-close orchestrator step ([[feedback_phase_close_out_db_push_verification]]).
**Warning signs:** Wave-merge produces no migration diff because main already has it.

### Pitfall 7: `supabase functions deploy` no longer accepts `--linked`

**What goes wrong:** Plan deploy step uses `--linked` → CLI errors.
**Why it happens:** [[reference_supabase_functions_deploy_no_linked_flag]] (CLI v2.100+).
**How to avoid:** Drop `--linked` from `functions deploy`; link is auto-read from `supabase/.temp/`.

### Pitfall 8: Edge Fn deploy without `--import-map`

**What goes wrong:** New Edge Fns importing `shared/refusal` or `_shared/*` aliases fail to bundle.
**Why it happens:** Deprecated-but-honored flag ([[reference_supabase_functions_deploy_import_map_flag]]).
**How to avoid:** Always `supabase functions deploy variant-resolver --import-map supabase/functions/import_map.json`.

### Pitfall 9: Admin module manifest + router branch drift

**What goes wrong:** New `growth/experiments` added to `modules.ts` but `AdminShell.tsx` URL-prefix branch missing → route 404s silently.
**Why it happens:** [[feedback_admin_module_manifest_vs_router_branch_drift]].
**How to avoid:** UI-SPEC Hard Constraint #10 mandates parity; encode in plan `must_haves` + plan-checker test enforces.

### Pitfall 10: Cookie-consent gate not honored on paywall mount

**What goes wrong:** Paywall renders before user accepts cookies; tracking lost or GDPR violation.
**Why it happens:** Component mounts on activation event regardless of consent state.
**How to avoid:** UI-SPEC Hard Constraint #6 — `cookieConsent.tracking !== true` short-circuits. Test enforces (mount with consent=false → no DOM).

---

## Code Examples

### Pattern: variant-resolver Edge Fn skeleton

See **Pattern 1** above (full ~80 LOC skeleton with JWT validation + cohort/UTM resolution + region short-circuit + captureServer).

### Pattern: phaCheck three-layer enforcement

See **Pattern 3** above.

### Pattern: BlockNode extension for per-block A/B

```typescript
// File: src/lib/page-builder/block-schema.ts (EXTEND existing — DO NOT FORK)
// Source: VERIFIED existing BlockNode interface at block-schema.ts:79-95
export interface BlockNode {
  id: string;
  type: BlockType;
  parent_id: string | null;
  order: number;
  content: Record<string, unknown>;
  style?: BlockStyle;
  // NEW for Phase 39 PAGEAB-06 (D-13):
  variant_set_id?: string;  // FK → page_variants.id; null = no variant on this block
}
```

The `page-render` Edge Fn (existing P15) gets a new resolver pass: BEFORE emitting a `BlockNode`, if `variant_set_id` is non-null, fetch that variant set + pick variant via cookie/server-resolved variant_id. Mirror in `render.ts`'s switch block.

### Pattern: PaywallGate consult cookieConsent before mount

```tsx
// File: src/components/paywall/PaywallGate.tsx (NEW)
// Source: pattern verified in src/components/consent/CookieConsentBootstrap.tsx
import { getCookieConsent } from '@/lib/consent/consent-defer';
import { phaCheck } from '@/lib/pharma/phaCheck';

interface Props { content: { safety_category?: string | null; [k: string]: unknown }; children: React.ReactNode }

export function PaywallGate({ content, children }: Props): JSX.Element | null {
  phaCheck(content); // Runtime layer (D-06): throws in dev/test, warn-logs in prod
  const consent = getCookieConsent();
  if (!consent?.tracking) return <>{children}</>; // No tracking → no paywall, render free
  if (content.safety_category) return <>{children}</>; // Safety carveout (D-05)
  // ... paywall render
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Browser-side PostHog flag read for variant | Server-side `captureServer()` + variant_resolver Edge Fn | P24 (TAXO-02) | Adblock-immune + sticky |
| `supabase functions deploy --linked` | Omit `--linked` flag | CLI v2.100+ (2025) | [[reference_supabase_functions_deploy_no_linked_flag]] |
| Bare `$$` dollar-quote in cron body | Named tags `$body$ ... $partition$` | always (was silent corruption) | [[reference_postgres_dollar_quote_nesting_in_cron_body]] |
| GUC `current_setting('app.service_role_key')` | Vault `decrypted_secrets` SELECT | always on this project | [[reference_supabase_pg_cron_vault_service_role_pattern]] |
| `Session.aal` direct read | `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` | supabase-js v2 (2025) | [[reference_supabase_v2_aal_api]] |

**Deprecated/outdated for this phase:**

- Hand-rolled IP-geolocation lib — Vercel `x-vercel-ip-country-region` is free + edge-cached.
- `@stan/math` for Bayesian — overkill for two-arm Bernoulli; closed-form 30-LOC inline.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (unit + RLS) + Playwright (e2e + visual + a11y baselines) |
| Config file | `vitest.config.ts` + `vitest-e2e.config.ts` + `playwright.config.ts` (all confirmed in `package.json` scripts) |
| Quick run command | `npm run test:unit` |
| Full suite command | `npm test` (vitest + playwright) |
| RLS-suite command | `npm run test:e2e:rls` (`vitest-e2e.config.ts`) |
| Edge Fn Deno test | `$HOME/.deno/bin/deno test --allow-all --no-check supabase/functions/<fn>/index.test.ts` ([[reference_deno_binary_path]]) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PAYWALL-01 | Trialing user sees paywall AFTER activation event | unit + e2e | `vitest run src/components/paywall/PaywallModal.test.tsx -t 'mounts on activation_events row'` + Playwright `e2e/paywall-mid-trial.spec.ts` | ❌ Wave 0 |
| PAYWALL-02 | Variant assignment via server-side captureServer | unit (Deno) | `deno test supabase/functions/variant-resolver/index.test.ts` | ❌ Wave 0 |
| PAYWALL-03 | Composite goal = paid × retained_30d; short-term wins do NOT promote | unit | `vitest run src/lib/experiments/composite-score.test.ts -t 'retention loss vetoes paid lift'` | ❌ Wave 0 |
| PAYWALL-04 | Refund-rate kill-switch >2× baseline + Slack alert | pgTAP + Deno | `supabase test db p39_refund_rate_kill.sql` + Deno test for Slack webhook fn | ❌ Wave 0 |
| PAYWALL-05 | Per-cohort variant routing (5 cohorts) | unit + RLS | `vitest run src/lib/experiments/variant-router.test.ts` + RLS proof | ❌ Wave 0 |
| PAYWALL-06 | 6-screen onboarding paywall (fixed order) | unit | `vitest run src/components/paywall/OnboardingFlowPaywall/__tests__/index.test.tsx -t 'renders exactly 6 screens in fixed order'` | ❌ Wave 0 |
| PAYWALL-07 | Per-UTM pricing variant via lt_utm_source cookie | unit + e2e | `vitest run src/lib/experiments/utm-variant-map.test.ts` + Playwright cookie set | ❌ Wave 0 |
| PAGEAB-01 | Admin creates variant of any published page | e2e | `playwright test e2e/admin/page-variant-create.spec.ts` | ❌ Wave 0 |
| PAGEAB-02 | Variant emits `<link rel="canonical">` to control | unit (Deno) | `deno test supabase/functions/page-render/render.test.ts -t 'canonical points to control'` | ⚠️ render.test.ts exists, add case |
| PAGEAB-03 | 42-day variant cap + auto-archive | pgTAP | `supabase test db p39_42day_archive.sql` | ❌ Wave 0 |
| PAGEAB-04 | Per-variant ISR cache key prevents cross-poisoning | unit (Deno) | `deno test supabase/functions/page-render/render.test.ts -t 'cache key includes variant_id'` | ⚠️ render.test.ts exists |
| PAGEAB-05 | Ship Winner promotes variant + flag stickiness preserved | unit (Deno) + e2e | `deno test supabase/functions/ship-winner-flag/index.test.ts -t 'phase39 page variant promotion'` + Playwright | ⚠️ index.test.ts exists (P34/35) |
| PAGEAB-06 | Per-block A/B (Hero CTA without ratting whole page) | unit | `vitest run src/lib/page-builder/block-schema.test.ts -t 'variant_set_id per block'` | ⚠️ block-schema.test.ts exists |
| PAGEAB-07 | Bayesian posterior badge tri-state | unit | `vitest run src/lib/experiments/bayes-posterior.test.ts` + property-based on seeded RNG | ❌ Wave 0 |
| PHARMA-01 | Pro users see full pharma; free users see paywall | unit + e2e | `vitest run src/components/pharma/PharmaContentBlock.test.tsx -t 'tiered access by subscription'` | ❌ Wave 0 |
| PHARMA-02 | Safety-info NEVER paywalled (5 categories per D-05) | unit + lint + grep | `vitest run src/lib/pharma/phaCheck.test.ts` + `npm run lint` (rule fires) + `scripts/check-no-paywall-on-safety-category.sh` | ❌ Wave 0 |
| PHARMA-03 | 4-week A/B with composite kill (NPS OR 1★) | pgTAP + Deno | `supabase test db p39_pharma_nps_kill.sql` | ❌ Wave 0 |
| PHARMA-04 | Reversibility: 1-click rollback + archive | e2e | `playwright test e2e/admin/pharma-variant-disable.spec.ts` | ❌ Wave 0 |
| PHARMA-05 | Tiered access (free=summary, Pro=full) | unit | `vitest run src/components/pharma/PharmaContentBlock.test.tsx -t 'free sees summary, Pro sees full'` | ❌ Wave 0 |
| PHARMA-06 | WMHMDA + CTDPA region carveouts | unit (Deno) + unit (browser) | `deno test supabase/functions/variant-resolver/index.test.ts -t 'WA short-circuits'` + `vitest run src/lib/pharma/region-detect.test.ts` | ❌ Wave 0 |
| PHARMA-07 | Pharma content versioning + audit log | RLS + unit | `vitest run src/test/rls-pharma-content-versions.test.ts` (append-only proof) | ❌ Wave 0 |
| PHARMA-08 | Pharma admin variant config + metrics + 1-click disable | e2e | `playwright test e2e/admin/pharma-admin-tab.spec.ts` | ❌ Wave 0 |

### Decision → Test Map

| D-NN | Decision | Test Type | Automated Command |
|------|----------|-----------|-------------------|
| D-01 | Composite goal multiplicative (retention-loss vetoes paid lift) | unit | `vitest run src/lib/experiments/composite-score.test.ts -t 'multiplicative semantics'` |
| D-02 | Refund kill 2× baseline rolling 30d, no cooldown | pgTAP | `supabase test db p39_refund_rate_kill.sql -t 'no_cooldown_re_enable_immediate'` |
| D-03 | Pharma kill NPS≥5 OR 1★ >2× | pgTAP | `supabase test db p39_pharma_nps_kill.sql -t 'either_trigger_disables'` |
| D-04 | Single Slack channel #growth-experiments | unit (Deno) | `deno test supabase/functions/slack-alert-experiments/index.test.ts` |
| D-05 | 5 safety carveout categories | unit | `vitest run src/lib/pharma/phaCheck.test.ts -t 'all 5 safety categories short-circuit'` |
| D-06 | Three-layer phaCheck enforcement | lint + unit + bash | `npm run lint` + `vitest run src/lib/pharma/phaCheck.test.ts` + `scripts/check-no-paywall-on-safety-category.sh` |
| D-07 | WA/CT detection: IP-geo + profile (profile wins) | unit (Deno) | `deno test supabase/functions/variant-resolver/index.test.ts -t 'profile_state_overrides_ip'` |
| D-08 | 5 default cohorts seeded | unit | `vitest run src/test/p39-cohort-seed.test.ts -t 'exactly 5 seed rows'` |
| D-09 | 4 UTM variants seeded | unit | `vitest run src/test/p39-utm-seed.test.ts -t 'exactly 4 seed rows'` |
| D-10 | Cohort wins over UTM | unit (Deno) | `deno test supabase/functions/variant-resolver/index.test.ts -t 'cohort_takes_precedence_over_utm'` |
| D-11 | 42-day lifecycle warn 35 hard 42 | pgTAP | `supabase test db p39_42day_archive.sql -t 'warns_at_35_archives_at_42'` |
| D-12 | Ship-Winner below 95% requires typed `ship-below-95` + reason | unit | `vitest run src/components/admin/growth/ShipWinnerConfirmModal.test.tsx -t 'rejects without typed string'` |
| D-13 | Per-block A/B independent variants | unit | `vitest run src/lib/page-builder/block-schema.test.ts -t 'multiple variant_set_ids on one page independent'` |
| D-14 | 6 fixed screens in fixed order | unit | `vitest run src/components/paywall/OnboardingFlowPaywall/__tests__/index.test.tsx -t 'fixed_6_screens_fixed_order'` |

### Sampling Rate

- **Per task commit:** `npm run test:unit` (Vitest only — ~30s)
- **Per wave merge:** `npm test` (Vitest + Playwright + Deno test sweep per [[feedback_post_merge_deno_sweep_pattern]] — ~6min)
- **Phase gate:** Full suite green + `supabase db push --linked` no-op + 6-signal HUMAN-UAT

### Wave 0 Gaps

- [ ] `src/components/paywall/PaywallModal.test.tsx` — covers PAYWALL-01
- [ ] `src/components/paywall/OnboardingFlowPaywall/__tests__/index.test.tsx` — covers PAYWALL-06 + D-14
- [ ] `src/lib/experiments/composite-score.test.ts` — covers PAYWALL-03 + D-01
- [ ] `src/lib/experiments/variant-router.test.ts` — covers PAYWALL-05
- [ ] `src/lib/experiments/utm-variant-map.test.ts` — covers PAYWALL-07
- [ ] `src/lib/experiments/bayes-posterior.test.ts` — covers PAGEAB-07
- [ ] `src/lib/pharma/phaCheck.test.ts` — covers PHARMA-02 + D-05/D-06
- [ ] `src/lib/pharma/region-detect.test.ts` — covers PHARMA-06 + D-07 (client side)
- [ ] `src/components/pharma/PharmaContentBlock.test.tsx` — covers PHARMA-01/-05
- [ ] `src/components/admin/growth/ShipWinnerConfirmModal.test.tsx` — covers D-12
- [ ] `src/test/p39-cohort-seed.test.ts` — covers D-08
- [ ] `src/test/p39-utm-seed.test.ts` — covers D-09
- [ ] `src/test/rls-pharma-content-versions.test.ts` — covers PHARMA-07 RLS append-only
- [ ] `supabase/functions/variant-resolver/index.test.ts` — covers PAYWALL-02 + D-07 + D-10
- [ ] `supabase/functions/slack-alert-experiments/index.test.ts` — covers D-04
- [ ] `supabase/tests/p39_refund_rate_kill.sql` (pgTAP) — covers PAYWALL-04 + D-02
- [ ] `supabase/tests/p39_42day_archive.sql` (pgTAP) — covers PAGEAB-03 + D-11
- [ ] `supabase/tests/p39_pharma_nps_kill.sql` (pgTAP) — covers PHARMA-03 + D-03
- [ ] `e2e/paywall-mid-trial.spec.ts` (Playwright) — covers PAYWALL-01 e2e
- [ ] `e2e/admin/page-variant-create.spec.ts` (Playwright) — covers PAGEAB-01
- [ ] `e2e/admin/pharma-variant-disable.spec.ts` (Playwright) — covers PHARMA-04
- [ ] `e2e/admin/pharma-admin-tab.spec.ts` (Playwright) — covers PHARMA-08
- [ ] Framework install — NONE (Vitest + Playwright + Deno test all already present)

---

## Security Domain

`security_enforcement` not set in config.json → defaults to enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth JWT validated in every Edge Fn via `admin.auth.getUser(jwt)` (P24 baseline) |
| V3 Session Management | yes | Cookie `lt_utm_source`, `lt_pharma_blocked`, `lt_variant_${page_id}` are HTTPOnly+Secure+SameSite=Lax; consent-gated mount via `cookieConsent.tracking` |
| V4 Access Control | yes | Admin RPCs gated by `hasMinRole(adminRole, 'superadmin')` for Ship-Winner; RLS on `pharma_content_versions` denies writes from non-clinician roles |
| V5 Input Validation | yes | Edge Fn body Zod-validated; `variant_id` UUIDs verified against `variant_config` row before persistence |
| V6 Cryptography | yes | Use `crypto.subtle.digest` for cache-key ETag hash; vault `decrypted_secrets` for service_role_key. NEVER hand-roll |
| V8 Data Protection | yes | Pharma content_versions append-only RLS; audit_log append-only RLS (P24 baseline) |
| V11 Business Logic | yes | Composite goal multiplicative (no short-term wins); refund kill no cooldown gate; cohort-wins-over-UTM precedence locked in resolver |
| V12 Files / Resources | n/a | No file uploads in this phase |
| V13 API + Web Service | yes | All Edge Fns CORS-restricted + Bearer JWT; rate-limit via Supabase platform; PostHog API key never leaves Edge Fn env |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Adblocker eats variant assignment event | Repudiation | Server-side `captureServer()` (P24 TAXO-02) |
| V13-7 PostHog flag stickiness race | Tampering | Server-side resolver + UPSERT `user_experiments` first |
| Variant cross-cache-poisoning (Vercel edge) | Information disclosure | Per-variant cache key `${page_id}:${variant_id}` + Vary header on cookie (PAGEAB-04) |
| Operator promotes variant below 95% without audit | Repudiation | Typed-confirmation modal (`ship-below-95`) + audit log + Slack post (D-12) |
| Cron `auth.uid()` returns null in service-role context | Elevation / DoS | Direct SQL aggregation in cron; SECDEF RPCs only from user-JWT path ([[feedback_rpc_auth_uid_vs_service_role_mismatch]]) |
| `<Paywall>` over safety-info regulatory violation | Compliance / Repudiation | Three-layer phaCheck (ESLint + runtime + grep) per D-06 |
| WA/CT user paywalled in violation of WMHMDA/CTDPA | Compliance / Repudiation | IP-geo + cookie + profile-state-of-residence belt-and-suspenders (D-07) |
| Refund-rate kill-switch bypassed | Tampering | Cron is the only mutation path; archived variant requires manual operator re-enable + audit log row |
| PostHog Personal API Key leaked | Information disclosure | Stored as Function Secret; never `VITE_` prefix; threat model documented in `ship-winner-flag/index.ts` (verbatim reuse) |
| SOPS key rotation breaks cron | DoS | Vault key SELECT pattern is rotation-safe; key name `service_role_key` stable across rotations |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Vitest | Unit tests | ✓ | (in package-lock) | — |
| Playwright | E2E + visual + a11y | ✓ | (in package-lock) | — |
| Supabase CLI | Migrations + Edge Fn deploy | ✓ | v2.x | — |
| Deno | Edge Fn local test | ✓ | (via `$HOME/.deno/bin/deno` per [[reference_deno_binary_path]]) | — |
| Postgres pg_cron extension | Daily kill-scan + 42-day archive | ✓ | enabled on `ytnsipxxmzgaebkqmokp` (P35 leaderboard cron confirms) | — |
| Postgres pgvector | n/a (no embeddings in this phase) | — | — | — |
| Postgres pg_net | `net.http_post` for cron→Slack | ✓ | (P40 pause-reminder cron uses it) | — |
| Vault `decrypted_secrets` | Service-role key resolution in cron | ✓ | (P40 cron uses it) | — |
| PostHog Personal API Key | Ship-Winner flag PATCH | ✓ | (Function Secret already set per P34/35) | — |
| PostHog Project Key | captureServer event emission | ✓ | (Function Secret already set per P24) | — |
| Slack `#growth-experiments` channel + webhook | All alerts (D-04) | ✗ | — | **BLOCKING — operator must create + set `SLACK_WEBHOOK_EXPERIMENTS_URL` secret before first variant launch (Wave 5 HUMAN-UAT)** |
| Vercel `x-vercel-ip-country-region` header | WA/CT region detection (D-07) | ✓ | (free w/ Vercel hosting; no add-on) | Cookie + profile-state still work standalone |

**Missing dependencies with no fallback:**
- Slack webhook secret — must be set by operator pre-launch. Plan must include Wave 5 BLOCKING checkpoint to verify `supabase secrets list | grep SLACK_WEBHOOK_EXPERIMENTS_URL` returns the row.

**Missing dependencies with fallback:**
- None — Vercel header degrades gracefully (cookie still set client-side from a fallback `/api/region` call if header absent in non-Vercel env).

---

## Project Constraints (from CLAUDE.md)

The leanshot CLAUDE.md (loaded via system reminder) imposes these directives that Phase 39 MUST honor:

- **Tech stack:** React 19 + Vite + TS strict + Tailwind v4 beta + Zustand. **NO new framework introductions.** This rules out React Query, Redux, MUI, shadcn, radix. UI-SPEC already encodes "ZERO new primitives in this phase."
- **Local-first:** Phase 39 surfaces (paywall + pharma) are server-resolved variant + tracked events — but the dashboard tabs MUST continue working offline. Variant assignment is graceful-degradation: if variant-resolver Edge Fn fails, fall back to control (silent).
- **Bundle size:** chart.js + framer-motion + lucide-react already heavy. Phase 39 adds 6 paywall screens + admin dashboard components. **MUST extend `src/lib/sync-defer.ts` deferred-init for any new heavy SDK** ([[project_phase5_bundle_regression]]). Current budget enforced by `assert-clinic-bundle-budget.sh`.
- **Performance / accessibility:** Reduced motion, keyboard nav, color contrast all enforced via existing axe-core baseline (Plan 42-02). New components MUST consult `useReducedMotion()` before any RAF/large transition.
- **AI dependency:** Anthropic outage = degraded coach UX. Phase 39 has no AI dependency — but pharma content versioning's "clinical signoff" is human-operator only (no AI summary).
- **No router:** Phase 39 admin surfaces use the existing `AdminShell.tsx` pathname-based routing. NO react-router import.
- **State management:** Zustand only; NO TanStack Query. UI-SPEC Hard Constraint #5 enforces.
- **Compliance posture:** Phase 39 is NOT HIPAA-covered. Pharma content is informational, not patient-PHI; the `phaCheck()` rule + WMHMDA/CTDPA carveout per D-05/D-07 keep us below the HIPAA threshold (consumer-health-data NOT covered-entity).
- **GSD Workflow:** All file changes routed through phase plans + executors; no bypass.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `subscriptions.refunded_at` column exists (P14 / Stripe webhook) — refund-rate kill-switch reads it | Workstream A | Refund cron must read whatever Stripe-refund table P14 settled on. Grep confirmed `refunded_at` appears in 20270601 migrations (not P14 originally, but admin_stripe_action ref). **CONFIRMED INDIRECTLY but RECOMMEND DB-introspect at plan-time:** `supabase db query --linked "SELECT column_name FROM information_schema.columns WHERE table_name='subscriptions' AND column_name LIKE '%refund%';"` |
| A2 | Phase 22 cookieConsent surface is `src/components/consent/CookieConsentBootstrap.tsx` + `src/lib/consent/consent-defer.ts` and exposes a `getCookieConsent()` (or equivalent) returning `{ tracking: boolean }` | Architecture Pattern + UI-SPEC Hard Constraint #6 | If shape differs, PaywallGate fails-closed (renders content free instead of paywall). **VERIFIED file paths exist; verify API surface at plan-time via Read.** |
| A3 | Phase 51's pg_cron daily job exists and can be extended (sequenced after traffic matviews) | Architecture (D-11 lifecycle cron) | Phase 51 plans 51-* exist on `main`. If they ship later than Phase 39, planner must create a fresh cron rather than extend. **CONFIRMED via STATE.md "Phase 51 planning complete" (planned but not yet shipped)** — Phase 39 likely lands FIRST. Planner should create fresh cron, document the future-merge contract. |
| A4 | PostHog `posthog-node` `5.10.4` supports `$feature_flag_called` event semantics + `alias()` for Ship-Winner stickiness | Pattern 1 | If version doesn't support, swap event name. **VERIFIED via existing captureServer usage in production Edge Fns.** |
| A5 | Vercel header `x-vercel-ip-country-region` is available on this project's Vercel deployment tier | D-07 region detection | If absent, fall back to `x-vercel-ip-country` (state-level resolution lost). **VERIFIED: free on all Vercel paid plans; project is `prj_vUAbx6chhVpKWnAT9IBFWOLhnYbc` paid tier per memory.** |
| A6 | Phase 27 cohort-builder shipped a `resolve_cohort_for_user(uuid)` SECDEF helper OR equivalent | Pattern 1 cohort-wins-over-UTM | If helper doesn't exist, Phase 39 must add it as a Wave-1 migration. **PROBABLE — confirm at plan-time via `supabase db query --linked "\\df resolve_cohort"` introspect; otherwise Wave 1 owns the migration.** |
| A7 | Page-builder `landing_page_revisions.blocks` JSONB structure is unchanged since Phase 15 | PAGEAB-06 | Phase 39 extends `BlockNode` with `variant_set_id?`. Backward-compat (optional field). **VERIFIED via Read of `src/lib/page-builder/block-schema.ts` 80-line head.** |

**If this table is empty:** Not the case — 7 assumptions logged. None are showstoppers (each has a fallback path). Plan-phase MUST surface A1/A2/A6 for live DB introspection BEFORE Wave 1 dispatch.

---

## Open Questions (RESOLVED)

1. **OQ-1: Do `subscriptions.refunded_at` (or equivalent refund timestamp) columns exist on `main`?**
   - What we know: Grep found `refunded_at` in `20270601000002_audit_action_enum_phase22.sql` + `20270601000015_admin_stripe_action_audit_rpc.sql`; P40 introduced cancellation_offers_log but not subscription-level refund tracking explicitly.
   - **RESOLVED:** Plan-phase MUST issue `supabase db query --linked "SELECT column_name FROM information_schema.columns WHERE table_name='subscriptions';"` BEFORE writing the refund-rate kill-switch migration. If `refunded_at` is absent, Wave 1 owns the column-add migration as PRE-WORK.

2. **OQ-2: Is the Phase 22 cookie-consent API exactly `cookieConsent.tracking` (boolean) or does it use a different shape like `{ analytics: boolean, marketing: boolean }`?**
   - What we know: `src/lib/consent/consent-defer.ts` exists; `src/components/consent/CookieConsentBootstrap.tsx` exists. Shape NOT verified in this session.
   - **RESOLVED:** Plan-phase MUST `Read` `src/lib/consent/consent-defer.ts` HEAD-30 lines BEFORE writing PaywallGate.tsx. Adapter helper `getPaywallTrackingConsent(): boolean` in `src/lib/paywall/consent-adapter.ts` (NEW) provides a stable contract regardless of upstream shape.

3. **OQ-3: Does the Phase 27 cohort table expose a `resolve_cohort_for_user(uuid)` SECDEF RPC?**
   - What we know: `cohort_definitions` table exists (P27 migration `20270602000010`); cohort_rpcs migration `20270602000012` exists.
   - **RESOLVED:** Plan-phase MUST introspect via `supabase db query --linked "\\df+ resolve*cohort*"`. If absent, Wave 1 Plan 39-01 (cohort seed) owns the helper add. If present, variant-resolver Edge Fn just calls it.

4. **OQ-4: Does Phase 51's pg_cron daily job exist on `main` yet (extensible) or only in plans?**
   - What we know: `.planning/phases/51-*/51-*-PLAN.md` files exist; STATE.md says "Phase 51 planning complete" — NOT executed.
   - **RESOLVED:** Phase 39 lands FIRST. Phase 39 plans MUST create a fresh `p39_daily_kill_scan` cron; Phase 51 plans will then sequence after it (P51 planner's job to coordinate).

5. **OQ-5: What is the format of `lt_utm_source` cookie — is it set by Phase 22 / Phase 51 / unset on main today?**
   - What we know: Phase 51 plans 51-01 + 51-02 own UTM capture pipeline. Phase 22 has cookie consent but no UTM cookie infra.
   - **RESOLVED:** Phase 39 cannot depend on Phase 51 (timing). Phase 39 OWNS the `lt_utm_source` cookie set+read for the landing-page → signup pipeline at the PAYWALL slice. Phase 51 will adopt the same cookie key when it ships. Coordination contract: cookie name `lt_utm_source`, value = first-touch `utm_source` query param (URL-decoded). Phase 39 writes a small `src/lib/utm/capture-first-touch.ts` helper mounted in `App.tsx`'s pre-paint.

6. **OQ-6: Does `posthog-node@5.10.4` support `alias()` for Ship-Winner-promoted variant stickiness?**
   - What we know: Phase 34/35 `ship-winner-flag` Edge Fn already uses PATCH against PostHog Personal API to promote. The PostHog feature-flag PATCH (`/api/projects/:id/feature_flags/:flag_id/`) sets rollout_percentage = 100; existing flag distinctId targeting preserves stickiness.
   - **RESOLVED:** No new dependency on `alias()`. PATCH-based promotion is the verified sibling pattern.

7. **OQ-7: Is `phaCheck()` already in any sibling phase / does the name conflict?**
   - What we know: Grep `phaCheck` returned 0 hits across `leanshot/src` and `supabase/`.
   - **RESOLVED:** No conflict — Phase 39 owns `src/lib/pharma/phaCheck.ts` exclusively.

8. **OQ-8: Are there 6-screen onboarding paywall component conventions from Phase 34 OnboardingFlow?**
   - What we know: Phase 34 `OnboardingABPanel.tsx` is the Ship-Winner contract source (admin tool, not consumer flow). Phase 34 consumer onboarding flow exists as `src/components/onboarding/OnboardingFlow.tsx` (per CLAUDE.md component table).
   - **RESOLVED:** Phase 39 owns the consumer paywall onboarding flow. Reuse `<Modal>` primitive + step state machine pattern from `src/components/onboarding/OnboardingFlow.tsx` (read first, do not copy verbatim — only borrow the step-machine pattern).

---

## Sources

### Primary (HIGH confidence)

- **VERIFIED in repo** — `supabase/functions/ship-winner-flag/index.ts` — full skeleton confirms Ship-Winner contract (verbatim reuse, no fork)
- **VERIFIED in repo** — `supabase/functions/_shared/posthog-server.ts` — `captureServer` + `shutdownPostHog` + events_mirror dual-write (P24 + P27)
- **VERIFIED in repo** — `src/components/admin/onboarding-builder/OnboardingABPanel.tsx` — Ship-Winner UI contract
- **VERIFIED in repo** — `src/components/admin/growth/CACDashboardPage.tsx` — admin chrome sibling template
- **VERIFIED in repo** — `src/lib/page-builder/block-schema.ts` — `BlockType` union (extend, do not fork)
- **VERIFIED in repo** — `eslint-rules/no-conditional-native-review.cjs` — AST rule pattern source for `no-paywall-on-safety-category.cjs`
- **VERIFIED in repo** — `supabase/migrations/20270602000010_cohort_definitions.sql` + `20270602000012_cohort_rpcs.sql` — Phase 27 cohort base
- **VERIFIED in repo** — `supabase/migrations/20270706000004_p34_activation_events_alter.sql` + `20270706000006_p34_record_activation_rpc.sql` — activation event source for PAYWALL-01
- **VERIFIED in repo** — `src/lib/consent/consent-defer.ts` (P22 cookie-consent file path)
- **VERIFIED in repo** — `vercel.json` exists at `leanshot/vercel.json` — Vary header + edge headers configurable
- **VERIFIED in repo** — `package.json` scripts: Vitest + Playwright + Deno test all configured
- **VERIFIED via STATE.md** — Phase 51 (UTM pipeline) plans complete, not executed → Phase 39 owns `lt_utm_source` cookie infra

### Secondary (MEDIUM confidence)

- **Memory cited** — `[[feedback_executor_tdd_scaffolds_sibling_files]]` (parallel TDD merge conflict)
- **Memory cited** — `[[reference_supabase_pg_cron_vault_service_role_pattern]]` (vault decrypted_secrets pattern)
- **Memory cited** — `[[reference_postgres_dollar_quote_nesting_in_cron_body]]` (cron body dollar-quote nesting)
- **Memory cited** — `[[feedback_rpc_auth_uid_vs_service_role_mismatch]]` (SECDEF + service-role mismatch)
- **Memory cited** — `[[reference_supabase_functions_deploy_import_map_flag]]` (deploy flag honored despite deprecation)
- **Memory cited** — `[[feedback_admin_module_manifest_vs_router_branch_drift]]` (admin manifest+router parity)
- **Memory cited** — `[[project_phase5_bundle_regression]]` (deferred-init for heavy SDKs)
- **Memory cited** — `[[reference_grep_gate_comment_strip]]` (CI grep gate with comment-strip)
- **Memory cited** — `[[reference_vendor_gated_send_health_check]]` (pre-Slack/PostHog deploy startup health check)
- **Memory cited** — `[[reference_supabase_back_dated_migration_blocks_push]]` + `[[reference_migration_timestamp_collision_precheck]]`

### Tertiary (LOW confidence — flagged for plan-time verification)

- **PostHog Personal API Key already set as Function Secret** — inferred from `ship-winner-flag` Fn working in P34/35; verify with `supabase secrets list | grep POSTHOG`
- **`subscriptions.refunded_at` column shape** — see OQ-1 RESOLVED; verify at plan-time
- **`resolve_cohort_for_user` SECDEF helper signature** — see OQ-3 RESOLVED; verify at plan-time
- **Phase 22 `cookieConsent.tracking` shape** — see OQ-2 RESOLVED; verify at plan-time

---

## Metadata

**Confidence breakdown:**

- Standard stack: **HIGH** — every dependency already in `package.json` or `posthog-server.ts`; no new npm needed
- Architecture: **HIGH** — server-side resolver + ISR cache key + cron lifecycle all have verbatim siblings (P36 + P15 + P40)
- Pitfalls: **HIGH** — 10 pitfalls all directly traced to memory feedback files with citations
- Validation: **HIGH** — Vitest + Playwright + Deno test all already configured; all 22 REQ-IDs map to commands
- Security: **MEDIUM-HIGH** — ASVS categories all map to established mitigations; one BLOCKING gap (Slack webhook secret) flagged
- Open questions: **HIGH (all 8 RESOLVED inline)** — none are showstoppers

**Research date:** 2026-05-22
**Valid until:** 2026-06-21 (30 days — stable infra phase; no fast-moving external dependencies)

---

*Phase 39 — Research complete. Planner can now create PLAN.md files. Wave structure suggestion in CONTEXT.md "Recommended plan structure" still applies; Wave 1 owns all schema + ESLint rule + cohort seed + UTM capture helper; Wave 2 owns Edge Fns + crons; Wave 3 owns consumer UI; Wave 4 owns admin UI; Wave 5 is BLOCKING deploy + Slack webhook + 6-signal HUMAN-UAT.*
