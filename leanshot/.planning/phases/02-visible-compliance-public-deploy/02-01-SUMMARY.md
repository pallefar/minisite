---
phase: 02-visible-compliance-public-deploy
plan: 1
subsystem: storage
tags: [persistence, migration, disclaimer, zustand, tdd]
requires:
  - "src/lib/storage.ts (existing PersistedState + migrateFromV3)"
  - "src/lib/store.ts (existing Zustand persist middleware)"
provides:
  - "PersistedState.acknowledgedDisclaimer: 'v1' | undefined"
  - "useStore.getState().acknowledgeDisclaimer('v1') action"
  - "v4→v5 persist.migrate that defaults acknowledgedDisclaimer to undefined"
  - "STORAGE_VERSION === 5 (bumped from 4)"
affects:
  - "All downstream readers of acknowledgedDisclaimer (D-08 Step 0 disclaimer + D-11 dashboard fallback)"
tech_stack_added: []
patterns:
  - "Versioned persisted-state schema (Zustand persist `migrate` callback fires on version mismatch)"
  - "Default-undefined sentinel for forced re-acknowledgment (RESEARCH Pitfall 5)"
key_files:
  created: []
  modified:
    - src/lib/storage.ts
    - src/lib/store.ts
    - src/lib/storage.test.ts
decisions:
  - "Bumped STORAGE_VERSION 4→5 instead of relying on Zustand's default merge — explicit migration is testable and guaranteed to fire."
  - "Kept STORAGE_KEY as 'leanshot_v4' literal — the localStorage key is independent of the schema version inside the payload; renaming would orphan v4 data."
  - "Declared field as `'v1' | undefined` (not optional `?`) so TypeScript forces every code path to think about the disclaimer state."
  - "Both initialState AND v3 + v4 migrations default to undefined (NOT 'v1', NOT false) per D-11 / RESEARCH Pitfall 5 — defaulting to 'v1' would silently grandfather every existing user past the disclaimer."
metrics:
  duration: "~10 minutes (incl. npm ci)"
  completed_date: "2026-05-11"
  tasks_completed: 2
  tests_added: 4
---

# Phase 2 Plan 1: Persisted-State Disclaimer Field Summary

Added a versioned `acknowledgedDisclaimer: 'v1' | undefined` field to the persisted Zustand state with default-undefined semantics on every entry path (initialState, v3 migration, v4→v5 migration), bumping STORAGE_VERSION 4→5 so the persist middleware's `migrate` callback fires for existing v4 users.

## What Was Built

### Storage layer (`src/lib/storage.ts`)
- `PersistedState` interface gained `acknowledgedDisclaimer: 'v1' | undefined`.
- `STORAGE_VERSION` bumped from `4` to `5`. STORAGE_KEY (`'leanshot_v4'`) intentionally unchanged — the persist middleware writes `{ state, version }` to that key; bumping the version inside the payload triggers `migrate`.
- `initialState` defaults the field to `undefined`.
- `migrateFromV3()` sets `acknowledgedDisclaimer: undefined` in its returned `merged` literal.

### Store layer (`src/lib/store.ts`)
- `Actions` interface declares `acknowledgeDisclaimer: (version: 'v1') => void`.
- Action implementation: `acknowledgeDisclaimer: (version) => set({ acknowledgedDisclaimer: version })`.
- `partialize` selector includes `acknowledgedDisclaimer: state.acknowledgedDisclaimer` so the field round-trips through localStorage.
- `migrate` callback extended with a v4→v5 branch that spreads the existing persisted state and sets `acknowledgedDisclaimer: undefined`.

### Test layer (`src/lib/storage.test.ts`)
- Added `describe('initialState')` with `expect(initialState.acknowledgedDisclaimer).toBeUndefined()`.
- Added `describe('STORAGE_VERSION')` asserting it equals 5.
- Extended the existing `migrateFromV3` "migrates v3 payload" test to assert `result?.acknowledgedDisclaimer` is undefined.
- Added `describe('useStore.acknowledgeDisclaimer')` asserting the action writes `'v1'` into store state.

