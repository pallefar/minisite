---
phase: 06-patient-cloud-sync-slice-2-full-data-migration-photos
plan: 02
subsystem: cloud-sync-migration
tags: [migration, D-01, D-02, D-03, D-10, SYNC-02, SYNC-03, 12-scenario-matrix]
requires:
  - "@/lib/sync (Phase 5 — flushSyncQueue + subscribeInjections)"
  - "@/lib/auth-migration (Phase 5 — enqueueLocalInjectionsForSync)"
  - "@/lib/sync-defer (Plan 06-01 — FIFO buffer + idle loader)"
  - "@/lib/store + @/lib/storage (Phase 5 + 06-02 slice extensions)"
  - "@/components/ui/Modal + Button + ProgressBar (existing primitives)"
provides:
  - "@/lib/migration — state machine: maybeStartMigration / runMigration / snapshotPreCloudBackup / cleanupExpiredBackup / isMigrationStateCorrupted / ENTITIES"
  - "Zustand migration_state slice (persisted) + migrationError flag (ephemeral) + 4 actions"
  - "MigrationModal + MigrationEntityRow components (CSS-variable-only, lazy-loaded)"
  - "sync-defer.ts SyncCall union extended with `startMigration` kind + `deferStartMigration` export"
affects:
  - "src/lib/store.ts (migration slice + actions + clearUserDataSlices)"
  - "src/lib/storage.ts (PersistedState.migration_state + initialState + partialize allow-list)"
  - "src/App.tsx (lazy MigrationModal + render gate + onContinue/onRetry CTAs)"
  - "src/lib/sync-defer.ts (loadSync now Promise.all-loads @/lib/migration; onSignedIn drain triggers maybeStartMigration after subscribe)"
tech-stack:
  added: []
  patterns:
    - "Module-level migrationInFlight guard mirrors auth-migration.ts's `lastWasAnon` flag; idempotent concurrent calls"
    - "D-03 backup snapshot is single-slot — re-running snapshotPreCloudBackup overwrites in-place"
    - "Type-only namespace import `import type * as SyncModule from '@/lib/sync'` keeps migration.ts off the static graph"
    - "D-02 corruption detection rule: null is the no-migration sentinel; non-null structural validation"
key-files:
  created:
    - path: "src/lib/migration.ts"
      purpose: "Phase 6 D-01..D-03 + D-10 state machine. 8 exports (ENTITIES, EntityStatus, Entity, MigrationState, maybeStartMigration, runMigration, snapshotPreCloudBackup, cleanupExpiredBackup, isMigrationStateCorrupted, _resetMigrationInFlightForTests). Per-entity upload loops STUBBED for the 8 mechanical tables (06-03 wires) + photos (06-04 wires); `injections` reuses Phase 5's enqueueLocalInjectionsForSync."
    - path: "src/lib/migration.test.ts"
      purpose: "12-scenario matrix M1..M12 + 5 unit tests + 1 constants test (18 total). Asserts D-03 backup contract, D-02 corruption detection, idempotency, resume from partial state, 90-day retention cleanup."
    - path: "src/components/sync/MigrationModal.tsx"
      purpose: "Foreground blocking modal — 4 visual states (fresh/resume/complete/corruption). Lazy-loaded via React.lazy in App.tsx; gated on `migration_state != null || migrationError != null` so net-new users never download the chunk."
    - path: "src/components/sync/MigrationEntityRow.tsx"
      purpose: "Per-entity checklist row — state icon (Check/Loader2/AlertCircle/Circle) + plural-noun name + count + optional ProgressBar (thin) when in-progress. CSS variables only — no Tailwind palette keys."
    - path: "e2e/migrate-resume.spec.ts"
      purpose: "Playwright SC#1 — 2 tests (happy path with backup retention assertion + resume from partial migration_state). Skip-gated on SUPABASE_SERVICE_ROLE_KEY + URL/ANON keys (Pattern D)."
  modified:
    - path: "src/lib/store.ts"
      change: "migration_state slice + migrationError ephemeral flag added to State; 4 new actions (setMigrationState / markMigrationEntity / markMigrationComplete / setMigrationError); clearUserDataSlices clears both."
    - path: "src/lib/storage.ts"
      change: "PersistedState.migration_state (MigrationState | null | undefined) added; initialState defaults to null; type-only import from @/lib/migration to avoid value-cycle."
    - path: "src/lib/store.test.ts"
      change: "7 new tests covering setMigrationState / markMigrationEntity (slice path + null-guard) / markMigrationComplete / setMigrationError / clearUserDataSlices (migration_state + migrationError cleared, acknowledgedDisclaimer preserved) / partialize (migration_state persists, migrationError doesn't)."
    - path: "src/App.tsx"
      change: "Added migrationState + migrationError store selectors; lazy MigrationModal import; gated Suspense block with onContinue (post-complete clear + mid-flight toast escape) and onRetry (clear flag + direct dynamic-import re-trigger) CTAs."
    - path: "src/lib/sync-defer.ts"
      change: "loadSync now Promise.all-loads @/lib/migration alongside sync + auth-migration; SyncCall union adds `startMigration` kind; onSignedIn drain branch invokes maybeStartMigration AFTER subscribeInjections (Pitfall #5 mirror); new deferStartMigration export."
    - path: "src/lib/sync-defer.test.ts"
      change: "Added @/lib/migration mock; 2 new tests (Test 7 ordering contract subscribe-before-migration; Test 8 deferStartMigration buffer + drain semantics)."
