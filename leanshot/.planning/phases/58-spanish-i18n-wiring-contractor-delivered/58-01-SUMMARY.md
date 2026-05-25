---
phase: 58-spanish-i18n-wiring-contractor-delivered
plan: "01"
subsystem: i18n-ci-governance
tags: [i18n, ci, playwright, clinical-glossary, translator-workflow]
dependency_graph:
  requires: []
  provides:
    - Gate 3 ICU interpolation guard in i18n-gate.yml
    - p58-es-smoke opt-in Playwright project
    - RED es-smoke scaffold at e2e/i18n/es-smoke.spec.ts
    - docs/clinical-glossary.md (EN/ES medical term pairs, signoff-pending)
    - docs/TRANSLATOR-WORKFLOW.md (extract/translate/verify/CI runbook)
  affects:
    - leanshot/.github/workflows/i18n-gate.yml (Gate 3 appended)
    - leanshot/playwright.config.ts (ES_SMOKE_OPT_IN const + testIgnore + project)
tech_stack:
  added: []
  patterns:
    - CI grep gate for ICU interpolation integrity (Gate 3)
    - Playwright opt-in project via env var (ES_SMOKE_OPT_IN)
    - RED/fixme scaffold pattern for deferred Wave-4 assertions
    - Clinical glossary with signoff-pending lifecycle flag
key_files:
  created:
    - leanshot/e2e/i18n/es-smoke.spec.ts
    - leanshot/docs/clinical-glossary.md
    - leanshot/docs/TRANSLATOR-WORKFLOW.md
  modified:
    - leanshot/.github/workflows/i18n-gate.yml
    - leanshot/playwright.config.ts
decisions:
  - Gate 3 ICU guard greps RELATIVE path public/locales/es/ (i18n-gate.yml job has working-directory: leanshot)
  - TRANSLATOR-WORKFLOW.md documents the absence of scripts/import-tmx.ts as an explicit "this was rejected" note
  - clinical-glossary.md ships machine ES translations for 30+ terms, all signoff-pending for Phase 70 HUMAN-UAT
metrics:
  duration: "~15 min"
  completed: "2026-05-25T20:52:37Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 3
  files_modified: 2
---

# Phase 58 Plan 01: CI Gate-3 + ES Smoke Scaffold + Clinical Governance Summary

Gate 3 ICU interpolation guard (grep-based, CI-blocking) + p58-es-smoke opt-in Playwright project + RED es-smoke fixture scaffold + clinical-glossary.md machine-ES terms (30+ rows, all signoff-pending) + TRANSLATOR-WORKFLOW.md 6-step runbook.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add Gate 3 ICU interpolation guard to i18n-gate.yml | 659bc066 | leanshot/.github/workflows/i18n-gate.yml |
| 2 | Add p58-es-smoke Playwright project + RED es-smoke scaffold | 41d36213 | leanshot/playwright.config.ts, leanshot/e2e/i18n/es-smoke.spec.ts |
| 3 | Author clinical-glossary.md + TRANSLATOR-WORKFLOW.md | f1394217 | leanshot/docs/clinical-glossary.md, leanshot/docs/TRANSLATOR-WORKFLOW.md |

## What Was Built

### Task 1: Gate 3 ICU Interpolation Guard

Appended a third CI step to `leanshot/.github/workflows/i18n-gate.yml` after the existing "i18n parser drift check" step. The step runs:

```bash
grep -rEn '\{\{[a-záéíóúñüÁÉÍÓÚÑÜ]' public/locales/es/
```

