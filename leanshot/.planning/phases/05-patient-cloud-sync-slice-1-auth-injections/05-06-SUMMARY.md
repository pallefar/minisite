---
phase: 05-patient-cloud-sync-slice-1-auth-injections
plan: 06
subsystem: ui-null-guard
tags: [bugfix, ux, sentry-noise, signed-out, rules-of-hooks]
gap_closure: true
closes_gaps: [G3]
requirements: [AUTH-05]
threat_model_required: false
dependency_graph:
  requires:
    - "05-02 (App.tsx SIGNED_OUT state machine — establishes the user=null transient window MedicationTab now guards against)"
    - "05-03 (clearUserDataSlices() — the action that produces the user=null render frame)"
  provides:
    - "Null-safe MedicationTab — pattern other dashboard tabs should adopt for any future feature that reads `useStore((s) => s.user)` directly"
  affects:
    - "src/components/dashboard/tabs/MedicationTab.tsx (single-file behavior change; subcomponents VialModal/CostModal/CostTile untouched)"
tech_stack:
  added: []
  patterns:
    - "Nullable Zustand selector + rules-of-hooks-compliant early-return guard for tab components rendered during transient signOut frames"
key_files:
  created:
    - "src/components/dashboard/tabs/MedicationTab.test.tsx"
  modified:
    - "src/components/dashboard/tabs/MedicationTab.tsx"
decisions:
  - "Option A (null-guard in MedicationTab) chosen over Option B (re-order App.tsx state machine to unmount tabs before clearing user). Option B requires either an intermediate signing-out view (UI flicker) or flushSync (React 18 footgun); the null-guard is the lower-risk surgical fix proportional to the minor severity (Sentry-noise only, no user-visible impact)."
  - "useState initializer uses `user?.dose ?? ''` (defensive belt-and-braces) even though the early-return guarantees user is non-null past line 55. App.tsx's state machine guarantees the initializer only runs on mount when user is non-null, but the defensive optionals cost nothing and document the invariant."
  - "Local variable renamed `u` → `user` to remove the lie that the non-null assertion (`!`) used to encode. The terse `u` shorthand is allowed by project conventions, but in this file it was the trap; a regular noun signals nullability."
metrics:
  duration_min: 4
  completed: "2026-05-12T03:24:30Z"
  tasks_completed: 1
  test_count_delta: 2
  files_created: 1
  files_modified: 1
---

# Phase 5 Plan 06: MedicationTab null-guard (Gap G3 closure) Summary

**One-liner:** Null-guard MedicationTab against the single-frame user=null render that fires during signOut → SIGNED_OUT view switch, eliminating the `TypeError: Cannot read properties of null (reading 'dose')` Sentry noise from UAT Test 7.

## Gap Closed

| Gap | Severity | Source | Resolution |
| --- | -------- | ------ | ---------- |
| G3 | minor | 05-UAT.md Test 7 `issues:` block | `useStore((s) => s.user!)` → `useStore((s) => s.user)` + `if (!user) return null` early-return after all hooks. Co-located RTL test pins the regression. |

## What changed

### `src/components/dashboard/tabs/MedicationTab.tsx` (modified)

Before:
```tsx
export function MedicationTab() {
  const u = useStore((s) => s.user!);            // lies about nullability
  // ...
  const [injForm, setInjForm] = useState({
    datetime: new Date().toISOString().slice(0, 16),
    dose: u.dose,                                // CRASH: u is null during SIGNED_OUT
    unit: u.doseUnit as DoseUnit,
    // ...
  });
  const halfLifeDays = ((HALF_LIVES[u.medication] ?? 168) / 24).toFixed(1);
  // 8 total `u.*` deref sites
```

After:
```tsx
export function MedicationTab() {
  const user = useStore((s) => s.user);          // nullable
  // ...all other hooks unchanged...
  const [injForm, setInjForm] = useState({
    datetime: new Date().toISOString().slice(0, 16),
    dose: user?.dose ?? '',                      // defensive
    unit: (user?.doseUnit ?? 'mg') as DoseUnit,
    // ...
  });

  if (!user) return null;                        // ← G3 null-guard (after all hooks)

  const halfLifeDays = ((HALF_LIVES[user.medication] ?? 168) / 24).toFixed(1);
  // every u.* deref renamed to user.*
```

