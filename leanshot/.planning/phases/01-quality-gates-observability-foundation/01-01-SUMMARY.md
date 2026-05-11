---
phase: 01-quality-gates-observability-foundation
plan: "01"
subsystem: infra
tags: [typescript, eslint, type-safety, chart.js, anthropic]

# Dependency graph
requires: []
provides:
  - Zero as-never casts in src/ — TypeScript type narrowing correct at all 5 cast sites
  - Insight.cta.tab and pickFocus return type tightened to TabId (was string)
  - Topbar setTab guarded by TAB_VALUES runtime Set check
  - BaseChart eslint-disable-next-line carries documented rationale
  - ai.ts DEFAULT_MODEL points to real claude-sonnet-4-5 (was 404ing claude-sonnet-4-6)
  - SupplementsTab Amazon URLs carry no affiliate tag parameter
affects:
  - 01-03-PLAN.md (ESLint config — requires zero pre-existing lint violations)
  - All future plans that call setTab, use Insight, or render BaseChart

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TAB_VALUES Set guard pattern for string -> TabId runtime narrowing"
    - "WorkoutType alias via Workout['type'] — extract union from interface field"
    - "Measurement typed entry with (entry as unknown as Record<string, number | string>) index write"
    - "ChartOptions<ChartType> for Chart.js options assignment — correct generic cast"
    - "Two-comment eslint-disable pattern: rule -- intentional: rationale"

key-files:
  created: []
  modified:
    - src/components/layout/Topbar.tsx
    - src/components/dashboard/tabs/ActivityTab.tsx
    - src/components/dashboard/tabs/BodyTab.tsx
    - src/components/dashboard/tabs/HomeTab.tsx
    - src/components/dashboard/charts/BaseChart.tsx
    - src/lib/insights.ts
    - src/lib/ai.ts
    - src/components/dashboard/tabs/SupplementsTab.tsx

key-decisions:
  - "TAB_VALUES.has(tab) runtime guard used instead of direct cast — safer than `as TabId` without guard (T-1-LOC-01 threat mitigation)"
  - "entry as unknown as Record<...> double-cast for Measurement index write — required because Measurement lacks index signature by design"
  - "pickFocus return type also updated to tab: TabId (not just Insight interface) — ensures full type consistency downstream"

patterns-established:
  - "Union narrowing via Set guard (TAB_VALUES) — reuse wherever string needs narrowing to a union at runtime"
  - "Workout['type'] alias pattern — extract union from interface field instead of duplicating the union"

requirements-completed: [PROD-05]

# Metrics
duration: 15min
completed: 2026-05-10
---

# Phase 1 Plan 01: Type Hygiene & Model ID Fix Summary

**Replaced all 5 `as never` casts with proper TypeScript narrowing and fixed the 404-ing claude-sonnet-4-6 model ID, clearing the lint backlog so ESLint can run at error-level from day one**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-10T20:30:00Z
- **Completed:** 2026-05-10T20:45:07Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Eliminated all 5 `as never` cast sites in `src/` via proper runtime guards and type aliases
- Tightened `Insight.cta.tab` and `pickFocus` return type from `string` to `TabId` — type safety now propagates from rule engine through HomeTab render
- Patched `DEFAULT_MODEL` from `'claude-sonnet-4-6'` (404) to `'claude-sonnet-4-5'` — AI coach now functional in dev/QA
- Documented the BaseChart two-effect pattern so future reviewers don't incorrectly "fix" the eslint-disable and cause Chart.js memory churn
- Removed `&tag=YOURTAG-20` affiliate placeholder from SupplementsTab Amazon URLs

## Task Commits

1. **Task 1: Replace 5x as-never casts with proper types** - `6a0d7c6` (fix)
2. **Task 2: Document BaseChart eslint-disable, fix model ID, drop affiliate tag** - `1aad89e` (fix)

## Files Created/Modified
- `src/components/layout/Topbar.tsx` - Added `TAB_VALUES` Set + `TabId` import; `setTab(tab as TabId)` now guarded by `TAB_VALUES.has(tab)` runtime check
- `src/components/dashboard/tabs/ActivityTab.tsx` - Added `WorkoutType = Workout['type']` alias; explicit `useState` generic type; replaced `as never` with `as WorkoutType`
- `src/components/dashboard/tabs/BodyTab.tsx` - Added `Measurement` import; `entry: Measurement` typed directly; `(entry as unknown as Record<string, number | string>)[k] = v` for index write
- `src/components/dashboard/tabs/HomeTab.tsx` - Removed `as never` cast; `setTab(insight.cta!.tab)` works without cast now that source type is `TabId`
- `src/components/dashboard/charts/BaseChart.tsx` - Added `ChartOptions, ChartType` import; replaced `as never` with `as ChartOptions<ChartType>`; documented eslint-disable rationale
- `src/lib/insights.ts` - Added `TabId` import; tightened `Insight.cta?.tab` and `pickFocus` return from `string` to `TabId`
- `src/lib/ai.ts` - `DEFAULT_MODEL` patched to `'claude-sonnet-4-5'` (D-04)
- `src/components/dashboard/tabs/SupplementsTab.tsx` - Removed `&tag=YOURTAG-20` from Amazon search URL (D-01)

## Decisions Made
- Used double-cast `as unknown as Record<string, number | string>` for `BodyTab.tsx` entry index write — TypeScript requires the intermediate `unknown` step because `Measurement` lacks an index signature by design; alternatives (`as any`) would violate the no-explicit-any rule landing in Plan 03
- `pickFocus` return type also narrowed to `tab: TabId` (not just the `Insight` interface) — callers of `pickFocus` (`FocusCard.tsx`) also benefit and no downstream call site needed updating since all literal values were already valid TabId members

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Explicit useState generic type required for ActivityTab**
- **Found during:** Task 1 (ActivityTab as-never fix)
- **Issue:** `useState({ type: 'resistance' as const, ... })` inferred `type: 'resistance'` literally, making the `as WorkoutType` cast fail with TS2322 ("Type WorkoutType not assignable to type 'resistance'")
- **Fix:** Added explicit generic `useState<{ date: string; type: WorkoutType; ... }>` so the state shape is widened to the full union upfront
- **Files modified:** src/components/dashboard/tabs/ActivityTab.tsx
- **Verification:** `npm run typecheck` exits 0
- **Committed in:** `6a0d7c6` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — type inference bug)
**Impact on plan:** Necessary to make the WorkoutType alias pattern work correctly. No scope creep.

## Issues Encountered
- `node_modules/` was empty in the worktree — ran `npm ci` to install dependencies before typecheck could run. Expected for a freshly spawned worktree.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `src/` has zero `as never` casts — ESLint `@typescript-eslint/no-unsafe-*` rules will not find pre-existing violations
- `DEFAULT_MODEL = 'claude-sonnet-4-5'` — AI coach functional in dev until Phase 4 proxy lands
- Plan 03 (ESLint config) can now run `npm run lint` on the codebase and exit 0 on the first attempt

## Self-Check

**Verified:**
- `grep -rn "as never" src/` → 0 matches
- `grep -rn "claude-sonnet-4-6" src/` → 0 matches
- `grep -rn "YOURTAG-20" src/` → 0 matches
- `grep -rn "&tag=" src/` → 0 matches
- `grep -n "exhaustive-deps -- intentional" BaseChart.tsx` → line 36 match
- `git log --oneline` → commits `6a0d7c6` and `1aad89e` present
- `npm run typecheck` → exits 0

## Self-Check: PASSED

---
*Phase: 01-quality-gates-observability-foundation*
*Completed: 2026-05-10*
