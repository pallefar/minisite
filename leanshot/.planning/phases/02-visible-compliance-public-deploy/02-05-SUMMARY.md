---
phase: 02-visible-compliance-public-deploy
plan: 5
subsystem: app-shell-compliance
tags: [disclaimer, dashboard, fallback, modal, analytics, tdd]
requirements: [COMPL-04]
dependency-graph:
  requires: [02-01, 02-03, 02-04]
  provides: [App.dashboard-render-fallback, App.disclaimer-required-event]
  affects: []
tech-stack:
  added: []
  patterns: [zustand-selector-derived-flag, useEffect-fire-on-transition, store-getState-write, eager-import-of-small-modal]
key-files:
  created:
    - src/App.disclaimer.test.tsx
  modified:
    - src/App.tsx
decisions:
  - "Eager-import DisclaimerModal (not lazy) — the component composes Modal + a few <p> + Button, no chart/animation deps. The 02-04 implementation is small enough that the extra Suspense boundary would cost more than the bytes saved."
  - "Mount the fallback AFTER the lazy <Suspense> overlay block (AIChatPanel/Settings/DoctorReport/GuidedTour) so the disclaimer's z-[100] backdrop layers above any concurrent overlay (e.g., a tour that auto-launched ~900ms before the user state settled)."
  - "useEffect keyed on `needsDisclaimer` only — fires on every false→true transition. A refs + once-flag would suppress the second fire on a hypothetical 'v1' → 'v2' bump, but the version-bump signal is itself useful analytics data. Documented in code comment."
  - "Selector is `useStore((s) => s.acknowledgedDisclaimer)` (one primitive per selector per CONVENTIONS) — keeps the App.tsx re-render footprint minimal."
  - "Test file uses `vi.mock` for HomeTab, Landing, OnboardingFlow, and GuidedTour to avoid Suspense hangs and the GuidedTour auto-open setTimeout. Did NOT stub MedicationTab/SymptomsTab/etc. because the default tab is `home` and the test resets `currentTab: 'home'` in beforeEach."
metrics:
  duration_minutes: 5
  completed: 2026-05-11
  tasks_completed: 2
  tests_added: 5
---

# Phase 2 Plan 5: Wire Dashboard-Render Disclaimer Fallback Summary

Wired the App.tsx D-11 dashboard-render fallback — any user landing on the dashboard with `acknowledgedDisclaimer !== 'v1'` now sees a blocking `DisclaimerModal` overlay over the AppShell, with a fire-once `disclaimer_required` analytics event on first appearance. Closes the SC#2 enforcement loop for v3-migrants and any returning user from before disclaimers existed.

## What was built

### `src/App.tsx`

- Added eager imports: `DisclaimerModal` (from `@/components/dashboard/DisclaimerModal`) and `track` (from `@/lib/analytics`).
- New selector: `const acknowledgedDisclaimer = useStore((s) => s.acknowledgedDisclaimer);`
- New derived flag: `const needsDisclaimer = !!user && acknowledgedDisclaimer !== 'v1';`
- New `useEffect` keyed on `[needsDisclaimer]`: when true, calls `track('disclaimer_required', { surface: 'dashboard' })`.
- Dashboard JSX: appended `{needsDisclaimer && <DisclaimerModal open onAcknowledge={() => useStore.getState().acknowledgeDisclaimer('v1')} />}` AFTER the existing `<Suspense fallback={null}>` block. The Modal primitive's `z-[100]` (Modal.tsx:54) stacks above AppShell and any lazy overlay.
- No changes to the marketing or onboarding return branches — Step 0 of OnboardingFlow (02-04) already fronts the disclaimer for net-new users.

### `src/App.disclaimer.test.tsx` (new, 121 lines, 5 tests)

| State | Test | Result |
|---|---|---|
| acked-dashboard (`user + 'v1'`) | "does NOT mount the fallback for an acknowledged user on the dashboard" | green ✓ |
| unacked-dashboard (`user + undefined`) | "mounts the fallback for an unacknowledged dashboard user" | green ✓ |
| v3-migrant (same shape) | "mounts the fallback for a v3-migrated user" | green ✓ |
| no-user (covers acked-/unacked-onboarding equivalence) | "does NOT mount the fallback when there is no user" | green ✓ |
| acknowledge action | "removes the fallback after the user clicks 'I understand' and writes acknowledgedDisclaimer = 'v1'" | green ✓ |

