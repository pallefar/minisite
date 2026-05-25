---
phase: 39
phase_name: "A/B Trifecta — Mid-Trial Paywall + Pharma Paywall + Page-Variant A/B"
status: ready-for-research
gathered: 2026-05-22
---

# Phase 39: A/B Trifecta — Mid-Trial Paywall + Pharma Paywall + Page-Variant A/B — Context

**Gathered:** 2026-05-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Three A/B surfaces ship together under a single phase, sharing a common Ship-Winner contract + composite-goal measurement infrastructure:

**Workstream A — Mid-Trial Paywall (PAYWALL-01..07)**
- Trialing users see paywall variant AFTER the Phase 34 activation event (NOT at signup, NOT at trial end).
- Server-side PostHog variant assignment via Phase 24 `captureServer()` (immune to adblockers + V13-7 stickiness race).
- Composite goal = paid_rate × 30d_retention (multiplicative — a variant that lifts paid but tanks retention does NOT ship).
- Refund-rate kill-switch hard-disables variant when 7-day refund rate > 2× rolling 30-day CONTROL baseline.
- Per-cohort variant routing (5 default cohorts) + per-UTM pricing-page variant; cohort wins conflict resolution.
- Multi-screen onboarding paywall = fixed 6-screen template (value-1/value-2/value-3/social-proof/pricing/final-CTA).

**Workstream B — Page-Builder A/B (PAGEAB-01..07)**
- Admin creates variant of any published page via Phase 15 page-builder editor; PostHog flag controls traffic split.
- Every variant page emits `<link rel="canonical">` to control page (avoids V13-4 silent SEO penalty).
- 42-day variant auto-archive lifecycle: warn day 35, hard-cut day 42 (traffic flips back to control + post-mortem prompt).
- Per-variant ISR cache key prevents control + variant cross-cache-poisoning.
- "Ship Winner" promotes variant to 100% + becomes new control + PostHog flag stickiness preserved (REUSE Phase 34/35 OnboardingABPanel contract).
- Bayesian significance badge: gray <80% / yellow 80-95% / green ≥95%. Ship-Winner overridable below 95% via typed-confirmation modal.
- Per-block A/B (Hero CTA variants without re-running the whole page).

**Workstream C — Pharmacology Paywall (PHARMA-01..08)**
- Free users see 1-2 sentence content summaries; Pro users see full drug interactions / dosing / contraindications (tiered access, NOT hard paywall — lower backlash per V13-PHARMA-03).
- Safety-info ALWAYS free for everyone: {overdose warnings, contraindication alerts, FDA black-box warnings, serious adverse-event signals, pregnancy/lactation contraindications}.
- `phaCheck()` helper enforces safety-info carveout via THREE independent layers: ESLint AST rule (build-time) + runtime assertion + CI grep gate (mirrors Phase 36 V13-3 rule pattern).
- WMHMDA (WA) + CTDPA (CT) state-of-residence: pharma paywall disabled for detected WA/CT users; detection = IP-geo at landing + profile state-of-residence supersedes (both, profile wins).
- 4-week A/B with composite kill: ANY of (NPS drop ≥5 points OR 1★ review rate > 2× 30d baseline) hard-disables variant.
- Pharma content versioning + audit log (every pharma copy change creates `pharma_content_versions` row).

**Out of scope (explicit):**
- New paywall surfaces beyond mid-trial + pharma (cancel-save paywall is Phase 40).
- Multi-touch attribution beyond first/last touch (Phase 51 owns).
- Pricing model changes (still single price point, Stripe-driven; price experiments are copy-only, not amount).
- Variant config UI for non-page-builder surfaces (only page-builder gets the rich editor; PAYWALL + PHARMA variants are admin-config rows).

</domain>

<decisions>
## Implementation Decisions

### Composite-Goal + Kill-Switch Policy (PAYWALL-03/04 + PHARMA-03)

