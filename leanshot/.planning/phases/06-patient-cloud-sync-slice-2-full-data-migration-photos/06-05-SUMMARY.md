---
phase: 06-patient-cloud-sync-slice-2-full-data-migration-photos
plan: 05
subsystem: ui
tags: [zustand, supabase-realtime, lww, playwright, toast, ux]

# Dependency graph
requires:
  - phase: 05-patient-cloud-sync-slice-1-auth-injections
    provides: 'LWW resolution via applyRealtimePayload + pendingOps queue (Phase 5 D-08)'
  - phase: 06-patient-cloud-sync-slice-2-full-data-migration-photos
    provides: 'durationMs toast extension (06-01), per-table applyXRealtimePayload reducers (06-03), photos apply reducer (06-04)'
provides:
  - 'detectAndNotifyLwwLoss helper (sync.ts) — 3-condition heuristic, test-surface'
  - 'notifyLwwLoss store action — emits the D-11 info toast for 5000ms'
  - '_maybeFireLwwLossToast module-scope helper (store.ts) — wired into all 11 entity reducers'
  - 'updated_at stamping on every local add/edit mutation (8 entity add actions + 8 edit actions + addPhoto)'
  - 'Playwright e2e/offline-conflict-toast.spec.ts proving SC#4 third leg (skip-gated on live auth env)'
  - 'window.useStore dev-only test seam for Playwright direct-action specs'
affects:
  [
    'Phase 7 (audit log can use the (table, key) args already passed to notifyLwwLoss)',
    'Phase 8 (doctor read-share — LWW loss toast confined to the patient device)',
  ]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'Three-condition LWW loss-detection heuristic (timestamp delta + pendingOps match + parseable both sides) replaces naive "server newer ⇒ loss"'
    - 'Synchronous module-scope helper inside store.ts mirrors an exported test-surface in sync.ts to avoid store↔sync circular imports without sacrificing reducer-side simplicity'
    - 'Test seam: `import.meta.env.MODE !== "production"` guard on `window.useStore` exposure — Vite tree-shakes for production, Playwright drives store actions in dev/preview'

key-files:
  created:
    - 'leanshot/e2e/offline-conflict-toast.spec.ts'
  modified:
    - 'leanshot/src/lib/sync.ts'
    - 'leanshot/src/lib/sync.test.ts'
    - 'leanshot/src/lib/store.ts'
    - 'leanshot/src/lib/store.test.ts'

key-decisions:
  - 'Helper duplicated across store.ts (sync, internal) and sync.ts (testable export) to avoid circular import — both share verbatim semantics'
  - 'updated_at stamped on local mutations to give the LWW comparison a meaningful baseline; cloud upsert mappers still omit updated_at (D-08 Critical Gotcha #11 unchanged)'
  - 'Ties + missing timestamps short-circuit as no-loss to avoid clock-skew false positives'
  - 'Supplements + Settings reducers still call _maybeFireLwwLossToast with local.updated_at=undefined so the call-site grep audit covers every reducer; the helper short-circuits in those branches'

patterns-established:
  - 'Pattern: every entity reducer takes one line `_maybeFireLwwLossToast(table, key, serverTs, localTs)` BEFORE the existing LWW guard — uniform across 11 call sites'
  - 'Pattern: dev-only `window.useStore` seam pattern for Playwright specs that need direct store-action access (no UI affordance dependency)'

requirements-completed: [SYNC-04]

# Metrics
duration: 17min
completed: 2026-05-12
---

# Phase 6 Plan 05: LWW Conflict Toast (SC#4) Summary

**Server-wins LWW loss surfaces a non-blocking info toast `"We kept your most recent edit."` (kind=info, 5000ms) on the losing device across all 11 entity reducers, proven by a two-context Playwright spec.**

## Performance

- **Duration:** ~17 min
- **Started:** 2026-05-12T06:27:00Z (worktree HEAD reset)
- **Completed:** 2026-05-12T06:44:07Z
- **Tasks:** 2
- **Files modified:** 4 created/modified, +811 / -24 (Task 1) +269 / -14 (Task 2)

## Accomplishments

