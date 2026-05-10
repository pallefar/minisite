# LeanShot

## What This Is

LeanShot is a web app that lets people on GLP-1s (and adjacent peptides) track everything that affects their treatment — injections, body metrics, food, activity, mood, symptoms — and turns it into a unified picture they share with their doctor and a coach (rule-based + AI) shares with them. v1 serves three audiences: GLP-1 patients (B2C), doctors viewing a specific patient's data (read-share), and clinics/coaches monitoring multiple patients (B2B).

## Core Value

**Drug-level projection + injection-site rotation** are the headline. The pharmacology curve (28 days past + 7 days projected) and site-rotation tracking are the centerpiece — every other tab feeds context into that picture or interprets it for the user. If the curve is wrong or the rotation logic confuses users, the product fails regardless of what else works.

## Requirements

### Validated

<!-- Inferred from the v2 codebase on branch claude/upgrade-leanshot-design-mjjJl. "Validated" here means "present and working in the v2 baseline" — the v2 build itself has not yet shipped to production. -->

- ✓ **TRACK-01**: User can log injections (drug, dose, site, date) — `src/components/dashboard/tabs/MedicationTab.tsx` — v2 baseline
- ✓ **TRACK-02**: User sees their drug-level curve (28-day past + 7-day projection) using real PK math — `src/lib/pharmacology.ts`, `src/components/dashboard/charts/MedLevelChart.tsx` — v2 baseline
- ✓ **TRACK-03**: User sees site rotation history with a recommended next-site nudge — `SiteRotationCard.tsx` — v2 baseline
- ✓ **TRACK-04**: User can log weight, photos, and compare progress over time — `BodyTab.tsx`, `PhotoCompareModal.tsx` — v2 baseline
- ✓ **TRACK-05**: User can log nutrition (incl. protein), activity, supplements, mood, sleep, symptoms — corresponding tabs in `src/components/dashboard/tabs/` — v2 baseline
- ✓ **TRACK-06**: User gets rule-based daily focus and insights derived from their state — `src/lib/insights.ts` — v2 baseline
- ✓ **TRACK-07**: User can chat with an AI coach that has context on their data — `AIChatPanel.tsx`, `src/lib/ai.ts` (Anthropic, BYO key) — v2 baseline
- ✓ **TRACK-08**: User can generate a printable doctor-facing report — `DoctorReport.tsx` — v2 baseline
- ✓ **TRACK-09**: User onboards via a 7-step wizard with a guided first-run tour — `OnboardingFlow.tsx`, `GuidedTour.tsx` — v2 baseline
- ✓ **TRACK-10**: User maintains streaks and can render shareable summary cards — `StreaksCard.tsx`, `ShareCardModal.tsx`, `src/lib/share-card/` — v2 baseline
- ✓ **TRACK-11**: All user data persists locally across sessions with v3→v4 migration — `src/lib/storage.ts` — v2 baseline

### Active

<!-- v1 launch milestone: take v2 from "runs locally" to "shipped multi-audience SaaS". Hypotheses until shipped and proved valuable. -->

**Production readiness (existing app)**

- [ ] **PROD-01**: App is publicly accessible at a real domain over HTTPS
- [ ] **PROD-02**: Real-user errors are captured and triaged via an error-tracking service
- [ ] **PROD-03**: Privacy-respectful product analytics measure feature usage and onboarding drop-off
- [ ] **PROD-04**: Pharmacology engine (`calcMedLevel`, `HALF_LIVES`, `TITRATION`) and insights rule engines (`generateInsights`, `pickFocus`) are covered by automated tests so clinical math regressions are caught before merge
- [ ] **PROD-05**: Anthropic API key handling is hardened (proxy via serverless function OR explicit BYO-key disclosure flow with disclaimers) — keys not silently exposed in plaintext localStorage
- [ ] **PROD-06**: App displays appropriate medical disclaimer ("Not medical advice, talk to your doctor") and a clear data-storage explanation users see before logging anything

**Cloud sync + accounts (net new)**

- [ ] **AUTH-01**: User can create an account and log in across devices
- [ ] **SYNC-01**: User's tracked data syncs across their devices via the cloud, while still working offline (local-first)
- [ ] **SYNC-02**: Existing local-only users can migrate their `leanshot_v4` localStorage data into their account on first sign-in without loss

**Doctor read-share (net new)**

- [ ] **SHARE-01**: Patient can generate a read-only share link or invite that grants their doctor in-browser access to their tracked data (no doctor account required, OR a lightweight doctor sign-up — TBD in planning)
- [ ] **SHARE-02**: Doctor view is read-only, contains the same data as the printable report plus the live curves, and has clear scoping (which patient, which window, when revoked)

**Clinic / coach B2B (net new)**

