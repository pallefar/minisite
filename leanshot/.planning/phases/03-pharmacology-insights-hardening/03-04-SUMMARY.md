---
phase: 03-pharmacology-insights-hardening
plan: 4
subsystem: doctor-report
tags: [doctor-report, pdf, disclaimer, pk-04, d-09, d-10, rtl]
requires:
  - 03-01  # PK_DISCLAIMER_DOCTOR_REPORT exported from src/lib/disclaimers.ts
provides:
  - PK-04-pdf  # DoctorReport PDF carries PK disclaimer aside
  - D-10       # discharged (DoctorReport PDF watermark parity via HTML aside branch)
  - D-09       # discharged (Phase 2 cross-reference docs updated)
affects:
  - src/components/dashboard/modals/DoctorReport.tsx
tech-stack:
  added: []
  patterns:
    - "HTML disclaimer aside parallel to canvas watermark — second branch of D-10"
    - "RTL component test with beforeEach store-setState + afterEach cleanup() before reset"
key-files:
  created:
    - src/components/dashboard/modals/DoctorReport.test.tsx
  modified:
    - src/components/dashboard/modals/DoctorReport.tsx
    - .planning/phases/02-visible-compliance-public-deploy/02-06-SUMMARY.md
    - .planning/phases/02-visible-compliance-public-deploy/02-HUMAN-UAT.md
decisions:
  - "Implement D-10 via parallel HTML aside, not canvas re-render — DoctorReport does not embed MedLevelChart"
  - "Place aside between header and Summary so doctor sees it before dose tables"
  - "Use beforeEach to seed user fixture + cleanup() before useStore reset to avoid framer-motion null-deref on unmount"
metrics:
  duration_min: 8
  completed: 2026-05-11
  tasks: 3
  files_created: 1
  files_modified: 3
requirements:
  - PK-04
---

# Phase 3 Plan 04: DoctorReport PK Disclaimer (PK-04 + D-10) Summary

**One-liner:** Added PK-specific HTML `<aside>` to `DoctorReport.tsx` between the patient-name header and Summary section, sourcing the verbatim text from `PK_DISCLAIMER_DOCTOR_REPORT` in `src/lib/disclaimers.ts`; locked the contract with an RTL test asserting presence on every render; updated Phase 2 docs to flag the watermark string as superseded by Phase 3 D-08.

## What Shipped

1. **`src/components/dashboard/modals/DoctorReport.tsx`** — Added import of `PK_DISCLAIMER_DOCTOR_REPORT` and inserted an `<aside role="note">` between the existing `<header>` (line 48) and the Summary `<section>` (now line 60). Aside carries Tailwind classes `rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-3 text-[12px] italic text-[var(--color-text-secondary)] print:border-black` so the disclaimer survives `window.print()`. Aside is preceded by a JSX comment `{/* CONTEXT D-10: DoctorReport PDF watermark parity — see .planning/phases/03-pharmacology-insights-hardening/03-CONTEXT.md */}` for traceability. Existing generic footer at line 197 left untouched (kept as the broader medical disclaimer).

2. **`src/components/dashboard/modals/DoctorReport.test.tsx`** (new, 62 lines) — Vitest + `@testing-library/react` regression. Seeds a minimal `User` fixture via `useStore.setState({ ...initialState, user: FIXTURE_USER })` in `beforeEach`. Two `it` cases assert (a) `PK_DISCLAIMER_DOCTOR_REPORT` text rendered (non-exact substring match because the surrounding `<strong>` element produces sibling text nodes), and (b) the `Pharmacokinetic estimate:` label is rendered. `afterEach` calls `cleanup()` BEFORE `useStore.setState(initialState)` to avoid a `Cannot read properties of null (reading 'units')` exception during framer-motion's `AnimatePresence` exit transition.

3. **`.planning/phases/02-visible-compliance-public-deploy/02-06-SUMMARY.md`** — Added a single consolidated supersession note directly beneath the one-liner, naming Phase 3 D-08, the canonical `src/lib/disclaimers.ts` strings, and the bumped plugin id `medLevelWatermark-v2`. The Phase 2 single-line string `Estimate — not medical advice` is preserved throughout as a historical record of the Phase 2 deliverable; only the new italicized note flags the Phase 3 supersession. Discharges D-09 for this file.

4. **`.planning/phases/02-visible-compliance-public-deploy/02-HUMAN-UAT.md`** — Deterministic edits to lines 80 (C10) and 81 (C11) per the plan's `<action>` block. Original Phase 2 acceptance text preserved verbatim; one `**Note (Phase 3 D-09):**` line appended immediately beneath each. C10's note tells future UAT runners the live watermark is the Phase 3 two-line string. C11's note clarifies that D-14's watermark-scope constraint still holds in Phase 3 (C11 verifies scope, not text). Discharges D-09 for this file.

## Plan-Required Output Confirmations