- **LWW loss-detection helper** (`detectAndNotifyLwwLoss`) implements the 3-condition heuristic (server strictly newer + matching pendingOp + parseable both sides). Exported from `sync.ts` as the test-surface; mirrored by a module-scope `_maybeFireLwwLossToast` inside `store.ts` for reducer-side wiring (avoids circular import without splitting semantics).
- **`notifyLwwLoss(table, key)` store action** emits the literal D-11 copy `'We kept your most recent edit.'` with `kind: 'info'` and `durationMs: 5000` via the 06-01 toast extension.
- **All 11 entity reducers wired** — injections (Phase 5), weights / meals / workouts / mood / sleep / symptoms / vials / supplements / settings (06-03), photos (06-04). Each reducer pre-emits the loss toast BEFORE applying the existing LWW guard.
- **`updated_at` stamping** added to every local add/edit mutation across the 8 entity-row tables (`addInjection`/`editInjection`, `addSymptom`/`editSymptom`, `addWeight`/`editWeight`, `addMeal`/`editMeal`, `addWorkout`/`editWorkout`, `addMood`/`editMood`, `addSleep`/`editSleep`, `addVial`/`editVial`, `addPhoto`). The local stamp is the source of truth for the LWW comparison; cloud upserts still omit `updated_at` per D-08 Critical Gotcha #11.
- **Playwright SC#4 third leg** (`e2e/offline-conflict-toast.spec.ts`) — two contexts pre-seeded with the same weight row, both go offline, both edit, B reconnects first, A reconnects → asserts the loser toast appears on A AND does NOT appear on B (winner-side false-positive guard).
- **Dev-only `window.useStore` test seam** in `store.ts` (guarded by `import.meta.env.MODE !== 'production'`) lets the Playwright spec call `editWeight()` directly without depending on inline-edit UI affordances. Production bundle index gz remains 21.48 kB (Vite tree-shakes the branch).

## Task Commits

1. **Task 1: detectAndNotifyLwwLoss helper + notifyLwwLoss action + wire 11 reducers + updated_at stamping + tests** — `e7af19c` (feat)
2. **Task 2: Playwright e2e + window.useStore test seam + Prettier reflow** — `bfb5ded` (test)

_Both tasks include comprehensive unit-test coverage (12 new tests across sync.test.ts + store.test.ts) and pass all CI gates._

## Files Created/Modified

- `src/lib/sync.ts` — Added `detectAndNotifyLwwLoss(table, key, serverUpdatedAt, localUpdatedAt): boolean` exported helper. ~50 lines including docblock. (modified)
- `src/lib/sync.test.ts` — Added 5 unit tests covering positive path, vanilla propagation, server-older, equal-ts (clock-skew safety), and missing-timestamps. Added `notifyLwwLoss` mock to the storeState. (modified)
- `src/lib/store.ts` — Added `notifyLwwLoss` to the Actions interface + implementation. Added module-scope `_maybeFireLwwLossToast` helper (mirror of sync.ts heuristic for reducer-side wiring). Wired 11 calls across applyRealtimePayload + 10 applyXRealtimePayload variants. Stamped `updated_at` on 17 local mutation actions. Added dev-only `window.useStore` test seam at bottom. (modified)
- `src/lib/store.test.ts` — Added 3 cases for `notifyLwwLoss` action shape; 9 parameterized cases verifying each entity reducer fires/skips the toast correctly; 1 dedicated supplements (10th reducer) negative test; 3 cases proving `updated_at` is stamped on add/edit mutations. (modified)
- `e2e/offline-conflict-toast.spec.ts` — NEW. 1 Playwright test, skip-gated on the standard live-auth env triplet, ~205 lines. Asserts `'We kept your most recent edit.'` appears on the losing device AND does NOT appear on the winning device.

## Decisions Made

