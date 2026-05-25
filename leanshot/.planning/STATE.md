---
gsd_state_version: 1.0
milestone: v1.4
milestone_name: Launch Readiness
status: in_progress
authored: "2026-05-25"
archived: false
last_updated: "2026-05-25T09:00:00.000Z"
last_activity: "2026-05-25 -- Phase 54 (Push Notifications) COMPLETE: 5 plans/3 waves (foundation migrations+type-sync+RED-scaffolds; push-dispatch fan-out Fn web/APNs/FCM; native @capacitor/push-notifications registration; notification-send web-filter; NotificationsSubtab quiet-hours UI). Heavy push infra pre-existed. VERIFICATION passed. Code review caught 4 CRITICAL bugs masked by test mocks (urgent-alert quiet-hours block, UTC tz, APNS sandbox default, FCM PHI leak) — all fixed. Live device delivery→P70. Autonomous run 52->69 in progress (3/18 done)."
progress:
  total_phases: 19
  completed_phases: 3
  total_plans: 17
  completed_plans: 17
  percent: 16
phase_range: "52-70"
v1_3_archive:
  roadmap: .planning/milestones/v1.3-ROADMAP.md
  requirements: .planning/milestones/v1.3-REQUIREMENTS.md
  audit: .planning/milestones/v1.3-MILESTONE-AUDIT.md
  uat_runbook: .planning/milestones/v1.3-uat-deferred.md
  git_tag: v1.3
---

# Milestone v1.4: Launch Readiness

**Status:** Executing Phase 52
**Phases:** 52-70 (19 phases)
**Requirements:** 200 REQ-IDs across 19 workstreams
**Source documents:**

- `.planning/PROJECT.md` (v1.4 Goals section)
- `.planning/MILESTONE-CONTEXT.md` (phase enumeration + scope contracts)
- `.planning/research/v1.4-launch-readiness-gaps.md` (4 blockers + 16 hard-debt items)
- `.planning/REQUIREMENTS.md` (v1.4 traceability)
- `.planning/ROADMAP.md` (phase details + UAT roll-up)

## Current Position

- **Phase:** 55 (HealthKit + Two-Tunnel Firewall) — NEXT (pending dispatch)
- **Last completed:** Phase 54 (Push Notifications) — VERIFICATION passed 2026-05-25
- **Status:** autonomous run `52→69` in progress (3/18 autonomous phases done)

## Milestone Contract

Per `feedback_milestone_uat_deferral_consolidation` forward-looking variant:

- **Every phase 52-69 ships `autonomous: true`** with HUMAN-UAT signals EMPTY in its own frontmatter
- **Every per-phase HUMAN-UAT signal rolls up to Phase 70**
- **Phase 70 is `autonomous: false`** — single consolidated launch gate, multi-signal HUMAN-UAT
- **Ship rule for Phase 70:** TBD at Phase 70 planning (either all-signals-pass OR ≥X/Y inline-approved + critical-gate subset)

## Dependency Graph

```
P52 (Vendor Setup) gates:
  → P53 (Capacitor) → P57 (Watch needs mobile shell)
  → P54 (Push needs APNs/FCM)
  → P55 (HealthKit needs entitlement)
  → P59 (Apple OAuth needs service ID)
  → P61 (Protocol Creator needs Mux for clinical embeds)
  → most launch-gap phases (Stripe Tax, Mux, etc.)

P60 (RAG completion) gates:
  → P61 (Protocol Creator pulls RAG evidence)
  → P62 (Insights feeds back into RAG)

P64-68 (launch gaps) mostly parallel after carry-over
P69 (Design Polish) waits for P52-68 (audit AFTER all surfaces ship)
P70 (Consolidated UAT) waits for EVERYTHING (last phase)
```

## Accumulated Context

### Decisions locked at milestone authoring (2026-05-25)

- **D-01:** Vendor setup consolidates to Phase 52 (user direction: "ensure all is setup correctly from start of the milestone"). Eliminates per-phase secret-deferral pattern from v1.3.
- **D-02:** Phase 50 RAG resumes IN-PLACE (existing dir at `.planning/phases/50-*/`); not a fresh phase dir.
- **D-03:** Phase 20 (Ad Network) + Phase 21 (Watch Apps) both ship in v1.4 per `feedback_aggressive_foundations`. No descope.
- **D-04:** Spanish i18n contractor already engaged externally; Phase 58 is wiring + verification only.
- **D-05:** Launch-readiness gaps (4 blockers + 16 hard-debt) fold INTO v1.4 after carry-over, BEFORE design polish + UAT.
- **D-06:** Two new product features added (P61 Protocol Creator + P62 Insights & Research Engine) per user 2026-05-25 direction.
- **D-07:** Phase numbering continues from 51 (v1.3's last) — no `--reset-phase-numbers`.
- **D-08:** All per-phase HUMAN-UAT rolls up to Phase 70 per consolidated-UAT contract. No per-phase UAT during execution.

### Todos

- [x] Phase 52 (Vendor Setup Foundation) shipped — VERIFICATION passed, review fixed, UI 22/24
- [ ] After Phase 52 ships: dispatch carry-over phases (53-63) in dependency order
- [ ] Then launch-gap phases (64-68) — mostly parallel
- [ ] Then design polish (69) after all surfaces ship
- [ ] Then consolidated UAT (70) — final launch gate

### Blockers

None at authoring time. Vendor accounts (Apple Dev / Play / Mux / Better Stack / HealthKit entitlement) need provisioning at Phase 52 dispatch per existing PROJECT.md Vendor Accounts table.

## Session Continuity

Authored via `/gsd-new-milestone v1.4` flow on 2026-05-25. All 4 artifacts written atomically:

- `.planning/REQUIREMENTS.md` (new — fresh for v1.4; v1.3 archived)
- `.planning/ROADMAP.md` (extended — milestone header + collapsed v1.1/v1.2/v1.3 details + new Phases 52-70 section)
- `.planning/PROJECT.md` (extended — v1.4 Goals section added; history preserved)
- `.planning/STATE.md` (this file — reset for v1.4)

Next step: `/gsd-plan-phase 52` to plan the Vendor Setup Foundation.
