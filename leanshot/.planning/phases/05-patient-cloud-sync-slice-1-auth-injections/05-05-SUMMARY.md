---
phase: 05-patient-cloud-sync-slice-1-auth-injections
plan: 05
subsystem: storage-isolation
tags: [zustand, persist, localStorage, multi-account, T-05-03, gap-closure, G2]

gap_closure: true
closes_gaps: [G2]

# Dependency graph
requires:
  - phase: 05-patient-cloud-sync-slice-1-auth-injections
    provides: namespacedKey + renameStorageNamespace (05-01); persist hardcoded to STORAGE_KEY which caused G2 (pre-this-plan)
provides:
  - createNamespacedStorage StateStorage adapter routing every read/write through activeNamespaceKey
  - setActiveStorageUserId / removeUserNamespace exports wired into App.tsx onAuthStateChange
  - M1-M4 regression tests in store.test.ts that lock the ordering contract
  - 10 unit tests in storage.test.ts covering the adapter contract end-to-end
affects: [phase-06 weights/photos/meals/supplements, future Phase 5 follow-ups, e2e cross-device-sync]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "StateStorage adapter pattern — zustand persist's `name` arg ignored; routing owned by module-level activeNamespaceKey cache"
    - "Async-key-precompute — namespacedKey is async (crypto.subtle.digest); setActiveStorageUserId awaits once and caches so every persist setItem stays synchronous"
    - "Call-order contract test — M4 enforces setActiveStorageUserId BEFORE renameStorageNamespace by exercising real exports (no mocks); future refactor that swaps order fails M4"

key-files:
  created: []
  modified:
    - src/lib/storage.ts (added: setActiveStorageUserId, createNamespacedStorage, removeUserNamespace, getActiveStorageNamespace, __resetActiveNamespaceForTests; module-level activeNamespaceKey)
    - src/lib/storage.test.ts (added: 10 adapter-contract tests + import additions)
    - src/lib/store.ts (replaced: storage option with createJSONStorage(() => createNamespacedStorage()); imports updated)
    - src/lib/store.test.ts (added: 6 tests in "Plan 05-05 — per-user storage adapter (G2 closure)" describe block — M1, M2, M3, M4, CONF-2 guard, CONF-3 guard)
    - src/App.tsx (added: setActiveStorageUserId call before renameStorageNamespace in INITIAL_SESSION + SIGNED_IN; added setActiveStorageUserId(null) + removeUserNamespace(prevUserId) in SIGNED_OUT; captured prevUserId before clearUserDataSlices)

key-decisions:
  - "Wrap createNamespacedStorage with createJSONStorage in store.ts (Rule 1 deviation from plan). Zustand persist's `storage` option expects PersistStorage<S> not StateStorage; createJSONStorage handles JSON serialize/parse at the boundary, leaving the adapter to focus purely on key routing."
  - "Adapter ignores the `name` arg from persist. Persist passes its configured name on every call but our routing key is owned by activeNamespaceKey, so the arg is irrelevant. Keeping `name: STORAGE_KEY` in the persist config remains correct (persist uses it for storage-event cross-tab notification, which is separate from our adapter's localStorage key)."
  - "M4 (anon-promotion ordering contract) exercises real exports, no mocks. A future refactor that calls renameStorageNamespace BEFORE setActiveStorageUserId will fail M4 immediately because the post-migration persist write would land in STORAGE_KEY (activeNamespaceKey still null) instead of the namespaced key."

patterns-established:
  - "Per-user localStorage isolation via a module-level singleton activeNamespaceKey + a StateStorage adapter — generic, slice-agnostic. Phase 6 (weights/photos/meals) inherits the guarantee for free; new slices added to partialize automatically route through the same adapter without code changes."

requirements-completed: [AUTH-05, SYNC-05]

# Metrics
duration: 12min
completed: 2026-05-12
---

# Phase 5 Plan 05: G2 Closure — Per-User Storage Adapter Summary

**Per-user namespaced storage adapter routes every Zustand persist write through `activeNamespaceKey`, closing UAT G2 by ensuring Realtime INSERTs and subsequent app writes land in the per-user namespaced key (`leanshot_v4:<sha256(user_id).slice(0,16)>`) instead of falling back to the universal `leanshot_v4` key after the one-shot `renameStorageNamespace` migration.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-12T05:14:00Z (worktree branch base — actual edit start ~05:19Z)
- **Completed:** 2026-05-12T05:26:01Z
- **Tasks:** 2 (both TDD: 2 RED + 2 GREEN commits = 4 atomic commits)
- **Files modified:** 5

