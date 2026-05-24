---
phase: 39-a-b-trifecta-mid-trial-paywall-pharma-paywall-page-variant-a
plan: 06
subsystem: admin/growth-experiments
tags:
  - admin
  - growth
  - experiments
  - paywall
  - page-builder
  - pharma
  - shell
  - manifest
  - tdd
dependency-graph:
  requires:
    - leanshot/src/lib/admin/modules.ts (existing ADMIN_MODULES manifest)
    - leanshot/src/components/admin/AdminShell.tsx (existing URL-prefix router)
    - leanshot/src/components/ui/Pill.tsx
    - leanshot/src/components/ui/EmptyState.tsx
    - leanshot/src/components/ui/Skeleton.tsx
    - leanshot/src/components/ui/Card.tsx
    - leanshot/src/lib/supabase.ts
  provides:
    - "ADMIN_MODULES['growth-experiments'] (route=growth/experiments)"
    - "ExperimentDashboardPage (Surface E + H shell with 3 Pill tabs)"
    - "experiment-types.ts: ExperimentSurface, ExperimentRow, PharmaExperimentRow, InvokeError"
    - "data-testid='experiment-tab-content' slot for per-tab content"
  affects:
    - 39-07 (paywall + page-builder sub-tab content — consumes ExperimentRow + slot)
    - 39-08 (pharma sub-tab content — consumes PharmaExperimentRow + slot)
tech-stack:
  added: []
  patterns:
    - manifest-driven admin module registration (single source of truth: modules.ts)
    - URL-prefix routing in AdminShell (pathname.startsWith) — no hardcoded switch branches
    - controlled-state-union tabs via Pill primitive (aria-pressed inherited)
    - useEffect + setInterval polling at 30_000ms (no server-state library)
    - vendor-unconfigured soft-banner Pattern A (Phase 34/35 precedent)
    - Pattern S1 dual-layer security (minRole UX gate + SECDEF RPC re-check)
key-files:
  created:
    - leanshot/src/components/admin/growth/experiment-types.ts
    - leanshot/src/components/admin/growth/ExperimentDashboardPage.tsx
    - leanshot/src/components/admin/growth/ExperimentDashboardPage.test.tsx
  modified:
    - leanshot/src/lib/admin/modules.ts
    - leanshot/src/components/admin/__tests__/AdminShell.test.tsx
decisions:
  - "Manifest entry placed after growth-cac, before nps-quarterly (grouping convention)"
  - "Empty state CTA is a styled <a> not the Button primitive (Button has no asChild; matches CACDashboardPage anchor pattern)"
  - "Polling cadence stored as POLL_INTERVAL_MS=30_000 constant for spy-friendly assertion"
  - "T8 polling test asserts setInterval registration cadence, NOT real timer fire — avoids fake-timer/waitFor interaction; actual re-fire integration runs at staging UAT per VALIDATION.md"
  - "vendor_unconfigured detected via error.message.includes substring (defensive against shape variance)"
  - "Removed busyKey setter from initial shell since Plan 39-07's Ship-Winner button is not yet wired; busyKey state preserved as null placeholder so the slot contract stays stable"
  - "Used adjacent vitest config workaround (vitest-39-06.config.ts, post-run deleted) — known pre-existing project-wide gap documented in 39-02 deferred issues; deferred a permanent fix to a follow-on focused plan"
metrics:
  duration: ~25min
  completed: 2026-05-24
  tasks: 2/2
  tests: 16/16 pass (7 AdminShell + 9 ExperimentDashboardPage)
  files-modified: 5
---

# Phase 39 Plan 39-06: Wave 4 admin shell — growth/experiments registration + ExperimentDashboardPage shell Summary

Registers the `growth/experiments` admin module in the canonical manifest and ships the 3-Pill-tab chrome (Surface E + H per 39-UI-SPEC) so Plans 39-07 and 39-08 have a stable mount point with shared types.

## What shipped

### 1. Manifest entry (`leanshot/src/lib/admin/modules.ts`)
Single source of truth — `ADMIN_MODULES['growth-experiments']` with all 7 fields:

| field    | value                                                         |
| -------- | ------------------------------------------------------------- |
| key      | `growth-experiments`                                          |
| label    | `Experiments`                                                 |
| route    | `growth/experiments`                                          |
| icon     | `TrendingUpIcon`                                              |
| lazy     | `() => import('@/components/admin/growth/ExperimentDashboardPage').then((m) => ({ default: m.ExperimentDashboardPage }))` |
| flagKey  | `admin.growth.experiments.enabled`                            |
| minRole  | `'admin' as AdminRole`                                        |

Placed after `growth-cac` (line 339), before `nps-quarterly` (grouping convention). Header comment cites PAYWALL-06 / PAGEAB-01/07 / PHARMA-08 and references `[[feedback_admin_module_manifest_vs_router_branch_drift]]`.

