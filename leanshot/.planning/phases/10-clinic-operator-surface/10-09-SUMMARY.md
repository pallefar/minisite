---
phase: 10-clinic-operator-surface
plan: 09
subsystem: patient-activity-mirror
tags: [edge-function, patient-transparency, hbnr, wmhmda, audit-logs, deno-test, vitest]
dependency_graph:
  requires:
    - Phase 9 D-15 stub (Active Organizations "View activity" button)
    - audit_logs.target_user_id column (Plan 10-01 migration)
    - audit_logs Phase 10 action enum (rank_threshold_crossed, section_view)
  provides:
    - patient-activity Edge Function deployed to ytnsipxxmzgaebkqmokp
    - PatientActivityModal (two-tab, 25-row pagination, HBNR footer)
    - PatientActivityRow (operator-views + ranking-events Why? expander)
    - usePatientActivity hook
    - ActiveOrganizationsSection "View activity" button wired (Phase 9 D-15 stub filled)
  affects:
    - leanshot/src/components/dashboard/settings/sections/ActiveOrganizationsSection.tsx
tech_stack:
  added:
    - patient-activity Supabase Edge Function (Deno/TypeScript)
  patterns:
    - Patient JWT validation via admin.auth.getUser (mirrors clinic-photo pattern)
    - Service-role admin client for cross-uid audit_logs queries (target_user_id != user_id RLS boundary)
    - Actor display_name fallback: null → "a clinic member" (D-20)
    - Tab filter (operator_views vs ranking_events) via query param
    - Focus-trap + focus-return on modal close
    - HBNR/WMHMDA defensible footer always visible (T-10-09-02 mitigation)
key_files:
  created:
    - supabase/functions/patient-activity/index.ts
    - supabase/functions/patient-activity/cors.ts
    - supabase/functions/patient-activity/deno.json
    - supabase/functions/patient-activity/index.test.ts
    - leanshot/src/components/dashboard/settings/PatientActivityModal.tsx
    - leanshot/src/components/dashboard/settings/PatientActivityRow.tsx
    - leanshot/src/components/dashboard/settings/use-patient-activity.ts
    - leanshot/src/components/dashboard/settings/PatientActivityModal.test.tsx
  modified:
    - leanshot/src/components/dashboard/settings/sections/ActiveOrganizationsSection.tsx
decisions:
  - D-20 actor display fallback handled in Edge Function (not client) for consistency
  - Service-role admin client required because audit_logs RLS is user_id = auth.uid() (actor), not target_user_id
  - OPERATOR_VIEW_ACTIONS includes clinic_snapshot_loaded for completeness (D-04 audit rows)
  - Focus return uses window.setTimeout(50ms) to let modal exit animation complete
metrics:
  duration: 70 minutes
  completed: 2026-05-13
  tasks: 2
  files: 9
---

# Phase 10 Plan 09: patient-activity Edge Function + PatientActivityModal Summary

Patient-facing transparency surface: Edge Function returning per-org audit rows scoped to authenticated patient, two-tab modal (Operator views / Ranking events) filling the Phase 9 D-15 "View activity" stub.

## What Was Built

### Task 1: patient-activity Edge Function

**Endpoint:** `GET /patient-activity?org_id=<uuid>&tab=<operator_views|ranking_events>&offset=N&limit=25`  
**Auth:** Bearer JWT (patient) → admin.auth.getUser → service-role queries audit_logs by target_user_id  
**Deployed to:** `ytnsipxxmzgaebkqmokp` via `npx supabase functions deploy patient-activity`

Key design decisions:
- Service-role client required: `audit_logs_select_own` RLS policy uses `user_id = auth.uid()` (the actor, not the target). Patient needs to see rows where `target_user_id = patient.id`, which bypasses the patient's own JWT RLS context.
- Cross-tenant isolation: Patient B querying Patient A's org_id returns 0 rows — the WHERE clause `target_user_id = patient.id` is the gate (verified in Deno Test 4).
- Actor display fallback: `auth.users.user_metadata.display_name` OR `'a clinic member'` (D-20).
- Tab filter: `operator_views` → `section_view`, `patient_data.read`, `patient_photos.read`, `clinic_snapshot_loaded`; `ranking_events` → `rank_threshold_crossed`.
- Cache-Control: `private, no-store` on every status code (T-10-09-01 mitigation).

**Deno tests: 13/13 pass**

