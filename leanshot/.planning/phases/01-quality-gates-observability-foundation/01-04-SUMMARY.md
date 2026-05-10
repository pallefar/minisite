---
phase: 1
plan: 4
subsystem: testing
tags: [vitest, react-testing-library, jest-dom, unit-tests, tdd]
dependency_graph:
  requires: [01-01, 01-02, 01-03]
  provides: [unit-test-infrastructure, helpers-coverage, streak-coverage, migration-coverage, onboarding-coverage]
  affects: [vite.config.ts, tsconfig.app.json, useStreaks.ts]
tech_stack:
  added:
    - vitest@4.1.5
    - "@testing-library/react@16.3.2"
    - "@testing-library/user-event@14.6.1"
    - "@testing-library/jest-dom@6.9.1"
    - "@testing-library/dom@10.x"
    - "@vitest/coverage-v8@4.1.5"
    - jsdom@29.1.1
  patterns:
    - Vitest config merged into vite.config.ts (defineConfig from vitest/config)
    - jsdom test environment for RTL + React 19 compatibility
    - globals: true for describe/it/expect without imports
    - vi.useFakeTimers() for deterministic date tests
    - vi.spyOn(Storage.prototype) for localStorage isolation
    - vi.spyOn(useStore.getState()) for Zustand action assertion
key_files:
  created:
    - src/test-setup.ts
    - src/lib/helpers.test.ts
    - src/hooks/useStreaks.test.ts
    - src/lib/storage.test.ts
    - src/components/onboarding/OnboardingFlow.test.tsx
  modified:
    - vite.config.ts
    - tsconfig.app.json
    - src/hooks/useStreaks.ts
decisions:
  - "Used defineConfig from vitest/config (not vite) to satisfy TypeScript for the test block"
  - "Added @testing-library/dom explicitly (not pulled transitively by @testing-library/react@16)"
  - "Mocked window.matchMedia in test-setup.ts (jsdom missing API needed by useReducedMotion)"
  - "OnboardingFlow test spies on useStore.getState().setUser (not callback) since onComplete is () => void"
  - "formatDuration parameter is hours not minutes — tests adjusted to match implementation"
  - "greeting() takes no argument — tests use vi.useFakeTimers() for time control"
metrics:
  duration: "~5 minutes"
  completed: "2026-05-10T21:06:00Z"
  tasks_completed: 3
  files_created: 5
  files_modified: 3
---

# Phase 1 Plan 4: Vitest 4 + RTL + Unit Tests Summary

Wired Vitest 4.1.5 + React Testing Library 16 + jest-dom into the existing vite.config.ts and delivered four foundational test suites covering helpers, streaks, storage migration, and onboarding — satisfying Walking Skeleton gate S-05.

## What Was Built

### Task 1: Vitest infrastructure

- Added `test` block to `vite.config.ts` using `defineConfig` from `vitest/config` (required for TypeScript to accept the `test` key — the re-exported `defineConfig` from `vite` does not include the test block type)
- Test environment: jsdom (safer than happy-dom for RTL 16 + React 19 StrictMode per RESEARCH.md Pitfall 6)
- `globals: true` so test files can use `describe`/`it`/`expect` without import
- `setupFiles: ['./src/test-setup.ts']` bootstraps `@testing-library/jest-dom` matchers
- Added `"types": ["vitest/globals", "@testing-library/jest-dom"]` to `tsconfig.app.json`
- `@testing-library/dom` installed explicitly — it is not auto-pulled by `@testing-library/react@16` and is required at runtime
- `window.matchMedia` mock added to `test-setup.ts` — jsdom does not implement this API; it is needed by `useReducedMotion` which is called by `ProgressIndicator` (used inside `OnboardingFlow`)

### Task 2: helpers.test.ts + calcStreak extraction + useStreaks.test.ts

**calcStreak extraction:**
- `calc()` private function moved to module scope and exported as `calcStreak(predicate, today = new Date())`
- Optional `today` parameter enables deterministic tests without fake timers
- All four internal `calc()` call sites in the hook updated to `calcStreak()`
- Hook external behavior unchanged — verified by typecheck + test suite

