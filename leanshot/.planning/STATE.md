---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Tech Debt Sweep + Launch Polish
status: Awaiting next milestone
stopped_at: Phase 16 UI-SPEC approved
last_updated: "2026-05-17T09:28:54.114Z"
last_activity: 2026-05-17 — Milestone v1.2 completed and archived
progress:
  total_phases: 19
  completed_phases: 18
  total_plans: 146
  completed_plans: 144
  percent: 95
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-13 for v1.2 milestone)

**Core value:** Drug-level projection + injection-site rotation are the headline; everything else feeds context into that picture or interprets it.
**Current focus:** Phase 16 — Capacitor Mobile Shells (resumed after `leanshot.app` domain registration; awaiting Apple Dev enrollment + Play Console + vendor paste-backs to ship plans 16-09 + 16-10)

## Current Position

Phase: Milestone v1.2 complete
Plan: —
Status: Awaiting next milestone
Last activity: 2026-05-17 — Milestone v1.2 completed and archived

### v1.1 close (2026-05-13)

Milestone v1.1 SHIPPED + ARCHIVED + TAGGED 2026-05-13. Tag `v1.1` pushed to `pallefar/minisite`; archive commit `44ad476` on `origin/main`. 11/11 phases · 76/76 plans · 497 commits · +174,668 / −7,207 LOC · 4-day sprint. Onboarding summary at `.planning/reports/MILESTONE_SUMMARY-v1.1.md`; archived ROADMAP at `.planning/milestones/v1.1-ROADMAP.md`; audit at `.planning/v1.1-MILESTONE-AUDIT.md` (verdict `tech_debt`, 48/49 REQ-IDs satisfied).

### v1.2 milestone open (2026-05-13)

12 phases (numbered 12-23, continuing from v1.1) covering 104 REQ-IDs across 11 workstreams. Granularity `fine`, mode `mvp`. Synthesized research at `.planning/research/SUMMARY.md` (HIGH confidence, 6 disagreements resolved). Three open questions to lock at plan-phase: clinic seat metering (Phase 14), pharmacology paywall (Phase 14), embed-provider blocks (Phase 15). Three phases flagged HIGH research priority: Phase 16 (App Store review), Phase 20 (AdMob+GAM+AdSense ETL), Phase 21 (Swift + Kotlin surface). Cross-cutting concerns owned per phase: affiliate ledger × IRS retention (P19+P22 jointly), no-ads-on-B2B (P12 + P20), bundle ceiling 24.5/50 kB gz (P12 sets, every later phase respects), Two-tunnel firewall (P18 implements, P20 audits), App Store Review Checklist (P16 hard gate; P20 + P21 contribute), Resend domain (P12 prereq), Capacitor process model (P16 + P18 + P20 CONTEXT).

Progress: [██████████] 96%

## Performance Metrics

**Velocity:**

- Total plans completed (v1.2): 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 12 | 0 | — | — |
| 13 | 0 | — | — |
| 14 | 0 | — | — |
| 15 | 0 | — | — |
| 16 | 0 | — | — |
| 17 | 0 | — | — |
| 18 | 0 | — | — |
| 19 | 0 | — | — |
| 20 | 0 | — | — |
| 21 | 0 | — | — |
| 22 | 0 | — | — |
| 23 | 0 | — | — |

**Recent Trend:**

- Last 5 plans: — (no plans executed in v1.2 yet)
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- v1.2 milestone open (2026-05-13): 12 phases at fine granularity, mvp mode; phase numbering continues from v1.1 (12-23, no reset)
- v1.2 stack additions (from `.planning/research/STACK.md`): Capacitor 8 + RevenueCat (iOS+Android IAP) + Stripe direct (web subs + clinic seats + Connect Express affiliate payouts) + AdMob (`@capacitor-community/admob@8.0.0`) + GAM/AdSense via GPT script + `@capgo/capacitor-health` (HealthKit + Health Connect single plugin) + native Apple Watch (SwiftUI + WatchConnectivity + SwiftData) + native WearOS (Kotlin + Wear Compose + Tiles 1.4) + `web-push@3.6.7` + `vanilla-cookieconsent@3.1.0` + `@dnd-kit/core@6.3.1` + `react-hook-form@7.75.0` + `jspdf@3.1.0`
- v1.2 architecture: Polyrepo+ (single repo, sibling native shells; NO Turborepo); page-builder is "Editor/Renderer split with in-house dnd-kit"; ad-firewall named "Two-tunnel firewall"; ad-serving named "Server-decides config, client-fetches creative + hybrid mediation"; watch sync named "Cloud-primary + WatchConnectivity for live"; push named "Single Edge Function push-fanout"; affiliate attribution named "Server-side first-party cookie via Edge Function + Stripe client_reference_id"; account-deletion named "Single Edge Function account-delete with explicit retention exceptions"
- v1.2 hard constraints: Apple §5.1.3 (HealthKit → ads) + §3.1.1 (Stripe in-app subs forbidden) + §5.1.1(v) (in-app account delete) + GDPR cookie consent + DSAR + IRS 1099 7yr retention
- v1.2 bundle: 24.5 kB gz target on index; 50 kB hard ceiling; all new SDKs via `sync-defer.ts`; per-chunk ceilings declared in Phase 12

### Pending Todos

None yet.

### Blockers/Concerns