Test stubs (via `vi.mock`):
- `@/components/dashboard/tabs/HomeTab` → `<div data-testid="home-tab-stub">`
- `@/components/marketing/Landing` → `<div data-testid="marketing-stub">`
- `@/components/onboarding/OnboardingFlow` → `<div data-testid="onboarding-stub">`
- `@/components/dashboard/tour/GuidedTour` → `null` + `shouldShowTour: () => false`

The GuidedTour stub is the load-bearing one: without it, the `useEffect` in App.tsx would `import('@/components/dashboard/tour/GuidedTour').then(({ shouldShowTour }) => …)` on every dashboard mount, then schedule a 900ms `setTimeout` to call `setTourOpen(true)` — leaking timers across tests and surfacing tour DOM that competes for the modal's role queries.

The test fixture `makeUser()` returns a fully-typed `User` literal (mirrors `src/types/index.ts`) so the `setUser` cast tricks (`as never`) used in OnboardingFlow.test were not needed — the cleaner type-correct fixture lives directly in this file.

## TDD cycle (plan-level compliance)

| Gate | Commit | Notes |
|---|---|---|
| RED | `2a9682c` test(02-05): add failing test for App.tsx D-11 dashboard-render fallback | 3/5 tests fail (the present-state assertions). 2/5 pass tautologically (the absent-state assertions are vacuously true with no fallback wired). The 3 failing tests are the load-bearing RED gate. |
| GREEN | `53313ce` feat(02-05): wire DisclaimerModal as dashboard-render fallback (D-11) | All 5 tests pass; full unit suite 86/86 (5 new + 81 pre-existing); typecheck exits 0; lint exits 0 errors. |

REFACTOR step skipped — implementation was minimal and the diff (one selector, one derived flag, one useEffect, one conditional mount) is already at the desired final shape.

## Verification results

- `npm run typecheck` → exits 0.
- `npm run test:unit` → **86 tests pass** across 11 files (5 new + 81 pre-existing).
- `npm run test:unit -- src/App.disclaimer.test.tsx` → 5/5 pass in 2.45s.
- `npm run lint` → 0 errors. 4 pre-existing warnings in unrelated files (`BaseChart.tsx`, `ShareCardModal.tsx`, `GuidedTour.tsx`).
- `npx prettier --check src/App.tsx src/App.disclaimer.test.tsx` → clean.
- `grep -c "DisclaimerModal" src/App.tsx` = **3** (import + comment + JSX mount; ≥2 met).
- `grep -c "disclaimer_required" src/App.tsx` = **2** (one in `track('disclaimer_required', …)`, one in the explanatory comment); see deviation note below.
- `grep -c "acknowledgedDisclaimer" src/App.tsx` = **3** (selector + comment + needsDisclaimer derivation; ≥2 met).

## Fire-once `disclaimer_required` event

Confirmed via the test "removes the fallback after the user clicks 'I understand'": the click triggers `acknowledgeDisclaimer('v1')` which writes `'v1'` synchronously into store state, the `needsDisclaimer` selector re-renders to `false`, and the `useEffect`'s dependency list de-triggers — no second fire. On a future hypothetical `'v1' → 'v2'` version bump, `needsDisclaimer` would re-go true and the event would fire again — by design (a version-bump re-acknowledgment is itself a notable analytics signal).

## Visual / z-index sanity

The DisclaimerModal mount sits AFTER the lazy `<Suspense fallback={null}>` block in JSX order. The Modal primitive (`src/components/ui/Modal.tsx:54`) sets `position: fixed inset-0 z-[100]` on the backdrop, which stacks above:
- AppShell sidebar / topbar / main pane (no explicit z, default stacking).
- Any concurrent overlay (`AIChatPanel`, `SettingsPage`, `DoctorReport`, `GuidedTour`) which use the same Modal primitive but are siblings, not children — and the disclaimer mounts last in DOM order, winning ties.

No manual `z-management` in App.tsx was needed.

## Deviations from Plan

### 1. [Rule 1 — Bug] Import order in `src/App.disclaimer.test.tsx`

- **Found during:** Task 1 GREEN — first lint pass after the test passed.
- **Issue:** Initial import order placed `import { App } from './App';` before the alias-prefixed `import { useStore } from '@/lib/store';` and `import type { User } from '@/types';`. ESLint `import-x/order` rule flagged the relative `./App` import as needing to come AFTER alias imports (since `@/...` resolves to `./src` and is treated as a higher-precedence "internal" group).
- **Fix:** Moved `import { App } from './App';` to the bottom of the import block, alias imports above.
- **Files modified:** `src/App.disclaimer.test.tsx`.
- **Commit:** rolled into `53313ce` (GREEN).

### 2. [Process] Task 2 deliverable subsumed into Task 1's RED commit

