---
phase: 10-clinic-operator-surface
plan: 05
subsystem: frontend
tags: [react, typescript, refactor, shared-component, bundle-optimization, tdd]

# Dependency graph
requires:
  - phase: 10-clinic-operator-surface
    plan: 01
    provides: SnapshotData, ReadOnlyPermissionMap, ReadOnlyPatientViewProps types
  - phase: 08-doctor-read-share
    provides: Phase 8 SharePage state machine, section rendering patterns
provides:
  - src/components/shared/ReadOnlyPatientView.tsx (orchestrates 6 sections, permissionMap D-12 gating, onSectionMount D-21 hook)
  - src/components/shared/sections/{Injections,Weights,Symptoms,Photos,DoctorReport,Chart}Section.tsx (6 extracted section components)
  - src/components/clinic/drill-in/ClinicDrillInPage.tsx (stub; Plan 10-07 overwrites)
  - src/components/share/SharePage.tsx (thin wrapper around ReadOnlyPatientView with viewerMode=share)
  - /clinic/{slug}/patient/{user_id} route registered in App.tsx
  - read-only-patient-view shared chunk configured in vite.config.ts
  - Bundle budget guards added to scripts/assert-clinic-bundle-budget.sh
affects:
  - 10-clinic-operator-surface/10-07 (ClinicDrillInPage real implementation)
  - 10-clinic-operator-surface/10-06 (ClinicWorkspace references ReadOnlyPatientView via drill-in)
  - 08-doctor-read-share (SharePage is now a thin wrapper)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ReadOnlyPatientView extraction: shared body-section rendering parameterized by viewerMode + permissionMap"
    - "adaptSnapshotToReadOnly adapter: bridges Phase 8 SnapshotResponse shape to canonical SnapshotData"
    - "onMount useRef guard: sections call onMount once via firedRef.current, prevents double-fire on re-render"
    - "D-12 absence rule: isVisible() gates section rendering; absent sections leave no placeholder DOM nodes"
    - "read-only-patient-view manualChunk: shared chunk loaded by both share and clinic lazy chunks"

key-files:
  created:
    - src/components/shared/ReadOnlyPatientView.tsx
    - src/components/shared/ReadOnlyPatientView.test.tsx
    - src/components/shared/sections/InjectionsSection.tsx
    - src/components/shared/sections/WeightsSection.tsx
    - src/components/shared/sections/SymptomsSection.tsx
    - src/components/shared/sections/PhotosSection.tsx
    - src/components/shared/sections/DoctorReportSection.tsx
    - src/components/shared/sections/ChartSection.tsx
    - src/components/shared/sections/sections.test.tsx
    - src/components/clinic/drill-in/ClinicDrillInPage.tsx
  modified:
    - src/components/share/SharePage.tsx
    - src/components/share/SharePage.test.tsx
    - src/App.tsx
    - vite.config.ts
    - scripts/assert-clinic-bundle-budget.sh

key-decisions:
  - "adaptSnapshotToReadOnly adapter pattern: Phase 8 SnapshotResponse shape (log_id, timestamp, signed_url) differs from canonical SnapshotData (id, created_at, storage_path). Adapter bridges both without modifying either type."
  - "SharePage lazy-imports ReadOnlyPatientView: the shared chunk loads asynchronously; share-chrome elements (header, print button, footer) render immediately from SharePage while sections wait for Suspense."
  - "Chart depends on injections permission: isVisible('chart') delegates to canViewInjections since the chart renders the PK curve from injection history."
  - "onMount useRef guard pattern: each section has its own firedRef.current guard rather than a parent-level set, because sections may be conditionally rendered and need per-instance tracking."

metrics:
  duration: 18min
  completed: 2026-05-13
---

# Phase 10 Plan 05: ReadOnlyPatientView extraction + SharePage refactor + drill-in route

**ReadOnlyPatientView shared component extracted from Phase 8 SharePage; 6 section components moved to shared/sections/; App.tsx adds /clinic/{slug}/patient/{user_id} route; new read-only-patient-view shared chunk; 23 Vitest assertions green**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-05-13
- **Completed:** 2026-05-13
- **Tasks:** 2 of 2
- **Files modified:** 14 (9 created, 5 modified)

## Accomplishments

### Task 1: Extract 6 section components from SharePage into shared/sections/

- Authored TDD test file `src/components/shared/sections/sections.test.tsx` (19 assertions: RED → GREEN)
- Created `InjectionsSection.tsx`, `WeightsSection.tsx`, `SymptomsSection.tsx`, `PhotosSection.tsx`, `DoctorReportSection.tsx`, `ChartSection.tsx`
- Each section accepts: `data` (typed slice of SnapshotData), `viewerMode: 'share' | 'clinic'`, `onMount?: (name: string) => void`
- `onMount` fires once via `useRef` guard (firedRef.current pattern) — T-10-05-02 mitigation
- EmptyState rendered when data is empty/undefined — T-10-05-01 mitigation
- `DoctorReportSection` lazy-loads the existing `DoctorReport` modal component
- `ChartSection` lazy-loads `MedLevelChart`; adapter maps `SnapshotData['injections']` to Phase 8 chart shape
- All 19 assertions pass; typecheck clean