| Test | Behavior |
|------|----------|
| 1 | 401 missing_jwt + Cache-Control header |
| 2 | 400 missing_or_invalid_org_id |
| 3 | 200 own audit rows; target_user_id scoped; actor_display_name enriched |
| 4 | Cross-tenant isolation: Patient B → 0 rows in Patient A's org |
| 5 | tab=operator_views filter: only section_view / clinic_snapshot_loaded |
| 6 | tab=ranking_events filter: only rank_threshold_crossed |
| 7 | Actor with null display_name → "a clinic member" fallback |
| 8 | Pagination: offset=25 returns next 5 rows; has_more=false on last page |
| 9 | Cache-Control: private, no-store on 401 + 400 + OPTIONS + 200 |
| + | Static check: BASE_RESPONSE_HEADERS has Cache-Control |
| + | 3 additional Cache-Control variants |

### Task 2: PatientActivityModal + row + hook + wire ActiveOrganizationsSection

**Files created:**
- `PatientActivityModal.tsx`: Two-tab modal, 25-row pagination, HBNR footer, focus return to trigger
- `PatientActivityRow.tsx`: Operator-views row (`{time} — {actor} ({role badge}) viewed your {section}`) + ranking-events Why? expander with breakdown_snapshot top-3 signals
- `use-patient-activity.ts`: Hook fetching via Edge Function; tab + pagination params; error/loading states; NO posthog.capture (D-19)

**ActiveOrganizationsSection.tsx updated:**
- Added `Activity` icon import from lucide-react
- Added "View activity" `IconButton` with `aria-label="View activity from {orgName}"`
- Added `activityTarget` state + `activityButtonRefs` map for focus return
- Renders `PatientActivityModal` when `activityTarget` is set
- Focus returns to the originating row's button on modal close

**Vitest tests: 9/9 pass**

| Test | Behavior |
|------|----------|
| 1 | Click View activity → modal renders with org name in title |
| 2 | Tab nav has Operator views + Ranking events; defaults to Operator views |
| 3 | Each tab triggers hook with correct tab param; rows render with actor + role badge |
| 4 | Ranking Why? expander: click → breakdown + top signals; click again → collapses |
| 5 | Empty state: "No views from this workspace yet." |
| 6 | Previous/Next pagination: click Next → hook called with offset=25 |
| 7 | Close modal → focus returns to triggerRef element |
| 8 | posthog.capture NEVER called during modal mount + tab switch (D-19) |
| 9 | HBNR footer visible on both tabs regardless of active tab |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] `React.useState` at bottom import pattern**
- **Found during:** Task 2 implementation
- **Issue:** Placed `import React from 'react'` at bottom of PatientActivityModal.tsx, used `React.useState` — invalid in ES module hoisting context
- **Fix:** Replaced with named imports `{ type RefObject, useRef, useState }` from 'react' at top
- **Files modified:** `PatientActivityModal.tsx`, `PatientActivityModal.test.tsx`

**2. [Rule 2 - Lint] import-x/order violations**
- **Found during:** Pre-commit lint check
- **Issue:** `lucide-react` import after `react` in PatientActivityModal; `PatientActivityModal` import before `EditConsentScopeModal` in AOS
- **Fix:** Reordered imports alphabetically per eslint-plugin-import-x rules
- **Commit:** 1e9fcf2

**3. [Architectural note] Service-role required for audit_logs queries**
- **Found during:** Task 1 design analysis
- **Issue:** The plan said "RLS does the filter" but audit_logs RLS policy `audit_logs_select_own` uses `user_id = auth.uid()` (actor UID). Patient queries need `target_user_id = patient.id` which isn't covered by the patient's JWT context.
- **Fix:** Used service-role admin client (intentional bypass) with explicit `WHERE target_user_id = patient.id` as the isolation gate. This is the same pattern as clinic-snapshot/clinic-photo.
- **Cross-tenant proof:** Deno Test 4 verifies Patient B → 0 rows.

## Threat Surface Scan

No new threat surfaces beyond what the plan's threat model covers:
- T-10-09-01 (information disclosure via cross-tenant rows): mitigated by service-role WHERE clause + Deno Test 4
- T-10-09-02 (meta-audit of patient viewing modal): mitigated by zero posthog.capture + Vitest Test 8 guard
- T-10-09-03 (actor IP/UA leak via metadata): metadata column does not include IP/UA per D-20 design

## Bundle Impact

PatientActivityModal rides the existing `settings` chunk (no new lazy chunk needed). Estimated delta: +2 kB gz (consistent with UI-SPEC L375 projection).

## Self-Check: PASSED
