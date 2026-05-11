---
phase: 03-pharmacology-insights-hardening
plan: 05
subsystem: storage
tags: [storage, migration, zustand, persist, pharmacology, pk-engine]

# Dependency graph
requires:
  - phase: 02-visible-compliance-public-deploy
    provides: STORAGE_VERSION=5 + persist migrate handler that defaults acknowledgedDisclaimer to undefined for v4 users (Phase 2 D-10/D-11)
provides:
  - Optional `pkEngineVersion?: number` field on the Injection interface
  - STORAGE_VERSION bumped 5 → 6
  - Exported pure `migrateState(persistedState, version): PersistedState` helper in `src/lib/store.ts` (refactor — direct unit-testable)
  - Chained `version <= N` predicates in migrate so v4-direct-to-v6 users receive BOTH the Phase 2 disclaimer reset AND the Phase 3 pk back-stamp
  - addInjection now stamps `pkEngineVersion: 1` by default; explicit caller value preserved via `?? 1`
  - 6 new Vitest cases covering v5→v6 back-stamp, idempotency (explicit 2 preserved), v4→v6 chain, malformed-snapshot defensive `?? []`, and addInjection default + explicit stamping
affects: [phase-03 plan-01-pharmacology-corpus, phase-03 plan-02-pk-engine-v1, phase-03 plan-04-ui-uncertainty-band, future-v1.1-two-compartment-engine]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Chained version-predicate migrate: `version <= N` (not ===) so accumulated transforms apply in series; addresses PATTERNS.md self-invalidating grep gate"
    - "Pure exported `migrateState` helper: persist middleware delegates to it; tests drive it directly without a localStorage harness"
    - "Engine-version stamping with `?? 1`: explicit caller value wins; default preserved-on-read via migrate back-stamp"

key-files:
  created: []
  modified:
    - src/types/index.ts
    - src/lib/storage.ts
    - src/lib/store.ts
    - src/lib/storage.test.ts

key-decisions:
  - "Refactored migrate callback into exported `migrateState` pure helper for direct unit testing (planner's recommended path; avoids fragile localStorage-spy harness for new tests)"
  - "Chained `version <= N` predicates replace `version === 4` so a v4-direct-to-v6 user receives BOTH Phase 2 disclaimer reset AND Phase 3 pk back-stamp (T-03-13 mitigation)"
  - "addInjection stamps `pkEngineVersion: inj.pkEngineVersion ?? 1` so an explicit caller value (future v1.1 engine) wins over the default"
  - "Defensive `(state.injections ?? []).map(...)` collapses a malformed snapshot's missing injections array to empty (T-03-16 mitigation, covered by `tolerates missing injections array` test)"

patterns-established:
  - "Pure migrate helper: extract the persist `migrate` callback as `migrateState(persistedState, version): PersistedState` so it is directly unit-testable without instantiating the store"
  - "Version-chain migration: subsequent phases that add schema-bumped fields should use `version <= N` predicates and accumulate transforms on the same `state` variable before returning"

requirements-completed:
  - PK-05

# Metrics
duration: 12min
completed: 2026-05-11
---

# Phase 3 Plan 05: pkEngineVersion field plumbing + chained storage migration Summary

**Optional `pkEngineVersion?: number` field on Injection, STORAGE_VERSION 5→6, exported `migrateState` helper with chained `version <= N` predicates, and addInjection stamping — making a future v1.1 two-compartment engine retroactively addressable per-record.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-11T12:02:15Z
- **Completed:** 2026-05-11T12:06:16Z
- **Tasks:** 3 (all TDD: RED → GREEN per task)
- **Files modified:** 4 source files

## Accomplishments

- Added optional `pkEngineVersion?: number` field on the `Injection` interface so every saved record can carry the engine version that produced its expected curve (PK-05).
- Bumped `STORAGE_VERSION` 5 → 6 with updated comment citing D-07 + PK-05, preserving the "Do NOT rename STORAGE_KEY" cautionary note.
- **Refactor:** extracted the persist `migrate` callback into a pure, exported `migrateState(persistedState, version): PersistedState` helper. The middleware now delegates a single line; tests drive the helper directly.
- Replaced the exact-equality `version === 4` predicate with chained `version <= 4` and `version <= 5` predicates so a user upgrading directly from v4 to v6 receives BOTH the Phase 2 disclaimer reset AND the Phase 3 pk back-stamp (T-03-13 mitigation).
- `addInjection` now stamps `pkEngineVersion: 1` on every write using `inj.pkEngineVersion ?? 1` so explicit caller values (future v1.1 engine) are preserved.
- Added 6 new Vitest cases (8 → 14 in `storage.test.ts`; 87 → 93 project-wide). All green.

## Task Commits