### 2. ExperimentDashboardPage (`leanshot/src/components/admin/growth/ExperimentDashboardPage.tsx`)
Surface E + H chrome — 3 Pill tabs with controlled state union, useEffect+setInterval polling, EmptyState, vendor-unconfigured soft banner.

**Pill tab labels (verbatim):**
1. `Paywall` (default active; surface='paywall')
2. `Page-Builder` (surface='page')
3. `Pharma` (surface='pharma')

**Polling cadence:** 30_000ms (constant `POLL_INTERVAL_MS`) via `useEffect + setInterval`. NO server-state library imports. Cancellation flag (`cancelled.v`) prevents pileup on tab change. Mirrors `CACDashboardPage.tsx` precedent.

**Empty state copy (exact, per UI-SPEC):**
- Heading: `No active experiments yet.`
- Body: `Create a variant from any published page to begin testing.`
- Primary: `Go to Pages` (anchor to `/admin/pages` — router-less admin)

**Vendor-unconfigured banner copy (exact, per UI-SPEC D-04):**
`Slack alerts pause until #growth-experiments webhook is configured.`

**Per-tab content slot:** `<section data-testid="experiment-tab-content" data-tab={activeTab}>` — Plans 39-07 (paywall + page-builder) and 39-08 (pharma) fill this in. Until then, a non-stub placeholder renders `<N> experiments loaded. Per-tab table renders ship in Plans 39-07 / 39-08.` when data is present.

### 3. Shared types (`leanshot/src/components/admin/growth/experiment-types.ts`)
- `ExperimentSurface` — `'paywall' | 'page' | 'pharma'`
- `ExperimentRow` — 14 fields (variant_id, variant_name, surface, cohort_id, cohort_label, sample_size, paid_rate, retention_30d_rate, composite_score, posterior, refund_rate_7d, refund_rate_baseline_30d, warned_at, archived_at, created_at)
- `PharmaExperimentRow extends ExperimentRow` — +3 fields (nps_delta, one_star_rate_ratio, safety_categories_in_variant) — D-05 invariant documented in JSDoc
- `InvokeError` — `{ error?: string }`

### 4. AdminShell parity test (`leanshot/src/components/admin/__tests__/AdminShell.test.tsx`)
Two new test cases extend the existing 5-test suite:

| Test name | What it asserts |
| --------- | ----------------------------------------------------------- |
| `T6: manifest entry growth-experiments resolves via AdminShell pathname.startsWith branch` | Renders AdminShell with `currentPath="/admin/growth/experiments"`, waits for the lazy `ExperimentDashboardPage` to hydrate, asserts `experiment-tab-content` testid is in the DOM. Mitigates `[[feedback_admin_module_manifest_vs_router_branch_drift]]`. |
| `T7: ADMIN_MODULES has a growth-experiments entry with route=growth/experiments` | Belt-and-braces structural check — all 7 fields match exactly. Catches a typo'd route that TS would not catch. |

Suite-level `vi.mock('@/lib/supabase', ...)` added so the lazy chunk hydrates cleanly without per-test stubs.

**Parity-test name for downstream consumption:** `T6: manifest entry growth-experiments resolves via AdminShell pathname.startsWith branch` — Plans 39-07 and 39-08 can wire their own integration tests using the same supabase-rpc mock fixture pattern + the same `currentPath="/admin/growth/experiments"` constructor argument.

## Test results

Adjacent vitest config (`vitest-39-06.config.ts` — post-run deleted; not shipped):

```
Test Files  2 passed (2)
     Tests  16 passed (16)
  Duration  ~1.2s
```

| File | Tests | Status |
| ---- | ----- | ------ |
| `AdminShell.test.tsx`              | 7 (5 existing + 2 new) | PASS |
| `ExperimentDashboardPage.test.tsx` | 9 new (T1-T9)          | PASS |

`tsc -p tsconfig.app.json --noEmit` exits 0.
`eslint` exits 0 on all 4 touched files.

## Hard Constraints (UI-SPEC) compliance

| # | Constraint | How honored |
| - | ---------- | ----------- |
| 1 | Typography ramp `text-sm/base/xl/2xl` only | Used `text-sm`, `text-xl` for h1, `font-bold`, `font-semibold` — `grep -E 'text-\[[0-9]\|font-\[[0-9]'` returns empty |
| 2 | Spacing tokens only | `mb-6`, `mb-4`, `p-6`, `gap-2`, `gap-3` — sm/md/lg token scale |
| 3 | `--color-primary` only on active Pill + primary CTA | Active Pill inherits from primitive; "Go to Pages" anchor is the only other use |
| 4 | No hex literals | Zero `#` color literals; all colors via `var(--color-*)` |
| 5 | NO server-state library imports | `grep -E 'useQuery\|useMutation\|QueryClient'` returns empty (negation-grep-safe — see Decisions §6) |
| 11 | NO new keyframes | Zero `@keyframes` additions; reuses `Skeleton`'s `skeleton-shimmer` |

## Deviations from Plan

