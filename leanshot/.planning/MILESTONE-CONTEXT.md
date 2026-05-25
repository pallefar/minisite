---
milestone: v1.4
captured: 2026-05-25
source: user freeform direction
status: draft (pending REQUIREMENTS + ROADMAP)
---

# v1.4 Milestone Context

## User-stated direction (verbatim)

> Lets do all the carry over backlog, then focus on the layout and design, remember to use the claud design which was setup for this. once all the backlog is done then lets finalise all the UAT tests etc. while you are reseraching, please also think about what might be missing in this app, to make it ready for launch. If you find something add this in after the backlog carry over and group all the UATs at the end of the milstone, on one big phase

## Phase Ordering Contract

Roadmap MUST order phases as follows:

1. **Carry-over backlog** — v1.2 + v1.3 deferred items, in dependency order
2. **Launch-readiness gaps** — items discovered by research that block production launch but were never planned
3. **Layout & design polish** — uses the established LeanShot design system (Tailwind v4 tokens, 4-size typography ceiling, DS primitives — `Card`, `Modal`, `Sheet`, `Pill`, `EmptyState`, etc.); harmonization audit across all v1.3 surfaces
4. **One consolidated UAT phase** — ALL outstanding UAT signals roll up here at the END of the milestone. No per-phase HUMAN-UAT during execution — defer ALL of them to this single closeout phase

## Inherited carry-over backlog

### From v1.2 (Phase 16-21 descoped → ~44 REQs)

- **Phase 16** — Capacitor mobile shells (iOS + Android)
- **Phase 17** — Push Notifications (web + native)
- **Phase 18** — HealthKit + two-tunnel firewall (Apple Health PHI path)
- **Phase 20** — Ad Network (in-app placements / sponsorship integrations)
- **Phase 21** — Watch Apps (Apple Watch + Wear OS companion)

REQ-ID families: PUSH-*, HEALTH-*, AD-*, WATCH-*, MOBILE-*, ON-01

### From v1.3 (deferred items)

- **Phase 32-06** — Spanish i18n contractor handoff (translation memory + glossary delivery)
- **Phase 34-08/10** — Apple OAuth (sign-in-with-Apple — required for App Store + iOS users)
- **Phase 50 Waves 2-4** — RAG knowledge base MVP + STRETCH (Phase 50 dir kept in `.planning/phases/` for in-place resume)
- **Phase 42** — 5 device-UAT signals (dark mode, PWA offline, smart notifications, etc.)
- **33 consolidated HUMAN-UAT signals** — v1.3-uat-deferred.md
- **7 vendor secrets** — Calendly OAuth, Better Stack API, Sentry CSP report URI, Mux, etc.
- v1.2/v1.3-era tech debt (REVIEW.md leftovers, IN-* findings, etc.)

## Design system anchor

Layout/design phase uses the **established LeanShot design system**:

- Tailwind v4 beta CSS-first `@theme` tokens (`leanshot/src/index.css`)
- Typography ceiling: 4 sizes (11/13/18/28 px), 2 weights, accent reserved-list (validated Phase 41/51 ui-checker)
- DS primitives: `Card`, `Modal`, `Sheet`, `Pill`, `PillGroup`, `EmptyState`, `Button`, `Input`, `Toast`, `Badge`, `ProgressRing`, `Skeleton`, `Sparkline`
- a11y baseline: aria-label on icon-only buttons, role="dialog" + aria-modal="true" on modals, aria-sort on sortable columns, `useReducedMotion` for all animations
- Dark mode: `data-theme="light|dark"` on `<html>`, applied pre-paint
- Per `feedback_ui_researcher_prebake_constraints`: bake these constraints into UI-SPEC up front

## Consolidated UAT phase contract

Final phase of v1.4 (likely numbered as the LAST phase, ~Phase 60+):

- Inherits all 33 v1.3 HUMAN-UAT signals
- Inherits Phase 42's 5 device-UAT signals
- Includes new v1.4 carry-over HUMAN-UAT (mobile shells, push, HealthKit, Apple OAuth, ad network, watch)
- Includes UAT for launch-readiness gaps surfaced by research
- Includes UAT for design polish phase
- Full regression sweep across v1.1 + v1.2 + v1.3 + v1.4 surfaces
- Multi-signal structure per `feedback_multi_signal_human_verify_checkpoint_pattern` — N discrete approve-able items, not one mega-signal
- Ship rule (TBD by user at UAT-phase planning): all-signals-pass OR ≥X/Y inline-approved + critical gate among them

## Out of scope for v1.4

- HIPAA covered-entity-tier conversion (still B2C + B2B-without-EHR)
- Direct EHR integration (would push into HIPAA-CE bucket)
- Net-new revenue streams not already scoped in v1.2/v1.3 backlog
- New community-feed features beyond Phase 49 (digest send loop, search) — those are v1.3-complete

## User decisions (2026-05-25)

- **Phase 50 RAG:** Ship FULL Waves 2-4 (MVP + STRETCH). Per `feedback_aggressive_foundations` user picks max-coverage on foundation phases.
- **Phase 20 (Ad Network) + Phase 21 (Watch Apps):** BOTH in v1.4. No descope.
- **Spanish i18n contractor:** Already engaged. Phase 32-06 follow-up is engineering wiring + integration testing only (~1 small phase).
- **Launch-readiness gaps:** Research dispatched (`gsd-project-researcher`); blockers + hard-debt fold into v1.4 roadmap AFTER carry-over phases, BEFORE design polish + UAT consolidation.

## Carry-over phase enumeration (proposed numbering — continues from Phase 51)

| # | Phase | Source | Scope |
|---|-------|--------|-------|
| 52 | Capacitor Mobile Shells (iOS + Android) | v1.2 P16 | Foundation: bundle iOS + Android wrappers; CI per-platform builds; signing certs |
| 53 | Push Notifications | v1.2 P17 | Web push (Phase 42 foundation) + native iOS APNs + Android FCM; permission UX |
| 54 | HealthKit + Two-Tunnel Firewall | v1.2 P18 | Apple Health PHI ingestion path; iOS-only; OPT-IN per HIPAA |
| 55 | Ad Network | v1.2 P20 | In-app placements / sponsorship integrations |
| 56 | Watch Apps (Apple Watch + Wear OS) | v1.2 P21 | Companion app: quick dose log + reminder; depends on P52 mobile shell |
| 57 | Spanish i18n Wiring (Contractor-Delivered) | v1.3 P32-06 | TMX import + glossary integration + RTL verification + smoke; contractor already engaged |
| 58 | Apple OAuth (Sign-in-with-Apple) | v1.3 P34-08/10 | iOS App Store requirement; Supabase Auth provider config + UI |
| 59 | Phase 50 RAG Completion (Waves 2-4) | v1.3 P50 | Resume in-place: scrape + chunk + embed + admin curation + re-rank + federated; MVP + STRETCH |
| 60 | Vendor Secrets + Device-UAT + Tech Debt Cleanup | v1.3 carry | 7 vendor secret onboarding (Calendly, Better Stack, Sentry CSP, Mux, etc.) + Phase 42's 5 device-UAT signals + REVIEW.md IN-* findings + v1.2/v1.3-era tech debt sweep |

(Phases 61+ TBD after launch-readiness research returns.)

## Phase numbering notes

- **No `--reset-phase-numbers`** — continue 52..N from v1.3's last phase (51).
- Phase 50 stays at its existing number; Phase 59 is the **resume marker** for Waves 2-4 (per `feedback_summary_forward_effects_section`, Phase 59 SUMMARY should reference Phase 50's CARRY-OVER + the kept-in-place phase dir).