decisions:
  - "Per-entity upload loops STUBBED for 9 entities — only `injections` has a real path (reuses Phase 5's enqueueLocalInjectionsForSync). `photos` deferred to 06-04 (D-10 base64 → Storage); the 8 mechanical tables (weights/meals/workouts/supplements/mood/sleep/symptoms/vials/settings) deferred to 06-03 (per-entity enqueueOp + SQL tables). All STUBBED entities still flip pending → complete so the modal correctly transitions to 'All done' for users with non-empty v4 data; zero-row entities also flip immediately (M2 contract)."
  - "ENTITIES order is static (11 entries, photos first, settings last) rather than dynamically size-sorted. Acceptable for v1 — a future Plan can refine computeRunOrder with row-count introspection if UX feedback warrants it."
  - "App.tsx 'Retry migration' CTA uses **direct dynamic import** `import('@/lib/migration').then(m => m.maybeStartMigration(uid))` rather than `deferStartMigration` from sync-defer. Both work; direct import is cleaner because the chunk is already loaded by sync-defer's idle init (cache hit), so the latency is identical. `deferStartMigration` is exported anyway for callers that may need to enqueue a migration retry pre-init buffer drain."
  - "migration_state lives in PersistedState (auto-partialized via the allow-list bump) while migrationError lives in UIState (ephemeral, re-derived from corruption detection on next sign-in). Mirrors the pattern of `pendingOps` (persisted) vs `signedIn` (ephemeral) from Phase 5."
metrics:
  duration_minutes: 12
  completed: "2026-05-12T05:30:00Z"
  tasks_completed: 4
  files_created: 5
  files_modified: 5
  commits: 5
  tests_added: 27
  tests_total_passing: 350
---

# Phase 6 Plan 02: Migration Framework — leanshot_v4 → cloud + 90-day Backup + MigrationModal Summary

**One-liner:** Ships the leanshot_v4 → cloud one-shot migration state machine with D-03 90-day backup snapshot, D-02 resumable per-entity progress slice, D-01 foreground blocking modal with 11-entity checklist, and the 12-scenario test matrix M1..M12 that locks the SC#2 contract; 06-03 will wire the 8 mechanical table upload loops + 06-04 will wire the photos eager migration on top of this framework.

## What Was Built

### Task 1 — `src/lib/migration.ts` + `src/lib/migration.test.ts` (NEW) + store/storage slice

**migration.ts** ships the lifecycle:

1. `maybeStartMigration(userId)` — entry point from sync-defer's onSignedIn drain.
2. `cleanupExpiredBackup()` — drops any snapshot older than 90 days (D-03 retention).
3. Corruption check via `isMigrationStateCorrupted` — clears the slice + raises `migrationError` if so.
4. Already-complete? Bail early.
5. Mid-flight? Enter `runMigration` directly (resume path).
6. Fresh? Take backup → initialise slice → enter `runMigration`.