- 8 `u.{dose,doseUnit,medication,startDate}` references renamed to `user.*`.
- VialModal / CostModal / CostTile subcomponents untouched (they don't read `user`).
- No imports changed.

### `src/components/dashboard/tabs/MedicationTab.test.tsx` (new)

Co-located RTL suite with 2 cases:

- **G3-1 (the bug pin):** `useStore.setState({...initialState, user: null}, true)` then render. Asserts `container.toBeEmptyDOMElement()` (component returned null) AND `console.error` was never called with a `Cannot read properties of null` message. **This test FAILED before the fix** with the exact UAT bug.
- **G3-2 (regression guard):** Renders with a fixture User; asserts Current dose tile, Log new injection form, and Half-life badge are all present. Proves the rename + guard didn't regress steady-state UI.

The test stubs `MedLevelChart` via `vi.mock` because Chart.js requires a real canvas (resize/responsive handlers call `ownerDocument` on the canvas's DOM node, which jsdom doesn't fully implement). The chart is irrelevant to the G3 surface — the null-guard sits at the top of MedicationTab and never reaches the chart on the null path.

## Verification

| Gate | Command | Result |
| ---- | ------- | ------ |
| RED test reproduces UAT bug | `npx vitest run src/components/dashboard/tabs/MedicationTab.test.tsx` against unmodified MedicationTab | `TypeError: Cannot read properties of null (reading 'dose')` at MedicationTab.tsx:38 — exact UAT signature |
| GREEN test passes | same command after fix | 2/2 tests pass |
| Typecheck | `npx tsc -b --noEmit` | exit 0 |
| Lint (touched files) | `npx eslint src/components/dashboard/tabs/MedicationTab.tsx src/components/dashboard/tabs/MedicationTab.test.tsx` | exit 0, 0 problems |
| Full unit suite (no regression) | `npx vitest run` | 22 files, 298 tests pass (296 baseline + 2 new) |

## TDD Gate Compliance

- **RED gate:** commit `73cd8dc` — `test(05-06): add failing test reproducing G3 null-deref in MedicationTab`. Test failed with the exact UAT error before fix.
- **GREEN gate:** commit `93e2915` — `fix(05-06): null-guard MedicationTab against SIGNED_OUT user=null render`. Test now passes.
- **REFACTOR gate:** N/A — the `u` → `user` rename was bundled into GREEN since it's part of the fix (it's what removes the lie of the `!` assertion). A standalone refactor commit would have been make-work.

## Deviations from Plan

None — plan executed exactly as written.

One micro-adjustment worth noting: the plan's test sketch in `<behavior>` showed an inline-mock-free render of `<MedicationTab />` with `expect(container).toBeEmptyDOMElement()`. That works for G3-1 (null-render path never touches MedLevelChart) but G3-2 (happy path) would crash inside Chart.js due to jsdom's missing canvas resize APIs. Added a `vi.mock('@/components/dashboard/charts/MedLevelChart', ...)` stub at the top of the test file to keep both cases hermetic. This is a Rule-3 fix to the test (jsdom limitation, not the component bug) — documented in-line via comment.

## Commits

- `73cd8dc` test(05-06): add failing test reproducing G3 null-deref in MedicationTab
- `93e2915` fix(05-06): null-guard MedicationTab against SIGNED_OUT user=null render

## Hand-off note for future tab components

Any future dashboard tab that reads `useStore((s) => s.user)` directly should follow the same pattern:

```tsx
const user = useStore((s) => s.user);  // nullable — never `s.user!`
// ...other hooks...
if (!user) return null;                // after all hooks (rules-of-hooks)
// safe to deref user.* below this line
```

The App.tsx SIGNED_OUT state machine guarantees a single-frame `user === null` window after `clearUserDataSlices()` and before the view switches to `<Landing>`. Any tab still mounted during that frame WILL render once with `user === null`. Tabs that don't null-guard will surface as the same `Cannot read properties of null` class in Sentry.

The sibling `MedLevelChart.tsx` (`src/components/dashboard/charts/MedLevelChart.tsx:13`) still uses `useStore((s) => s.user!)` — it doesn't crash today because its parent MedicationTab now null-guards above it, but a future tab that mounts MedLevelChart directly under different conditions could resurface the bug class. **Not in scope for this plan** — logged here for future awareness.

## Self-Check: PASSED

- `src/components/dashboard/tabs/MedicationTab.tsx` — FOUND (modified)
- `src/components/dashboard/tabs/MedicationTab.test.tsx` — FOUND (created)
- Commit `73cd8dc` (RED test) — FOUND in `git log`
- Commit `93e2915` (GREEN fix) — FOUND in `git log`
- No `s.user!` non-null assertion remains in MedicationTab.tsx body (verified via grep)
- `if (!user) return null` guard present at line 55 (verified via grep)
- 0 stale `u.{dose,doseUnit,medication,startDate}` references in MedicationTab.tsx body (verified via grep)
- All 298 unit tests pass; typecheck + lint clean.
