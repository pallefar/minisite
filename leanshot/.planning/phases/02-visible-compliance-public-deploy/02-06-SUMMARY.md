---
phase: 02-visible-compliance-public-deploy
plan: 6
subsystem: charts
tags: [chartjs, plugin, watermark, compliance, sc3, d-13, d-14, d-15]
dependency_graph:
  requires:
    - src/components/dashboard/charts/MedLevelChart.tsx
    - src/components/dashboard/charts/BaseChart.tsx
    - src/lib/chart-theme.ts
    - src/hooks/useTheme.ts
  provides:
    - "Per-instance Chart.js plugin medLevelWatermarkPlugin: in-canvas diagonal disclaimer"
    - "MedLevelWatermarkOptions interface (color, opacity, text, fontFamily)"
  affects:
    - "MedLevelChart only — weight/symptom/sparkline charts unchanged"
tech-stack:
  added: []
  patterns:
    - "Per-instance Chart.js v4 plugin via config.plugins (NOT Chart.register)"
    - "Theme-derived options passed through ChartConfiguration.options.plugins.<id>"
    - "Co-located test file with hand-rolled CanvasRenderingContext2D mock"
key-files:
  created:
    - src/components/dashboard/charts/medLevelWatermarkPlugin.ts
    - src/components/dashboard/charts/medLevelWatermarkPlugin.test.ts
  modified:
    - src/components/dashboard/charts/MedLevelChart.tsx
decisions:
  - "Plugin scope = per-instance only (D-14, D-15) — no Chart.register, no BaseChart edit"
  - "Theme-aware values: light='60, 60, 60'@0.12, dark='220, 220, 220'@0.18 (D-13)"
  - "Watermark text frozen as module-level WATERMARK_TEXT constant with em-dash escape U+2014 to defeat editor auto-correction"
  - "Hand-rolled vi.fn()-based ctx mock instead of pulling in vitest-canvas-mock — lighter and matches plan §interfaces guidance"
metrics:
  duration_sec: 260
  completed: 2026-05-11
  tasks_completed: 2
  files_created: 2
  files_modified: 1
  unit_tests_added: 6
requirements:
  - COMPL-04
---

# Phase 02 Plan 06: MedLevel Diagonal Watermark Summary

**One-liner:** In-canvas diagonal `Estimate — not medical advice` watermark on MedLevelChart, scoped per-instance via Chart.js plugin so screenshots carry the disclaimer (SC#3) without polluting weight/symptom/sparkline charts.

> _Superseded by Phase 3 D-08: live watermark is now the two-line disclaimer `estimate, not measured serum level` / `— based on population pharmacokinetics`, plugin id bumped to `medLevelWatermark-v2`. The Phase 2 single-line string `Estimate — not medical advice` documented throughout this file is HISTORICAL — it accurately describes the Phase 2 deliverable but is no longer the rendered text. See `.planning/phases/03-pharmacology-insights-hardening/03-CONTEXT.md` D-08 and `src/lib/disclaimers.ts` for the canonical Phase 3 strings. D-09 also requires Phase 2 cross-reference docs to quote the new Phase 3 watermark string; this note discharges that requirement for 02-06-SUMMARY.md._

## What Shipped

1. **`src/components/dashboard/charts/medLevelWatermarkPlugin.ts`** — Chart.js v4 `Plugin<'line', MedLevelWatermarkOptions>` with `id: 'medLevelWatermark'`. Implements `afterDraw(chart, _args, options)` using `ctx.save → translate(cx, cy) → rotate(-π/4) → fillText(WATERMARK_TEXT, 0, 0) → restore`. Bails when `chartArea` is undefined (chart not yet laid out). Defaults: color `'120, 120, 120'`, opacity `0.12`, font `Inter, system-ui, sans-serif`.
2. **`src/components/dashboard/charts/medLevelWatermarkPlugin.test.ts`** — 6 unit tests using a hand-rolled `vi.fn()`-mocked `CanvasRenderingContext2D`:
   - Plugin id check
   - Verbatim text assertion `'Estimate — not medical advice'` (em-dash U+2014)
   - `-Math.PI / 4` rotation assertion
   - `save`/`restore` hygiene
   - Opacity propagation into `fillStyle`
   - `chartArea === undefined` bail-out
3. **`src/components/dashboard/charts/MedLevelChart.tsx`** — Added per-instance plugin import and wiring:
   - New import `import { medLevelWatermarkPlugin } from './medLevelWatermarkPlugin';`
   - New `options.plugins.medLevelWatermark: { color, opacity }` keyed off existing `theme` value
   - New `plugins: [medLevelWatermarkPlugin]` on the returned `ChartConfiguration`
   - `useMemo` deps already included `theme` (line 85) — no dep change required

## Plan-Required Output Confirmations

- **BaseChart.tsx watermark refs:** `grep -c "medLevelWatermarkPlugin" src/components/dashboard/charts/BaseChart.tsx` = **0** (no global registration; BaseChart untouched)
- **SimpleCharts.tsx watermark refs:** `grep -c "medLevelWatermarkPlugin" src/components/dashboard/charts/SimpleCharts.tsx` = **0** (weight/symptom/sparkline charts un-watermarked)
- **MedLevelChart.tsx watermark refs:** `grep -c "medLevelWatermarkPlugin" src/components/dashboard/charts/MedLevelChart.tsx` = **2** (import line + `plugins:` array)
- **`useTheme` import added?** No. `MedLevelChart.tsx` already imported `useTheme` (line 2 in v4 baseline) and destructured `{ theme }` on line 12. The plan's contingency to add `useTheme` was NOT triggered.
- **Final color/opacity values:**
  - **Light theme:** `color: '60, 60, 60'`, `opacity: 0.12`
  - **Dark theme:** `color: '220, 220, 220'`, `opacity: 0.18`

## Verification

- `npm run typecheck` → exit 0
- `npm run test:unit` → **8 files / 69 tests passed** (6 new + 63 pre-existing)
- `npm run build` → exit 0 (build size unchanged within noise; no new chunk)
- `npm run lint` → 0 errors, 4 warnings (all pre-existing in BaseChart.tsx, ShareCardModal.tsx, GuidedTour.tsx — not introduced by this plan)
- Done-criteria greps (Task 1 + Task 2):
  - Plugin file `Chart.register` count: 1 (sole match is in the doc comment **forbidding** `Chart.register()` — see Note A below)
  - Per-instance wiring confirmed in MedLevelChart only

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Plugin file leaves the `Chart.register()` mention in its header doc-block | The reference is part of a forbidding sentence: "*…NEVER via `Chart.register()` globally…*". Removing it would weaken future-developer guidance. The intent of the plan's grep done-criterion (no global registration) is satisfied; Note A below documents the literal vs intent gap. |
| Used hand-rolled mock instead of `vitest-canvas-mock` | Plan §interfaces explicitly recommended this trade. 6 tests, 73 lines, no new dep. |
| Did not memoize the plugin options object | The watermark options are recomputed inside the existing `useMemo` whose deps already include `theme`. Chart.js destroys-and-recreates on theme change via the `BaseChart` `key={theme}` pattern documented in CONTEXT (D-15 caveat about Chart.js not re-reading `config.plugins` on `.update()`). No remount work needed beyond what BaseChart already does. |
| Kept watermark default opacity at 0.12 inside the plugin even though Light/Dark are explicitly passed from MedLevelChart | A reasonable default matters when the plugin is reused for tests or for any future caller — Theme-arg fallbacks live at the call site. Tests assert behavior with both default and explicit options. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Lint cleanup] Removed 5 unused `eslint-disable-next-line @typescript-eslint/no-non-null-assertion` directives in plugin test file**
- **Found during:** Task 2 verification (`npm run lint`)
- **Issue:** ESLint flagged 5 unused-disable warnings; `@typescript-eslint/no-non-null-assertion` is not configured in this project (`eslint.config.js`), so the `!` operator on `medLevelWatermarkPlugin.afterDraw!(…)` does not trigger a rule.
- **Fix:** Stripped the 5 stale directives. Tests still green; lint warnings dropped from 9 to 4 (the remaining 4 are all pre-existing in unrelated files).
- **Files modified:** `src/components/dashboard/charts/medLevelWatermarkPlugin.test.ts`
- **Commit:** Bundled into Task 2 commit `dde3a09`

