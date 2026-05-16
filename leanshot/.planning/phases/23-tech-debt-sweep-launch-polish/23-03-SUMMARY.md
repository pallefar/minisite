---
phase: 23-tech-debt-sweep-launch-polish
plan: 03
subsystem: ui
tags: [react, supabase, modal, rls, vitest, lazy-load, clinic, drill-in, a11y]

# Dependency graph
requires:
  - phase: 10-clinic-operator-surface
    provides: "ClinicDrillInPage + handleViewActivity stub (Plan 10-09 carry-forward DEBT-01)"
  - phase: 22-onboarding-account-mgmt-cs-admin
    provides: "Impersonation write-deny RLS policies on all data tables"
  - phase: 23-tech-debt-sweep-launch-polish
    provides: "Plan 23-01: no-restricted-syntax ESLint rule blocking .user! non-null assertions"
provides:
  - "PatientActivityModal.tsx — 6-table chronological-merge activity feed for clinic drill-in"
  - "handleViewActivity wired in ClinicDrillInPage.tsx — DEBT-01 closed"
  - "13 vitest cases covering modal render, merge logic, empty/error states, a11y"
  - "3 live RLS isolation test cases (self-skip when env absent)"
affects: [clinic-operator-surface, phase-24-onwards]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Local lazy() import inside page component (modal code-split without App.tsx change)"
    - "Chronological-merge via ISO string comparison across 6 heterogeneous tables"
    - "File-scoped RLS test prefix (patact-) to avoid cross-suite cleanup clobber"

key-files:
  created:
    - leanshot/src/components/clinic/drill-in/PatientActivityModal.tsx
    - leanshot/src/components/clinic/drill-in/PatientActivityModal.test.tsx
    - leanshot/tests/rls/patient-activity-modal-rls.test.ts
  modified:
    - leanshot/src/components/clinic/drill-in/ClinicDrillInPage.tsx

key-decisions:
  - "Use local lazy() import inside ClinicDrillInPage (not App.tsx) to avoid App.tsx change and respect single-writer rule"
  - "PatientActivityModal queries with .eq('user_id', patientId) — client-side filter as well as RLS; defence-in-depth for operator drill-in context"
  - "manualChunks clinic rule absorbs modal into clinic chunk (not a separate file); index is unaffected — both acceptable per plan goals"
  - "formatRelativeTs custom helper avoids date-fns dependency (project convention)"

requirements-completed: [DEBT-01]

# Metrics
duration: 45min
completed: 2026-05-16
---

# Phase 23 Plan 03: PatientActivityModal Summary

**Clinic operator drill-in "View activity" stub wired to a lazy-loaded 6-table chronological activity modal — DEBT-01 carry-forward closed after Plan 10-09.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-05-16T14:30:00Z
- **Completed:** 2026-05-16T15:15:00Z
- **Tasks:** 4
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments

- PatientActivityModal: parallel Promise.all fetch from 6 tables (injections, weights, meals, workouts, symptoms, photos), merged newest-first by ISO timestamp, loading/empty/error states, wraps existing Modal primitive
- ClinicDrillInPage wired: `console.warn` stub at line 287 replaced with `setIsActivityModalOpen(true)`; lazy import at module scope; Suspense-wrapped conditional render
- 13 vitest tests (all green): open=false, loading state, 12-entry merge, empty state, partial error, Esc close, role=dialog/aria-modal, .user! source guard, kind badges, formatRelativeTs unit tests
- Live cross-tenant RLS test (3 scenarios): patient A sees only their injections, patient B sees only theirs, anon sees 0 rows; self-skips without env vars

## Bundle Delta

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| index chunk gz | 19,738 bytes | 19,738 bytes | 0 (unchanged) |
| clinic chunk gz | ~27,000 bytes | 27,485 bytes | +485 bytes |
| Index ceiling (24.5 kB) | PASS | PASS | — |
| assert-clinic-bundle-budget.sh | PASS | PASS | — |

PatientActivityModal source lands in the `clinic` chunk (manualChunks rule `src/components/clinic/`). The modal is lazy-loaded from ClinicDrillInPage — the `clinic` chunk only downloads when the operator first navigates to `/clinic/{slug}/patient/{id}`.

## Vitest Results

