---
phase: 03-pharmacology-insights-hardening
plan: 03
subsystem: pharmacology-chart
tags:
  - chart
  - chartjs
  - watermark
  - band
  - a11y
  - pk-disclaimer
requires:
  - 03-01  # src/lib/disclaimers.ts (PK_DISCLAIMER_LINE_1, PK_DISCLAIMER_LINE_2, PK_DISCLAIMER_Y_AXIS, PK_DISCLAIMER_BAND_CAPTION)
  - 03-01  # src/lib/pharmacology-corpus.ts (CV_BY_DRUG_CLASS)
provides:
  - "MedLevelChart now renders a ±CV% inter-individual variability band per drug class"
  - "Two-line PK disclaimer watermark rendered on chart canvas at 45° in both themes"
  - "Y-axis carries no measurement-grade unit (PK_DISCLAIMER_Y_AXIS abstract-unit label)"
  - "aria-label communicates 'estimate, not a measured serum level' to screen readers"
  - "DOM band caption (PK_DISCLAIMER_BAND_CAPTION) under canvas — AT-accessible"
affects:
  - DoctorReport (Phase 8 read-share): inherits the same MedLevelChart component verbatim
  - Any future chart that shares BaseChart: unaffected (per-instance plugin discipline preserved)
tech-stack:
  added: []  # No new runtime deps — uses existing chart.js, react 19
  patterns:
    - "Per-instance Chart.js plugin (config.plugins: [...]), NEVER Chart.register()"
    - "Dataset ordering: visible-lines-first so UI-SPEC tooltip filter datasetIndex < 2 cleanly excludes band datasets"
    - "alpha-0.12 hex suffix (t.primary + '20', t.rose + '20') for band fill"
    - "Disclaimer strings as single-source-of-truth constants in @/lib/disclaimers"
key-files:
  created: []
  modified:
    - src/components/dashboard/charts/medLevelWatermarkPlugin.ts
    - src/components/dashboard/charts/medLevelWatermarkPlugin.test.ts
    - src/components/dashboard/charts/MedLevelChart.tsx
decisions:
  - "Watermark font multiplier = 0.06 (midpoint between Phase 2 0.08 and UI-SPEC compact-fallback 0.055); rationale comment per UI-SPEC line 61 instruction. Reserved fallback to 0.055 if Plan 05 VALIDATION reports clipping."
  - "Dataset ordering: visible-lines-first (Past, Projected, then 4 band datasets). Reconciles RESEARCH suggestion (bands first) against UI-SPEC tooltip filter (datasetIndex < 2). PATTERNS.md flagged the conflict; Plan 03 picked UI-SPEC-compatible ordering."
  - "Plugin-id cascade: 'medLevelWatermark' → 'medLevelWatermark-v2' (D-08). The options-key on the chart configuration must be quoted because of the hyphen."
  - "options.text only overrides LINE 1 (testing convenience); LINE 2 is never overridden so the em-dash byte verification test is stable."
  - "Empty-state band suppression: showBand = injections.length > 0 prevents a zero-on-zero ghost-fill artifact along the x-axis when no doses are logged."
  - "DOM band caption rendered alongside canvas so screen-reader users receive the variability magnitude (~30%) — canvas pixels are inaccessible to AT."
metrics:
  duration: ~25min
  completed: 2026-05-11
  tasks: 3
  commits: 3
  files_modified: 3
  files_created: 0
---

# Phase 3 Plan 3: Drug-Level Chart Uncertainty Band + Disclaimer Cascade Summary

**One-liner:** MedLevelChart now renders a per-drug-class ±CV% uncertainty band, a two-line on-canvas PK disclaimer (`estimate, not measured serum level — based on population pharmacokinetics`) at 45° in both themes, an abstract-unit Y-axis (`Estimate · arbitrary units`), and an a11y-equivalent aria-label + DOM caption — implementing PK-03 (band), PK-04 (chart-side watermark), and ROADMAP Phase 3 SC#1 (no measurement-grade unit).

## What Was Built

### Task 1 — Watermark plugin update (`medLevelWatermarkPlugin.ts`)

- Replaced the `WATERMARK_TEXT = 'Estimate — not medical advice'` constant with imports `PK_DISCLAIMER_LINE_1` and `PK_DISCLAIMER_LINE_2` from `@/lib/disclaimers` (single source of truth).
- Bumped plugin id `'medLevelWatermark'` → `'medLevelWatermark-v2'` (D-08) so PRs that drop the em-dash or revert text are caught by name-mismatch.
- Two `fillText` calls at `(0, ±lineHeight/2)` render two lines under one `ctx.rotate(-π/4)`.
- New font formula: `Math.max(11, height * 0.06)` (was `Math.max(14, height * 0.08)`).
- New `lineHeight = Math.max(13, height * 0.07)`.
- `options.text` now overrides LINE 1 only; LINE 2 always paints verbatim from the constant so the em-dash byte verification test stays stable.
- `chartArea`-undefined guard preserved (early return before any `ctx.save`).
- Rationale comment for the 0.06 multiplier embedded in the file per UI-SPEC line 61 "Document the chosen value in the plan."

