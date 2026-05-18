---
phase: 30
plan: "04"
subsystem: clinic-dashboard
tags: [clinic, dashboard, matviews, patient-thresholds, rpc, role-gate]
depends_on: ["30-00"]
provides: [ClinicDashboardOverview, use-clinic-metrics, PatientThresholdOverrideForm, reset_patient_dose_thresholds SECDEF]
affects: [ClinicDrillInPage]
tech_stack:
  added: []
  patterns: [SECDEF-accessor-RPC, React.lazy, useMemberRole-role-gate, TDD-RED-GREEN]
key_files:
  created:
    - leanshot/src/components/clinic/dashboard/ClinicDashboardOverview.tsx
    - leanshot/src/components/clinic/dashboard/use-clinic-metrics.ts
    - leanshot/src/components/clinic/dashboard/ClinicDashboardOverview.test.tsx
    - leanshot/src/components/clinic/drill-in/PatientThresholdOverrideForm.tsx
    - leanshot/src/components/clinic/drill-in/PatientThresholdOverrideForm.test.tsx
    - supabase/migrations/20270601300007_p30_reset_patient_thresholds_rpc.sql
  modified:
    - leanshot/src/components/clinic/drill-in/ClinicDrillInPage.tsx
decisions:
  - "SECDEF accessor RPCs used exclusively (no direct mv_* reads — revoked at DB level per Plan 30-00 Wave 0 deviation)"
  - "reset_patient_dose_thresholds shipped as sibling SECDEF (set_patient_dose_thresholds is upsert-only, no DELETE path)"
  - "Role gate implemented inline via useMemberRole hook in ClinicDrillInPage (org_members.role query)"
  - "Tab state managed with local useState ('overview' | 'dose-thresholds') in ClinicDrillInPage"
metrics:
  duration_seconds: 551
  completed_date: "2026-05-18"
  tasks_completed: 2
  files_changed: 7
---

# Phase 30 Plan 04: ClinicDashboardOverview + PatientThresholdOverrideForm Summary

**One-liner:** Clinic aggregate dashboard (4 stat cards via SECDEF RPCs) + per-patient threshold override form with reset modal + admin/staff role-gated drill-in tab.

---

## What Was Built

### Task 1: ClinicDashboardOverview + use-clinic-metrics

`use-clinic-metrics.ts` — query hook fetching 3 parallel sources:
- `supabase.rpc('get_clinic_alert_metrics', { p_org_id })` — alert counts by type, ack rate
- `supabase.rpc('get_clinic_dose_trend_population', { p_org_id })` — patients below/within/above range
- `supabase.from('clinic_matview_refresh_log').select(...)` — matview staleness timestamp

Returns: `{ pendingThisWeek, ackRatePct, belowDosingRange, alertTypeBreakdown, lastRefreshedAt, isLoading, error }`.

`ClinicDashboardOverview.tsx` — 4 stat cards in responsive 3-col grid:
1. **Pending alerts** — primary focal point: `shadow-md`, `text-[20px]` figure, amber when >0/success when 0
2. **Ack rate (7 days)** — success >=80, amber 50-79, danger <50, tertiary dash when null
3. **Below dosing range** — amber when >0, tertiary when 0
4. **Alert types** — "Missed doses" + "Dose variance" sub-figures

Staleness caption: `text-[13px] text-[var(--color-text-tertiary)]` "Updated every 15 minutes · Last: {relative time}"

Empty state: "No data yet / Metrics appear after the first nightly alert scan. Check back tomorrow."

Loading: 4 `<Skeleton className="h-32 rounded-lg" />` placeholders.

**9 tests GREEN** (RTL).

### Task 2: PatientThresholdOverrideForm + ClinicDrillInPage tab + migration

`supabase/migrations/20270601300007_p30_reset_patient_thresholds_rpc.sql`:
- `reset_patient_dose_thresholds(p_org_id uuid, p_patient_user_id uuid) returns void`
- SECURITY DEFINER `set search_path = pg_catalog, public, extensions`
- Role gate: `org_members.role in ('admin', 'staff')`
- `set_config('app.suppress_audit', 'on', true)` before audit INSERT
- DELETE from `org_patient_thresholds`
- Audit INSERT with actor_user_id
- Pushed to live DB (to_regprocedure → true)

`PatientThresholdOverrideForm.tsx`:
- Props: orgId, patientUserId, patientDisplayName, clinicDefaults, existingOverride
- 3 `<Input type="number">` (N: min 1/max 30, M: min 7/max 90, X: min 5/max 100)
- Placeholders show clinic defaults; values prefill from existingOverride or empty
- Note: `text-[13px] text-[var(--color-text-tertiary)]` "Overrides clinic default for this patient only."
- Save: `supabase.rpc('set_patient_dose_thresholds', ...)` → toast "Patient thresholds saved."
- Reset button → `<Modal>` title "Reset patient thresholds" with canonical UI-SPEC body text including `{patientDisplayName}`
- Modal: `<Button variant="destructive">Reset to defaults</Button>` + `<Button variant="secondary">Keep current thresholds</Button>`
- Confirm reset: `supabase.rpc('reset_patient_dose_thresholds', ...)` → toast "Thresholds reset to clinic defaults." → close modal → clear form