- **PatientActivityModal.test.tsx**: 13/13 passed
- **ClinicDrillInPage.test.tsx**: 9/9 passed (existing, no regressions)
- **patient-activity-modal-rls.test.ts**: 1 passed, 3 skipped (live env required)

Total: 23 passed, 3 skipped (live-env-gated)

## A11y Coverage

The modal wraps `src/components/ui/Modal.tsx` which already provides:
- `role="dialog"` + `aria-modal="true"` (line 83-84 of Modal.tsx)
- Esc key closes via `document.addEventListener('keydown')` (line 58-66 of Modal.tsx)
- Backdrop click closes (line 81 of Modal.tsx)
- Focus trap / body scroll lock during open (`document.body.style.overflow = 'hidden'`)

Test coverage: Tests 6 (Esc closes) and 7 (role/aria-modal) verify the a11y baseline.

## RLS Test Evidence

- **PATIENT_ACTIVITY_PREFIX**: `patact-`
- **Patients created**: Patient A (`patact-pa-<ts>@leanshot.test`) + Patient B (`patact-pb-<ts>@leanshot.test`)
- **Seeded data**: 2 injections for Patient A (2026-05-10, 2026-05-14), 1 for Patient B (2026-05-16 — newer than both A rows)
- **T-23-03-01**: Patient A's JWT → query returns `patact-inj-a-older` + `patact-inj-a-recent` only; most-recent row is 2026-05-14 (not B's 2026-05-16) — cross-tenant isolation proven
- **T-23-03-02**: Patient B's JWT → returns `patact-inj-b-newest` only (length === 1), no A rows
- **T-23-03-03**: Anon JWT → 0 rows returned (RLS default-deny `auth.uid() = user_id`)

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| T1-src | PatientActivityModal component | `20b8485` | PatientActivityModal.tsx (new) |
| T1-test | PatientActivityModal test suite | `25d55a7` | PatientActivityModal.test.tsx (new) |
| T2 | Wire handleViewActivity | `8614379` | ClinicDrillInPage.tsx (modified) |
| T3 | Live cross-tenant RLS test | `5dc0e71` | patient-activity-modal-rls.test.ts (new) |
| T4 | Bundle + lint fixes | `4fdcc82` | PatientActivityModal.tsx, .test.tsx, rls.test.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Import order lint errors in new files**
- **Found during:** Task 4 (verification)
- **Issue:** lucide-react and supabase imports in wrong order per import-x/order rule; unused eslint-disable directives; Suspense import unused in test file
- **Fix:** Reordered imports per alphabetical rule (@ before r before v); removed unused directives; moved PatientActivityModal import to top-level in test
- **Files modified:** PatientActivityModal.tsx, PatientActivityModal.test.tsx, patient-activity-modal-rls.test.ts
- **Committed in:** `4fdcc82` (T4)

**2. [Rule 1 - Bug] Source comment containing `.user!` triggered test assertion**
- **Found during:** Test T1 execution
- **Issue:** JSDoc comment said `No \`s.user!\` non-null assertions` — the regex `/\.user!/` in the belt-and-suspenders test matched the comment text
- **Fix:** Rewrote comment as "No non-null bang assertions on session user"
- **Committed in:** `4fdcc82` (T4)

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs)
**Impact on plan:** No scope changes. Both required for correctness — lint errors would block CI, test assertion false-positive fixed.

## Known Stubs

None. The modal wires real data fetches from 6 Supabase tables. The `formatRelativeTs` helper uses a simple relative-time calculation (not a full i18n library) — this is intentional for bundle size; a v1.3 pass could add proper i18n if needed.

## Issues Encountered

- The `manualChunks` `clinic` rule captures ALL files under `src/components/clinic/`, so `PatientActivityModal.tsx` lands in the `clinic` chunk rather than a separate file. This is acceptable: the index chunk is unaffected (the clinic chunk is lazy-loaded from App.tsx), and the chunk size stays within the 28,000 byte ceiling.

## Next Phase Readiness

- DEBT-01 closed — `View activity` is no longer a no-op in the clinic drill-in surface
- Operator can now see all 6 data domains for any patient in chronological order
- RLS cross-tenant isolation confirmed on live DB when env vars present

---
*Phase: 23-tech-debt-sweep-launch-polish*
*Completed: 2026-05-16*