Each task was committed atomically; tasks marked `tdd="true"` produced both a RED test commit and a GREEN implementation commit.

1. **Task 1 RED: STORAGE_VERSION=6 assertion** — `79c1371` (test)
2. **Task 1 GREEN: Injection.pkEngineVersion + STORAGE_VERSION bump** — `e5eb790` (feat)
3. **Task 2/3 RED: v5→v6 migrate + addInjection stamping tests** — `e642e74` (test) — six new tests (one auto-added: defensive `?? []` coverage)
4. **Task 2 GREEN: chained migrate handler + addInjection stamping + `migrateState` export** — `37c6e7d` (feat)

_Note: Task 3 (the test-writing task in the plan) was satisfied by the RED commit (`e642e74`) per proper TDD ordering — tests were written first, then made green by Task 2's implementation. All Task 3 acceptance criteria (≥10 passing tests, `STORAGE_VERSION).toBe(6)`, `v5 → v6` description, ≥4 `pkEngineVersion` matches, `acknowledgedDisclaimer` in v4→v6 chained test) are met._

## Files Created/Modified

- `src/types/index.ts` — Added optional `pkEngineVersion?: number` field on the `Injection` interface, with JSDoc explaining the back-stamping contract.
- `src/lib/storage.ts` — Bumped `STORAGE_VERSION` 5 → 6; updated header comment to cite D-07 + PK-05; preserved the "Do NOT rename STORAGE_KEY" cautionary note.
- `src/lib/store.ts` — Extracted persist `migrate` callback into exported pure `migrateState(persistedState, version): PersistedState` helper; rewrote predicates as chained `version <= N`; updated `addInjection` to stamp `pkEngineVersion: 1` (explicit caller value preserved via `?? 1`); JSDoc explains each transform branch and the chain semantics.
- `src/lib/storage.test.ts` — Updated existing `STORAGE_VERSION` assertion to `.toBe(6)`. Added two new `describe` blocks: `persist migrate v5 → v6 (PK-05)` (4 cases: back-stamp, preserve-explicit, v4→v6 chain, defensive missing-array) and `useStore.addInjection — PK-05 stamping` (2 cases: default + explicit). Imports `migrateState` and `Injection` type for direct unit testing.

## Decisions Made

- **Refactor: extract `migrateState` helper.** The plan's recommended path. Persist middleware now delegates a single line; tests drive the helper directly without the fragile localStorage-spy harness that the existing `migrateFromV3` tests use. The refactor is additive (the legacy `migrateFromV3` localStorage-spy tests still pass unchanged).
- **Chained `version <= N` predicates.** Replaces `version === 4`. T-03-13 mitigation (silent data drop for v4-direct-to-v6 users). Covered explicitly by the `v4 → v6 chain applies BOTH disclaimer reset AND pk back-stamp` test.
- **`?? 1` (nullish coalescing) over default-parameter or `|| 1`.** `??` only fills `undefined`/`null`, so an explicit `pkEngineVersion: 0` (sentinel for some future "uncomputed" state) would be preserved. `|| 1` would clobber 0. Matters for future-engine forward-compatibility.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical mitigation coverage] Added defensive-missing-array test**

- **Found during:** Task 3 (test-writing) review against the plan's threat model
- **Issue:** T-03-16 in the plan's threat register (mitigate disposition) calls for migrate to tolerate `state.injections === undefined`. The plan's Task 3 narrative said "Test in Task 3 covers explicit `[]` case implicitly by the v4-chain test where the fixture's injections array is empty" — but the fixture's array is `[inj]`, not empty, and `undefined` is not the same as `[]`. The mitigation pattern `(state.injections ?? []).map(...)` was unverified.
- **Fix:** Added an explicit `tolerates missing injections array (defensive ?? [])` test that constructs a malformed v5 snapshot with `injections: undefined` and asserts `after.injections` equals `[]`. The mitigation is now positively covered.
- **Files modified:** `src/lib/storage.test.ts`
- **Verification:** Test green; 14/14 in the file, 93/93 project-wide; lint + typecheck clean.
- **Committed in:** `e642e74` (Task 2/3 RED commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical test coverage)
**Impact on plan:** Net-positive — the threat register said `mitigate` but the plan's narrative undersold the test coverage. The added test directly verifies the T-03-16 mitigation. No scope creep, no architectural change.

## Issues Encountered

None — TDD cycle ran cleanly. The plan correctly anticipated the version-chain predicate pitfall in PATTERNS.md and called it out in the threat model (T-03-13); the test for v4→v6 chained migration was straightforward to write because the plan explicitly named it.

## TDD Gate Compliance

Per-task TDD gate verification (each task with `tdd="true"`):