**helpers.test.ts (32 tests across 11 describe blocks):**
- `todayStr`, `lastNDays`: use `vi.useFakeTimers()` pinned to `2026-05-10T12:00:00Z`
- `daysBetween`: covers US spring-forward (2024-03-10) and fall-back (2024-11-03) DST edges — both return 2 correctly because the implementation uses millisecond arithmetic (`Math.round(diff / 86_400_000)`) which is DST-safe
- `hoursSince`, `relTime`: fake timer pinned for determinism
- `formatDuration`: parameter is **hours** (not minutes as the plan sketch suggested) — tests adjusted: `formatDuration(0)` → `"0m"`, `formatDuration(1)` → `"1h"`, `formatDuration(25)` → `"1d 1h"`
- `greeting()`: takes **no argument** (reads `new Date().getHours()` internally) — tests use `vi.useFakeTimers()` rather than the plan's `greeting(new Date(...))` approach
- `cn`, `clamp`, `pct`, `escapeHtml`: straightforward assertions, no timer mocking needed

**useStreaks.test.ts (5 tests):**
- All four from the plan + one extra for "breaks streak on first prior-day miss"
- Uses fixed `today = new Date('2026-05-10T12:00:00Z')` — no fake timers needed

### Task 3: storage.test.ts + OnboardingFlow.test.tsx

**storage.test.ts (5 tests — four-way matrix per D-05):**
- `vi.spyOn(Storage.prototype, 'getItem/setItem/removeItem')` pattern for localStorage isolation
- Five cases: empty storage → null, v3-only → migrated state with correct user.name, v4-only → null, both present → does not throw (first call migrates, second call returns null because removeItem ran), corrupted v3 → null without throwing

**OnboardingFlow.test.tsx:**

*OnboardingFlow prop signature:* `{ onComplete: () => void, onCancel: () => void }` — `onComplete` receives **no argument**. The component calls `setUser(user)` directly via `useStore.getState().setUser` then calls `onComplete()`. Therefore the test spies on `useStore.getState().setUser` to assert the User shape.

*RTL approach used:*
```typescript
const setUserSpy = vi.spyOn(useStore.getState(), 'setUser');
// ... walk 7 steps ...
expect(setUserSpy).toHaveBeenCalledWith(
  expect.objectContaining({ name: 'Alex', medication: 'ozempic', startWeight: 85 })
);
```

*7-step walk:*
- Step 1: type name "Alex" in `getByLabelText(/your name/i)`, click "Continue"
- Step 2: `selectOptions` on `getByLabelText(/glp-1 medication/i)` = "ozempic", click "Continue"
- Step 3: type "85" in `getByLabelText(/weight \(kg\)/i)` (required field), click "Continue"
- Steps 4-6: no required fields, click "Continue" through each
- Step 7: click "Open dashboard" button to trigger `complete()` → `setUser` → `onComplete()`

*No StrictMode wrapping* — per RESEARCH.md Pitfall 6.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added @testing-library/dom explicitly**
- **Found during:** Task 1 verification (`npm run test:unit` crashed with "Cannot find module '@testing-library/dom'")
- **Issue:** `@testing-library/react@16` does not pull `@testing-library/dom` as a transitive dependency in this npm setup
- **Fix:** `npm install -D @testing-library/dom --legacy-peer-deps`
- **Files modified:** `package.json`, `package-lock.json`

**2. [Rule 3 - Blocking] Mocked window.matchMedia in test-setup.ts**
- **Found during:** Task 3 OnboardingFlow test ("TypeError: window.matchMedia is not a function")
- **Issue:** `ProgressIndicator` calls `useCountUp` which calls `useReducedMotion` which calls `window.matchMedia` — jsdom does not implement this
- **Fix:** Added `window.matchMedia` mock to `src/test-setup.ts` (returns `{ matches: false, ... }`)
- **Files modified:** `src/test-setup.ts`