- **Phase 12 prereq**: Resend domain `app.leanshot.app` verification (carry-over from v1.1) — must complete before Phase 22 lifecycle email work
- **Phase 12 prereq**: Hash-hyphen bug in `assert-clinic-bundle-budget.sh` must be fixed before per-chunk ceilings can be declared (per `reference_bundle_budget_hash_hyphen.md`)
- **Phase 16 research**: App Store review pitfalls compound (Pitfalls 1, 2, 3, 8, 9, 14, 19, 26 + SKAdNetwork). Recommend `/gsd-research-phase 16` before plan-phase
- **Phase 18 ↔ Phase 20 contract**: Two-tunnel firewall MUST exist as code (ESLint + runtime + manifest) before any AD-* code lands. Phase 18 implements; Phase 20 audits. Sequencing is non-negotiable
- **Phase 20 research**: AdMob+GAM+AdSense Reporting ETL is a net-new surface. Recommend `/gsd-research-phase 20`
- **Phase 21 research**: New Swift + Kotlin surface area (Apple Watch SwiftUI + WearOS Kotlin/Compose). Recommend `/gsd-research-phase 21`
- **Phase 19 + Phase 22 joint owner**: Affiliate ledger × IRS 1099 7yr retention requires `ON DELETE SET NULL` + anonymization (NEVER cascade). Both phases' CONTEXT.md must cross-reference Pitfall 7
- **Carry-over runner-pool quirk**: `/gsd-manager` background plan/execute dispatch still lacks the Task tool (per memory `reference_gsd_tooling_quirks.md`). Use foreground Claude Code session for plan-phase + execute-phase

### v1.1 Tech Debt Carried into Phase 23

| Item | Source | Status |
|------|--------|--------|
| CLINIC-07 operator drill-in "View activity" dead button | v1.1 audit (1 partial REQ-ID) | Open — Phase 23 |
| `s.user!` non-null assertion audit (15 occurrences / 14 files) | Phase 7 inventory + memory | Open — Phase 23 |
| Photo trash flow | v1.1 deferred-items | Open — Phase 23 |
| 6 deferred tests batch-fix | `.planning/deferred-tests.md` + `feedback_defer_then_batch_fix_pattern.md` | Open — Phase 23 |
| knip + ts-unused-exports CI gate (anti-pattern #6 tooling) | Plan 10-06 WORKSPACE_LOADED defect | Open — Phase 23 |

## Quick Tasks Completed

| Date | Slug | Summary |
|------|------|---------|
| 2026-05-11 | fix-focus-loop-and-console | FocusCard infinite render loop, PostHog placeholder init, deprecated mobile-web-app meta |
| 2026-05-11 | fix-insights-and-home-render-loop | InsightsTab + HomeTab infinite render loops (`generateInsights` as Zustand selector) |
| 2026-05-11 | eslint-guard-unstable-selectors | ESLint `no-restricted-syntax` rule blocking `useStore(generateInsights\|pickFocus)` |
| 2026-05-11 | add-dist-marketing-to-eslint-ignores | Added `dist-marketing/**` to ESLint global ignores |

## Deferred Items

Items acknowledged and carried forward from v1.1 close (folded into v1.2 phase ownership above):

| Category | Item | Status | Deferred At | New Owner |
|----------|------|--------|-------------|-----------|
| Phase 9 infra (v1.1) | Resend domain verification + RESEND_FROM swap | Open | 2026-05-13 (v1.1 Plan 09-06 close) | **Phase 12** (v1.2) |
| Phase 9 CI (v1.1) | 6 RLS impersonation specs not run against live DB | Open — CI infra | 2026-05-13 | **Phase 23** (sweep) |
| Phase 9 CI gate (v1.1) | GitHub branch-protection for `share-security-drill` | Open | 2026-05-13 | **Phase 23** (sweep) |
| Phase 9 hardening (v1.1) | 7 pre-existing SharePage lint errors | Open | 2026-05-13 | **Phase 23** (sweep) |
| Phase 9 hardening (v1.1) | `s.user!` latent assertion audit (15/14) | Open | 2026-05-13 | **Phase 23 — DEBT-02** |

Items acknowledged at v1.2 close (2026-05-17):

| Category | Item | Status | Notes |
|----------|------|--------|-------|
| Debug session | phase7-e2e-post-signin-render | blocked (v1.1 era) | Stale carry-over; Phase 7 archived to milestones/v1.1-phases — debug record kept for forensic reference only |
| Debug session | phase7-e2e-rc4-state-wipe-race | blocked (v1.1 era) | Same — Phase 7 archived |
| UAT gap | Phase 01 — 01-HUMAN-UAT.md (3 scenarios) | partial (v1.0 era) | Phase 01 shipped pre-Nyquist; HUMAN-UAT items captured at v1.0 era, not actioned in v1.1 or v1.2 |
| UAT gap | Phase 02 — 02-HUMAN-UAT.md | unknown (v1.0 era) | Same vintage; no open scenarios |
| UAT gap | Phase 08 — 08-UAT.md | blocked (v1.1 era) | No open scenarios; status string is stale |
| Verification gap | Phase 01 — 01-VERIFICATION.md | human_needed (v1.0 era) | Pre-Nyquist; Phase 01 has VALIDATION.md instead |
| Verification gap | Phase 02 — 02-VERIFICATION.md | human_needed (v1.0 era) | Same |

**Phase 16 descope (2026-05-17 round 2):** Phase 16 vendor closeout in flight at v1.2 close (Apple Dev + Play Console + Supabase Pro enrollments running). 11 REQs (MOBILE-01..10 + MONEY-06) descoped to v1.4. Plans 16-00..16-08 shipped + on disk; 16-03/16-09/16-10 remain unexecuted. Resume path: v1.4 milestone absorbs these + the prior 33 deferred REQs (PUSH/HEALTH/AD/WATCH/ON-01).

## Session Continuity

Last session: 2026-05-16T12:35:07.106Z
Stopped at: Phase 16 UI-SPEC approved
Resume file: None

## Operator Next Steps

- Start the next milestone with /gsd-new-milestone
