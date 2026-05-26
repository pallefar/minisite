---
phase: 64-legal-refresh
plan: 06
subsystem: ui
tags: [react, typescript, dsar, privacy, legal, CCPA, CDPA, CPA, CTDPA, UCPA, tailwind-v4]

# Dependency graph
requires:
  - phase: 64-01
    provides: data_rights_requests table with RLS policy (user_id=auth.uid())
  - phase: 22-11
    provides: DsarPortalPage.tsx + DsarStatusCard + dsar-export-client (Lane A GDPR flow)

provides:
  - state-residency Select (CA/VA/CO/CT/UT/OTHER) in DsarPortalPage
  - conditional request-type checkboxes per state per D-DSAR-Portal-Extensions decision matrix
  - Lane B submit: INSERT into data_rights_requests one row per request_type + legacy deletion RPC
  - Pure lookup module src/lib/dsar/state-request-types.ts with getRequestTypesForState()
  - 16 vitest tests (8 unit + 8 component) all GREEN

affects:
  - 64-08-close-out (Lane B data rights requests visible to staff via admin)
  - Phase 70 UAT (staff must review data_rights_requests table for CCPA compliance verification)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Two-lane DSAR: Lane A (GDPR export RPC) + Lane B (state-rights INSERT) coexist in same page
    - State-residency dropdown drives conditional checkboxes via getRequestTypesForState lookup
    - One INSERT row per request_type (not jsonb array) — simplifies per-right status tracking
    - Legacy RPC preserved when deletion selected — dual write for operator audit trail

key-files:
  created:
    - leanshot/src/lib/dsar/state-request-types.ts
    - leanshot/src/lib/dsar/__tests__/state-request-types.test.ts
    - leanshot/src/components/dsar/__tests__/DsarPortalPage.state-residency.test.tsx
  modified:
    - leanshot/src/components/dsar/DsarPortalPage.tsx

key-decisions:
  - "Lane A (GDPR export) and Lane B (state-rights) coexist as separate cards — no form merging"
  - "One INSERT row per request_type (not jsonb array) — simplifies per-right operator status tracking"
  - "Deletion in Lane B triggers BOTH data_rights_requests INSERT AND initiate_account_deletion_rpc for unified audit"
  - "Cancel CTA: 'Keep my data rights pending' per UI-SPEC §Copywriting + Phase 61 lesson"
  - "Symlinked worktree node_modules to main leanshot node_modules for test execution (ephemeral, removed post-test)"

patterns-established:
  - "State-residency lookup pattern: pure const table + getX(key) throws on unknown key — defensive runtime guard"
  - "TDD RED-GREEN cycle: test commit precedes implementation commit per plan type=tdd"

requirements-completed: [LEGAL-03]

# Metrics
duration: 6min
completed: 2026-05-26
---

# Phase 64 Plan 06: DSAR State-Residency Extension Summary

**State-residency Select (CA/VA/CO/CT/UT/OTHER) with conditional checkboxes per CCPA/CDPA/CPA/CTDPA/UCPA decision matrix, writing one row per request_type into data_rights_requests; legacy deletion RPC preserved**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-26T20:44:37Z
- **Completed:** 2026-05-26T20:51:32Z
- **Tasks:** 2
- **Files modified:** 4 (2 created, 1 new component test, 1 extended)

## Accomplishments

- Pure lookup module `state-request-types.ts` with CA/VA/CO/CT/UT/OTHER arrays per D-DSAR-Portal-Extensions (UT narrower, CO/CT widest including opt_in_sensitive, CA with limit_sensitive_use)
- Extended `DsarPortalPage.tsx` with Lane B: state-residency Select, conditional request-type checkboxes with human-readable labels, INSERT into data_rights_requests, legacy deletion RPC preserved
- Cancel CTA "Keep my data rights pending" per UI-SPEC §Copywriting; Submit "Submit data rights request" (verb+noun)
- 16 total vitest tests (8 unit + 8 component); all GREEN; tsc clean; no undefined Tailwind v4 tokens

## Task Commits

Each task was committed atomically with TDD RED/GREEN cycles:

1. **Task 1 RED: state-request-types test** - `698ad845` (test)
2. **Task 1 GREEN: state-request-types implementation** - `a1126ba6` (feat)
3. **Task 2 RED: DsarPortalPage.state-residency test** - `bec71f1d` (test)
4. **Task 2 GREEN: DsarPortalPage extended** - `239dce25` (feat)

## Files Created/Modified

- `src/lib/dsar/state-request-types.ts` — Pure lookup: StateCode → RequestType[] per D-DSAR-Portal-Extensions
- `src/lib/dsar/__tests__/state-request-types.test.ts` — 8 tests: CA/VA/CO/CT/UT/OTHER arrays + unknown throws + STATE_REQUEST_TYPES shape
- `src/components/dsar/__tests__/DsarPortalPage.state-residency.test.tsx` — 8 tests: Select, checkboxes, insert, cancel copy, legacy RPC, result card
- `src/components/dsar/DsarPortalPage.tsx` — Extended with Lane B state-residency card; Lane A (GDPR export) fully preserved

## Decisions Made

- Two-lane DSAR: Lane A (GDPR export bundle) and Lane B (state-rights) are separate cards on the same page — no form merging. This preserves the Phase 22/35 Lane A flow exactly and avoids scope creep.
- One INSERT row per request_type (vs. jsonb array) so operators can independently track status of each right exercised by a user at Phase 70 UAT.
- Deletion in Lane B triggers BOTH `data_rights_requests` INSERT AND `initiate_account_deletion_rpc` (dual write) so the operator sees deletion requests in both tables for a unified audit trail.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Worktree lacks `node_modules` (gitignored per project norms). Resolved by creating a temporary symlink from the worktree's `leanshot/node_modules` to the main leanshot's `node_modules`. Symlink removed after testing.

## Known Stubs

None. The "Even if we can't get the row back, show a success card placeholder" comment in DsarPortalPage.tsx is defensive fallback code — not a data stub. The Lane B result card renders even when the INSERT returns no `data` (e.g., Supabase returning null for the inserted row). This is intentional.

## Threat Surface Scan

No new trust boundaries or network endpoints introduced beyond what the plan's `<threat_model>` covers. T-64-06-04 (undefined Tailwind tokens → invisible DSAR form) verified via grep gate — no undefined tokens found.

## TDD Gate Compliance

- RED gate: `698ad845` (`test(64-06)`) — Task 1 failing test committed before implementation
- GREEN gate: `a1126ba6` (`feat(64-06)`) — Task 1 implementation committed after test
- RED gate: `bec71f1d` (`test(64-06)`) — Task 2 failing test committed before implementation
- GREEN gate: `239dce25` (`feat(64-06)`) — Task 2 implementation committed after test

## Self-Check: PASSED

Files verified:
- `FOUND: src/lib/dsar/state-request-types.ts`
- `FOUND: src/lib/dsar/__tests__/state-request-types.test.ts`
- `FOUND: src/components/dsar/__tests__/DsarPortalPage.state-residency.test.tsx`
- `FOUND: src/components/dsar/DsarPortalPage.tsx (modified)`

Commits verified: 698ad845, a1126ba6, bec71f1d, 239dce25 — all present in git log.

## Next Phase Readiness

- Lane B writes are ready for Phase 70 UAT operator review (staff SELECT policy from Plan 64-01)
- `data_rights_requests` table must be created by Plan 64-01 before Lane B is functional in production
- Phase 64-08 close-out can reference this plan as complete

---
*Phase: 64-legal-refresh*
*Completed: 2026-05-26*
