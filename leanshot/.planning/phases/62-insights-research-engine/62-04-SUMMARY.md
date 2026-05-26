---
phase: 62-insights-research-engine
plan: "04"
subsystem: admin-research-ui
tags: [admin, research, cohort-builder, chart-js, privacy, k-anonymity, differential-privacy]
dependency_graph:
  requires:
    - 62-01  # DB schema + matviews
    - 62-02  # SECDEF RPCs (compile_research_cohort, estimate_research_cohort)
  provides:
    - admin-research-ui  # /admin/research shell + cohort builder + charts
  affects:
    - leanshot/src/lib/admin/modules.ts  # adds research module
    - leanshot/src/components/admin/AdminShell.tsx  # indirectly via manifest
tech_stack:
  added: []
  patterns:
    - ProtocolsLayout verbatim mirror (ResearchLayout)
    - BaseChart stacked-area retention curve
    - Debounced RPC estimate (400ms cancellation-token)
    - k_floor sentinel UX (AlertTriangle + disabled button)
    - stub-then-replace resilient lazy imports
    - TDD RED→GREEN per task
    - src-ui-unit vitest project for React component tests
key_files:
  created:
    - leanshot/src/components/admin/research/ResearchLayout.tsx
    - leanshot/src/components/admin/research/CohortBuilderPage.tsx
    - leanshot/src/components/admin/research/CohortBuilderForm.tsx
    - leanshot/src/components/admin/research/RetentionChart.tsx
    - leanshot/src/components/admin/research/CrossTabMatrix.tsx
    - leanshot/src/components/admin/research/__tests__/CohortBuilderForm.test.tsx
    - leanshot/src/components/admin/research/__tests__/CohortBuilderPage.test.tsx
  modified:
    - leanshot/src/lib/admin/modules.ts  # FlaskConical + research entry
    - leanshot/vitest.config.ts          # src-ui-unit project for React tests
decisions:
  - "ResearchLayout uses resilient @vite-ignore lazy imports for Plan 62-05 files (stub-then-replace pattern)"
  - "vitest.config.ts projects[] masks default test: block; added src-ui-unit project for src/components/**/__tests__ coverage"
  - "AdminShell URL-prefix routing (pathname.startsWith('/admin/research/')) covers all sub-routes automatically — no hardcoded switch branch required"
  - "Python3 used for @theme token audit instead of macOS grep (-- prefix token names break grep flag parsing)"
metrics:
  duration: "~8 minutes"
  completed: "2026-05-26T19:15:23Z"
  tasks_completed: 2
  files_created: 7
  files_modified: 2
---

# Phase 62 Plan 04: Admin Cohort Builder UI Summary

**One-liner:** Admin research cohort builder shell with k_floor sentinel UX, 400ms-debounced RPC estimates, Chart.js stacked-area retention curve, and differential-privacy cross-tab matrix.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | CohortBuilderForm test scaffold + vitest src-ui-unit project | `60c96638` | `__tests__/CohortBuilderForm.test.tsx`, `vitest.config.ts` |
| 1 (GREEN) | ResearchLayout + CohortBuilderForm + module manifest | `7589c6ca` | `ResearchLayout.tsx`, `CohortBuilderForm.tsx`, `modules.ts` |
| 2 (RED) | CohortBuilderPage test scaffold | `aa05a1bb` | `__tests__/CohortBuilderPage.test.tsx` |
| 2 (GREEN) | CohortBuilderPage + RetentionChart + CrossTabMatrix | `32695be5` | `CohortBuilderPage.tsx`, `RetentionChart.tsx`, `CrossTabMatrix.tsx` |

## File Inventory

### ResearchLayout.tsx (133 lines)
Mirrors ProtocolsLayout.tsx verbatim. Grid `lg:grid-cols-[200px_1fr]`, sub-nav (Cohort Builder | Publications | Review Queue), active accent `bg-[var(--color-primary)] text-[var(--color-primary-foreground)]`. Resolves `/admin/research/*` via regex. Resilient lazy imports for Plan 62-05 PublicationsListPage (not yet shipped) and CohortBuilderPage (same plan, Task 2).

### CohortBuilderForm.tsx (331 lines)
Filter form: compound multiselect (Pill chips, `aria-pressed`), tenure bucket `<select>`, audience segment multiselect (Pill), outcome metric `<select role="combobox" aria-label="Outcome Metric">`. Debounced 400ms `estimate_research_cohort` RPC call with cancellation token pattern. k_floor sentinel: when estimate < 5, shows `AlertTriangle` + "Cohort too small (k<5) — broaden filters" (13px/600, `var(--color-warning)`); Run Cohort button gains `aria-disabled="true" pointer-events-none opacity-50`. Above k_floor: shows `font-mono tabular-nums` estimate + epsilon row. Run Cohort calls `compile_research_cohort`, lifts result to parent.