**2. [Operational — not a code deviation] Ran `npm ci` in worktree before tests**
- **Found during:** First Task-1 RED test run
- **Issue:** Worktree was missing `node_modules` (only the main repo at `/Users/karstenhaldan/minisite/leanshot` had them installed). `vitest: command not found`.
- **Fix:** Single `npm ci --prefer-offline --no-audit --no-fund` in the worktree (5s, 501 packages). No package.json or lockfile change.
- **Files modified:** None tracked.

### Notes

- **Note A — `grep "Chart.register"` count:** The Task-1 done-criterion text says `grep -c "Chart.register" plugin.ts == 0`, but the plugin file's JSDoc header includes the phrase "NEVER via `Chart.register()` globally" as part of its forbidding documentation. Literal grep returns 1; the intent (no functional registration) is satisfied. Removing the comment would weaken future-developer guidance, so the comment stays. If the grep is ever wired to CI, the regex should be tightened to ignore comment lines (e.g., `grep -vE "^\\s*\\*" | grep -c "Chart\\.register("`).

## Threat Flags

None. This plan only adds an in-canvas paint hook for the existing MedLevelChart; it adds no network, auth, file-IO, or schema surface.

## Known Stubs

None. The watermark feature is end-to-end functional (plugin draws into canvas; MedLevelChart wires it; theme propagates via existing `useMemo` deps).

## Commits

| # | Type | Hash | Description |
|---|------|------|-------------|
| 1 | test | `cb9de04` | TDD RED — failing tests for medLevelWatermarkPlugin (6 cases) |
| 2 | feat | `5a91af0` | TDD GREEN — implement medLevelWatermarkPlugin |
| 3 | feat | `dde3a09` | Wire plugin into MedLevelChart (per-instance only); lint cleanup |

## TDD Gate Compliance

- ✓ RED commit `cb9de04` precedes GREEN commit `5a91af0`
- ✓ GREEN commit followed RED on the **same plan id** in the same wave
- ✓ No REFACTOR cycle was needed (implementation came in one focused pass)

## Self-Check: PASSED

- File `src/components/dashboard/charts/medLevelWatermarkPlugin.ts`: FOUND
- File `src/components/dashboard/charts/medLevelWatermarkPlugin.test.ts`: FOUND
- File `src/components/dashboard/charts/MedLevelChart.tsx` (modified): FOUND
- Commit `cb9de04`: FOUND
- Commit `5a91af0`: FOUND
- Commit `dde3a09`: FOUND
- Greps: BaseChart=0, SimpleCharts=0, MedLevelChart=2 — all match plan done-criteria
- Tests: 8/8 files pass, 69/69 cases pass
- Build: clean