- **D-01: PAYWALL composite goal = paid_rate × 30d_retention (multiplicative).** A variant that lifts paid 20% but loses 25% of 30d retention is a NET LOSS — does NOT ship. Implemented as a single composite_score field on `experiment_results` table; Ship-Winner button reads it. Aligns with REQUIREMENTS.md PAYWALL-03 "short-term wins that hurt retention DO NOT promote".
- **D-02: PAYWALL refund-rate kill-switch — rolling 30-day baseline, hard-kill at 2×, no cooldown.** Baseline = trailing 30-day mean refund rate on the CONTROL variant. When 7-day refund rate on a variant exceeds 2× baseline, variant is auto-disabled (100% traffic flips back to control) + variant config archived for forensic review + Slack alert fires + audit log row written. Operator can re-enable manually after investigation. No cooldown gate — re-enable is gated by operator intent, not by time.
- **D-03: PHARMA kill thresholds — hard kill on ANY of (NPS drop ≥5 points OR 1★ review rate > 2× 30d baseline).** Two independent triggers, either one disables. NPS measured weekly (PHARMA-03 4-week window means 4 NPS checkpoints). 1★ review rate baseline = trailing 30-day. Conservative posture matches consumer-health-data regulatory profile.
- **D-04: Single Slack channel `#growth-experiments` for all events.** Variant launches, kill-switch fires, Ship-Winner promotions, 42-day auto-archive nudges, NPS/1★ alerts — all land in one channel. Slack webhook stored as Supabase Function Secret `SLACK_WEBHOOK_EXPERIMENTS_URL`. Operator subscribes.

### Pharma Safety-Info Carveout + Region Detection (PHARMA-02/06)

- **D-05: Safety-info NEVER-paywalled categories (5 total).** {overdose warnings, contraindication alerts, FDA black-box warnings, serious adverse-event signals (FDA MedWatch-class), pregnancy/lactation contraindications}. Stored as a `safety_category text` column on `pharma_content` table; non-null = always free. Pregnancy/lactation + serious adverse-event signals added beyond the roadmap-named three because the regulator-audience scope demands defensibility (per memory `feedback_regulator_vs_user_audience_pattern`).
- **D-06: `phaCheck()` enforcement = build-time ESLint rule + runtime assertion + CI grep gate (three layers).**
  - ESLint AST rule `eslint-rules/no-paywall-on-safety-category.cjs`: detects `<Paywall>` / `<PaywallGate>` JSX wrapping a node that reads `content.safety_category`. Mirrors Phase 36 V13-3 rule pattern. Error message points to D-05 of this CONTEXT.
  - Runtime: `phaCheck(content)` helper called from inside `<PaywallGate>`; throws in dev / NODE_ENV=test, renders-free in prod (warn-log only). Defense-in-depth.
  - CI grep backup: `scripts/check-no-paywall-on-safety-category.sh` greps for `safety_category` co-occurring with `Paywall` within 10 lines, comment-stripped per [[reference_grep_gate_comment_strip]].
- **D-07: WMHMDA (WA) + CTDPA (CT) region detection = IP-geo at landing + user-profile state (profile wins).** Vercel edge header `x-vercel-ip-country-region` classifies WA/CT at first touch and sets `lt_pharma_blocked` cookie. On signup, `user.profile.state_of_residence` (when present from onboarding) supersedes — profile wins. Belt-and-suspenders pattern matches "reasonable effort + best knowledge" regulatory posture. PaywallGate consults both signals (cookie + profile) and short-circuits to free if either says WA/CT.

### Per-Cohort + Per-UTM Paywall Mapping (PAYWALL-05/07)

- **D-08: 5 default seeded cohorts.** `free-user`, `past-due (>3d)`, `trial-day-3`, `trial-day-7`, `post-activation`. Seeded via Phase 27 cohort builder migration. Each cohort has a `cohort_id` referenced by variant_config rows. Operator can add more cohorts via the P27 admin UI without code deploy.
- **D-09: Per-UTM pricing variant routing (PAYWALL-07).** LandingPage cookie `lt_utm_source` captured at first visit; resolver maps utm_source → variant_id via `utm_variant_map` admin table; persisted to `user_experiments.utm_variant_id` at signup. Seed `utm_variant_map` with 4 rows: `lean` → variant_lean_copy, `transformation` → variant_transform_copy, `clinical` → variant_clinical_copy, `default` → control.
- **D-10: Conflict resolution — cohort wins over UTM.** When BOTH a cohort and a UTM-source match a user, the cohort-specific variant_id is served. Rationale: cohort = explicit user-state targeting (past-due, trial-day-7), more specific than acquisition channel. UTM treated as fallback for users with no matching cohort (mostly anonymous/free pre-activation users). Resolver reads `user_experiments.cohort_id` FIRST, falls back to `user_experiments.utm_variant_id`. Documented in the variant_resolver Edge Fn body.