The grep targets `public/locales/es/` (relative to the job's `working-directory: leanshot`). It fails CI when any ES catalog value contains an interpolation marker whose variable name starts with a lowercase or accented letter — the signature of a translated `{{var}}` name (e.g. `{{conteo}}`, `{{recuento}}`). i18next variable names are always ASCII-lowercase (`{{count}}`, `{{name}}`), so a legitimate ES catalog never matches. On match, the step emits `::error::` annotations naming the offending file and a remediation hint ("preserve {{count}} verbatim, only translate surrounding text"), then exits 1. Implements I18N-13 ICU-validity requirement and T-58-01 interpolation-integrity threat mitigation.

### Task 2: p58-es-smoke Playwright Project + RED Scaffold

In `playwright.config.ts`:
- Added `const ES_SMOKE_OPT_IN = process.env.PLAYWRIGHT_RUN_ES_SMOKE === '1'`
- Added `/e2e\/i18n\/es-smoke\.spec\.ts$/` to the chromium project's `testIgnore` array
- Added conditional `p58-es-smoke` project spread with `testMatch: [/e2e\/i18n\/es-smoke\.spec\.ts$/]`

Created `e2e/i18n/es-smoke.spec.ts` as a RED scaffold with:
- `test.skip(!ES_SMOKE_OPT_IN, 'opt-in via PLAYWRIGHT_RUN_ES_SMOKE=1 --project=p58-es-smoke')` as describe-level guard
- `test.fixme()` placeholder tests for all 5 I18N-15 flows: onboarding, dose-log (Medication tab), AI chat, cancellation, KB search
- `addInitScript` seeding `STORAGE_KEY = 'leanshot_v4'` with a minimal onboarded `user.locale = 'es'` state
- Navigation only to `/?lang=es` — no router paths (consumer surface uses Zustand tab clicks)

Wave-4 plan 58-08 replaces the `test.fixme()` stubs with real ES string assertions.

### Task 3: Clinical Glossary + Translator Workflow Runbook

Created `docs/clinical-glossary.md` (I18N-12):
- Machine-generated notice header with T-58-02 patient-harm vector warning
- Markdown table with 30+ EN/ES clinical term pairs across 5 categories
- All rows flagged `signoff-pending` for Phase 70 clinical-advisor HUMAN-UAT
- Covers: 6 medications (Ozempic/Wegovy/Mounjaro/Zepbound + semaglutida/tirzepatida), 4 dose units, 5 symptom terms, 3 anatomical sites, 7 safety-copy terms
- Phase 70 signoff requirements section with escalation path

Created `docs/TRANSLATOR-WORKFLOW.md` (I18N-13):
- 6-step runbook: key components → i18n:extract → machine-translate delta → i18n:check → Gate 3 ICU verify → commit and CI push
- Explicit documentation that `scripts/import-tmx.ts` does NOT exist and should NOT be created
- Command reference table, clinical term handling section, scope reference, troubleshooting guide

## Verification Results

All plan verification checks passed:

```
V1: Gate 3 present in i18n-gate.yml          PASS
V2: p58-es-smoke present in playwright.config PASS
V3: e2e/i18n/es-smoke.spec.ts present        PASS
V4: docs/ files present                       PASS
V5: bash scripts/check-locale-coverage.sh    PASS (all namespaces 0 missing/extra)
```

TypeScript: `npx tsc -p tsconfig.app.json --noEmit` exits 0 (no new errors introduced).

## Deviations from Plan

None — plan executed exactly as written.

The TRANSLATOR-WORKFLOW.md mentions `scripts/import-tmx.ts` in two places: once to document that the contractor TMX approach was abandoned, and once in the "Out of scope" section explicitly saying it should NOT be created. This is compliant with the plan task's intent ("Note the original 'contractor TMX import' framing...never materialized") and represents documentation of the rejected approach, not a reference to an existing script.

## Known Stubs

- `e2e/i18n/es-smoke.spec.ts`: All 5 test bodies are `test.fixme()` stubs — intentional RED scaffold. Wave-4 plan 58-08 wires real ES string assertions after all namespaces are keyed (58-02 through 58-07).

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. All files are CI config, Playwright test scaffold, and documentation artifacts. Threat model fully addressed:

| Flag | File | Description |
|------|------|-------------|
| T-58-01 (mitigated) | .github/workflows/i18n-gate.yml | Gate 3 ICU guard prevents translated {{var}} names from reaching production |
| T-58-02 (mitigated+transferred) | docs/clinical-glossary.md | Clinical terms flagged signoff-pending; human advisor signoff transferred to Phase 70 |

## Self-Check: PASSED

Files created:
- [x] leanshot/.github/workflows/i18n-gate.yml — FOUND (modified, Gate 3 appended)
- [x] leanshot/playwright.config.ts — FOUND (modified, ES_SMOKE_OPT_IN + p58-es-smoke)
- [x] leanshot/e2e/i18n/es-smoke.spec.ts — FOUND
- [x] leanshot/docs/clinical-glossary.md — FOUND
- [x] leanshot/docs/TRANSLATOR-WORKFLOW.md — FOUND

Commits:
- [x] 659bc066 — feat(58-01): add Gate 3 ICU interpolation guard to i18n-gate.yml
- [x] 41d36213 — feat(58-01): add p58-es-smoke opt-in project + RED es-smoke scaffold
- [x] f1394217 — docs(58-01): add clinical-glossary.md + TRANSLATOR-WORKFLOW.md