## Accomplishments

- Authored `createNamespacedStorage` StateStorage adapter + `setActiveStorageUserId` / `removeUserNamespace` exports in `src/lib/storage.ts`.
- Wired the adapter into Zustand persist via `createJSONStorage(() => createNamespacedStorage())` (necessary deviation — see below).
- Wired `setActiveStorageUserId` into App.tsx's `onAuthStateChange` for INITIAL_SESSION + SIGNED_IN (BEFORE `renameStorageNamespace`) and SIGNED_OUT (followed by `removeUserNamespace(prevUserId)` to wipe per-user residue).
- Added 10 storage-adapter contract tests + 6 store-level integration tests (M1 multi-account regression, M2 Realtime INSERT routing, M3 anon path preservation, M4 anon-promotion ordering contract, CONF-2 + CONF-3 regression guards).
- T-05-03 (cross-account leak) re-mitigated and locked by automated regression — M1 fails immediately if Account A's data ever leaks into Account B's view.

## Task Commits

Each task was committed atomically with a RED/GREEN split (TDD):

1. **Task 1 RED — storage adapter tests** — `727c139` (test)
2. **Task 1 GREEN — storage adapter implementation** — `37d242a` (feat)
3. **Task 2 RED — multi-account regression tests** — `acbe5ba` (test)
4. **Task 2 GREEN — wiring into persist + App.tsx** — `9fda29f` (feat)

**Plan metadata commit:** TBD (created by orchestrator post-wave).

## Files Created/Modified

- `src/lib/storage.ts` — Added 5 exports (`setActiveStorageUserId`, `getActiveStorageNamespace`, `createNamespacedStorage`, `removeUserNamespace`, `__resetActiveNamespaceForTests`) plus module-level `activeNamespaceKey` cache. All existing exports (`STORAGE_KEY`, `STORAGE_VERSION`, `namespacedKey`, `renameStorageNamespace`, `migrateV6ToV7`, `migrateFromV3`, `PersistedState`, `initialState`) preserved verbatim — no signature changes.
- `src/lib/storage.test.ts` — Added `Plan 05-05 — per-user storage adapter` describe block with 10 tests covering all three adapter methods, switching active users, the `_name` arg ignore contract, `removeUserNamespace` isolation guarantees, and crash-safety on localStorage exceptions.
- `src/lib/store.ts` — Replaced `storage: createJSONStorage(() => localStorage)` with `storage: createJSONStorage(() => createNamespacedStorage())`. `name: STORAGE_KEY` and `version: STORAGE_VERSION` preserved (persist's cross-tab storage-event name, NOT the adapter's routing key).
- `src/lib/store.test.ts` — Added `Plan 05-05 — per-user storage adapter (G2 closure)` describe block with 6 tests: M1 (Account A logs 3, signs out, Account B sees zero), M2 (Realtime INSERT routes to namespace, universal stays null), M3 (anon writes still land in universal — Phase 5 Test 2 anon path preserved), M4 (anon-promotion ordering contract — seeds universal, asserts both rename AND a subsequent addInjection land in the namespace), plus CONF-2 (acknowledgedDisclaimer preserved through clearUserDataSlices) and CONF-3 (signedIn not in persisted partialize allow-list) regression guards.
- `src/App.tsx` — Added `setActiveStorageUserId(session.user.id)` call BEFORE `renameStorageNamespace(session.user.id)` in both INITIAL_SESSION and SIGNED_IN branches (the load-bearing ordering contract). SIGNED_OUT now captures `prevUserId = useStore.getState().signedIn?.user?.id ?? null` BEFORE `clearUserDataSlices` null-outs the signedIn slice, then calls `setActiveStorageUserId(null)` + `removeUserNamespace(prevUserId)` to wipe per-user residue.

## Decisions Made