**3. [Rule 1 - Behavior mismatch] formatDuration takes hours, plan said minutes**
- **Found during:** Task 2 reading helpers.ts implementation
- **Issue:** Plan's test sketch called `formatDuration(60)` expecting "1h" but the function signature is `formatDuration(hours: number)` — `formatDuration(60)` would produce "60h"
- **Fix:** Adjusted test values to match actual implementation: `formatDuration(0.5)` → "30m", `formatDuration(1)` → "1h", `formatDuration(25)` → "1d 1h"
- **Files modified:** `src/lib/helpers.test.ts`

**4. [Rule 1 - Behavior mismatch] greeting() takes no argument**
- **Found during:** Task 2 reading helpers.ts implementation
- **Issue:** Plan's test sketch called `greeting(new Date('...'))` but the actual signature is `greeting(): 'morning' | 'afternoon' | 'evening'` with no parameter
- **Fix:** Used `vi.useFakeTimers()` + `vi.setSystemTime()` pattern instead
- **Files modified:** `src/lib/helpers.test.ts`

**5. [Rule 1 - Behavior mismatch] TypeScript rejected vite's defineConfig for test block**
- **Found during:** Task 1 typecheck
- **Issue:** `defineConfig` from `vite` does not include the `test` key type — results in TS2769
- **Fix:** Changed import to `from 'vitest/config'` which re-exports defineConfig with the full UserConfig type including `test`
- **Files modified:** `vite.config.ts`

**6. [Rule 2 - ESLint import order] vitest import order in OnboardingFlow.test.tsx**
- **Found during:** Task 3 `npm run lint`
- **Issue:** `import-x/order` rule required `vitest` to come after `@testing-library/user-event`
- **Fix:** Reordered imports alphabetically per ESLint config
- **Files modified:** `src/components/onboarding/OnboardingFlow.test.tsx`

## DST Edge Cases

`daysBetween('2024-03-09', '2024-03-11')` and `daysBetween('2024-11-02', '2024-11-04')` both return 2 correctly. The implementation uses `Math.round(diff / 86_400_000)` which handles DST correctly: spring-forward day has 23 hours (82,800,000 ms / 86,400,000 = 0.958, rounds to 1) and fall-back day has 25 hours (90,000,000 ms / 86,400,000 = 1.042, rounds to 1). Two such days sum to 2.

## useStreaks Refactor Verification

The `calcStreak` extraction preserves identical semantics:
- Original: `calc(predicate)` used `new Date()` for today (captured at loop start)
- New: `calcStreak(predicate, today = new Date())` uses `new Date(today)` copy at each iteration, matching original behavior when called with default argument
- 5 deterministic tests pass; `npm run typecheck` exits 0

## Test Summary

| File | Tests | Key Coverage |
|------|-------|-------------|
| `src/hooks/useConfirm.test.ts` (Plan 02) | 4 | useConfirm hook behavior |
| `src/lib/helpers.test.ts` | 32 | All 11 named exports: todayStr, lastNDays, daysBetween (DST), hoursSince, relTime, formatDuration, greeting, cn, clamp, pct, escapeHtml |
| `src/hooks/useStreaks.test.ts` | 5 | calcStreak: all-true, all-false, consecutive window, today-miss, mid-gap break |
| `src/lib/storage.test.ts` | 5 | migrateFromV3: empty, v3-only, v4-only, both, corrupted |
| `src/components/onboarding/OnboardingFlow.test.tsx` | 1 | 7-step happy path, setUser called with User shape |
| **Total** | **47** | S-05 gate satisfied |

## Known Stubs

None — all tests wire to real implementations.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `src/test-setup.ts` exists | FOUND |
| `src/lib/helpers.test.ts` exists | FOUND |
| `src/hooks/useStreaks.test.ts` exists | FOUND |
| `src/lib/storage.test.ts` exists | FOUND |
| `src/components/onboarding/OnboardingFlow.test.tsx` exists | FOUND |
| Commit 7a3095f (chore: install Vitest) | FOUND |
| Commit 9942cfb (feat: calcStreak + helpers tests) | FOUND |
| Commit 1c5ab59 (feat: storage + OnboardingFlow tests) | FOUND |
| `npm run typecheck` exits 0 | PASSED |
| `npm run lint` exits 0 (0 errors) | PASSED |
| `npm run format:check` exits 0 | PASSED |
| `npm run test:unit` 5 files, 47 tests | PASSED |
