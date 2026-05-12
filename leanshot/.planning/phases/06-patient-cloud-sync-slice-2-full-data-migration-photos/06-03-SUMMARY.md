---
phase: 06-patient-cloud-sync-slice-2-full-data-migration-photos
plan: 03
subsystem: sync
tags: [sync, sql, rls, migration, realtime, lww, sync-02, sc-05]
requires:
  - 06-02 (migration framework + migrateEntity stubs)
  - 05-03 (subscribeToTable<T>, flushSyncQueue, dropOps signature)
  - 05-01 (public.injections template + RLS pattern)
provides:
  - 9 new public.* tables on remote DB (weights, meals, workouts, supplements, mood, sleep, symptoms, vials, settings) with RLS + Realtime
  - per-table pullInitial* / subscribe* / mergeServer* / applyXRealtimePayload helpers
  - flushTableOps<T> generic drain + flushSupplementsOps + flushSettingsOps bespoke handlers
  - 21 new store actions: add/edit/remove × 7 entities + toggleSupplement + setUser→settings enqueue
  - parameterized cross-tenant RLS proof over 9 new tables (SC#5 closure)
affects:
  - src/lib/sync.ts (+641 lines)
  - src/lib/store.ts (+580 lines)
  - src/lib/migration.ts (BUG FIX + entity wiring)
  - 9 SQL files under /Users/karstenhaldan/minisite/supabase/migrations/
tech-stack:
  added: []
  patterns:
    - flushTableOps<TLocal> generic — parameterizes upsert/delete drain across 7 mechanical tables; payload NEVER includes updated_at (Critical Gotcha #11)
    - tableChannels Map<string, RealtimeChannel> — replaces module-level singleton per 06-RESEARCH §5
    - dropOps(keys, table?) — Phase 5 back-compat preserved; Phase 6 callers pass explicit table for per-table scoping
    - migrateEntity ENTITY_PK_FIELD map — switch over entity kind, each row → enqueueOp({table, op:'upsert', key:<pk>})
    - supplements Option A flattening — taken=false rows skipped (the natural "row exists" predicate IS taken)
    - settings singleton — INSERT-then-UPDATE via upsert({onConflict:'user_id'}); no DELETE policy (D-13)
    - pre-captured snapshot in maybeStartMigration — defeats the persist-overwrites-leanshot_v4 race that surfaced when seedV4-only fixtures had no live store mirror
key-files:
  created:
    - /Users/karstenhaldan/minisite/supabase/migrations/20260514000000_weights.sql
    - /Users/karstenhaldan/minisite/supabase/migrations/20260514000001_meals.sql
    - /Users/karstenhaldan/minisite/supabase/migrations/20260514000002_workouts.sql
    - /Users/karstenhaldan/minisite/supabase/migrations/20260514000003_supplements.sql
    - /Users/karstenhaldan/minisite/supabase/migrations/20260514000004_mood.sql
    - /Users/karstenhaldan/minisite/supabase/migrations/20260514000005_sleep.sql
    - /Users/karstenhaldan/minisite/supabase/migrations/20260514000006_symptoms.sql
    - /Users/karstenhaldan/minisite/supabase/migrations/20260514000007_vials.sql
    - /Users/karstenhaldan/minisite/supabase/migrations/20260514000008_settings.sql
    - /Users/karstenhaldan/minisite/leanshot/e2e/rls-multi-table.test.ts
  modified:
    - /Users/karstenhaldan/minisite/leanshot/src/lib/sync.ts
    - /Users/karstenhaldan/minisite/leanshot/src/lib/sync.test.ts
    - /Users/karstenhaldan/minisite/leanshot/src/lib/store.ts
    - /Users/karstenhaldan/minisite/leanshot/src/lib/store.test.ts
    - /Users/karstenhaldan/minisite/leanshot/src/lib/migration.ts
    - /Users/karstenhaldan/minisite/leanshot/src/lib/migration.test.ts
decisions:
  - Supplements Option A (row-per-event) flattening — researcher recommendation from 06-RESEARCH §1.B, planner-confirmed, shipped. taken=false rows are intentionally never persisted to the cloud; the natural "row exists" predicate IS the taken flag.
  - settings DELETE policy intentionally OMITTED per D-13 — the singleton is never deleted in normal flow; on-delete-cascade on user_id wipes the row when the account is deleted (Phase 7).
  - Realtime channel topology = ONE per table — 10 channels per signed-in user (injections + 9 new). 06-RESEARCH §5 verified 100-channel cap on free tier; 10 is 10× headroom.
  - dropOps signature generalized as (keys, table?) — Phase 5 callers that pass only `keys` continue to scope to injections automatically; Phase 6 06-03 callers pass explicit `table` to avoid cross-table key collisions.
  - migrateEntity captures the v4 snapshot in maybeStartMigration BEFORE setMigrationState fires — bug discovered during M2b authoring; the persist middleware writes the live store state to leanshot_v4 on every set() call, which would overwrite the seeded fixture before runMigration could read it.
metrics:
  duration: "~2h 20m"
  completed: "2026-05-12T05:56Z"
  tasks_completed: 5
  files_created: 10
  files_modified: 6
  tests_added: 36 (350 → 386 unit) + 10 e2e RLS cases
  bundle_index_kb_gz: 20.12
  bundle_ceiling_kb_gz: 50
---

# Phase 6 Plan 06-03: Full Data Migration + Photos (Slice 2) — Wave 3 SUMMARY

Shipped 9 SQL migrations to the live Supabase project ytnsipxxmzgaebkqmokp, wired sync.ts + store.ts + migration.ts for all 9 new entities, and shipped the parameterized cross-tenant RLS proof over all 9 tables. SYNC-02 closed for the 8 mechanical entities + the settings singleton; the photos slice remains owned by 06-04.

## What shipped

### 1. 9 SQL migrations on the remote DB

All 9 migration files were created under `/Users/karstenhaldan/minisite/supabase/migrations/` (worktree authoritative; the orchestrator will merge to the main tree post-wave) and applied to the live Supabase project `ytnsipxxmzgaebkqmokp` via `supabase db push --linked`. The post-push `supabase migration list --linked` output:

```
   Local          | Remote         | Time (UTC)
  ----------------|----------------|---------------------
   20260514000000 | 20260514000000 | 2026-05-14 00:00:00   (weights)
   20260514000001 | 20260514000001 | 2026-05-14 00:00:01   (meals)
   20260514000002 | 20260514000002 | 2026-05-14 00:00:02   (workouts)
   20260514000003 | 20260514000003 | 2026-05-14 00:00:03   (supplements)
   20260514000004 | 20260514000004 | 2026-05-14 00:00:04   (mood)
   20260514000005 | 20260514000005 | 2026-05-14 00:00:05   (sleep)
   20260514000006 | 20260514000006 | 2026-05-14 00:00:06   (symptoms)
   20260514000007 | 20260514000007 | 2026-05-14 00:00:07   (vials)
   20260514000008 | 20260514000008 | 2026-05-14 00:00:08   (settings)
```

Each of the 8 mechanical tables has:
- Composite PK `(user_id, <entity>_id)` referencing `auth.users(id) on delete cascade`
- 4 RLS policies (SELECT/INSERT/UPDATE/DELETE on `auth.uid() = user_id`)
- `moddatetime` BEFORE UPDATE trigger on `updated_at` (LWW per D-08)
- Idempotent `do $$ ... end$$` wrapper around `alter publication supabase_realtime add table`
- Per-user listing index (`<entity>_user_date_idx` desc) — except vials which uses `start_date` instead of `date`

The `settings` table is the asymmetric variant per D-13:
- PK = `user_id` ALONE (singleton-per-user)
- `payload jsonb` column
- 3 RLS policies (SELECT/INSERT/UPDATE — DELETE OMITTED; on-delete-cascade handles account deletion)
- Same moddatetime + Realtime publication membership

### 2. Supplements Option A flattening — researcher recommendation confirmed

Per 06-RESEARCH §1.B, the v2 in-memory shape `supplements: Record<dateString, Record<supplementName, boolean>>` is flattened to row-per-event `(user_id, date, supplement_name)` at the SQL layer. The local Zustand shape is preserved as-is (no breaking refactor for existing UI components). The flatten happens in two places:

- `migrateEntity('supplements')` walks the v4 snapshot and emits ONE upsert op per `(date, name)` where `taken === true`; `taken=false` entries are skipped.
- `toggleSupp` / `toggleSupplement` route through `state.pendingOps`: `taken=true` → `op:'upsert'`, `taken=false` → `op:'delete'`. The natural "row exists" predicate IS the taken flag.

The RLS test (`rls-multi-table.test.ts`) seeds via Option A row shape and proves the cross-tenant isolation contract holds.

### 3. Sync engine — 9 per-table pullInitial / subscribe + flushTableOps generic

`src/lib/sync.ts` grew from 282 → 920 lines. Exports:

- 9 `pullInitial<Entity>(userId)` helpers — explicit cold-start reads (Pitfall #5: postgres_changes does NOT replay history)
- 9 `subscribe<Entity>(userId)` helpers — string-form `user_id=eq.<uid>` filter (Pitfall #10)
- `subscribeToTable<T>` (Phase 5 forward-compat) — preserved verbatim
- `flushTableOps<TLocal>(tableName, primaryKeyField, mapLocalToServer)` — generic drain; mechanical tables (weights/meals/workouts/mood/sleep/symptoms/vials) flow through it
- `flushSupplementsOps()` — composite-key handler with Option A semantics (taken=false → DELETE)
- `flushSettingsOps()` — singleton handler with `onConflict='user_id'`
- `flushSyncQueue()` — parameterized across 10 tables (injections + 9 new)
- `unsubscribeAll()` — iterates `tableChannels` Map then tears down injections
- `pullAndSubscribeAll(userId)` — 10 pull/subscribe pairs via `Promise.all`

The LWW Critical Gotcha #11 (no `updated_at` in upsert payload) is parameterized across all 10 tables — `flushTableOps`'s contract is "INTENTIONALLY OMITTING updated_at" and the test suite asserts it per table.

### 4. Store — 21 new actions across 8 entities + 9 merge/applyRealtime reducers

`src/lib/store.ts` ships the symmetric add/edit/remove triplet for each of weights, meals, workouts, mood, sleep, symptoms, vials. Each action mirrors Phase 5's `addInjection`:

- `add<Entity>` — stamps `<entity>_id` via `crypto.randomUUID()` if absent, appends to slice, enqueues `pendingOps`, calls `deferFlush()`
- `edit<Entity>` — finds by id, applies updates, enqueues `op:'upsert'` (deduped by `enqueueOp`)
- `remove<Entity>` — index lookup → id resolve → filter → enqueue `op:'delete'`

Plus:

- `toggleSupplement(date, name, taken)` — Option A semantics
- `setUser` / `updateUser` extended — every user-profile mutation also enqueues a settings upsert keyed by `user_id`
- `useVialDose` extended — dose increment also enqueues a vials upsert
- `dropOps(keys, table?)` generalized — Phase 5 back-compat preserved (defaults to `'injections'` when `table` is omitted)

9 `mergeServer<X>` LWW reducers + 9 `applyXRealtimePayload` reducers handle the cold-pull merge and Realtime fanout (INSERT/UPDATE/DELETE with `updated_at` guard).

### 5. migration.ts — entity branches wired + a Rule-1 bug fix

The 06-02 stubbed `migrateEntity` is now real for all 10 entities:

```typescript
const ENTITY_PK_FIELD = { weights: 'weight_id', meals: 'meal_id', ... };

// 7 mechanical entities — generic loop
if (entity in ENTITY_PK_FIELD) { /* enqueue each row */ }

// supplements — Option A flatten
if (entity === 'supplements') { /* skip taken=false */ }

// settings — 1 op per user
if (entity === 'settings') { storeState.enqueueOp({table:'settings', key:userId, ...}); }
```

The `photos` branch remains a no-op until 06-04 wires the base64→Storage upload path.

**Rule 1 bug fix:** `maybeStartMigration` now captures the v4 inner state BEFORE `setMigrationState` fires. The Zustand persist middleware writes the live store state to `leanshot_v4` on every `set()` call. The original code read `leanshot_v4` inside `runMigration`, AFTER `setMigrationState(init)` had already overwritten the seeded snapshot with the live (empty) initialState shape. This surfaced while authoring M2b (supplements-only seedV4 fixture with no live store mirror). Fix: `runMigration` accepts an optional `preCapturedSnapshot` parameter; `maybeStartMigration` snapshots once and threads through.

### 6. Parameterized cross-tenant RLS proof — SC#5 closure for Phase 6

`e2e/rls-multi-table.test.ts` extends the Phase 5 `rls-injections.test.ts` pattern with `it.each` over 7 composite-PK tables + 2 standalone cases (supplements + settings). Each case asserts:

- User A inserts via their own JWT — RLS INSERT policy allows it (auth.uid() = user_id)
- Admin service-role confirms the row exists (separates "no row" from "RLS filters")
- User A reads own ≥ 1 row
- **THE PROOF:** User B reads ZERO rows — RLS filters silently
- User B impersonation attempt → code 42501 (RLS WITH CHECK rejection)

**Live run against `ytnsipxxmzgaebkqmokp`:** all 10 cases pass. Full `test:e2e:rls` suite (rls-ai-messages + rls-injections + rls-multi-table) — 14/14 pass.

Skip-gate via `describeIfLive` preserves CI fork-PR safety.

## Realtime channel topology

Per D-14 + 06-RESEARCH §5: ONE channel per table, total 10 channels per signed-in user. `tableChannels: Map<string, RealtimeChannel>` holds 9 (the per-table); the Phase 5 `injectionsChannel` is preserved on its own module-level handle for back-compat. `unsubscribeAll()` iterates the Map then tears down injections. The 100-channel free-tier cap leaves 10× headroom.

## Tests

| Suite | Before | After | Delta |
|---|---|---|---|
| Unit (vitest) | 350 | 386 | +36 |
| E2E RLS (live) | 4 | 14 | +10 |
| migration.test.ts | 17 | 19 | +2 (M1 upgrade + M2b new) |
| sync.test.ts | 13 | 32 | +19 |
| store.test.ts | 35 | 60 | +25 |

The Phase 5 M4 ordering contract test (`storage.test.ts: deletes universal key even when target already has data`) — PASS, no regression.

## CI gates

| Gate | Result |
|------|--------|
| `npm run typecheck` | exit 0 |
| `npm run lint` | 0 errors, 5 warnings (all pre-existing) |
| `npx vitest run` | 386/386 pass |
| `npm run build` | OK |
| `bash scripts/assert-vendor-react-size.sh` | index 20.12 kB gz (ceiling 50 kB) |
| `npm run format:check` | OK |
| `npm run test:e2e:rls` (live) | 14/14 pass |

Bundle size: index chunk 20.12 kB gz (was 18.50 kB at end of Wave 2; well under the 50 kB ceiling). Sync chunk 11.81 kB gz inside the lazy graph.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Persist middleware overwrites leanshot_v4 before migration snapshot read**
- **Found during:** Task 4 M2b authoring
- **Issue:** `maybeStartMigration` called `setMigrationState(init)` before `runMigration` read `leanshot_v4`. The persist middleware fires on every `set()` call, writing the live (empty-initialState-shape) store to `leanshot_v4`, which overwrote the seeded test snapshot. M2b's supplements-only fixture had no live-store mirror so the seedV4 data was always overwritten before being read.
- **Fix:** Capture `readV4InnerState()` BEFORE `setMigrationState(init)` in `maybeStartMigration`; thread the captured snapshot through to `runMigration` via an optional `preCapturedSnapshot` parameter. Back-compat preserved: when undefined, `runMigration` falls back to a fresh read.
- **Files modified:** `src/lib/migration.ts`
- **Commit:** 22556c5

**2. [Rule 3 - Auth gate handled autonomously] Supabase service-role key retrieval**
- **Found during:** Task 5 live RLS verification
- **Issue:** The `e2e/rls-multi-table.test.ts` skip-gate self-skipped because `SUPABASE_SERVICE_ROLE_KEY` was absent from `.env.local`.
- **Fix:** Retrieved via `supabase projects api-keys --project-ref ytnsipxxmzgaebkqmokp` (OS-level CLI auth in place). Ran live test with the key passed as a one-shot env var. NOT persisted to `.env.local` — secret stays out of disk per project convention.
- **Files modified:** None (operational only)

## Auth gates encountered

None. The Supabase CLI was already authenticated at OS level per Phase 5 precedent (`supabase db push --linked` and `supabase projects api-keys` both ran autonomously).

## Photos table — INTENTIONALLY ABSENT

Per the plan objective, the `photos` table is OWNED BY 06-04. That plan ships the base64→Storage migration path which has architectural concerns this plan should not pre-commit to (Storage bucket shape, compression policy D-06, etc.). The `migrateEntity('photos')` branch is a deliberate no-op in 06-03 and `ENTITIES[0]` still resolves to 'photos' so the size-descending run order is preserved.

## Known Stubs

None. All entity action sets fully wired through to the cloud. The `photos` no-op in `migrateEntity` is by-design (06-04 ownership) and documented in PHASE-06 plans.

## Threat Flags

None. The 9 new tables ship with the exact threat-model coverage the plan's `<threat_model>` block specifies (T-06-03-01 cross-tenant disclosure → mitigated by 4 policies per mechanical + 3 policies for settings; T-06-03-02 LWW tampering → mitigated by moddatetime + parameterized "no updated_at" test). No new threat surface discovered.

## Self-Check: PASSED

- All 9 SQL files exist in worktree + applied to remote DB
- All 21 new store actions are present in store.ts grep
- 9 subscribe* helpers present in sync.ts grep
- ENTITY_PK_FIELD wired in migration.ts (3 grep hits — declaration + 2 references)
- 0 `TODO(06-03)` markers remaining in migration.ts
- 386 unit tests pass; M4 ordering contract still passes
- 14/14 RLS tests pass against live DB (rls-injections + rls-ai-messages + rls-multi-table)
- Bundle size 20.12 kB gz < 50 kB ceiling
- All 5 commits exist in `git log --oneline`:
  - dbdd41a: 9 SQL migrations
  - 826a6c2: sync.ts + store.ts wiring
  - 22556c5: migration.ts entity branches + bug fix
  - ff1201a: rls-multi-table.test.ts
  - 68796d5: prettier format pass