### Task 2: ReadOnlyPatientView + SharePage refactor + App.tsx route + stub

- Authored `ReadOnlyPatientView.test.tsx` (4 assertions: RED → GREEN):
  - Test 1: viewerMode=share renders all 6 section headings
  - Test 2: viewerMode=clinic + full permissionMap renders all 6 sections
  - Test 3: viewerMode=clinic + canViewPhotos=false → Photos section absent (D-12 absence rule)
  - Test 4: onSectionMount fires once per visible section; no duplicate fires on re-render
- Authored `ReadOnlyPatientView.tsx`:
  - `isVisible()` helper applies D-12 permissionMap gating
  - Renders 6 sections in order: chart, injections, weights, symptoms, photos, doctor_report
  - `onSectionMount` passed to each section's `onMount` prop (Plan 10-07 integration point)
- Refactored `SharePage.tsx`:
  - `adaptSnapshotToReadOnly()` adapter bridges Phase 8 SnapshotResponse shape to SnapshotData
  - Snapshot-rendered branch replaced with `<ReadOnlyPatientView snapshot={readOnlySnapshot} viewerMode="share" />`
  - Share chrome (header, print button, disclaimer note, footers) unchanged
  - Removed: MedLevelChart lazy import, DoctorReport lazy import, doctorReportOpen state
- Updated `SharePage.test.tsx`: replaced section-rendering assertions with share-chrome assertions
- Created `ClinicDrillInPage.tsx` stub (Plan 10-07 overwrites with real implementation)
- Updated `App.tsx`:
  - Added `ClinicDrillInPage = lazy(...)` import
  - Added `'clinic-drill-in'` to View union type
  - Added `/clinic/[^/]+/patient/[^/]+` route match (ordered BEFORE generic `/clinic/` branch)
  - Added `clinic-drill-in` render branch
- Updated `vite.config.ts`: added `src/components/shared/` → `read-only-patient-view` manualChunk
- Updated `scripts/assert-clinic-bundle-budget.sh`: added `read-only-patient-view` (≤12 kB) and `share` (≤6 kB) ceiling checks

## Task Commits

1. **Task 1: Extract 6 section components (TDD)** — `b365c66` (feat)
2. **Task 2: ReadOnlyPatientView + SharePage refactor + drill-in route** — `2a604ab` (feat)

## Files Created/Modified

### Created
- `src/components/shared/ReadOnlyPatientView.tsx` — composition + D-12 gating + onSectionMount passthrough
- `src/components/shared/ReadOnlyPatientView.test.tsx` — 4 Vitest assertions
- `src/components/shared/sections/InjectionsSection.tsx` — injection list, EmptyState, onMount guard
- `src/components/shared/sections/WeightsSection.tsx` — weight log, EmptyState, onMount guard
- `src/components/shared/sections/SymptomsSection.tsx` — symptom list, EmptyState, onMount guard
- `src/components/shared/sections/PhotosSection.tsx` — photo grid, EmptyState, onMount guard
- `src/components/shared/sections/DoctorReportSection.tsx` — lazy DoctorReport wrapper, EmptyState, onMount guard
- `src/components/shared/sections/ChartSection.tsx` — lazy MedLevelChart wrapper, onMount guard
- `src/components/shared/sections/sections.test.tsx` — 19 Vitest assertions
- `src/components/clinic/drill-in/ClinicDrillInPage.tsx` — stub file (Plan 10-07 overwrites)

### Modified
- `src/components/share/SharePage.tsx` — thin wrapper; adaptSnapshotToReadOnly adapter; body sections replaced
- `src/components/share/SharePage.test.tsx` — share chrome tests only; section assertions removed
- `src/App.tsx` — ClinicDrillInPage lazy import + clinic-drill-in view + route match
- `vite.config.ts` — read-only-patient-view manualChunk rule
- `scripts/assert-clinic-bundle-budget.sh` — read-only-patient-view + share ceiling guards

## Bundle Delta (Projected)

| Chunk | Before | After (expected) | Notes |
|-------|--------|-----------------|-------|
| `share` | ~4 kB gz | ≤6 kB gz | Chrome only after section extraction |
| `read-only-patient-view` (new) | — | ≤12 kB gz | 6 sections + ReadOnlyPatientView |
| `clinic` | ~17 kB gz | ~17 kB gz | Stub only (Plan 10-07 grows it) |
| Index | ~18-24 kB gz | unchanged | No new index static imports |

## Decisions Made