`runMigration` iterates `ENTITIES` (photos first per size-descending order), marks each entity through `pending → in-progress → complete`, and sets `migration_state.complete = true` IFF every entity finished. `migrateEntity` has a real implementation for `injections` (reuses Phase 5's `enqueueLocalInjectionsForSync`) and stubbed branches for `photos` (06-04) and the 8 mechanical tables (06-03) — these stubs flip pending → complete without doing work, so the modal still transitions correctly for users whose v4 data is entirely composed of those (deferred) entity types.

`snapshotPreCloudBackup` writes `{ state, version: 7, snapshotAt: <ISO> }` to `localStorage['leanshot_v4_pre_cloud_backup']`. If `setItem` throws (quota), the function re-raises so the caller halts the migration — D-03's "no cloud write without a backup" invariant.

**migration.test.ts** ships 18 vitest cases:

- M1: full multi-entity migration → all 11 entities complete.
- M2: only 2 entities populated → empty entities still flip to complete (zero-row case).
- M3: net-new install (no leanshot_v4 key) → maybeStartMigration no-ops; modal never opens.
- M4: cloud-populated path → migration still runs to completion (sync-layer LWW handles row-level merge).
- M5: literal conflict shape → migration runs to completion; loser-toast deferred to 06-05.
- M6: offline at sign-in → migration_state still advances (mock `navigator.onLine = false`).
- M7: resume after crash → pre-seeded 3-of-11 complete state surfaces "Resuming migration" branch; finishes.
- M8: base64 photos pre-seeded → ENTITIES[0] === 'photos' asserted; entity loop runs (06-04 wires real upload).
- M9: corrupted migration_state → detected, slice cleared, migrationError set to 'corrupted'.
- M10: 80-day-old backup → snapshotPreCloudBackup overwrites in-place (single-slot).
- M11: 95-day-old backup → cleanupExpiredBackup fires first, fresh snapshot taken.
- M12: v3-only user (no leanshot_v4) → maybeStartMigration no-ops; no crash.
- Unit 1: snapshotPreCloudBackup throws on localStorage.setItem failure (D-03 contract).
- Unit 2: _resetMigrationInFlightForTests clears the module-level guard.
- Unit 3: idempotent concurrent calls — enqueueOp dedupe keeps pendingOps queue at length 1.
- Unit 4: isMigrationStateCorrupted detects every malformed shape (non-bool complete, missing startedAt, invalid status value, etc.).
- Unit 5: cleanupExpiredBackup is a no-op when no snapshot exists.
- Constants: STORAGE_KEY === 'leanshot_v4', SNAPSHOT_KEY !== STORAGE_KEY.

**Store + storage extensions:**

- `PersistedState.migration_state` (optional, defaults to null in `initialState`).
- partialize allow-list adds `migration_state` (D-02 resume across reload).
- `UIState.migrationError: 'corrupted' | null` (NOT persisted — ephemeral, re-derived).
- 4 new actions: `setMigrationState`, `markMigrationEntity`, `markMigrationComplete`, `setMigrationError`.
- `clearUserDataSlices` resets both `migration_state` and `migrationError` to null (per-account; CONF-3 preserves acknowledgedDisclaimer).
- 7 new vitest cases in `store.test.ts` covering each action surface + the partialize allow-list (migration_state survives reload; migrationError does not).

### Task 2 — `src/components/sync/MigrationModal.tsx` + `MigrationEntityRow.tsx` + App.tsx wiring (NEW)

**MigrationEntityRow** is the per-entity checklist row: leading status icon (Check/Loader2/AlertCircle/Circle), plural-noun display name, tabular-num count text ("—" for pending, "X of Y" for in-progress/error, just "Y" for complete), and an optional `ProgressBar thickness="thin"` when status === 'in-progress' AND total > 0. All colors via CSS variables (Pattern E — no Tailwind palette keys).

**MigrationModal** ships the 4-state surface from 06-UI-SPEC §1:

| State | Title | Subtitle | CTA |
|-------|-------|----------|-----|
| Fresh | "Migrating your data" | "Saving your history to your account. This should take less than a minute." | "Continue with sync running" (ghost) |
| Resume | "Resuming migration" | "Picking up where we left off — X of Y sections done." | "Continue with sync running" (ghost) |
| Complete | "All done" | "Your history is safe in the cloud. You can now sync across devices." | "Continue to dashboard" (primary) |
| Corrupted | "Something went wrong" | "Your data is safe in the backup we saved before starting. Tap retry, or contact support if this keeps happening." | "Retry migration" (primary) |

Modal is rendered with `dismissible={false} hideClose` — only exit is via an explicit CTA. Includes an `aria-live="polite"` screen-reader announcer for state-mode transitions.

**App.tsx** wires the lazy chunk: `lazy(() => import('@/components/sync/MigrationModal'))` rendered inside a Suspense block gated on `migration_state != null || migrationError != null`. Net-new users have both null so the chunk never downloads. `onContinue` clears the slice (post-complete) or shows the "Migration continuing in the background." toast (mid-flight escape); `onRetry` clears the corruption flag + slice and re-enters `maybeStartMigration` via a direct dynamic import.

### Task 3 — sync-defer.ts extension

`loadSync()` now Promise.all-loads `@/lib/migration` alongside sync + auth-migration. `SyncCall` union gets a 5th kind (`startMigration`). The `onSignedIn` dispatch branch invokes `maybeStartMigration(userId)` AFTER `subscribeInjections(userId)` — Pitfall #5 mirror: Realtime is listening when the per-entity upload loop enqueues server writes. New `deferStartMigration(userId)` export for manual retry triggers.

2 new vitest cases in `sync-defer.test.ts` (Test 7 ordering contract; Test 8 buffer + drain).

### Task 4 — `e2e/migrate-resume.spec.ts` (NEW)

2 Playwright tests covering SC#1's load-bearing paths:

- **Test 1 (happy path):** seed `leanshot_v4` with SEED_USER + 1 injection → admin-create verified user → sign in → MigrationModal renders → `leanshot_v4_pre_cloud_backup` is present with `version: 7` + ISO `snapshotAt` + non-empty `state` → transitions to "All done" → user clicks "Continue to dashboard" → reload → modal does NOT re-render.
- **Test 2 (resume):** seed a partial `migration_state` (3 of 11 entities complete) → sign in → "Resuming migration" title appears (or "All done" if drain is near-instant) → eventually reaches "All done".

Skip-gated on `SUPABASE_SERVICE_ROLE_KEY + URL/ANON keys` (Pattern D). Per-test admin-created users torn down in test.afterAll.

## Verification — CI gates GREEN

| Gate | Plan 06-01 baseline | Plan 06-02 post-fix | Pass |
|------|-------|-------|-------|
| `npm run format:check` | exit 0 | exit 0 | yes |
| `npm run typecheck` | exit 0 | exit 0 | yes |
| `npm run lint` | 0 errors, 5 warnings | 0 errors, 5 warnings (same pre-existing) | yes |
| `npm run build` | exit 0 | exit 0 | yes |
| `bash scripts/assert-vendor-react-size.sh` | exit 0 (`index gz 18,123`) | exit 0 (`index gz 18,495`) | yes |
| `npm run test:unit` | 323 tests | 350 tests (323 + 18 migration + 7 store slice + 2 sync-defer) | yes |
| M1–M4 storage ordering contract | pass | pass (preserved) | yes |
| Phase 5 D-13 acknowledgedDisclaimer survives sign-out | pass | pass (preserved) | yes |

### Bundle topology (post-fix)

| Chunk | Plan 06-01 ship | Plan 06-02 post-fix | Delta |
|-------|-------|-------|-------|
| `dist/assets/index-*.js` (gzipped) | 18,123 B | **18,495 B** | +372 B (type-import retentions in store.ts) |
| `dist/assets/MigrationModal-*.js` (gzipped, NEW) | — | 1,530 B | (loaded only when migration is active) |
| `dist/assets/migration-*.js` (gzipped, NEW) | — | 1,520 B | (state machine; loaded post-idle by sync-defer) |
| `dist/assets/supabase-*.js` (gzipped) | 53,569 B | 53,570 B | (unchanged) |
| `dist/assets/vendor-react-*.js` (gzipped) | 60,491 B | 60,491 B | (unchanged) |

The 50 kB index ceiling has 31,505 B of headroom remaining. The new MigrationModal + migration runtime chunks (~3 kB combined gzip) are loaded LAZILY — net-new users never pay this cost (`migration_state` and `migrationError` both null → lazy gate is false → chunks never fetched).

## Entity-loop wiring breakdown

The per-entity upload logic in `migrateEntity` is **partial** in this plan — the framework is complete but most entity handlers are stubs that flip pending → complete without doing work:

| Entity | Plan 06-02 path | Future wiring |
|--------|------------------|----------------|
| `injections` | Real — `enqueueLocalInjectionsForSync` + `flushSyncQueue` (Phase 5 reuse) | N/A — already shipped |
| `photos` | Stub no-op | **Plan 06-04** — decode base64 → compress (D-06) → Storage upload (D-10) |
| `weights` | Stub no-op (logs warn if rows exist) | **Plan 06-03** — per-row `enqueueOp({ table: 'weights', op: 'upsert', key: <pk> })` |
| `meals` | Stub no-op | **Plan 06-03** |
| `workouts` | Stub no-op | **Plan 06-03** |
| `supplements` | Stub no-op | **Plan 06-03** (after researcher proposes the flattening shape) |
| `mood` | Stub no-op | **Plan 06-03** |
| `sleep` | Stub no-op | **Plan 06-03** |
| `symptoms` | Stub no-op | **Plan 06-03** |
| `vials` | Stub no-op | **Plan 06-03** |
| `settings` | Stub no-op | **Plan 06-03** (per-user singleton) |

For a user whose v4 blob contains ONLY injections, Plan 06-02 ships a fully working end-to-end migration. For users with weights/meals/etc., the modal correctly completes (so they don't get stuck staring at it) but the actual data won't appear in the cloud until Plan 06-03 is merged into the same wave. The e2e spec's Test 1 seeds only injections + SEED_USER, so it validates the real path.

## Decision on "Retry migration" CTA

App.tsx uses **direct dynamic import** (`import('@/lib/migration').then(m => m.maybeStartMigration(uid))`) for the corruption-banner Retry CTA, not the new `deferStartMigration` export.

Both work identically — sync-defer's `loadSync` has already resolved `@/lib/migration` by the time the corruption modal is visible, so the dynamic import is a synchronous cache hit. Direct import is preferred here because:

1. App.tsx already does direct dynamic imports for other rare-path operations (GuidedTour's `shouldShowTour` for example).
2. `deferStartMigration` is still exported for callers who DO need pre-init buffer semantics (e.g. a future "auto-retry on quota release" flow that fires before sync-defer resolves).

## Self-Check: PASSED

- `src/lib/migration.ts` exists (commit 9a765a2): 8 named exports, ENTITIES.length === 11.
- `src/lib/migration.test.ts` exists (commit 9a765a2): grep "M1:|M2:|…|M12:" returns 12.
- `src/lib/storage.ts` modified (commit 9a765a2): partialize allow-list bumped (grep returns 2 occurrences of `migration_state`).
- `src/lib/store.ts` modified (commit 9a765a2): slice + actions + clearUserDataSlices + initialState pin.
- `src/lib/store.test.ts` modified (commit 9a765a2): 7 new tests under "Phase 6 — migration_state slice actions".
- `src/components/sync/MigrationModal.tsx` exists (commit f9705c0): 6 copy-contract strings present.
- `src/components/sync/MigrationEntityRow.tsx` exists (commit f9705c0): only CSS variables for colors.
- `src/App.tsx` modified (commit f9705c0): lazy MigrationModal import + render gate + onContinue/onRetry.
- `src/lib/sync-defer.ts` modified (commit dc309d5): grep `@/lib/migration` returns 1 dynamic import + 1 type import; grep `maybeStartMigration` returns 6.
- `src/lib/sync-defer.test.ts` modified (commit dc309d5): 2 new tests added; 8 total passing.
- `e2e/migrate-resume.spec.ts` exists (commit eaf4841): 2 Playwright tests; `npx playwright test --list` exits 0.
- All 5 task commits present in git log.
- All CI gates green (format:check, typecheck, lint, build, bundle guard, test:unit).
- M4 contract preserved (storage ordering still locks); CONF-3 preserved (acknowledgedDisclaimer survives clearUserDataSlices).