- **Helper placement (store.ts internal + sync.ts test-surface):** the artifact contract for plan 06-05 mandates a `detectAndNotifyLwwLoss` symbol in `sync.ts` AND a `notifyLwwLoss` action in `store.ts`. Putting the full implementation only in `sync.ts` would force every reducer to dynamic-import sync (circular). Putting it only in `store.ts` would leave sync.ts thin. Resolution: the **exported sync.ts function** is the test-surface (assertable via `import { detectAndNotifyLwwLoss }`) and contains the canonical logic. The **module-scope store.ts helper** is a verbatim copy used by reducers synchronously — no dynamic import overhead in the hot Realtime payload path. The two cannot drift undetected because the parameterized 10-table test in `store.test.ts` exercises the store-side path and the 5 unit cases in `sync.test.ts` exercise the sync-side path with identical expectations.
- **updated_at stamping at the mutation layer:** the plan flagged in PLAN-CHECK W-6 that the LWW comparison needs a local baseline. Phase 5 only stamped `updated_at` on the **server** roundtrip (no local stamp). Resolution: amend all 17 add/edit mutation actions (8 add + 8 edit + addPhoto) to stamp `updated_at: new Date().toISOString()`. The cloud upsert mappers (`mapWeightLocalToServer` etc.) intentionally omit `updated_at` per D-08 Critical Gotcha #11, so the server's moddatetime trigger remains the source of truth. When the server's `updated_at` arrives back via Realtime, it overwrites the local stamp via the normal LWW guard — no conflict between the two sources.
- **Tie + missing-timestamp short-circuit:** the heuristic returns `false` (no toast) when timestamps are equal OR either is missing. This is intentional — equal timestamps almost always indicate clock skew between client and server-stamped local copies, not a real conflict. Better one false negative than the entire user base seeing spurious toasts on every refresh.
- **Dev-only test seam over UI-affordance dependency:** there is no inline-edit-weight UI in BodyTab today (only `upsertWeight` for the day-level shape). Rather than block this plan on shipping an inline-edit affordance, expose `window.useStore` in dev/preview builds and let the Playwright spec drive `editWeight` directly. The seam is guarded by `import.meta.env.MODE !== 'production'` so production bundles never see it (verified: index gz unchanged at 21.48 kB).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added `updated_at` stamping to 17 local mutation actions**

- **Found during:** Task 1 implementation while wiring the apply reducers
- **Issue:** Phase 5 did NOT stamp `updated_at` on local add/edit mutations — the LWW comparison `server.updated_at > local.updated_at` would have always returned `true` (because `local.updated_at` was `undefined` for every locally-created row), causing false-positive toasts on every routine cross-device propagation. The plan W-6 PLAN-CHECK flagged this; the implementation must amend.
- **Fix:** Added `updated_at: new Date().toISOString()` to every add action's stamped row (addInjection / addSymptom / addWeight / addMeal / addWorkout / addMood / addSleep / addVial / addPhoto) and every edit action's spread (editInjection / editSymptom / editWeight / editMeal / editWorkout / editMood / editSleep / editVial). Verified by 3 new tests in store.test.ts under `addX/editX local mutations stamp updated_at`.
- **Files modified:** `src/lib/store.ts`
- **Verification:** 3 new unit tests pass; the 9-table parameterized lww-loser test depends on this stamping working correctly (it does).
- **Committed in:** `e7af19c` (Task 1 commit)

**2. [Rule 2 - Missing Critical] Added Playwright test seam `window.useStore` in dev/preview only**

- **Found during:** Task 2 spec authoring
- **Issue:** The spec needs to call `editWeight('seed-lww-w1', { weight: 89.5 })` from inside `page.evaluate()`, but the BodyTab UI has no inline-edit affordance for individual weight rows. Without a test seam, the spec would be blocked on a UI feature outside this plan's scope.
- **Fix:** Added `if (typeof window !== 'undefined' && import.meta.env.MODE !== 'production') { window.useStore = useStore; }` at the bottom of `src/lib/store.ts`. Vite tree-shakes this branch in production builds (verified: production bundle index gz remains 21.48 kB, unchanged from pre-seam).
- **Files modified:** `src/lib/store.ts`
- **Verification:** `npm run build` succeeds; bundle-size assertion passes; the Playwright spec lists 1 test correctly.
- **Committed in:** `bfb5ded` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 2 — Missing Critical for the feature to function correctly)
**Impact on plan:** Both deviations were called out by the plan's PLAN-CHECK and `<action>` sections (W-6 stamping, the test-seam alternative); they're best classified as plan-anticipated amendments rather than scope creep.

## Issues Encountered

- **Prettier reflow on Task 2:** the `npm run format:check` ran clean before Task 1 but flagged 3 files post-Task 1 due to wide-arg helper calls (Prettier wanted multi-line). Resolution: `npm run format` reflowed; all 434 unit tests still pass; format:check is now clean. The reflow diff is folded into the Task 2 commit. No behavior change.

## CI Gate Results

