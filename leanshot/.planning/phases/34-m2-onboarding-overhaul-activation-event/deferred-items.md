# Phase 34 — Deferred Items

Items discovered out-of-scope during plan execution. Per executor scope boundary:
pre-existing warnings, linting errors, or failures in unrelated files are NOT
auto-fixed by the active plan.

## Pre-existing failing tests in `src/lib/__tests__/org.test.ts`

**Discovered:** During Plan 34-08 Task 1 baseline test run.

- **Test 6** (`surfaceCheck staff: members.invite=false; patients.link=true`)
  asserts `surfaceCheck('patients.link')` is true for `clinician` role, but
  `patients.link` is not present in `ROLE_PERMISSIONS.clinician` (or any role).

- **Test 12** (`_ROLE_PERMISSIONS_FOR_TEST owner set has expected permissions`)
  asserts `_ROLE_PERMISSIONS_FOR_TEST.owner.has('patients.link')` is true; same
  root cause — `patients.link` is not in the matrix.

**Likely owner:** Phase 28 Plan 28-05 OR Phase 31 Plan 31-01 (when the matrix
was expanded; tests reference a key that was removed/renamed during a later
refactor and the tests weren't updated).

**NOT touched by Plan 34-08** — out of scope (Rule 1/2/3 apply only to changes
directly caused by THIS plan).

**Plan 34-08 additive tests:** Tests 13a-13e (Phase 34 D-18 ship_winner +
edit_draft permission hints) — all pass.