- **Task 1** — RED `79c1371` (test bump) → GREEN `e5eb790` (feat impl). Both gates present. ✓
- **Task 2** — RED `e642e74` (5 failing tests) → GREEN `37c6e7d` (migrate refactor + addInjection stamping). Both gates present. ✓
- **Task 3** — Test-only task. Satisfied by the RED commit `e642e74` which contains the full test suite required by Task 3 (≥10 passing total: 14). The plan's structure of "Task 3 = write tests" was reordered into proper TDD discipline (tests written before Task 2's implementation), which both satisfies the plan's acceptance criteria and produces a verified RED→GREEN trace in git log. ✓

REFACTOR phase: the `migrateState` helper extraction in commit `37c6e7d` is itself a refactor (callback inlined into a named, exported, doc'd helper); tests stayed green throughout. Not a separate REFACTOR commit because the extraction was load-bearing for Task 2's test gate (tests import `migrateState` directly), and committing the extraction separately would have re-broken the RED tests' import.

## User Setup Required

None — pure schema/migration plumbing, no external service configuration.

## Verification

All plan-level verification commands run from the worktree root (`/Users/karstenhaldan/minisite/.claude/worktrees/agent-afdfbc3ac69a890a3/leanshot`):

- `npx vitest run src/lib/storage.test.ts` → **14 passing** (was 8; net +6)
- `npx vitest run` (whole project) → **93 passing** (was 87; net +6, no regression)
- `npx tsc -p tsconfig.app.json --noEmit` → exit 0
- `npx tsc -b --noEmit` (full build-ref typecheck) → exit 0
- `npx eslint src/lib/store.ts src/lib/storage.ts src/types/index.ts src/lib/storage.test.ts` → exit 0

Acceptance-criteria grep gates (all from plan's `<acceptance_criteria>` blocks):

| Gate | Required | Actual |
|------|----------|--------|
| `pkEngineVersion?: number` in `src/types/index.ts` | 1 | 1 |
| `export const STORAGE_VERSION = 6` in `src/lib/storage.ts` | 1 | 1 |
| `export const STORAGE_VERSION = 5` in `src/lib/storage.ts` | 0 | 0 |
| `D-07` in `src/lib/storage.ts` | ≥1 | 1 |
| `Do NOT rename STORAGE_KEY` in `src/lib/storage.ts` | ≥1 | 1 |
| `version <= 4` in `src/lib/store.ts` | ≥1 | 1 |
| `version <= 5` in `src/lib/store.ts` | ≥1 | 1 |
| `version === 4` in `src/lib/store.ts` | 0 | 0 |
| `pkEngineVersion: inj.pkEngineVersion ?? 1` in `src/lib/store.ts` | ≥2 | 2 |
| `D-07` in `src/lib/store.ts` | ≥1 | 3 |
| `expect(STORAGE_VERSION).toBe(6)` in `storage.test.ts` | 1 | 1 |
| `v5 → v6` in `storage.test.ts` | ≥1 | 2 |
| `pkEngineVersion` in `storage.test.ts` | ≥4 | 13 |
| `acknowledgedDisclaimer` in `storage.test.ts` (v4→v6 chain) | ≥1 | 9 |

All gates pass.

## Next Phase Readiness

- **PK-05 satisfied.** Pharmacology engine version is recorded on every saved Injection — back-stamped for existing records via migrate, stamped on new writes via `addInjection`. A future v1.1 two-compartment engine can address records by version (e.g. `injections.filter(i => i.pkEngineVersion === 1)` to recompute curves) without ambiguity. Verified by the `back-stamps injections lacking pkEngineVersion to 1` and `useStore.addInjection — PK-05 stamping` tests.
- **No blockers.** This plan is wave 1 standalone (no `depends_on`). Plans 01–04 in this phase are independent of this storage-migration plumbing and can proceed in parallel; the `pkEngineVersion` field is optional, so any other plan's `Injection` literal continues to typecheck without modification.
- **Forward compatibility.** `?? 1` (not `|| 1`) preserves explicit `0` sentinel values, so a future engine that wants to signal "uncomputed" or "pre-engine" state has the option without a code change here.

## Self-Check

Verifying claimed files and commits.

```
[ -f src/types/index.ts ] → FOUND
[ -f src/lib/storage.ts ] → FOUND
[ -f src/lib/store.ts ] → FOUND
[ -f src/lib/storage.test.ts ] → FOUND
git log --oneline | grep 79c1371 → FOUND  (test RED, task 1)
git log --oneline | grep e5eb790 → FOUND  (feat GREEN, task 1)
git log --oneline | grep e642e74 → FOUND  (test RED, task 2/3)
git log --oneline | grep 37c6e7d → FOUND  (feat GREEN, task 2)
```

## Self-Check: PASSED

---
*Phase: 03-pharmacology-insights-hardening*
*Completed: 2026-05-11*