- **Issue:** The plan defined Task 2 as "Create `src/App.disclaimer.test.tsx` with 4-state coverage" — a separate `tdd="true"` task whose deliverable IS the test file. But Task 1 (also `tdd="true"`) requires the same test file as its RED gate. Splitting into two task commits would have meant either (a) committing a partial test file in Task 1 RED then expanding it in Task 2, or (b) having Task 2 produce zero new content (already shipped in Task 1 RED).
- **Resolution:** Wrote the full 4-state matrix + v3-migrant + acknowledge-click test (5 tests total) as the Task 1 RED commit. Task 2's deliverable is satisfied by that same commit. Committed as a single `test(02-05): …` commit then a single `feat(02-05): …` commit — the canonical 2-commit RED/GREEN cycle.
- **No content lost:** the 4-state matrix is fully covered (acked-dashboard ✓, unacked-dashboard ✓, no-user/onboarding-equivalence ✓, v3-migrant case ✓, acknowledge-click ✓).

### 3. [Note] `disclaimer_required` grep returns 2, not 1

- **Plan done-criterion:** `grep -c "disclaimer_required" src/App.tsx == 1`.
- **Actual:** 2 — one in the `track('disclaimer_required', { surface: 'dashboard' })` call, one in the inline `// D-11: fire \`disclaimer_required\` …` documentation comment.
- **Disposition:** Intent of the criterion is "exactly one call site for the event." Semantically met — the comment is documentation, not a call site. The comment is load-bearing for future readers (it documents the false→true transition contract and the deliberate choice to allow re-fire on a version bump). Leaving as-is.

No Rule 4 (architectural) deviations. No authentication gates. No checkpoints.

## Auto-approval / acknowledgment trace

- Click on "I understand" in the rendered DisclaimerModal → DisclaimerModal's onAcknowledge prop fires.
- Prop is `() => useStore.getState().acknowledgeDisclaimer('v1')` (set in App.tsx) — calls the store action added in 02-01.
- Action implementation: `acknowledgeDisclaimer: (version) => set({ acknowledgedDisclaimer: version })` (store.ts:115). Synchronous Zustand `set` → all subscribers re-render in the same tick.
- App.tsx's selector `useStore((s) => s.acknowledgedDisclaimer)` returns `'v1'` on next render → `needsDisclaimer = false` → modal unmounts → `useEffect` does NOT re-fire `track` (dependency went true→false, not false→true).
- Confirmed by RTL assertion: `expect(useStore.getState().acknowledgedDisclaimer).toBe('v1')` passes after the click.

## Threat Flags

None. The fallback introduces:
- No new network surface (analytics already routed through `@/lib/analytics`'s typed wrapper, which 02-03 wired with PostHog).
- No new file/storage access (all writes go through the existing `acknowledgeDisclaimer` action added in 02-01, already covered by Phase 2's threat model).
- No new auth path (the dashboard branch is reached only when `user` is non-null, same as before; the modal does not bypass any other gate).

## Known Stubs

None. The wire-up is end-to-end: selector reads from the store, the modal calls the real action on click, the action writes through to localStorage via the existing persist middleware, and the analytics call routes through the real `track` wrapper (which no-ops when `VITE_ANALYTICS_ENABLED !== 'true'`).

## Self-Check

```
$ [ -f leanshot/src/App.tsx ] && echo "FOUND: src/App.tsx" || echo "MISSING"
FOUND: src/App.tsx
$ [ -f leanshot/src/App.disclaimer.test.tsx ] && echo "FOUND: src/App.disclaimer.test.tsx" || echo "MISSING"
FOUND: src/App.disclaimer.test.tsx
$ git log --oneline --all | grep -E "2a9682c|53313ce"
53313ce feat(02-05): wire DisclaimerModal as dashboard-render fallback (D-11)
2a9682c test(02-05): add failing test for App.tsx D-11 dashboard-render fallback
```

## Self-Check: PASSED

- All claimed files exist on disk.
- Both RED (`2a9682c`) and GREEN (`53313ce`) commits exist in the worktree branch's git log.
- Plan-level TDD gate sequence satisfied: `test(...)` → `feat(...)`.
- All success criteria from the plan met:
  - App.tsx renders DisclaimerModal as a blocking overlay over AppShell when `user && acknowledgedDisclaimer !== 'v1'` ✓
  - First-render-only `track('disclaimer_required', { surface: 'dashboard' })` fires ✓
  - 4-state matrix covered + v3-migrant case ✓
  - SUMMARY.md created ✓
  - No modifications to STATE.md or ROADMAP.md ✓
