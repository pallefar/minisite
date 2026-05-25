# Phase 39 — Discussion Log

**Date:** 2026-05-22
**Mode:** discuss (default)
**Areas selected:** 4 of 4 presented

---

## Gray Areas Selected

User selected all 4 presented gray areas:
1. Composite-goal + kill-switch policy (PAYWALL-03/04 + PHARMA-03)
2. Pharma safety-info carveout boundary + region-detect (PHARMA-02/06)
3. Per-cohort + per-UTM paywall mapping (PAYWALL-05/07)
4. Variant lifecycle + Ship-Winner UX (PAGEAB-03/05/07 + PAYWALL-06)

---

## Area 1: Composite-Goal + Kill-Switch Policy

### Q1 — PAYWALL composite-goal formula
**Options:** Multiplicative (Recommended) / Additive weighted / Lexicographic / Two-stage holdout.
**Selected:** Multiplicative — `composite = paid_rate × 30d_retention`. Variant wins only if both lift.
**→ D-01.**

### Q2 — Refund-rate kill-switch design
**Options:** Rolling 30-day baseline + hard-kill at 2× (Recommended) / Two-tier soft + hard / Trailing 7-day baseline / Phase-fixed baseline.
**Selected:** Rolling 30-day baseline, hard-kill at 2×, no cooldown.
**→ D-02.**

### Q3 — PHARMA kill thresholds
**Options:** Hard-kill on ANY (NPS drop ≥5 OR 1★ rate > 2× baseline) (Recommended) / Combined AND / Manual weekly review.
**Selected:** Hard kill on either trigger.
**→ D-03.**

### Q4 — Slack routing
**Options:** Single `#growth-experiments` (Recommended) / Severity-routed / Per-workstream.
**Selected:** Single channel for everything.
**→ D-04.**

---

## Area 2: Pharma Safety-Info Carveout + Region Detect

### Q1 — Safety-info NEVER-paywalled categories
**Options:** Roadmap-3 + 2 extras (Recommended) / Strict roadmap list / Broader (incl. drug-interactions + dosing-floor).
**Selected:** 5 categories — {overdose, contraindication, FDA black-box, serious adverse-event signals, pregnancy/lactation}.
**→ D-05.**

### Q2 — phaCheck() enforcement
**Options:** Build-time + runtime + CI grep (Recommended) / Runtime only / DB-level only.
**Selected:** Three-layer defense (ESLint AST + runtime + CI grep), mirrors Phase 36 V13-3.
**→ D-06.**

### Q3 — WMHMDA/CTDPA region detect
**Options:** Both IP + profile (Recommended) / Profile only / IP only.
**Selected:** IP-geo at landing + profile state-of-residence supersedes.
**→ D-07.**

---

## Area 3: Per-Cohort + Per-UTM Paywall Mapping

### Q1 — Default seeded cohorts
**Options:** 5 cohorts (Recommended) / Roadmap minimum 3 / Operator-configurable from day 1.
**Selected:** 5 cohorts — free-user, past-due (>3d), trial-day-3, trial-day-7, post-activation.
**→ D-08.**

### Q2 — Cohort vs UTM conflict resolution
**Options:** Cohort wins (Recommended) / UTM wins / Priority field per-variant.
**Selected:** Cohort wins; UTM is fallback.
**→ D-09 + D-10.**

---

## Area 4: Variant Lifecycle + Ship-Winner UX

### Q1 — 42-day variant auto-archive behavior
**Options:** Warn day 35 + hard-cut day 42 (Recommended) / Warn day 35 + soft-archive / No warn + hard-cut.
**Selected:** Warn day 35, hard-cut day 42 with post-mortem prompt.
**→ D-11.**

### Q2 — Ship-Winner confidence gate
**Options:** Override with typed confirm (Recommended) / Hard gate ≥95% / Soft gate yellow ≥80%.
**Selected:** Default ≥95%, override below via typed-confirmation modal logged to audit.
**→ D-12.**

### Q3 — Multi-screen onboarding paywall shape
**Options:** Fixed 6-screen template (Recommended) / Variable 5-7 admin-built / 2-variant simple A/B.
**Selected:** Fixed 6-screen template (value-1 / value-2 / value-3 / social-proof / pricing / final-CTA).
**→ D-14.**

---

## Out-of-Scope Items Captured (Deferred)

See CONTEXT.md `<deferred>` section. No scope-creep redirects required during this discussion — user stayed in-domain throughout.

---

## Decisions Captured

14 locked decisions D-01..D-14 spanning 3 workstreams + Ship-Winner contract + shared infrastructure.

## Claude's Discretion items
- Server-side variant assignment Edge Fn shape
- Bayesian posterior library choice
- experiment_results matview refresh sequencing
- ISR cache key extension shape
- Admin UI per-block layout

All documented in CONTEXT.md `<decisions>` `### Claude's Discretion` subsection.
