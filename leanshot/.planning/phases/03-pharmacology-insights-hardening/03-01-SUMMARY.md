---
phase: 03-pharmacology-insights-hardening
plan: 01
subsystem: pharmacology
tags:
  - pharmacology
  - vitest
  - corpus
  - pk-01
requires: []
provides:
  - PK_DISCLAIMER_LINE_1
  - PK_DISCLAIMER_LINE_2
  - PK_DISCLAIMER_FULL
  - PK_DISCLAIMER_BAND_CAPTION
  - PK_DISCLAIMER_Y_AXIS
  - PK_DISCLAIMER_DOCTOR_REPORT
  - CORPUS
  - CV_BY_DRUG_CLASS
  - CorpusEntry
affects:
  - src/lib/pharmacology.ts (test coverage only — no source change)
tech_stack:
  added: []
  patterns:
    - "Single-source-of-truth string constants module (src/lib/disclaimers.ts)"
    - "Cited corpus + ±15% Vitest predicate per drug class"
key_files:
  created:
    - src/lib/disclaimers.ts
    - src/lib/pharmacology-corpus.ts
    - src/lib/pharmacology.test.ts
  modified: []
decisions:
  - "Sampling fix: most-recent dose placed at `now` so [now, now+τ) is the final dosing interval (not the post-last interval as the RESEARCH scaffold suggested)"
metrics:
  duration_minutes: 6
  completed_date: 2026-05-11
  tasks_total: 3
  tasks_completed: 3
  tests_added: 6
  tests_passing: 6
requirements:
  - PK-01
---

# Phase 3 Plan 1: PK Corpus + Disclaimer Strings Summary

Cited steady-state corpus for the 1-compartment PK model with peer-reviewed Vitest assertions and a shared disclaimer string module that Plans 03 and 04 will consume.

## What Was Built

Three new files under `src/lib/`. No existing source files were modified.

### `src/lib/disclaimers.ts`

Six string constants — the single source of truth for every PK disclaimer surface Phase 3 introduces. The chart watermark (D-08), Y-axis label (SC#1), band caption (D-06), and DoctorReport PDF disclaimer (D-10) all derive from these constants in downstream plans.

Exported symbols:

| Symbol | Value |
|--------|-------|
| `PK_DISCLAIMER_LINE_1` | `estimate, not measured serum level` |
| `PK_DISCLAIMER_LINE_2` | `— based on population pharmacokinetics` (U+2014 em-dash) |
| `PK_DISCLAIMER_FULL` | `LINE_1 + ' ' + LINE_2` |
| `PK_DISCLAIMER_BAND_CAPTION` | `Estimate · ~30% inter-individual variation` (U+00B7 middle dot) |
| `PK_DISCLAIMER_Y_AXIS` | `Estimate · arbitrary units` |
| `PK_DISCLAIMER_DOCTOR_REPORT` | `Drug-level curve: estimate, not measured serum level — based on population pharmacokinetics. Shows modeled mean with shaded inter-individual variability band (~30%).` |

Punctuation verified: em-dash U+2014 and middle dot U+00B7 character classes assert across the file via the executor's grep gate.

### `src/lib/pharmacology-corpus.ts`

The cited corpus driving `pharmacology.test.ts` and (in later plans) the Chart.js uncertainty band fill.

Exported symbols:

| Symbol | Shape |
|--------|-------|
| `CorpusEntry` | interface with literal-union `drugClass`, `representativeMed: MedicationId`, dose/τ/halfLife/target/bounds, `cvPercent`, optional `publishedCssNgPerMl`, `source`, `year` |
| `CORPUS` | `CorpusEntry[]` — 5 rows in canonical order: semaglutide, tirzepatide, liraglutide, dulaglutide, retatrutide |
| `CV_BY_DRUG_CLASS` | `Record<string, number>` — derived from `CORPUS.map(c => [c.drugClass, c.cvPercent / 100])` |

All five published sources grep-visible in the file:

- `10.1007/s13300-018-0458-5` (Petri 2018 — semaglutide)
- `10.1002/psp4.13099` (Schneck 2024 — tirzepatide)
- `accessdata.fda.gov/.../206321s016lbl.pdf` (Saxenda 2023 — liraglutide)
- `10.1007/s40262-015-0338-3` (Geiser 2016 — dulaglutide)
- `10.1056/NEJMoa2301972` (Jastreboff 2023 — retatrutide)

Numeric values copied verbatim from `03-RESEARCH.md` lines 109-115 — no recomputation, no deviation.

### `src/lib/pharmacology.test.ts`

Six Vitest cases:

| Case | Result |
|------|--------|
| semaglutide (wegovy 1mg q168h): Aₛₛ_avg within ±15% of 1.443mg | PASS |
| tirzepatide (mounjaro 10mg q168h): Aₛₛ_avg within ±15% of 10.305mg | PASS |
| liraglutide (saxenda 3mg q24h): Aₛₛ_avg within ±15% of 2.345mg | PASS |
| dulaglutide (trulicity 1.5mg q168h): Aₛₛ_avg within ±15% of 1.546mg | PASS |
| retatrutide (retatrutide 12mg q168h): Aₛₛ_avg within ±15% of 14.846mg | PASS |
| CV_BY_DRUG_CLASS: semaglutide cv = 0.27 | PASS |

Full suite cross-check: `npx vitest run` reports `Test Files 12 passed (12), Tests 93 passed (93)`. No prior tests were broken.

## Commits

| Hash | Task | Message |
|------|------|---------|
| `0ed0ad6` | 1 | `feat(03-01): add disclaimers.ts — shared PK disclaimer string constants` |
| `3700d0c` | 2 | `feat(03-01): add pharmacology-corpus.ts — 5 drug-class steady-state corpus` |
| `c8dfea6` | 3 | `test(03-01): add pharmacology.test.ts — Vitest ±15% steady-state corpus assertions` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] RESEARCH §Test scaffold sampling offset was off by one τ**