### CohortBuilderPage.tsx (124 lines)
Hosts `CohortBuilderForm` + conditional chart/matrix area. Empty state "Run a cohort to see retention curves." Suppressed banner "Cohort suppressed — k<5 at the selected filters." (text-warning/font-semibold, role="alert", min-h-[48px]). `animate-fade-in` gated on `useReducedMotion()`. `space-y-12` between form and chart panel.

### RetentionChart.tsx (117 lines)
BaseChart wrapper for stacked-area line chart. Props: `{ data: Array<{week_label, retained_pct}>; epsilon }`. Chart.js type='line', fill=true, tension=0.3, `borderColor: var(--color-primary)`, `backgroundColor: rgba(27,72,66,0.15)`. Grid lines `var(--color-grid-line)`, tick labels `var(--color-chart-tick)`. `key={theme}` on BaseChart for remount on theme change. EmptyState when `data.length === 0`.

### CrossTabMatrix.tsx (104 lines)
HTML table with caption `ε = {epsilon} (differential privacy noise applied) — N sub-groups suppressed`. Column headers: 11px/400 text-tertiary uppercase tracking-[0.06em]. Cell values: 13px/400. Suppressed cells (null): `<span class="text-[var(--color-text-tertiary)]" title="Suppressed — cohort below k-floor">—</span>`. Row hover: `var(--color-admin-table-row-hover)`.

### modules.ts (modified)
Added `FlaskConical as FlaskConicalIcon` import and research module entry:
```typescript
{
  key: 'research',
  label: 'Research',
  route: 'research',
  icon: FlaskConicalIcon,
  lazy: () => import('@/components/admin/research/ResearchLayout'),
  flagKey: 'admin_research',
  minRole: 'staff' as AdminRole,
}
```
Inserted after `protocols` entry, before `rag` entry.

## RPC Wire-Up Confirmation

| RPC | File | Call Pattern |
|-----|------|-------------|
| `estimate_research_cohort` | `CohortBuilderForm.tsx` | `supabase.rpc('estimate_research_cohort', { p_filters: { metric, compound, tenure_bucket, audience_segment } })` debounced 400ms |
| `compile_research_cohort` | `CohortBuilderForm.tsx` | `supabase.rpc('compile_research_cohort', { p_filters })` on Run Cohort click |

## @theme Tokens Verified (14 tokens)

All tokens confirmed present in `src/index.css @theme {}` block (verified via Python3 to avoid macOS grep `--color-*` flag interpretation issue):

`--color-admin-table-row-hover`, `--color-bg`, `--color-border`, `--color-chart-tick`, `--color-grid-line`, `--color-primary`, `--color-primary-foreground`, `--color-surface`, `--color-surface-elevated`, `--color-text`, `--color-text-secondary`, `--color-text-tertiary`, `--color-warning`, `--color-warning-soft`

## Admin Module Manifest Diff

**Added to `ADMIN_MODULES` in `leanshot/src/lib/admin/modules.ts`:**
```typescript
{
  key: 'research',     // new module key
  label: 'Research',
  route: 'research',   // → /admin/research
  icon: FlaskConicalIcon,
  lazy: () => import('@/components/admin/research/ResearchLayout'),
  flagKey: 'admin_research',
  minRole: 'staff' as AdminRole,
}
```

**AdminShell routing:** `pathname === '/admin/research' || pathname.startsWith('/admin/research/')` — URL-prefix catch-all handles all sub-routes automatically. No hardcoded switch branch required per `feedback_admin_module_manifest_vs_router_branch_drift`.

## Typography Compliance

All new files use ONLY: `text-[11px]`, `text-[13px]`, `text-[18px]`, `text-heading`. Zero banned utilities (`text-base`, `text-lg`, `text-md`, `text-sm`, `text-xl`, `text-2xl`). Font weights: `font-normal` (400) or `font-semibold` (600) only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TS compile error: unused `filterVersion` ref**
- **Found during:** Task 1 GREEN implementation
- **Issue:** `filterVersion` ref declared in CohortBuilderForm but never read; `noUnusedLocals` strict mode
- **Fix:** Removed `const filterVersion = useRef(0)` and `useRef` import
- **Files modified:** `CohortBuilderForm.tsx`
- **Commit:** `7589c6ca` (inline fix before commit)