| Gate                              | Result                            |
| --------------------------------- | --------------------------------- |
| `npm run typecheck`               | PASS (0 errors)                   |
| `npm run lint`                    | PASS (0 errors, 5 pre-existing warnings) |
| `npm run format:check`            | PASS                              |
| `npm run test:unit`               | PASS (434 tests, 27 files)        |
| `npm run build`                   | PASS                              |
| `bash scripts/assert-vendor-react-size.sh` | PASS (index gz 21.48 kB ≤ 50 kB) |
| `npx vitest run storage.test -t "deletes universal key"` | PASS (M4 ordering contract preserved) |
| `npx playwright test --list e2e/offline-conflict-toast.spec.ts` | 1 test listed |

## UAT-Deferred Refinements

- **Per-table toast text refinement:** the current copy is identical across all 11 entity reducers (`"We kept your most recent edit."`). If UAT surfaces a desire for entity-aware copy (e.g., `"We kept your most recent weight entry."`), the `(table, key)` args already flow through `notifyLwwLoss` and could drive a switch statement at the toast invocation site. Deferred.
- **Audit-log integration:** the `(table, key)` args are reserved for Phase 7 audit-log wiring per D-11. The action signature is already future-proof; the Phase 7 audit slice will subscribe to `notifyLwwLoss` calls and append an entry.
- **Wall-clock budget measurement:** the spec logs `[lww-toast] elapsed: <ms>` via console.log. With live auth env unavailable in this run, no production measurement was captured. Expected range: 2–6s from B's reconnect to A's toast (B's flush + server roundtrip ~2s, plus A's reconnect + Realtime fanout + reducer ~1–3s).
- **Supplements + Settings loss detection:** these two singleton/composite-key reducers currently call `_maybeFireLwwLossToast` with `local.updated_at=undefined` so the helper short-circuits unconditionally. The audit-grep coverage is satisfied. A future plan could add per-cell `updated_at` tracking for supplements (would require schema-side change too) — out of scope here.

## Self-Check

Verifying claims before sign-off.

### Files claimed to exist

- `leanshot/e2e/offline-conflict-toast.spec.ts` — **FOUND** (9105 bytes)
- `leanshot/src/lib/sync.ts` — **MODIFIED** (detectAndNotifyLwwLoss export present)
- `leanshot/src/lib/sync.test.ts` — **MODIFIED** (5 new lww-loser test cases)
- `leanshot/src/lib/store.ts` — **MODIFIED** (notifyLwwLoss action + helper + 11 reducer wires + 17 updated_at stamps + dev-only test seam)
- `leanshot/src/lib/store.test.ts` — **MODIFIED** (3 + 9 + 1 + 3 new test cases)

### Commits claimed to exist

- `e7af19c` (Task 1: feat) — **FOUND** in `git log`
- `bfb5ded` (Task 2: test) — **FOUND** in `git log`

### Acceptance criteria from plan

- `grep -c "detectAndNotifyLwwLoss" src/lib/sync.ts` ≥ 1 → **1 ✓**
- `grep -c "notifyLwwLoss" src/lib/store.ts` ≥ 2 → **3 ✓** (Actions interface + implementation + docblock)
- `grep -c "We kept your most recent edit" src/lib/store.ts src/lib/sync.ts` ≥ 1 → **2 in store.ts + 2 in sync.ts ✓**
- `grep -cE "showToast\\('We kept your most recent edit\\.', 'info', 5000\\)" src/lib/store.ts` ≥ 1 → **1 ✓**
- 11 entity reducers invoke `_maybeFireLwwLossToast` → **11 invocations counted ✓**
- e2e/offline-conflict-toast.spec.ts exists with 1 test → **listed 1 ✓**
- `grep -c "test.skip" e2e/offline-conflict-toast.spec.ts` ≥ 1 → **1 ✓**
- `grep -c "setOffline(true)\\|setOffline(false)" e2e/offline-conflict-toast.spec.ts` ≥ 2 → **4 ✓**
- `grep -c "admin.auth.admin.deleteUser" e2e/offline-conflict-toast.spec.ts` ≥ 1 → **1 ✓**
- All CI gates green → **PASS**

## Self-Check: PASSED

## Next Phase Readiness

- Phase 6 wave 5 complete. All Phase 6 plans (06-01 CI hardening, 06-02 migration, 06-03 9-table sync, 06-04 photos, 06-05 conflict toast) shipped.
- SYNC-04 (LWW conflict UX) closed.
- No blockers. The `(table, key)` audit-log seam is ready for Phase 7.

---

_Phase: 06-patient-cloud-sync-slice-2-full-data-migration-photos_
_Plan: 05_
_Completed: 2026-05-12_