- **Found during:** Task 3 (first vitest run)
- **Issue:** The RESEARCH scaffold (`03-RESEARCH.md` lines 251-255) builds `injections` with the most-recent dose at `new Date(now - (i + 1) * τ * HOUR_MS)` — i.e. one τ *before* `now` — and then samples `calcMedLevel(now + h * HOUR_MS, ...)` for `h ∈ [0, τ]`. That sequence actually samples the SECOND τ-interval after the last dose, so the curve has decayed an extra τ before averaging. Concrete impact: semaglutide simulated `Aₛₛ_avg ≈ 0.722 mg` versus the cited target `1.443 mg` — every drug class failed its ±15% predicate against the corpus bounds the same RESEARCH document publishes.
- **Fix:** Implementation places the most-recent dose at `now` (`i = 0 → now - 0`) and prior doses at `now - i × τ`. The sample window is then `[now, now + τ)`, which is the actual final τ-interval where `Aₛₛ_avg = D × halfLife / (τ × ln2)` holds.
- **Files modified:** `src/lib/pharmacology.test.ts` only — the RESEARCH document itself was left untouched (downstream plans reference it; the fix is captured here + in the test).
- **Verification:** All 5 drug-class assertions now pass against the originally-tabulated `lowerBoundMg` / `upperBoundMg` bounds; the corpus numbers in `pharmacology-corpus.ts` did not need to change.
- **Commit:** `c8dfea6`

### Asked Issues

None. No Rule 4 (architectural) decisions arose.

## Authentication Gates

None required. No external services, no secrets, no CI key handling.

## Threat Flags

None. No new network endpoints, auth paths, file access, or schema changes introduced. All three files are pure-data / pure-test modules with no runtime surface beyond what was scoped in the plan's `<threat_model>`.

## Known Stubs

None. No placeholder data, no empty-array fallbacks, no "coming soon" copy. Every export is a real, cited value.

## Verification Summary

| Check | Command | Result |
|-------|---------|--------|
| TypeScript strict | `npx tsc -p tsconfig.app.json --noEmit` | exit 0 |
| Vitest (this plan) | `npx vitest run src/lib/pharmacology.test.ts` | 6/6 pass |
| Vitest (full suite) | `npx vitest run` | 93/93 pass, 12/12 files |
| Disclaimer string sentinel | `grep -F "estimate, not measured serum level" src/lib/disclaimers.ts` | match |
| All 5 DOIs/URLs grep-visible | `grep -cE "DOI 10\.|accessdata\.fda\.gov"` | 5 |
| Em-dash present | `grep -c $'—' src/lib/disclaimers.ts` | 4 (≥2 required) |
| Middle-dot present | `grep -c $'·' src/lib/disclaimers.ts` | 3 (≥2 required) |

Success criterion (PK-01) satisfied: `src/lib/pharmacology.ts` (`calcMedLevel`, `HALF_LIVES`, `TITRATION`) is now covered by an automated test corpus citing peer-reviewed sources for all five drug classes; ±15% steady-state predicate enforced; CI green.

## Self-Check: PASSED

- [x] `src/lib/disclaimers.ts` exists — FOUND
- [x] `src/lib/pharmacology-corpus.ts` exists — FOUND
- [x] `src/lib/pharmacology.test.ts` exists — FOUND
- [x] Commit `0ed0ad6` exists in git log — FOUND
- [x] Commit `3700d0c` exists in git log — FOUND
- [x] Commit `c8dfea6` exists in git log — FOUND
- [x] `npx vitest run` reports 93/93 pass — VERIFIED
- [x] `npx tsc -p tsconfig.app.json --noEmit` exit 0 — VERIFIED