**1. [Rule 3 - Blocking] Adjacent vitest config required for src/ unit tests**
- **Found during:** Task 1 RED verification
- **Issue:** `npx vitest run src/...` returns `No test files found` because `vitest.config.ts` has both `test.include` and `projects: [...]`, and Vitest 4.x lets `projects` supersede the outer config (project-wide pre-existing gap documented in 39-02-SUMMARY.md deferred issues).
- **Fix:** Created `vitest-39-06.config.ts` with explicit `test.include` targeting only the two test files in scope. Deleted post-run; NOT committed.
- **Files modified:** ephemeral only
- **Commit:** N/A (config never committed)
- **Permanent fix:** out of scope per SCOPE BOUNDARY (project-wide issue); should land via a follow-on focused plan.

**2. [Rule 1 - Bug] Negation-grep false positive in JSDoc**
- **Found during:** Task 2 verify (`<verify><automated>`)
- **Issue:** The plan's verify grep `! grep -E 'useQuery|useMutation|QueryClient' src/components/admin/growth/ExperimentDashboardPage.tsx` failed because my JSDoc comment contained the strings `useQuery`, `useMutation`, `QueryClient` while explaining what was forbidden. Exact instance of `[[feedback_negation_grep_defeated_by_comment_string]]`.
- **Fix:** Rewrote the JSDoc to use the rationale phrase `NO server-state library; raw effect-driven fetch only` and explicitly cited the feedback memory. Net effect: grep is honest, intent preserved.
- **Files modified:** `leanshot/src/components/admin/growth/ExperimentDashboardPage.tsx` JSDoc only
- **Commit:** `2227f076` (rolled into Task 2)

**3. [Rule 1 - Bug] Initial Button + <a> CTA pattern unsupported**
- **Found during:** Task 2 GREEN
- **Issue:** I initially wrote the EmptyState CTA as `<Button asChild={false} variant="primary"><a href="...">Go to Pages</a></Button>` but `Button` always renders a `<button>` (no `asChild` prop). This would have produced invalid nested-interactive HTML.
- **Fix:** Replaced with a styled `<a href="/admin/pages">` matching CACDashboardPage's anchor pattern (router-less admin).
- **Files modified:** `leanshot/src/components/admin/growth/ExperimentDashboardPage.tsx`
- **Commit:** `2227f076` (rolled into Task 2)

**4. [Rule 1 - Bug] Parity test asserted Task-1 placeholder testid that Task 2 removed**
- **Found during:** Task 2 GREEN cross-check (`npx vitest run` against full config)
- **Issue:** T6 originally asserted `screen.getByTestId('experiment-dashboard-shell')` — the placeholder testid from the Task 1 shim. Once Task 2's full shell replaced the placeholder, that testid was gone and T6 failed.
- **Fix:** Re-targeted T6 to `screen.getByTestId('experiment-tab-content')` — the stable contract that Plans 39-07/08 will also depend on. Increased waitFor timeout to 3000ms to absorb lazy-chunk hydration latency.
- **Files modified:** `leanshot/src/components/admin/__tests__/AdminShell.test.tsx`
- **Commit:** `2227f076` (rolled into Task 2)

## Self-Check: PASSED

**Files created (all exist):**
- `leanshot/src/components/admin/growth/experiment-types.ts` — FOUND
- `leanshot/src/components/admin/growth/ExperimentDashboardPage.tsx` — FOUND
- `leanshot/src/components/admin/growth/ExperimentDashboardPage.test.tsx` — FOUND
- `leanshot/.planning/phases/39-a-b-trifecta-mid-trial-paywall-pharma-paywall-page-variant-a/39-06-SUMMARY.md` — FOUND (this file)

**Files modified (verified in commits):**
- `leanshot/src/lib/admin/modules.ts` — `grep -q "key: 'growth-experiments'"` → match
- `leanshot/src/components/admin/__tests__/AdminShell.test.tsx` — `grep -q "T6: manifest entry growth-experiments"` → match

**Commits exist:**
- `18235749` `feat(39-06): register growth/experiments admin module + AdminShell parity test`
- `2227f076` `feat(39-06): ExperimentDashboardPage shell — 3 Pill tabs + polling + EmptyState + vendor banner`

**Verify constraints (per plan `<verify><automated>`):**
- `grep -q "key: 'growth-experiments'" src/lib/admin/modules.ts` → match
- `grep -q "route: 'growth/experiments'" src/lib/admin/modules.ts` → match
- `grep -q 'ExperimentDashboardPage' src/lib/admin/modules.ts` → match
- `test -f src/components/admin/growth/experiment-types.ts` → exists
- `grep -E 'useQuery|useMutation|QueryClient' ExperimentDashboardPage.tsx` → empty
- `grep -E 'text-\[[0-9]|font-\[[0-9]' ExperimentDashboardPage.tsx` → empty
- 16/16 vitest cases pass; tsc exits 0; eslint exits 0