1. **Wrap `createNamespacedStorage` with `createJSONStorage` (deviation from plan).** Plan called for `storage: createNamespacedStorage()` directly but persist's `storage` option type is `PersistStorage<S, R>` (deserialized `{state, version}`), not the string-based `StateStorage`. Driving persist with a raw StateStorage produced `"[object Object]" is not valid JSON` errors on hydrate. Using `createJSONStorage(() => createNamespacedStorage())` keeps the adapter focused on routing while persist's stock JSON layer owns serialization. The `createJSONStorage` import had to be kept in store.ts (plan's automated check expected it removed — that check was based on the incorrect API assumption).

2. **Persist's `name: STORAGE_KEY` retained, not deleted.** Persist uses `name` for the cross-tab storage-event broadcast (a separate concern from where bytes physically land), and for the persist-event subscriber API. The adapter ignores `name` for routing purposes only.

3. **`useStore.setState({...initialState, ...})` runs BEFORE `localStorage.clear()` in beforeEach.** Resetting the store triggers a persist write under whatever `activeNamespaceKey` was previously set; if `clear()` ran first, that write would re-seed localStorage with stale data for the test. Discovered while making M2 pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan's `storage: createNamespacedStorage()` direct-assignment is wrong type**

- **Found during:** Task 2 GREEN — running M1/M2 produced `SyntaxError: "[object Object]" is not valid JSON` on hydrate.
- **Issue:** Zustand persist's `storage` option expects `PersistStorage<S>` (which exchanges `{state, version}` objects with the implementation). My `createNamespacedStorage()` returns a `StateStorage` (string-in / string-out). Persist was passing the deserialized state object directly to `setItem` and reading it back as a string, then `JSON.parse`-ing the result of `String([object Object])`.
- **Fix:** Wrap the adapter with `createJSONStorage(() => createNamespacedStorage())`. The JSON layer owns serialization at the persist boundary, and the StateStorage adapter does what it should: route raw strings to `localStorage[activeNamespaceKey ?? STORAGE_KEY]`.
- **Files modified:** `src/lib/store.ts` (import + persist config); `src/lib/storage.ts` JSDoc updated to reflect the wrapping pattern.
- **Verification:** All 312 vitest tests pass (including all 6 Plan 05-05 store tests and 10 storage adapter tests). `tsc --noEmit` clean. `eslint` clean.
- **Committed in:** `9fda29f`

**2. [Rule 1 - Bug] beforeEach ordering — store reset must precede localStorage.clear**

- **Found during:** Task 2 GREEN — M2 was failing on `expect(localStorage.getItem(STORAGE_KEY)).toBeNull()` because the prior test's `setState({...initialState, ...})` had already fired a persist write to the universal key by the time `localStorage.clear()` ran.
- **Issue:** The order in the plan (`localStorage.clear()` → `__resetActiveNamespaceForTests()` → `useStore.setState(...)`) leaves stale state in localStorage at the start of every test because `setState` triggers persist and writes under whatever `activeNamespaceKey` was previously set (post-clear, before resetting the namespace cache).
- **Fix:** Swapped to `useStore.setState({...initialState, ...})` → `__resetActiveNamespaceForTests()` → `localStorage.clear()`. Now the persist write from `setState` happens FIRST, then we wipe everything for the test to start clean.
- **Files modified:** `src/lib/store.test.ts`.
- **Verification:** All 6 Plan 05-05 tests pass; full suite remains green.
- **Committed in:** `9fda29f`

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs in plan-as-written that prevented the tests from being meaningful).
**Impact on plan:** Both fixes essential. The first (createJSONStorage wrapping) is a correctness fix — without it persist crashes on hydrate. The second (beforeEach ordering) is a test-correctness fix — without it M2's universal-key-empty assertion would be flaky. No scope creep.

## Issues Encountered

- `node_modules/` lives in the main worktree (`/Users/karstenhaldan/minisite/leanshot/node_modules`), not in this Claude Code worktree. Resolved by symlinking once at the start of execution. Symlink is not tracked (already in `.gitignore` by default — `?? node_modules` was the only untracked entry in `git status` and was never staged).

## Threat-Mitigation Evidence