- [ ] **CLINIC-01**: A clinic or coach can sign up as an organization and invite multiple patients into their workspace
- [ ] **CLINIC-02**: Clinic operator sees a roster view across their patients with at-a-glance status (active streak, recent symptoms, missed doses) so they can prioritize who to reach out to
- [ ] **CLINIC-03**: Clinic operator can drill into any one of their patients and see the same data the patient sees (or a clinical-flavored version of it)

### Out of Scope

- **Native iOS/Android apps** — Web is the only surface for v1; install via PWA. Native costs disproportionately for a launch where we're still discovering audience fit.
- **Peptides outside the GLP-1 family** — v1 supports semaglutide / tirzepatide / liraglutide / etc. only. Other peptide classes (BPC-157, growth hormone, etc.) are deferred until the GLP-1 funnel is validated.
- **Direct EHR / clinical-system integration (HL7, FHIR, Epic, etc.)** — Doctor surface is the LeanShot UI. EHR integration is a much bigger compliance + integration story that gates faster shipping.
- **Payments / paid plans / pricing tiers** — v1 is free across all audiences. Monetization is a separate later milestone informed by usage data.

## Context

- **Stack already chosen**: React 19, Vite 6, TypeScript (strict), Tailwind v4 (beta), Zustand, framer-motion, chart.js, lucide-react. Decided on `claude/upgrade-leanshot-design-mjjJl` (PR #1).
- **State of the codebase**: Brownfield. v2 is a full design upgrade with ~50 components, custom design system primitives, custom pharmacology engine, custom insights rule engine, AI panel, doctor report, share cards, onboarding, guided tour. Codebase map at `.planning/codebase/` (1766 lines, written 2026-05-10).
- **Persistence today**: 100% client-side (`localStorage`, key `leanshot_v4`, with v3→v4 migration) — implies an earlier shipped or in-flight version existed. v1 milestone introduces accounts + cloud sync for the first time.
- **AI coach**: BYO Anthropic key, currently stored unencrypted in localStorage and called direct from the browser. Security review must decide whether to keep BYO with disclosure or proxy through a serverless function.
- **Tests**: Zero. There is no test runner configured and no test files exist as of v2 baseline. Pharmacology and insights are the load-bearing math and run in a medical context — adding tests is a v1 must-have.
- **Domain sensitivity**: Tracking GLP-1 use is health-adjacent data. Even without HIPAA covered-entity status, the project should treat the data as sensitive (encryption in transit + at rest, minimal collection, clear disclosures, deletion on demand).
- **Prior exploration**: Started in a web claude.ai sandbox session and continued in local Claude Code on this branch. Sandbox plan files do not travel with the repo — git is the source of truth.

## Constraints

- **Tech stack**: React 19 + Vite + TS strict + Tailwind v4 beta + Zustand. Locked for v1 — net-new backend should pick a stack that complements (e.g., a small Node/TS or edge-runtime backend) rather than fighting it.
- **Architecture**: Local-first must continue to work even after cloud sync is added. Users without an account, or offline, must still be able to log and view their data. This rules out a pure cloud-first rewrite.
- **Compliance posture**: Not yet a HIPAA covered entity. Avoid features that would push us into that bucket prematurely (e.g., direct EHR integration). Keep the disclaimer + data minimization stance from day one.
- **AI dependency**: AI coach calls Anthropic directly. Outage on Anthropic = degraded coach UX, not full-app outage — keep the rest of the app functional even when AI is unavailable.
- **Bundle size**: chart.js + framer-motion + lucide-react together are heavy. A static SPA on a real domain has to load fast for a non-technical audience — code-split aggressively (App.tsx already lazy-loads tabs/modals; preserve that).
- **Performance / accessibility**: Audience includes patients with chronic conditions. Keyboard navigation, screen-reader labels, color contrast, and reduced-motion behavior must work end-to-end.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| GSD `.planning/` lives inside `/leanshot`, not at repo root `/minisite` | leanshot is the actual project; the repo root is just a wrapper. `gsd-sdk` auto-detected leanshot as `project_root`. | — Pending |
| v1 ambition = full SaaS launch (B2C + doctor share + B2B clinic) — not just polish | User explicitly confirmed when asked to narrow vs commit. Multi-audience is the strategic shape. | — Pending |
| Local-first + cloud sync (not local-only, not cloud-first) | Preserves the existing offline UX and the v2 codebase, while making cross-device + account-based features possible. | — Pending |
| Pharmacology + insights engines are required-to-test before launch | They are the load-bearing clinical math; mistakes look bad in a medical context. | — Pending |
| Native mobile, EHR integration, non-GLP-1 peptides, and payments are explicitly out of v1 | Each adds significant scope and gates a faster public launch. Park them in Out of Scope to prevent drift. | — Pending |
| AI coach key handling decision deferred to planning phase | Two viable paths (BYO with disclosure vs. serverless proxy); pick during the AUTH/PROD planning phase. | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-10 after initialization*