### Variant Lifecycle + Ship-Winner UX (PAGEAB-03/05/07 + PAYWALL-06)

- **D-11: 42-day variant lifecycle — warn day 35, hard-cut day 42.** At day 35, Slack alert + admin badge "Ship or rollback within 7 days". At day 42: `variant_config.archived_at = now()`, traffic flips to 100% control, Slack post-mortem prompt to `#growth-experiments`. Aligns with PAGEAB-03 strict-archive language. pg_cron daily check at 06:00 UTC scans variant_config for age >= 35d and 42d boundaries.
- **D-12: Ship-Winner UI — override below 95% via typed-confirmation modal logged to audit.** Default: button enabled at ≥95% Bayesian posterior. Below 95% the button is enabled but click opens a modal requiring the operator to type `ship-below-95` + a reason field. Action writes to `admin_audit_log` with full context (variant_id, posterior, reason, operator_id). Mirrors Phase 36 V13-3 typed-confirmation pattern. Above 95% = single-click + audit log row only.
- **D-13: Per-block A/B contract (PAGEAB-06) — independent variants per block; not coupled.** Each page-builder block carries its own optional `variant_set_id`; multiple blocks on one page can run independent A/Bs simultaneously. Block-level resolver picks variant per render. Avoids coupling — admin can ship a Hero-CTA variant winner without disturbing an in-flight Pricing-table variant on the same page.
- **D-14: Multi-screen onboarding paywall = fixed 6-screen template (PAYWALL-06).** Six screens, fixed order: `value-pillar-1` / `value-pillar-2` / `value-pillar-3` / `social-proof` / `pricing` / `final-CTA`. Each screen is its own React component; admin can A/B per-screen copy via the same PageBuilder block contract used by PAGEAB-06. 6-screen balances comprehensiveness vs drop-off; deviating from the count requires a future phase decision.

### Claude's Discretion (implementation details for planner)

- Server-side variant assignment Edge Fn (mirrors P36 nps-trigger-decide pattern: SECDEF for first-touch immutability, JWT-forwarding for user-context calls).
- Bayesian posterior calculation library — planner picks (`@stan/math` is too heavy; recommend a small Beta-Binomial conjugate-prior implementation inline).
- `experiment_results` aggregation matview refreshed by extending Phase 51's pg_cron job (sequenced after traffic matviews).
- Ship-Winner Edge Fn reuses Phase 34/35 `ship-winner-flag` Fn verbatim (per memory `feedback_orchestrator_inline_completes_returned_executor`).
- ESLint AST rule `no-paywall-on-safety-category.cjs` follows the Phase 36 V13-3 rule shape exactly.
- ISR cache key extension (PAGEAB-04): per-variant cache key = `${page_id}:${variant_id}` ensures cross-variant isolation.
- Admin UI for variant_config CRUD + experiment_results dashboard — sibling of Phase 36 admin/modules/reviews (FunnelDashboardPage + RulesListPage analogs).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### ROADMAP + REQUIREMENTS
- `.planning/ROADMAP.md` §"Phase 39: A/B Trifecta — Mid-Trial Paywall + Pharma Paywall + Page-Variant A/B" — 5 success criteria + 22 REQ-IDs
- `.planning/REQUIREMENTS.md` §WS4 (PAYWALL-01..07), §WS5 (PAGEAB-01..07), §WS-PHARMA (PHARMA-01..08)

### Cross-phase reuse mandates
- `.planning/phases/34-*/34-*-SUMMARY.md` — activation event definition (paywall fires after this)
- `.planning/phases/35-*/35-*-SUMMARY.md` — Ship-Winner contract source (OnboardingABPanel + ship-winner-flag Edge Fn)
- `.planning/phases/24-*/24-*-SUMMARY.md` — server-side PostHog captureServer wrapper (variant assignment)
- `.planning/phases/15-*/15-*-SUMMARY.md` — page-builder block schema (per-block A/B extends this)
- `.planning/phases/27-*/27-*-SUMMARY.md` — cohort builder (variant cohort routing)
- `.planning/phases/36-m3-review-prompt-engine-web-only/36-CONTEXT.md` — V13-3 ESLint rule shape (phaCheck mirrors this pattern)
- `.planning/phases/51-*/51-CONTEXT.md` + plans — UTM capture pipeline (Phase 51 owns the lt_utm_source cookie; Phase 39 reads it)