`ClinicDrillInPage.tsx` additions:
- `useMemberRole(orgId)` hook — fetches caller's `org_members.role` for the drill-in org
- `usePatientOverride(orgId, patientId)` hook — fetches `org_patient_thresholds.thresholds` row
- Tab bar rendered when `canSeeDoseThresholdsTab` (role = 'admin' or 'staff')
- "Dose thresholds" tab renders `<PatientThresholdOverrideForm>` via `React.lazy`
- Viewer role → tab bar not rendered → 'Dose thresholds' text absent from DOM (W13 gate)

**9 tests GREEN** (8 behavior + 1 role-gate Test 9).

---

## Migrations Used

| Migration | Ships What | Status |
|-----------|-----------|--------|
| `20270601300003_p30_secdef_and_triggers.sql` | `set_patient_dose_thresholds` (Plan 30-00) | Pre-existing |
| `20270601300007_p30_reset_patient_thresholds_rpc.sql` | `reset_patient_dose_thresholds` (this plan) | Pushed live |

---

## ClinicDrillInPage Tab Integration Point

Integration: `ClinicDrillInPage.tsx` renders a tab bar between `ClinicDrillInSubBar` and `<main>`. The tab bar is only rendered when `memberRole === 'admin' || memberRole === 'staff'`.

Default tab: "Overview" (existing ReadOnlyPatientView content). New tab: "Dose thresholds" → `<PatientThresholdOverrideForm>`.

---

## Verification Results

| Check | Result |
|-------|--------|
| `ClinicDashboardOverview.test.tsx` — 9 tests | PASS |
| `PatientThresholdOverrideForm.test.tsx` — 9 tests | PASS |
| Total tests | 18/18 PASS |
| `tsc --noEmit` | PASS (0 errors) |
| No `supabase.from('mv_clinic*')` in use-clinic-metrics.ts | CONFIRMED |
| `to_regprocedure('public.reset_patient_dose_thresholds(uuid,uuid)')` | true (live DB) |
| W13 viewer role gate | PASS (Test 9) |

---

## Bundle Impact Estimate

All new components are `React.lazy()`-loaded. No new heavy dependencies (no chart.js). Estimated impact: < 4 kB gz combined (stat card rendering + form with Modal — no new primitives, all from existing UI kit).

---

## Deviations from Plan

### Wave 0 matview-RLS deviation (inherited — honored as instructed)

**Found during:** Task 1 (pre-existing from Plan 30-00)

**Issue:** Direct `supabase.from('mv_clinic_alert_metrics')` reads are revoked at the DB level (matview RLS DDL is unsupported in Postgres). Plan 30-00 Wave 0 shipped SECDEF accessor functions instead.

**Fix:** `use-clinic-metrics.ts` uses `supabase.rpc('get_clinic_alert_metrics', ...)` and `supabase.rpc('get_clinic_dose_trend_population', ...)` — NOT direct matview reads. This was the pre-patched plan behavior.

**Grep verification:** `! grep -qE "supabase\.from\(['\"]mv_clinic" use-clinic-metrics.ts` → confirmed.

---

## Known Stubs

None. All RPC calls are wired to live functions. `clinicDefaults` in ClinicDrillInPage falls back to the v1.3 hardcoded defaults `{missed_doses_n: 2, window_days_m: 14, variance_pct_x: 25}` since `org_settings.dose_trend_thresholds` fetch is not wired in the drill-in page (it uses the default constant). This is acceptable per D-07 (defaults are the right fallback when no clinic custom threshold is set). Plan 30-05 or a future plan can wire the live `org_settings.dose_trend_thresholds` fetch.

---

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| (none) | — | No new network endpoints or unmodeled trust boundaries introduced |

The `useMemberRole` hook queries `org_members` via the existing RLS-gated Supabase client. The SECDEF for `reset_patient_dose_thresholds` re-checks role at the DB level (Pattern S1 dual-layer). No new external API surfaces.

---

## Self-Check: PASSED

- All 7 plan artifact files exist on disk
- Commits ce23317, 082fde9, 53ca7d8, 567872d verified in git log
- `to_regprocedure('public.reset_patient_dose_thresholds(uuid,uuid)')` = true (live DB)
- No direct matview reads in use-clinic-metrics.ts
- 18/18 tests pass