(No new `store.test.ts` was created — assertions were appended to the existing `storage.test.ts` per the plan's "if creating store.test.ts is too heavy" guidance, since the only store-level assertion needed was the action behavior.)

## TDD Cycle (Plan-Level Compliance)

| Gate | Commit | Notes |
|------|--------|-------|
| RED (Task 1) | `2f7aaeb` test(02-01): add failing test for STORAGE_VERSION bump and disclaimer defaults | 1 of 3 new asserts failed (`STORAGE_VERSION === 5`); the two undefined-default asserts passed tautologically because the field did not exist yet — by design they validate that we set the field to `undefined`, not `'v1'` or `false`, once added. |
| GREEN (Task 1) | `1b9b5b6` feat(02-01): add acknowledgedDisclaimer to PersistedState; bump STORAGE_VERSION 4→5 | All 7 storage tests pass; `tsc -b --noEmit` exits 0. |
| RED (Task 2) | `4c586d9` test(02-01): add failing test for useStore.acknowledgeDisclaimer action | Failed with `acknowledgeDisclaimer is not a function`. |
| GREEN (Task 2) | `2f0174a` feat(02-01): add acknowledgeDisclaimer action, partialize, v4→v5 migrate | All 56 unit tests pass; typecheck and lint clean. |

REFACTOR step skipped — no cleanup needed (implementation was minimal and readable).

## Verification

```
$ npm run typecheck
> tsc -b --noEmit
(exit 0)

$ npm run test:unit -- src/lib/
Test Files  4 passed (4)
Tests       56 passed (56)

$ npm run lint
0 errors, 4 warnings (all pre-existing in unrelated files; none in modified files)

$ grep -E "acknowledgedDisclaimer:\s*'v1'" src/lib/storage.ts src/lib/store.ts
src/lib/storage.ts:54:  acknowledgedDisclaimer: 'v1' | undefined;
# (Type declaration only — no defaults set to 'v1' anywhere.)
```

### Proof of insertions (`grep -n "acknowledgedDisclaimer" src/lib/storage.ts src/lib/store.ts`)

```
src/lib/storage.ts:29:// and explicitly defaults `acknowledgedDisclaimer` to undefined. Do NOT rename
src/lib/storage.ts:54:  acknowledgedDisclaimer: 'v1' | undefined;
src/lib/storage.ts:77:  acknowledgedDisclaimer: undefined,
src/lib/storage.ts:110:      acknowledgedDisclaimer: undefined,
src/lib/store.ts:115:      acknowledgeDisclaimer: (version) => set({ acknowledgedDisclaimer: version }),
src/lib/store.ts:249:        acknowledgedDisclaimer: state.acknowledgedDisclaimer,
src/lib/store.ts:259:        // dashboard fallback modal on next load. Default acknowledgedDisclaimer
src/lib/store.ts:265:            acknowledgedDisclaimer: undefined,
```

- `storage.ts`: 4 hits (interface declaration, initialState default, migrateFromV3 default, plus a comment) — exceeds the ≥3 done-criterion.
- `store.ts`: 4 hits (action impl, partialize, migrate comment, migrate default) — exceeds the ≥3 done-criterion.

## Final Exported Values

- `STORAGE_VERSION` = `5` (was `4`).
- `STORAGE_KEY` = `'leanshot_v4'` (unchanged — localStorage key is decoupled from payload version).

## Deviations from Plan

**Tautological RED-phase assertions for undefined defaults.** The two new "undefined" assertions (`initialState.acknowledgedDisclaimer` and `result?.acknowledgedDisclaimer`) passed even before the field was added, because property access on a missing field returns `undefined` in JS. This is benign — the assertions still serve their stated purpose (gate against ever defaulting to `'v1'` or `false`). The `STORAGE_VERSION === 5` assertion provided the actual RED gate for Task 1.

**[Rule 3 - Blocking issue] Installed dependencies.** The worktree had no `node_modules/`; `npm run test:unit` exited with `vitest: command not found`. Ran `npm ci` (501 packages, 5s). Not a code deviation — environment setup.

**[Rule 1 - Bug] Lint import order.** Initial test file added `import { useStore } from './store'` before `import { … } from './storage'`, violating `import-x/order`. Fixed by swapping the order (storage before store, alphabetical).

No architectural changes. No auth gates. No checkpoints required (plan was fully autonomous).

## Known Stubs

None — the field is wired through interface, init, both migration paths, action, partialize, and tests. Downstream readers (D-08 Step 0 disclaimer modal, D-11 dashboard fallback) live in subsequent plans (02-02+).

## Self-Check

```
$ [ -f leanshot/src/lib/storage.ts ] && echo "FOUND"
FOUND
$ [ -f leanshot/src/lib/store.ts ] && echo "FOUND"
FOUND
$ [ -f leanshot/src/lib/storage.test.ts ] && echo "FOUND"
FOUND
$ git log --oneline | head -5
2f0174a feat(02-01): add acknowledgeDisclaimer action, partialize, v4→v5 migrate
4c586d9 test(02-01): add failing test for useStore.acknowledgeDisclaimer action
1b9b5b6 feat(02-01): add acknowledgedDisclaimer to PersistedState; bump STORAGE_VERSION 4→5
2f7aaeb test(02-01): add failing test for STORAGE_VERSION bump and disclaimer defaults
70c3085 plan(phase-02): 8 plans across 4 waves for Visible Compliance & Public Deploy
```

## Self-Check: PASSED