**Commit:** `bc9fdfc`

### Task 2 — Watermark test update (`medLevelWatermarkPlugin.test.ts`)

- Imported `PK_DISCLAIMER_LINE_1` and `PK_DISCLAIMER_LINE_2`.
- Updated plugin-id assertion to `'medLevelWatermark-v2'`.
- Replaced the single-line verbatim-text assertion with two `fillText` expectations (LINE_1 at `(0, expect.any(Number))`, LINE_2 at `(0, expect.any(Number))`) plus a `toHaveBeenCalledTimes(2)` assertion.
- Added em-dash byte verification: `expect(PK_DISCLAIMER_LINE_2.charCodeAt(0)).toBe(0x2014)` — replaces the previous embedded em-dash literal check.
- Preserved the four other test cases (rotation, save/restore hygiene, opacity, chartArea-undefined bail).
- **Test count: 6 → 7 passing.**

**Commit:** `cf6f1b3`

### Task 3 — Chart component update (`MedLevelChart.tsx`)

- **Band datasets (PK-03):** 4 new datasets appended when `injections.length > 0`: UpperPast, LowerPast, UpperProjected, LowerProjected. Computed from `cvPct = CV_BY_DRUG_CLASS[trialClass(u.medication)] ?? 0.30` applied as `mean * (1 ± cvPct)`.
- **Dataset ordering** (visible-lines-first): `[Past, Projected, UpperPast, LowerPast, UpperProjected, LowerProjected]`. Upper datasets use `fill: '+1'` (relative) → resolves to the lower bound immediately following in the array. Reconciles RESEARCH "bands first" suggestion with UI-SPEC `tooltip.filter: datasetIndex < 2` — PATTERNS.md flagged the conflict; visible-lines-first wins.
- **Band fill colors:** `backgroundColor: t.primary + '20'` (past) and `t.rose + '20'` (projected). The `'20'` hex suffix is α=0.125, matching UI-SPEC α=0.12.
- **Tooltip filter:** `tooltip: { filter: (item) => item.datasetIndex < 2 }` — band datasets never appear in hover tooltips.
- **Legend filter:** `legend.labels.filter: (item) => item.text === 'Past' || item.text === 'Projected'` — band datasets hidden from legend.
- **Plugin-options key cascade:** `medLevelWatermark: { ... }` → `'medLevelWatermark-v2': { ... }` (quoted because of hyphen).
- **Y-axis (SC#1):** `title.text` now sourced from `PK_DISCLAIMER_Y_AXIS` constant (`'Estimate · arbitrary units'`); the previous `${u.doseUnit} in system` template literal is removed.
- **aria-label:** `'28-day medication level'` → `'28-day medication level estimate with inter-individual variability band, not a measured serum level'` — equivalence with the canvas watermark for SR users.
- **DOM band caption:** `<p className="text-[12px] italic text-[var(--color-text-tertiary)] text-center mt-1">{PK_DISCLAIMER_BAND_CAPTION}</p>` rendered directly under `<BaseChart>` via a React Fragment. Caption text: `Estimate · ~30% inter-individual variation`.
- **Empty-state suppression (T-03-10 mitigation):** `showBand = injections.length > 0` gates the band datasets so a zero-injections session does not render a ghost-fill on the x-axis.
- **D-15 per-instance discipline preserved:** `plugins: [medLevelWatermarkPlugin]` is unchanged; no `Chart.register()` call.

**Commit:** `304369a`

## Plugin-ID Cascade (Verification)

The id `medLevelWatermark-v2` now appears in **all three** locations:
- Plugin source: `medLevelWatermarkPlugin.ts:39` — `id: 'medLevelWatermark-v2'`
- Plugin test: `medLevelWatermarkPlugin.test.ts:25` — assertion `.toBe('medLevelWatermark-v2')`
- Chart consumer: `MedLevelChart.tsx:149` — quoted options key `'medLevelWatermark-v2': { ... }`

A future PR that bumps the id in only one of those three locations breaks the test or the canvas options-pass-through, which catches the regression in CI.

## Dataset Ordering Reconciliation

| Source | Suggested ordering | Resolution |
|--------|--------------------|------------|
| 03-RESEARCH.md L500-547 | Bands FIRST (so visible lines paint on top in z-order) | Rejected for Plan 03 |
| 03-UI-SPEC.md tooltip contract | Visible lines must satisfy `datasetIndex < 2` filter | Honored — visible lines first |
| 03-PATTERNS.md flag | "Reconcile in plan" | Done — Plan 03 picks visible-lines-first |

Result: `[Past, Projected, Upper(P), Lower(P), Upper(F), Lower(F)]`. Chart.js's `fill: '+1'` is index-relative so the upper-bound→lower-bound resolution still works regardless of absolute index.

## Watermark Font Multiplier — Chosen Value

**Chosen:** `0.06` (with 11px floor). Multiplier comment embedded in the plugin source per UI-SPEC line 61 "Document the chosen value in the plan."

**Rationale:** Midpoint between Phase 2's `0.08` (sized for the old 31-char single-line watermark) and UI-SPEC line 61's compact-fallback `0.055` (sized for worst-case narrow viewports). 0.06 preserves legibility on standard viewports while honoring UI-SPEC's shrink-from-0.08 intent for the longer Phase 3 two-line copy (~96 chars total).

**Reserved fallback:** If Plan 05 VALIDATION's UAT pass reports clipping at narrow widths, swap `Math.max(11, height * 0.06)` → `Math.max(11, height * 0.055)` in the same file and re-run the watermark test (no API-shape change).

## Empty-State Band Suppression (T-03-10)

- `showBand = injections.length > 0` is the gate.
- When false, datasets array is `[Past, Projected]` only (2 datasets).
- When true, datasets array is `[Past, Projected, UpperPast, LowerPast, UpperProjected, LowerProjected]` (6 datasets).
- Existing tooltip/legend filters (`datasetIndex < 2` / text-filter) are no-ops in the empty-state branch but remain wired so the chart options object is structurally stable.

## Test Counts

- `medLevelWatermarkPlugin.test.ts`: **7 passing** (was 6 pre-plan; +1 em-dash byte test, replaced 1 verbatim-string test with 1 two-line test, kept 5 others).
- `pharmacology.test.ts` (regression check): **6 passing**, unchanged — Plan 01's PK corpus still healthy.

## Verification Results

| Gate | Result |
|------|--------|
| `npx vitest run src/components/dashboard/charts/medLevelWatermarkPlugin.test.ts` | ✓ 7/7 passing |
| `npx vitest run src/lib/pharmacology.test.ts` (regression) | ✓ 6/6 passing |
| `npx tsc -p tsconfig.app.json --noEmit` | ✓ exit 0 |
| `npx eslint src/components/dashboard/charts/{MedLevelChart.tsx,medLevelWatermarkPlugin.ts,medLevelWatermarkPlugin.test.ts}` | ✓ exit 0 |
| Visual UAT (dashboard render) | Deferred to Plan 05 VALIDATION (recorded in 03-VALIDATION.md) |

## Threat Model Coverage

| Threat ID | Mitigation Status |
|-----------|-------------------|
| T-03-07 — Tampering of watermark text | Mitigated: plugin id `medLevelWatermark-v2` asserted in test + em-dash byte check (`0x2014`) + single-file disclaimer source (`@/lib/disclaimers`) |
| T-03-08 — Tampering of Y-axis label (measurement-claim reversion) | Mitigated: Y-axis title sourced from `PK_DISCLAIMER_Y_AXIS` constant; `doseUnit} in system` literal removed (grep returns 0 matches) |
| T-03-09 — a11y / SR info-disclosure gap | Mitigated: aria-label contains both "estimate" and "not a measured serum level"; DOM caption adds `~30% inter-individual variation` so SR users get variability magnitude too |
| T-03-10 — Zero-injection ghost-fill visual DoS | Mitigated: `showBand = injections.length > 0` gate; band datasets omitted entirely in empty state |

## Deviations from Plan

None. All three tasks executed exactly as specified.

The Task 3 acceptance-criteria regex for "no old unversioned plugin-options key" (`medLevelWatermark(['"\]|: \{)`) had an unterminated character class in the plan source, so I verified the intent with two equivalent greps:
- `medLevelWatermark: \{` → 0 matches (no bare `medLevelWatermark: {` plugin-options block)
- `['"]medLevelWatermark['"]:` → 0 matches (no unversioned quoted-key block)

The only `medLevelWatermark` occurrences in MedLevelChart.tsx are: (1) the `import { medLevelWatermarkPlugin }` line, (2) the quoted `'medLevelWatermark-v2':` options key, and (3) the `plugins: [medLevelWatermarkPlugin]` array — all expected.

This is not a behavior deviation; it's a clarification of how the regex was interpreted. Calling it out so a future reader doesn't think the acceptance-criteria gate was bypassed.

## Auth Gates

None — no external services touched.

## Known Stubs

None. The band uses the real `CV_BY_DRUG_CLASS` table from Plan 01 (no placeholder values); the caption text and Y-axis label come from real `PK_DISCLAIMER_*` constants.

## Deferred Issues

None.

## Commits

| Hash | Type | Message |
|------|------|---------|
| `bc9fdfc` | feat | feat(03-03): two-line watermark + v2 plugin id (PK-04 chart-side) |
| `cf6f1b3` | test | test(03-03): assert v2 plugin id + two-line render + em-dash byte |
| `304369a` | feat | feat(03-03): uncertainty band + Y-axis relabel + a11y (PK-03, PK-04, SC#1) |

## Self-Check: PASSED

- ✓ `src/components/dashboard/charts/medLevelWatermarkPlugin.ts` modified (commit `bc9fdfc`)
- ✓ `src/components/dashboard/charts/medLevelWatermarkPlugin.test.ts` modified (commit `cf6f1b3`)
- ✓ `src/components/dashboard/charts/MedLevelChart.tsx` modified (commit `304369a`)
- ✓ All three commit hashes resolve in `git log --all`
- ✓ Plan-level verification: 7/7 watermark tests passing, 6/6 pharmacology tests passing, tsc + eslint exit 0
- ✓ All acceptance criteria for all three tasks met