**2. [Rule 3 - Blocking] TS compile error: ResearchLayout's CohortBuilderPage import**
- **Found during:** Task 1 tsc verification
- **Issue:** `import('./CohortBuilderPage')` from ResearchLayout failed tsc because CohortBuilderPage didn't exist yet (Task 2 file)
- **Fix:** Applied `@vite-ignore` resilient lazy import pattern (per `feedback_stub_then_replace_sibling_collision`)
- **Files modified:** `ResearchLayout.tsx`
- **Commit:** `7589c6ca` (inline fix before commit)

**3. [Rule 3 - Blocking] Vitest projects[] masks default test: config**
- **Found during:** Task 1 RED test run
- **Issue:** `vitest.config.ts` `projects:[]` block silently masks default `test:` config per `reference_vitest_4_projects_config_masks_default` MEMORY entry — `npx vitest run` with filepath filter found 0 tests
- **Fix:** Added `src-ui-unit` project to `vitest.config.ts` covering `src/components/**/__tests__/*.test.tsx`
- **Files modified:** `vitest.config.ts`
- **Commit:** `60c96638` (RED commit)

**4. [Rule 3 - Blocking] macOS grep interprets `--color-*` as flag arguments**
- **Found during:** Task 2 @theme token audit
- **Issue:** Shell `grep -q "$name" src/index.css` where `$name = '--color-admin-table-row-hover'` throws "unrecognized option" — macOS BSD grep treats `--` prefix as flags
- **Fix:** Used Python3 one-liner for @theme token verification instead
- **Impact:** All 14 tokens confirmed defined; audit passed

**5. [Rule 1 - Bug] `React is not defined` in test files**
- **Found during:** Task 1 GREEN test run
- **Issue:** JSX in test files requires `import React from 'react'` when `react-jsx` transform is not auto-applied in src-ui-unit project context
- **Fix:** Added `import React from 'react'` to both test files
- **Commit:** `7589c6ca` (inline)

**6. [Rule 1 - Bug] `toBeInTheDocument` / `toHaveAttribute` not defined**
- **Found during:** Task 1 GREEN test run
- **Issue:** `@testing-library/jest-dom` matchers not auto-imported in src-ui-unit project (no global setup file)
- **Fix:** Added `import '@testing-library/jest-dom'` to test files
- **Commit:** `7589c6ca` (inline)

**7. [Rule 1 - Bug] `useReducedMotion` crashes in jsdom (window.matchMedia)**
- **Found during:** Task 2 GREEN test run
- **Issue:** `useReducedMotion.ts` calls `window.matchMedia(...)` which is undefined in jsdom; CohortBuilderPage test crashed
- **Fix:** Added `vi.mock('@/hooks/useReducedMotion', () => ({ useReducedMotion: () => false }))` in `CohortBuilderPage.test.tsx`
- **Commit:** `32695be5` (inline)

## AdminShell Catch-All Coverage (per plan spec)

AdminShell at line 118-119 uses:
```
pathname === `/admin/${m.route}` || pathname.startsWith(`/admin/${m.route}/`)
```
With `route: 'research'`, this resolves `/admin/research`, `/admin/research/cohort`, `/admin/research/publications`, `/admin/research/review` automatically. No Plan 62-08 close-out action needed for this specific concern.

## Known Stubs

**PublicationsListPage stub in ResearchLayout:** "Review Queue" and "Publications" sub-nav items reference `PublicationsListPage` via `@vite-ignore` resilient import. File does not exist yet (Plan 62-05). Both routes render `null` until 62-05 ships. This is intentional per `feedback_stub_then_replace_sibling_collision` pattern.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. ADMIN_MODULES entry enforces `minRole: 'staff'` (client UX layer; SECDEF RPCs provide server-side enforcement). Compliant with T-62-04-01 and T-62-04-03 mitigations in threat register.

## Self-Check: PASSED

- [x] `leanshot/src/components/admin/research/ResearchLayout.tsx` — FOUND
- [x] `leanshot/src/components/admin/research/CohortBuilderPage.tsx` — FOUND
- [x] `leanshot/src/components/admin/research/CohortBuilderForm.tsx` — FOUND
- [x] `leanshot/src/components/admin/research/RetentionChart.tsx` — FOUND
- [x] `leanshot/src/components/admin/research/CrossTabMatrix.tsx` — FOUND
- [x] `leanshot/src/lib/admin/modules.ts` contains `key: 'research'` — CONFIRMED
- [x] Commits `60c96638`, `7589c6ca`, `aa05a1bb`, `32695be5` — CONFIRMED
- [x] tsc -p tsconfig.app.json --noEmit — CLEAN
- [x] 7 tests pass (4 CohortBuilderForm + 3 CohortBuilderPage)
- [x] 14 @theme tokens verified in src/index.css
- [x] No banned typography utilities in research/*.tsx