- `grep -F "import { PK_DISCLAIMER_DOCTOR_REPORT } from '@/lib/disclaimers'" src/components/dashboard/modals/DoctorReport.tsx` → 1 match
- `grep -F "<aside role=\"note\"" src/components/dashboard/modals/DoctorReport.tsx` → 1 match
- `grep -F "Pharmacokinetic estimate:" src/components/dashboard/modals/DoctorReport.tsx` → 1 match
- `grep -F "CONTEXT D-10" src/components/dashboard/modals/DoctorReport.tsx` → 1 match (JSX traceability comment)
- `grep -F "print:border-black" src/components/dashboard/modals/DoctorReport.tsx` → 1 match
- `grep -F "{PK_DISCLAIMER_DOCTOR_REPORT}" src/components/dashboard/modals/DoctorReport.tsx` → 1 match
- `grep -c "Generated by LeanShot" src/components/dashboard/modals/DoctorReport.tsx` → 1 (existing footer preserved)
- `grep -F "Phase 3 D-08" .planning/phases/02-visible-compliance-public-deploy/02-06-SUMMARY.md` → 1 match
- `grep -F "medLevelWatermark-v2" .planning/phases/02-visible-compliance-public-deploy/02-06-SUMMARY.md` → 1 match
- `grep -F "estimate, not measured serum level" .planning/phases/02-visible-compliance-public-deploy/02-HUMAN-UAT.md` → 1 match
- `grep -F "Note (Phase 3 D-09):" .planning/phases/02-visible-compliance-public-deploy/02-HUMAN-UAT.md` → 2 matches (one under C10, one under C11)

## Verification

- `npm run test:unit -- --run src/components/dashboard/modals/DoctorReport.test.tsx` → **2 passed / 0 failed / 0 unhandled errors** (Vitest 4.1.5, jsdom)
- `npx tsc -p tsconfig.app.json --noEmit` → **exit 0**
- `npx eslint src/components/dashboard/modals/DoctorReport.tsx src/components/dashboard/modals/DoctorReport.test.tsx` → **exit 0** (zero errors)

## Manual UAT — pending (1 of 2 phase-level manual checks per VALIDATION.md)

Developer opens DoctorReport modal in the running app, clicks "Print / save PDF", and confirms in the browser's print preview:

1. The new italicized `<aside>` appears between the patient-name header and the Summary section
2. The aside's text begins with bold "Pharmacokinetic estimate:" and continues with the verbatim string `Drug-level curve: estimate, not measured serum level — based on population pharmacokinetics. Shows modeled mean with shaded inter-individual variability band (~30%).`
3. The aside has a visible black border under print rendering (the `print:border-black` Tailwind utility)

This is one of the two manual-only items recorded in `.planning/phases/03-pharmacology-insights-hardening/03-VALIDATION.md`.

## Deviations from Plan

None — plan executed exactly as written. The Task 2 test required one minor refinement after the initial RED commit: `cleanup()` had to be called before `useStore.setState(initialState)` in `afterEach` to avoid a framer-motion `AnimatePresence` exit-transition reading `user.units` from the now-null user. This is an internal test-hygiene detail, not a behavior change, and was applied within Task 2's TDD scope before commit `4f681c6`.

## Auto-fix attempts

None. No Rule 1/2/3 fixes were needed during execution. The single eslint import-order error in the new test file was auto-fixed by `eslint --fix` (a tooling convenience, not a behavior deviation).

## Commits

| # | Type | Hash    | Message |
|---|------|---------|---------|
| 1 | test | 76ad040 | TDD RED — failing RTL test for DoctorReport PK disclaimer |
| 2 | feat | bfd55a8 | TDD GREEN — add PK disclaimer aside to DoctorReport (D-10) |
| 3 | test | 4f681c6 | finalize DoctorReport.test.tsx — cleanup() + import order |
| 4 | docs | 7f0d49b | add Phase 3 supersession notes to Phase 2 docs (D-09) |

## TDD Gate Compliance

- RED commit (`test`): 76ad040 — failing test added before implementation ✓
- GREEN commit (`feat`): bfd55a8 — implementation turns the failing test green ✓
- REFACTOR commit (`test` for test-hygiene only): 4f681c6 — non-behavior-changing cleanup of the test file ✓

## Self-Check: PASSED

- File `src/components/dashboard/modals/DoctorReport.tsx`: FOUND (modified)
- File `src/components/dashboard/modals/DoctorReport.test.tsx`: FOUND (created)
- File `.planning/phases/02-visible-compliance-public-deploy/02-06-SUMMARY.md`: FOUND (modified)
- File `.planning/phases/02-visible-compliance-public-deploy/02-HUMAN-UAT.md`: FOUND (modified)
- Commit 76ad040: FOUND
- Commit bfd55a8: FOUND
- Commit 4f681c6: FOUND
- Commit 7f0d49b: FOUND
