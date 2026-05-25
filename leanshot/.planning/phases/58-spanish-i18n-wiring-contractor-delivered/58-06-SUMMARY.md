---
phase: 58-spanish-i18n-wiring-contractor-delivered
plan: "06"
subsystem: i18n / dashboard-tabs
tags: [i18n, spanish, patient-namespace, dashboard-tabs, clinical-copy]
dependency_graph:
  requires: ["58-05"]
  provides: ["patient:tab.*"]
  affects: ["58-07"]
tech_stack:
  added: []
  patterns:
    - useTranslation('patient') single-namespace hook in all 9 dashboard tabs
    - Exhaustive switch helpers (tabHeading, symptomLabel, moodLabel) in tab-labels.ts
    - Static literal t('patient:tab.*') keys — no template-literal keys in tabs/
key_files:
  created:
    - leanshot/src/lib/i18n/tab-labels.ts
  modified:
    - leanshot/src/components/dashboard/tabs/MedicationTab.tsx
    - leanshot/src/components/dashboard/tabs/HomeTab.tsx
    - leanshot/src/components/dashboard/tabs/BodyTab.tsx
    - leanshot/src/components/dashboard/tabs/ActivityTab.tsx
    - leanshot/src/components/dashboard/tabs/NutritionTab.tsx
    - leanshot/src/components/dashboard/tabs/MoodTab.tsx
    - leanshot/src/components/dashboard/tabs/SymptomsTab.tsx
    - leanshot/src/components/dashboard/tabs/SupplementsTab.tsx
    - leanshot/src/components/dashboard/tabs/InsightsTab.tsx
    - leanshot/public/locales/en/patient.json
    - leanshot/public/locales/es/patient.json
decisions:
  - "symptomLabel() and moodLabel() helpers added to tab-labels.ts rather than
    inline template-literal lookups — parser requires static keys"
  - "MoodTab MOODS array had inline label strings removed; moodLabel(t,v) now
    provides translated label at render time"
  - "SymptomsTab symptom labels resolved via symptomLabel(t,id) helper, replacing
    SYMPTOMS_LIST.name fallback — eliminates English hardcoded fallthrough"
  - "InsightsTab local variable 't' renamed to 'trimmed' to avoid shadowing
    the useTranslation 't' function"
  - "Clinical MedicationTab strings (current dose, estimated levels, doses
    remaining, half-life, titration) keyed under patient:tab.medication.* and
    flagged for Phase 70 human-signoff per T-58-02 threat disposition"
metrics:
  duration: "~35 min"
  completed: "2026-05-26"
  tasks_completed: 2
  files_modified: 11
---

# Phase 58 Plan 06: Dashboard Tab i18n (patient:tab.*) Summary

All 9 dashboard tab components keyed into the `patient` namespace under the `tab.*` prefix. patient.json extended from 128 keys (card.* only, 58-05) to 375 leaf keys (card.* + tab.*) at full EN↔ES parity.

## Tasks Completed

### Task 1: MedicationTab + HomeTab + tab-labels.ts (commit b24b933b)

- **tab-labels.ts** created at `src/lib/i18n/tab-labels.ts` with three exhaustive switch helpers:
  - `tabHeading(t, id)` — maps tab IDs to `patient:tab.<tab>.heading`
  - `symptomLabel(t, id)` — maps SYMPTOMS_LIST IDs (12 symptoms) to `patient:tab.symptoms.symptom_*`
  - `moodLabel(t, v)` — maps mood values 1–5 to `patient:tab.mood.mood_*`

- **MedicationTab** — densest clinical tab: ~30 strings keyed including:
  - `stat_current_dose`, `stat_last_shot`, `stat_doses_remaining`, `stat_total_injections`
  - `chart_title` ("Estimated medication levels"), `half_life_badge` ("Half-life · {{days}}d"), `chart_footnote`
  - Full vial management: `vials_title`, `action_add_vial`, empty states, dose counter (`vial_doses_of`)
  - Titration schedule: `titration_title`, `titration_week` ("Wk {{week}}"), `titration_you`, `titration_custom`
  - Recent injections table: `recent_title`, column headers, empty state, delete aria-labels
  - Cost tracker: `cost_title`, tiles, table columns, cost type options, modal fields
  - VialModal and CostModal inner components also wired with `useTranslation('patient')`

- **HomeTab** — `for_you_title`, `insight_title`, `insight_empty` keyed.

- Local variable conflict fixed: MedicationTab's `.map((t) => ...)` over titration steps renamed to `.map((step) => ...)` to avoid shadowing the `useTranslation` `t` function.

### Task 2: Remaining 7 tabs + locale JSON (commit 58d6caa3)

**BodyTab**: stat tiles, clinical trial comparison section, weight log form, measurements form, photo gallery (Add photo, Compare, Trash, Move to Trash), weight history table, goal progress bar label.

**ActivityTab**: stat tiles, workout log form (type select with 5 options), steps section, Apple Health import, workout history table with delete.

**NutritionTab**: target macros (Protein, Calories, Fiber, Water), quick log meal form with AI estimate flow, water bubbles and food noise selector aria-labels, food noise hint, today's meals table, protein/food noise charts.

**MoodTab**: MOODS array de-inlined — `moodLabel(t, v)` now resolves all 5 labels (Tough/Low/Even/Good/Great) at render time via static switch. Both mood log and sleep log forms fully keyed. Chart titles.

