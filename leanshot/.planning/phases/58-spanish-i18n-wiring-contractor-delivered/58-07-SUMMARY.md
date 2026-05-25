---
phase: 58-spanish-i18n-wiring-contractor-delivered
plan: "07"
subsystem: i18n
tags: [i18n, patient-namespace, ai-panel, modals, charts, spanish]
dependency_graph:
  requires: ["58-06"]
  provides: ["patient namespace final state (card.* + tab.* + ai.* + modal.* + chart.*)"]
  affects: ["58-08 (es-smoke asserts ES across full dashboard)"]
tech_stack:
  added: []
  patterns:
    - "useTranslation(['patient','common']) multi-namespace pattern (AIChatPanel)"
    - "useTranslation('patient') single-namespace pattern (DoctorReport, PhotoCompareModal, charts)"
    - "Inner chart-tokens variable renamed to tok to avoid shadowing t() from useTranslation"
    - "Sub-component useTranslation hook (Bubble component gets its own hook for badge_personalized)"
key_files:
  created: []
  modified:
    - leanshot/src/components/dashboard/ai/AIChatPanel.tsx
    - leanshot/src/components/dashboard/modals/DoctorReport.tsx
    - leanshot/src/components/dashboard/modals/PhotoCompareModal.tsx
    - leanshot/src/components/dashboard/charts/MedLevelChart.tsx
    - leanshot/src/components/dashboard/charts/SimpleCharts.tsx
    - leanshot/public/locales/en/patient.json
    - leanshot/public/locales/es/patient.json
decisions:
  - "GreetingStrip audited — already fully keyed via common namespace + i18nMoodLabel/i18nGreetingText helpers; zero inline patient strings; no changes needed"
  - "Inner chart-tokens variable (previously named t) renamed to tok in MedLevelChart and all modified SimpleCharts functions to avoid variable shadowing with useTranslation's t()"
  - "Bubble sub-component given its own useTranslation('patient') hook for badge_personalized key rather than passing t as prop (consistent with React hook convention)"
  - "PhotoCompareModal Side() function received tapPrompt as a prop (string) rather than calling useTranslation internally, since it already receives translated side labels as props"
  - "patient:ai.subtitle_journey uses {{weeks}} and {{medication}} vars (English names preserved in ES)"
  - "Clinical copy (GLP-1 journey, pharmacokinetic estimate label) translated conservatively; signoff transferred to Phase 70 per T-58-02 disposition"
  - "i18next-parser fails with failOnWarnings:true due to pre-existing non-literal key warnings; keys manually authored to match parser conventions; check-locale-coverage.sh passes as the authoritative gate"
metrics:
  duration: "~35 minutes"
  completed: "2026-05-26"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 7
---

# Phase 58 Plan 07: Dashboard Overlays i18n (AI Panel + Modals + Charts) Summary

Final patient namespace plan — AI coach panel + doctor report + photo compare modals + charts keyed to `patient:ai.*`, `patient:modal.*`, `patient:chart.*` with full EN+ES parity, appended to card.* (58-05) + tab.* (58-06).

## What Was Built

**One-liner:** patient namespace finalized — 442 leaf keys at EN+ES parity across card/tab/ai/modal/chart prefix groups.

### Task 1: Component Keying

**AIChatPanel.tsx** — `useTranslation(['patient','common'])` added. 15 keys under `patient:ai.*`:
- Panel title (`LeanShot AI`), aria labels, thinking state, journey subtitle with `{{weeks}}` + `{{medication}}`
- Welcome message with `{{name}}`
- Placeholder, disclaimer, error messages (rate limit + unavailable)
- Clear conversation confirm dialog (message, title, button)
- `Personalized` badge (Bubble sub-component gets its own `useTranslation('patient')`)

**DoctorReport.tsx** — `useTranslation('patient')` added. 32 keys under `patient:modal.doctor_report.*`:
- Modal title, print button, report heading suffix
- Generated date line with `{{date}}` var
- Pharmacokinetic estimate label, Summary section heading
- All summary row labels (Medication, Current dose, Started, Starting weight, Current weight, Total change, Total injections)
- `(weekly)` and `(week {{week}})` dose/started suffixes
- Column headers (Date, Dose, Site, Notes, Symptom, Severity, Weight, BF%)
- Section headings (Recent injections, Side effects, Recent weight log)
- Empty states (None logged, No side effects logged, No entries)
- Lifetime frequency label, footer disclaimer

**PhotoCompareModal.tsx** — `useTranslation('patient')` added. 9 keys under `patient:modal.photo_compare.*`:
- Modal title, subtitle instruction
- Before/After side labels (passed to Side() as props alongside new `tapPrompt` prop)
- Delta stat labels (Days apart, Weight Δ, Body weight)
- Choose photos label, Tap a photo below prompt

**MedLevelChart.tsx** — `useTranslation('patient')` added. 2 keys under `patient:chart.med_level.*`:
- Past, Projected legend labels
- Inner chart-tokens variable renamed `t → tok` to avoid shadow conflict
- Legend filter updated to compare translated label strings
- `t` added to `useMemo` dependency array