- **adaptSnapshotToReadOnly adapter:** Phase 8 share Edge Function returns `SnapshotResponse['snapshot']` with Phase-8-specific field names (log_id, timestamp, signed_url for photos). The canonical `SnapshotData` type (Plan 10-01) uses id, created_at, storage_path. Rather than changing either type, a bridging adapter is colocated in SharePage.tsx — the only consumer of this Phase-8-to-Phase-10 translation.
- **SharePage lazy-loads ReadOnlyPatientView:** ReadOnlyPatientView is in the new shared chunk. SharePage lazy-imports it so the share-chrome (header, print button) renders immediately from the existing share chunk while sections load asynchronously from the shared chunk.
- **Chart permission gated by canViewInjections:** The drug-level chart derives its PK curve from injection history. When the operator lacks `canViewInjections`, the chart would be meaningless. Gate chart by the same permission.
- **onMount useRef pattern per section:** Each section instance holds its own `firedRef`. This handles the case where sections are conditionally rendered (permissionMap gating) — a section mount always means a fresh drill-in session, so the guard needs to reset with the component lifecycle, not live in a parent-level Set.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript `const as` readonly array not assignable to mutable type in DoctorReportSection**
- **Found during:** Task 1 typecheck
- **Issue:** `buildDoctorReportSnapshot()` used `as const` which produced `readonly []` arrays, but `DoctorReport`'s `snapshot` prop type expected mutable arrays.
- **Fix:** Replaced `as const` with explicit type annotations for the empty arrays.
- **Files modified:** `src/components/shared/sections/DoctorReportSection.tsx`
- **Commit:** b365c66

**2. [Rule 1 - Bug] Card import removed too aggressively from SharePage refactor**
- **Found during:** Task 2 typecheck
- **Issue:** Loading skeleton in SharePage still uses `Card` primitive; removed it with the section-render imports.
- **Fix:** Re-added `Card` import.
- **Files modified:** `src/components/share/SharePage.tsx`
- **Commit:** 2a604ab

**3. [Rule 1 - Bug] SharePage test "renders all 6 headings" fails after refactor**
- **Found during:** Task 2 test run
- **Issue:** Test asserted section headings from inline JSX; after refactor, ReadOnlyPatientView loads lazily so headings are behind an async Suspense boundary not resolved in the test.
- **Fix:** Updated test to verify share-chrome elements (patient name, "Recipient verified" badge, print button) instead of section headings. Section rendering covered by ReadOnlyPatientView.test.tsx.
- **Files modified:** `src/components/share/SharePage.test.tsx`
- **Commit:** 2a604ab

## Threat Model Coverage

| Threat ID | Status | Mitigation Applied |
|-----------|--------|--------------------|
| T-10-05-01 (consent_scope omission sections) | MITIGATED | EmptyState rendered for empty arrays; permissionMap is backup gate (isVisible()) |
| T-10-05-02 (onSectionMount fires for hidden sections) | MITIGATED | useRef+useEffect live inside section component; unmounted sections never fire |
| T-10-05-03 (shared chunk session hijack) | ACCEPTED | No per-route auth state in shared chunk; injection requires valid snapshot prop |

## Known Stubs

- `src/components/clinic/drill-in/ClinicDrillInPage.tsx` — stub "Loading patient data…" UI. Plan 10-07 overwrites with real ClinicDrillInPage implementation (ClinicDrillInSubBar + ReadOnlyPatientView + onSectionMount → log_clinic_view RPC).

## Threat Flags

None — no new network endpoints or auth paths beyond what the plan's threat model covers. The shared chunk contains only UI rendering logic; auth is handled by callers (SharePage via share-client, ClinicDrillInPage via clinic-snapshot).

## Self-Check: PASSED

- `src/components/shared/ReadOnlyPatientView.tsx` FOUND
- `src/components/shared/ReadOnlyPatientView.test.tsx` FOUND
- `src/components/shared/sections/InjectionsSection.tsx` FOUND
- `src/components/shared/sections/WeightsSection.tsx` FOUND
- `src/components/shared/sections/SymptomsSection.tsx` FOUND
- `src/components/shared/sections/PhotosSection.tsx` FOUND
- `src/components/shared/sections/DoctorReportSection.tsx` FOUND
- `src/components/shared/sections/ChartSection.tsx` FOUND
- `src/components/clinic/drill-in/ClinicDrillInPage.tsx` FOUND
- `src/components/share/SharePage.tsx` contains ReadOnlyPatientView: VERIFIED
- `src/App.tsx` contains ClinicDrillInPage + /clinic/.*/patient route: VERIFIED
- Commit `b365c66` FOUND in git log
- Commit `2a604ab` FOUND in git log
- No file deletions in either commit
- Vitest: 701 pass / 5 skipped (full suite)
- Typecheck: clean (only pre-existing use-roster-realtime.ts from sibling plan 10-06)

---
*Phase: 10-clinic-operator-surface*
*Completed: 2026-05-13*