**SymptomsTab**: symptom picker buttons now use `symptomLabel(t, s.id)` — all 12 symptoms (Nausea, Fatigue, Constipation, Diarrhea, Sulfur burps, Reflux, Headache, Injection rxn, Dizziness, Mood shift, Hair loss, Cravings) resolved via static switch. Severity label, recent log table, empty state.

**SupplementsTab**: stack title, Reset button, Logged/Undo/Reorder supplement actions, adherence chart title.

**InsightsTab**: doctor report card, shareable progress card, NSV add form (local `t` variable renamed to `trimmed`), wins list with delete, smart insights section, weekly summary tiles, GLP-1 Survival Guide hero card.

**patient.json updates**:
- en/patient.json: 128 keys (card.*) → 375 keys (card.* + tab.*)
- es/patient.json: 128 keys (card.*) → 375 keys (card.* + tab.*) — full parity
- `bash scripts/check-locale-coverage.sh`: patient namespace PASS (375/375)
- No translated `{{vars}}` in ES — all interpolation variable names remain English (`{{date}}`, `{{week}}`, `{{count}}`, etc.)

## Clinical EN+ES Pairs (T-58-02 — Safety-Relevant, Human Signoff Deferred to Phase 70)

| EN key | EN value | ES value |
|--------|----------|----------|
| `tab.medication.chart_title` | Estimated medication levels | Niveles estimados de medicación |
| `tab.medication.stat_current_dose` | Current dose | Dosis actual |
| `tab.medication.stat_doses_remaining` | Doses remaining | Dosis restantes |
| `tab.medication.half_life_badge` | Half-life · {{days}}d | Semivida · {{days}}d |
| `tab.medication.titration_title` | Titration schedule | Cronograma de titulación |
| `tab.medication.titration_custom` | Custom titration — follow your prescriber's plan. | Titulación personalizada — sigue el plan de tu médico. |
| `tab.medication.vial_doses_of` | {{remaining}}/{{total}} doses | {{remaining}}/{{total}} dosis |
| `tab.medication.vial_expires` | expires {{days}}d | vence en {{days}}d |

Numbers, units, and `{{vars}}` are preserved verbatim in all ES values per clinical safety requirement T-58-02. Phase 70 human-signoff gate covers these strings.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Variable shadowing in MedicationTab titration .map()**
- **Found during:** Task 1 implementation
- **Issue:** The titration schedule `.map((t) => ...)` used `t` as the loop variable, shadowing the `useTranslation` `t` function. Any inline `t(...)` call inside the map body would silently call the titration step object instead of the translation function.
- **Fix:** Renamed loop variable from `t` to `step`.
- **Files modified:** `leanshot/src/components/dashboard/tabs/MedicationTab.tsx`
- **Commit:** b24b933b

**2. [Rule 1 - Bug] Variable shadowing in InsightsTab NSV onClick handler**
- **Found during:** Task 2 implementation
- **Issue:** The NSV save button onClick had `const t = nsv.trim()` which would shadow the `useTranslation` `t` from the outer scope, causing any `t(...)` calls in the handler to fail at runtime.
- **Fix:** Renamed local to `const trimmed = nsv.trim()`.
- **Files modified:** `leanshot/src/components/dashboard/tabs/InsightsTab.tsx`
- **Commit:** 58d6caa3

**3. [Rule 2 - Missing critical] VialModal and CostModal sub-components not in plan scope**
- **Found during:** Task 1 — these inner components share user-visible strings with the MedicationTab outer function
- **Issue:** VialModal and CostModal are defined in the same file and have inline English strings (modal titles, field labels, error toasts). Leaving them un-keyed would cause English to appear in Spanish mode for the vial/cost modal flows.
- **Fix:** Added `useTranslation('patient')` to both inner components; keyed all strings consistently.
- **Files modified:** `leanshot/src/components/dashboard/tabs/MedicationTab.tsx`
- **Commit:** b24b933b

## Known Stubs

None — all tab strings are wired to real i18n keys with both EN and ES translations populated. No placeholders, empty values, or TODO markers introduced.

## Threat Flags

None beyond the plan's declared threat model. No new network endpoints, auth paths, or file access patterns introduced.

## Verification Results

- `npx tsc -p tsconfig.app.json --noEmit`: 0 errors
- `bash scripts/check-locale-coverage.sh`: all 8 namespaces PASS including patient (375/375)
- EN↔ES parity: `jq paths(scalars)` output identical between en/patient.json and es/patient.json
- No translated `{{vars}}`: `grep -oE '\{\{[^}]+\}\}' es/patient.json | grep [áéíóúñü]` → empty
- Test suite: 25 failed files / 110 failing tests (identical to pre-58-06 baseline — no regressions)

## Self-Check: PASSED

- `leanshot/src/lib/i18n/tab-labels.ts`: FOUND
- `leanshot/src/components/dashboard/tabs/MedicationTab.tsx`: FOUND (useTranslation present)
- `leanshot/public/locales/en/patient.json`: FOUND (card.* + tab.* at 375 keys)
- `leanshot/public/locales/es/patient.json`: FOUND (375 keys, parity PASS)
- Commit b24b933b: FOUND
- Commit 58d6caa3: FOUND