**SimpleCharts.tsx** — `useTranslation('patient')` added. 10 keys across chart sub-groups:
- `WeightChart`: Weight legend, Start x-axis label (chart.weight.*)
- `MoodChart`: Mood (1–5), Energy (1–10) legend labels (chart.mood.*)
- `SleepChart`: Hours, Quality legend labels (chart.sleep.*)
- `SymptomChart`: No data empty label (chart.symptom.*)
- `CompositionChart`: Log body fat % to see empty label, Lean mass, Fat mass doughnut labels (chart.composition.*)
- Chart-tokens variable renamed `t → tok` in each updated function

**GreetingStrip.tsx** — AUDITED: already fully keyed via `common` namespace and `i18nMoodLabel`/`i18nGreetingText` helpers. Zero inline patient JSX text. No changes required.

### Task 2: patient.json Finalization

- **en/patient.json**: appended `ai.*` (15 keys), `chart.*` (12 keys), `modal.*` (42 keys, split across `doctor_report` and `photo_compare`)
- **es/patient.json**: full ES parity — same 442 leaf keys, all translated
- Total patient namespace: 442 leaf keys (card: 120, tab: 248, ai: 15, chart: 12, modal: 42, plus freeze_token/streak_day plurals)
- All `{{vars}}` in ES use English variable names: `{{weeks}}`, `{{medication}}`, `{{name}}`, `{{date}}`, `{{week}}`

## Clinical Strings (Phase 70 Signoff)

| EN key | EN value | ES value | Note |
|--------|----------|----------|------|
| ai.subtitle_journey | "Knows your {{weeks}}-week journey on {{medication}}." | "Conoce tu recorrido de {{weeks}} semanas con {{medication}}." | medication names are passed as-is (brand names) |
| ai.disclaimer | "AI guidance — not medical advice. Consult your prescriber." | "Orientación de IA — no es consejo médico. Consulta a tu prescriptor." | |
| modal.doctor_report.pk_label | "Pharmacokinetic estimate:" | "Estimación farmacocinética:" | clinical term |
| modal.doctor_report.footer | "Generated by LeanShot..." | "Generado por LeanShot..." | |

Phase 70 human signoff required for clinical ES copy per T-58-02 transfer disposition.

## Verification Results

- `npx tsc -p tsconfig.app.json --noEmit`: 0 errors
- `jq -e '.card and .tab and .ai and .chart and .modal'`: ALL-PREFIXES-PRESENT
- EN/ES parity: PARITY-PASS (442 leaf keys each)
- `bash scripts/check-locale-coverage.sh`: patient PASS (442/442), all namespaces OK
- No translated `{{vars}}` in new ai/modal/chart keys: PASS
- Test baseline: 25 failed / 110 failing (unchanged from pre-plan baseline)

## Deviations from Plan

**1. [Rule 2 - Audit] GreetingStrip confirmed no changes needed**
- Found during: Task 1
- Issue: Plan says audit GreetingStrip for remaining inline patient strings
- Result: GreetingStrip already fully keyed (uses `common` namespace + i18nMoodLabel/i18nGreetingText exhaustive-switch helpers from 58-PATTERNS.md Wave B). No inline patient JSX text found.
- Files modified: none
- Acceptable per plan: "if none remain, the file may need no change"

**2. [Rule 1 - Bug] Variable shadow: chart-tokens `t` vs useTranslation `t`**
- Found during: Task 1 (MedLevelChart, SimpleCharts)
- Issue: `const t = getChartTokens(theme)` inside `useMemo` would shadow `const { t } = useTranslation(...)` at component scope
- Fix: Renamed inner chart-tokens variable to `tok` in all affected functions; updated all `t.primary`, `t.tick`, `t.grid`, `t.rose`, `t.sage`, `t.surface` references to `tok.*`
- Files modified: MedLevelChart.tsx, SimpleCharts.tsx (WeightChart, MoodChart, SleepChart, CompositionChart, SymptomChart)

**3. [Rule 3 - Blocking] i18next-parser failOnWarnings blocks automated extraction**
- Found during: Task 2
- Issue: `npm run i18n:extract` exits non-zero due to pre-existing `failOnWarnings: true` + non-literal-key warnings in unrelated files. Parser does not write output when it errors.
- Fix: Keys manually authored directly to EN and ES patient.json following parser conventions (sorted alphabetically, nested object structure). The `check-locale-coverage.sh` gate is the authoritative coverage check per the parser config comments.
- Impact: `npm run i18n:extract && git diff --quiet` acceptance check cannot pass (extractor fails), but coverage.sh PASS + parity PASS + TypeScript clean all confirm correctness.

## Known Stubs

None — all patient:ai/modal/chart keys are wired to actual source strings with no placeholder values.

## Threat Flags

No new security-relevant surface introduced. All changes are translation key wiring only.

## Self-Check

- [x] AIChatPanel.tsx: modified with ai.* keying
- [x] DoctorReport.tsx: modified with modal.doctor_report.* keying
- [x] PhotoCompareModal.tsx: modified with modal.photo_compare.* keying
- [x] MedLevelChart.tsx: modified with chart.med_level.* keying
- [x] SimpleCharts.tsx: modified with chart.* keying
- [x] en/patient.json: ai + chart + modal sections present
- [x] es/patient.json: full parity at 442 keys

## Self-Check: PASSED

Commits:
- `faa5a51d` feat(58-07): key AIChatPanel + modals + charts to patient namespace
- `2e2c42e5` feat(58-07): finalize patient namespace — append ai./modal./chart. EN+ES