### Project memory invariants (verified before planning)
- [[reference_supabase_migration_filename_regex]] — strict 14-digit underscore filename regex
- [[reference_supabase_back_dated_migration_blocks_push]] — current remote tail; new migrations must be strictly ahead
- [[reference_postgres_dollar_quote_nesting_in_cron_body]] — cron bodies use named `$body$` tags
- [[feedback_rpc_auth_uid_vs_service_role_mismatch]] — SECDEF RPCs called from service-role Edge Fns must forward user JWT
- [[reference_supabase_pg_cron_vault_service_role_pattern]] — pg_cron + vault decrypted_secrets pattern
- [[reference_supabase_v2_aal_api]] — Supabase v2 AAL API quirks
- [[reference_tailwind_v4_unlayered_reset]] — Tailwind v4 reset rule
- [[feedback_aggressive_foundations]] — for revenue/A-B infrastructure phases, pick max-coverage variant on gray areas
- [[reference_ui_checker_dimension_traps]] — cap typography at ≤4 sizes; collapse-sizes preemptively

### External docs
- PostHog `alias()` + feature-flag stickiness docs (server-side variant assignment + Ship-Winner promotion)
- PostHog Experiments docs (Bayesian posterior + significance badge calculation)
- WMHMDA (Washington My Health My Data Act, RCW 19.373) — consumer-health-data scope
- CTDPA (Connecticut Data Privacy Act §6) — same
- Stripe Refunds API (refund-rate kill-switch calculation source)

</canonical_refs>

<specifics>
## Specific Ideas

- **Ship-Winner contract is verbatim P34/35 `OnboardingABPanel` + `ship-winner-flag` Edge Fn.** Plans must `<read_first>` the Phase 35 SUMMARY + the OnboardingABPanel.tsx file and NEVER fork. Memory note `feedback_admin_module_manifest_vs_router_branch_drift` applies to the new growth/experiments admin module entry.
- **phaCheck() helper ships under `src/lib/pharma/phaCheck.ts`** (not a wrapper component). Called from PaywallGate.tsx + the new `<PharmaContentBlock>` page-builder block.
- **`#growth-experiments` Slack channel.** Operator must create + register webhook BEFORE first variant launches. Add to PROJECT.md vendor table at phase close.
- **Multi-screen onboarding paywall component path:** `src/components/paywall/OnboardingFlowPaywall/` with 6 child screen components + a container that handles step advancement + dismiss/back nav.
- **`utm_variant_map` seed values:** `lean`, `transformation`, `clinical`, `default` — 4 rows. Other UTM sources fall back to `default`.
- **5 default cohorts (PAYWALL-05):** Seed migration creates rows in `cohorts` table from Phase 27. Each carries human-readable label + filter_rule_jsonb (e.g., `{trial_day: 7}`, `{is_past_due: true, days_overdue: {">=": 3}}`).

</specifics>

<deferred>
## Deferred Ideas

- **3rd-tier "premium" pharma access** beyond Pro (specialized clinical content) — v1.4+ if Pro→Premium upgrade demand emerges.
- **Per-region pharma variants beyond WMHMDA/CTDPA** (e.g., CCPA-aware variants for CA users) — v1.4 if California legislation evolves.
- **Browser-side pixel emission for paywall_shown / paywall_dismissed events** — Phase 51 orthogonal marketing-HTML work, not this phase.
- **Per-segment pricing experiments (different amounts, not just copy)** — requires Stripe price-object proliferation; deferred to a dedicated pricing-experiment phase.
- **Variable 5-7 onboarding-screen flows authored by admin** — Phase 39 ships fixed 6 screens; flexible-count flows v1.4+ if demand emerges from operators.
- **Mobile-native paywall surfaces** — v1.4 with the Capacitor mobile shell. Phase 39 is web-only (mirrors P36 scope discipline).
- **AND/OR cohort + UTM composition rules** — Phase 39 ships strict precedence (cohort wins). Composition rules v1.4 if real targeting needs emerge.
- **Per-block A/B WITHIN a multi-screen onboarding paywall** — current spec: A/B at the screen level OR at the paywall-flow level, not at sub-block granularity within a flow.

</deferred>

---

*Phase: 39-a-b-trifecta-mid-trial-paywall-pharma-paywall-page-variant-a*
*Context gathered: 2026-05-22*