| Threat | Status (pre-plan) | Status (post-plan) | Evidence |
|--------|-------------------|--------------------|----------|
| T-05-03 (cross-account localStorage leak when 2 users share a browser) | degraded (renameStorageNamespace moved data once; subsequent writes landed in universal key; UAT Test 5 proved 6 Realtime inserts went to universal not namespace) | **mitigated** | Test M1 in `src/lib/store.test.ts` — Account A logs 3 injections, signs out, Account B signs in → `useStore.getState().injections.length === 0` AND `localStorage.getItem(namespacedKey(userA))` is null. Test M2 — Realtime INSERT lands in namespaced key, `localStorage.getItem(STORAGE_KEY)` is null. Both fail immediately if the storage adapter or the App.tsx wiring regresses. |
| T-05-05-01 (sha256-16-hex namespace collision) | accept (per threat model) | accept | 64 bits collision-resistance unchanged. Revisit at 100k+ users. |
| T-05-05-03 (race between setActiveStorageUserId and renameStorageNamespace) | mitigate | **mitigated + tested** | Test M4 locks the ordering contract by exercising the real exports. A refactor that swaps the call order (calling renameStorageNamespace before setActiveStorageUserId) will fail M4's "afterWrite.state.injections.length === 2" assertion because the post-migration persist write would land in STORAGE_KEY (activeNamespaceKey still null) instead of the namespaced key. |
| T-05-05-04 (test asserting fix doesn't ship in CI) | mitigate | **mitigated** | M1-M4 + CONF-2 + CONF-3 live in `src/lib/store.test.ts` and the 10 adapter contract tests in `src/lib/storage.test.ts` — all 16 run on every PR via the existing vitest job (no Supabase dependencies, no Edge Function dependencies). |

## Hand-off Note for Phase 6 (Slice 2 — weights/photos/meals)

The per-user storage adapter is **slice-agnostic**: it routes the entire serialized persist blob (everything in `partialize`) to the active user's namespace. When Phase 6 adds new slices to `partialize` (e.g. `photos` evolving to include S3 keys, weights pulled from cloud), the namespace plumbing requires zero changes. The single failure mode to watch for in Phase 6 is calling a Zustand action that writes to a persisted slice from a non-React code path (e.g. background sync) WITHOUT having called `setActiveStorageUserId(userId)` first — in that case the write lands in `STORAGE_KEY`. The fix: ensure every entry point that resumes activity for a user (push notification handler, background sync, etc.) calls `setActiveStorageUserId` first. The existing onAuthStateChange wiring handles every signin path.

## CONF Preservation Verification

- **CONF-2 (acknowledgedDisclaimer preservation through sign-out)** — `clearUserDataSlices` action explicitly preserves `acknowledgedDisclaimer` (regression test in store.test.ts:115-134 unchanged AND new test in Plan 05-05 block re-asserts). Not regressed.
- **CONF-3 (signedIn not in persisted partialize allow-list)** — `partialize` allow-list at store.ts:589-611 unchanged (no `signedIn` entry). New test in Plan 05-05 block (`CONF-3 regression`) parses the persisted namespaced blob and asserts `blob.state.signedIn === undefined`. Not regressed.

## Self-Check: PASSED

- Files modified exist:
  - `src/lib/storage.ts`: FOUND (5 new exports verified by grep guards)
  - `src/lib/storage.test.ts`: FOUND (+10 tests in Plan 05-05 describe block)
  - `src/lib/store.ts`: FOUND (createNamespacedStorage import + wrapping verified)
  - `src/lib/store.test.ts`: FOUND (+6 tests in Plan 05-05 describe block)
  - `src/App.tsx`: FOUND (setActiveStorageUserId + removeUserNamespace imports + call sites verified)
- Commit hashes exist in worktree git log:
  - `727c139` test(05-05): add failing tests for per-user storage adapter — FOUND
  - `37d242a` feat(05-05): implement per-user storage adapter (createNamespacedStorage) — FOUND
  - `acbe5ba` test(05-05): add multi-account regression tests M1-M4 + CONF-2/CONF-3 guards — FOUND
  - `9fda29f` feat(05-05): wire per-user storage adapter into persist + App.tsx auth flow — FOUND
- Verification commands run:
  - `npx vitest run`: 312 tests passed (all 21 test files green)
  - `npx tsc -b --noEmit`: exit 0
  - `npx eslint src/lib/store.ts src/lib/storage.ts src/lib/store.test.ts src/lib/storage.test.ts src/App.tsx`: exit 0
- M4 ordering contract: PRESENT and PASSING (locks `setActiveStorageUserId BEFORE renameStorageNamespace`).
- No edits to STATE.md, ROADMAP.md, or 05-UAT.md (per orchestrator note in plan).

## TDD Gate Compliance

Both tasks followed RED → GREEN. Git log shows the `test(...)` commit precedes the `feat(...)` commit for each:
- Task 1: `727c139` (test) → `37d242a` (feat)
- Task 2: `acbe5ba` (test) → `9fda29f` (feat)

No REFACTOR phase was needed for either task — the GREEN implementations are minimal and direct.

---

*Phase: 05-patient-cloud-sync-slice-1-auth-injections*
*Plan: 05*
*Completed: 2026-05-12*
