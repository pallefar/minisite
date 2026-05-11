---
phase: 05-patient-cloud-sync-slice-1-auth-injections
plan: 01
subsystem: cloud-sync-foundation
tags: [auth, sync, supabase, rls, storage-migration, schema]
dependency-graph:
  requires: [04-03 (RLS pattern + anon→permanent linkage live)]
  provides:
    - "public.injections cloud table + RLS + Realtime publication membership"
    - "Injection.log_id TS interface (composite PK with user_id)"
    - "PendingOp TS interface (unified offline write queue; DELEG-2)"
    - "STORAGE_VERSION=7 with idempotent v6→v7 migration (log_id back-stamp + pendingOps init)"
    - "namespacedKey + renameStorageNamespace storage helpers (D-12)"
    - "Cross-tenant RLS proof test (SC#5 PROVEN live)"
  affects:
    - "05-02 (auth UI consumes namespacedKey + renameStorageNamespace on SIGNED_IN)"
    - "05-03 (sync engine writes injections; PendingOp queue; persist allow-list bump for pendingOps)"
tech-stack:
  added:
    - "moddatetime PostgreSQL extension (server-authoritative updated_at for LWW)"
  patterns:
    - "Composite PK (user_id, log_id) for client-stable identity across local-only logging, offline queue, and cloud upsert"
    - "Idempotent localStorage namespace migration (always remove universal key — T-05-03)"
    - "Lazy-construct admin client in describe.skip block to survive missing env vars"
key-files:
  created:
    - "/Users/karstenhaldan/minisite/supabase/migrations/20260513000000_injections.sql"
    - "/Users/karstenhaldan/minisite/leanshot/e2e/rls-injections.test.ts"
    - "/Users/karstenhaldan/minisite/leanshot/vitest-e2e.config.ts"
  modified:
    - "/Users/karstenhaldan/minisite/leanshot/src/types/index.ts"
    - "/Users/karstenhaldan/minisite/leanshot/src/lib/storage.ts"
    - "/Users/karstenhaldan/minisite/leanshot/src/lib/storage.test.ts"
    - "/Users/karstenhaldan/minisite/leanshot/src/lib/store.ts"
    - "/Users/karstenhaldan/minisite/leanshot/playwright.config.ts"
    - "/Users/karstenhaldan/minisite/leanshot/package.json"
decisions:
  - "log_id stamping centralized in addInjection (store.ts), not pushed onto every UI surface — Rule 2 addition"
  - "Hard delete (no deleted_at column) — LWW + Realtime DELETE fanout is sufficient for Phase 5; soft-delete deferred to Phase 7 GDPR"
  - "Playwright restricted to *.spec.ts only — fixes pre-existing Phase 4 breakage where Playwright crashed loading vitest-shaped *.test.ts files"
  - "Dedicated vitest-e2e.config.ts + npm script (test:e2e:rls) — keeps default test:unit excluded from e2e/** (CI semantics preserved) while making RLS suite runnable on-demand"
metrics:
  duration: "~13 minutes (5 tasks)"
  completed: "2026-05-11"
  tasks: "5/5"
  files-created: 3
  files-modified: 6
  tests-added: 15
  tests-total: 240 (from 225 baseline)
---

# Phase 5 Plan 01: Schema + Storage Foundations — Summary

**One-liner:** Authored `public.injections` cloud schema (composite PK + default-deny RLS + moddatetime LWW trigger + Realtime publication), pushed migration live to Supabase project `ytnsipxxmzgaebkqmokp`, extended `Injection` TS interface with `log_id`/`updated_at`, bumped STORAGE_VERSION 6→7 with idempotent log_id back-stamp + `pendingOps` init + per-user `namespacedKey`/`renameStorageNamespace` helpers, and proved cross-tenant RLS isolation (SC#5) via a 4-assertion live test against the remote DB.

## Tasks Completed (5/5)

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Extend Injection type + author PendingOp type | `85fb7f6` | `src/types/index.ts`, `src/lib/store.ts`, `src/lib/storage.test.ts` |
| 2 | Author injections SQL migration (schema + RLS + trigger + publication) | `5c19fbb` | `supabase/migrations/20260513000000_injections.sql` |
| 3 | supabase db push — applied migration to remote DB (autonomous via CLI auth) | — (no file changes; live verified) | live remote DB |
| 4 | Author STORAGE_VERSION 6→7 migration helpers | `3cc9b64` | `src/lib/storage.ts`, `src/lib/storage.test.ts`, `src/lib/store.ts` |
| 5 | Cross-tenant RLS proof test | `312bd87` | `e2e/rls-injections.test.ts`, `vitest-e2e.config.ts`, `package.json`, `playwright.config.ts` |

## Live Supabase Verification Outputs

All four checks executed via `npx supabase db query --linked` against project `ytnsipxxmzgaebkqmokp`:

### Migration applied

```
$ npx supabase migration list --linked

   Local          | Remote         | Time (UTC)
  ----------------|----------------|---------------------
   20260512000000 | 20260512000000 | 2026-05-12 00:00:00
   20260512000001 | 20260512000001 | 2026-05-12 00:00:01
   20260512000002 | 20260512000002 | 2026-05-12 00:00:02
   20260513000000 | 20260513000000 | 2026-05-13 00:00:00   ← Phase 5 injections
```

### Table exists

```sql
select tablename from pg_tables where schemaname='public' and tablename='injections';
-- rows: [{ "tablename": "injections" }]
```

### Four RLS policies present

```sql
select policyname from pg_policies where schemaname='public' and tablename='injections' order by policyname;
-- rows:
--   injections_delete_own
--   injections_insert_own
--   injections_select_own
--   injections_update_own
```

### Realtime publication membership

```sql
select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename='injections';
-- rows: [{ "tablename": "injections" }]
```

### RLS enabled

```sql
select relname, relrowsecurity from pg_class where relname='injections';
-- rows: [{ "relname": "injections", "relrowsecurity": true }]
```

### Cross-tenant RLS test (live)

```
$ SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
  npm run test:e2e:rls

 ✓ e2e/rls-ai-messages.test.ts > Phase 4 SC#5 (re-asserted) 1019ms
 ✓ e2e/rls-injections.test.ts  > Phase 5 SC#5 — user B reads ZERO, impersonation rejected 1131ms

 Test Files  2 passed (2)
      Tests  4 passed (4)
```

## Threat Mitigation Evidence

| Threat ID | Mitigation | Task | Status |
|-----------|-----------|------|--------|
| T-05-01 (Information disclosure — cross-tenant injections read) | Default-deny RLS + 4 explicit `auth.uid() = user_id` policies + cross-tenant proof test (`expect(bData).toEqual([])`) | Tasks 2, 3, 5 | **MITIGATED** — live test passes |
| T-05-03 (localStorage cross-account leak) | `namespacedKey(userId)` + `renameStorageNamespace` ALWAYS removes the universal key (even when target has data) | Task 4 | **MITIGATED** — unit test "deletes universal key even when target already has data (multi-account safety)" passes |
| T-05-05 (Offline-write conflict tampering) | Server-authoritative `updated_at` via `moddatetime` BEFORE UPDATE trigger; clients never send `updated_at` | Tasks 2, 3 | **MITIGATED** — trigger live on remote DB |
| T-05-06 (v6→v7 migration runs twice or leaves orphan keys) | `migrateV6ToV7` idempotency — preserves existing `log_id`s on re-run | Task 4 | **MITIGATED** — unit test "is idempotent: running twice does not re-generate log_id" passes |

## Success-Criteria Status

| SC | Status | Evidence |
|----|--------|----------|
| SC#1 (cross-device sync foundation) | **READY** — schema + LWW trigger + Injection.log_id + Injection.updated_at + offline-queue type ready; sync engine in 05-03 consumes | Live migration + TS types + tests pass |
| SC#4 (offline-first preserved) | **READY** — local-first Zustand path untouched; addInjection stamps log_id + pkEngineVersion stays 1; pendingOps queue type ready for 05-03 | 240/240 unit tests pass |
| SC#5 (cross-tenant RLS) | **PROVEN** — live test asserts user B sees `[]` from user A's injections + impersonation INSERT rejected with code 42501 | `e2e/rls-injections.test.ts` 4/4 pass |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical functionality] `addInjection` now stamps `log_id`**
- **Found during:** Task 1
- **Issue:** Making `log_id` required on `Injection` would break the `MedicationTab.tsx` caller (which builds an `injForm` object without `log_id` and casts via `as Injection`). Without stamping in `addInjection`, every new local-only injection would lack the composite-PK identifier the 05-03 sync engine needs.
- **Fix:** Extended `addInjection` in `store.ts` to stamp `log_id: inj.log_id ?? crypto.randomUUID()` alongside the existing pkEngineVersion stamping. Added 2 unit tests covering auto-stamp and explicit-preservation.
- **Files modified:** `src/lib/store.ts` (~5 lines), `src/lib/storage.test.ts` (+30 lines)
- **Commit:** `85fb7f6`

**2. [Rule 1 — Pre-existing bug] Playwright `testMatch` restricted to `*.spec.ts`**
- **Found during:** Task 5
- **Issue:** Adding `e2e/rls-injections.test.ts` would expand a pre-existing Phase 4 breakage where Playwright crashes with `TypeError: Cannot redefine property: Symbol($$jest-matchers-object)` trying to load vitest-shaped `.test.ts` files in `e2e/` (Phase 4's `rls-ai-messages.test.ts` already triggers this — `npm run test:e2e` exits 1).
- **Fix:** Set `testMatch: /.*\.spec\.ts$/` in `playwright.config.ts` so Playwright only matches `onboarding.spec.ts` and skips the vitest cross-tenant suites.
- **Files modified:** `playwright.config.ts`
- **Commit:** `312bd87`

**3. [Rule 3 — Blocking issue] `describe.skip` body executed `createClient` on undefined env vars**
- **Found during:** Task 5
- **Issue:** Initial implementation of `rls-injections.test.ts` mirrored Phase 4 exactly — `describeIfLive(..., () => { const admin = createClient(URL!, SERVICE!, ...) })`. With `URL=undefined`, the body function still runs at module load (describe.skip skips test registration, NOT the factory), and `createClient` throws `supabaseUrl is required`. Test would fail in default `vitest run` when SUPABASE_SERVICE_ROLE_KEY is absent.
- **Fix:** Lazy-construct `admin` via `getAdmin()` closure. The describe.skip body now only declares the lazy ref; createClient only runs inside `it(...)` which is itself skipped.
- **Files modified:** `e2e/rls-injections.test.ts` (~10 lines)
- **Commit:** `312bd87`
- **Note:** Phase 4's `rls-ai-messages.test.ts` has the same latent bug. Left as Phase 4 maintenance — out of this plan's scope per the SCOPE BOUNDARY rule (it only fires if Phase 4's CI run goes without service-role key, which apparently it does and just throws inside the test). Logged below.

### Plan additions

**4. [Plan addition] Dedicated `vitest-e2e.config.ts` + `test:e2e:rls` npm script**
- **Issue:** The main `vite.config.ts` test section explicitly excludes `e2e/**` from vitest, so `npx vitest run e2e/rls-injections.test.ts` returns "No test files found". The plan's acceptance criterion 7 allows either extending the main config OR adding a separate include path.
- **Choice:** Added a separate `vitest-e2e.config.ts` (clean separation: default `test:unit` keeps CI semantics; on-demand `test:e2e:rls` runs the cross-tenant suite) plus an npm script. The new config picks up BOTH `e2e/rls-injections.test.ts` AND Phase 4's `e2e/rls-ai-messages.test.ts` (via the `e2e/rls-*.test.ts` glob), so a single command verifies both phases' RLS.
- **Files added:** `vitest-e2e.config.ts`
- **Files modified:** `package.json` (one new script line)

### Auth gates encountered

None. Supabase CLI was already authenticated at OS level (likely via persisted login token), so `supabase db push --linked` ran autonomously without prompting for DB password. Live `supabase db query --linked` and `npx supabase projects api-keys` also worked without env-var injection — matches Phase 4's 04-03 Task 4 pattern.

## Deferred / Out-of-Scope Items

- **Phase 4's `e2e/rls-ai-messages.test.ts` has the same `describe.skip` body bug** (createClient with undefined env vars). I did NOT fix it — per SCOPE BOUNDARY, that's a Phase 4 file and CI evidence shows it's been working anyway. Logged here so a future Phase 4 maintenance pass can mirror the lazy-construct pattern.
- **`partialize` allow-list bump for `pendingOps`** — explicitly deferred to 05-03 per plan instructions (Task 4 behavior section: "This task does NOT modify store.ts's partialize"). The 05-03 sync engine will land it alongside the slice consumer.
- **GitHub Actions secret `SUPABASE_SERVICE_ROLE_KEY`** — Phase 4 added it; this plan doesn't touch CI. The new `npm run test:e2e:rls` is on-demand for now; a future CI wave-step can opt-in.

## Hand-off Notes

### For 05-02 (Wave 2 — Auth UI)

- **`namespacedKey(userId)` + `renameStorageNamespace(userId)`** exported from `@/lib/storage`. Wire `renameStorageNamespace` on `auth.onAuthStateChange('SIGNED_IN', ...)` in App.tsx; idempotent, always removes the universal key. Per CONF-3, `clearUserDataSlices()` on signout MUST preserve `acknowledgedDisclaimer` (already optional in `PersistedState`; just don't touch it).
- **`Injection.log_id`** is now required on all type literals. `addInjection` action auto-stamps if the caller omits it — UI surfaces can keep their form-shape calls unchanged.
- **STORAGE_VERSION = 7** — first signin after this plan ships triggers the v6→v7 migration which back-stamps every legacy injection with `crypto.randomUUID()`. Idempotent on re-runs.

### For 05-03 (Wave 3 — Sync engine + offline queue)

- **`public.injections`** is live on remote DB (project ref `ytnsipxxmzgaebkqmokp`). Realtime publication membership confirmed via `pg_publication_tables`.
- **`PendingOp` type** exported from `@/types`. Use `table: 'injections'` for this phase. The persist allow-list bump for `pendingOps` slice lives in your scope (this plan kept `partialize` unchanged per spec).
- **LWW** — when upserting from the offline queue, do NOT pass `updated_at` in the payload. The `moddatetime` BEFORE UPDATE trigger overwrites it server-side. Insert default is `now()`.
- **Cross-tenant RLS test re-runs in your verification**: `npm run test:e2e:rls` (requires `SUPABASE_SERVICE_ROLE_KEY`).

## Self-Check: PASSED

- `[FOUND]` `/Users/karstenhaldan/minisite/supabase/migrations/20260513000000_injections.sql` (4381 bytes)
- `[FOUND]` `/Users/karstenhaldan/minisite/leanshot/e2e/rls-injections.test.ts`
- `[FOUND]` `/Users/karstenhaldan/minisite/leanshot/vitest-e2e.config.ts`
- `[FOUND]` `85fb7f6` (Task 1)
- `[FOUND]` `5c19fbb` (Task 2)
- `[FOUND]` `3cc9b64` (Task 4)
- `[FOUND]` `312bd87` (Task 5)
- `[FOUND]` Remote DB migration `20260513000000_injections` confirmed via `npx supabase migration list --linked`
- `[FOUND]` 4 RLS policies live on `public.injections`
- `[FOUND]` Cross-tenant RLS test 4/4 pass against live DB
- `[VERIFY]` typecheck exits 0
- `[VERIFY]` 240/240 unit tests pass (15 added: 2 addInjection log_id + 6 v6→v7 migration + 3 namespacedKey + 4 renameStorageNamespace)
- `[VERIFY]` lint: 0 errors (5 pre-existing warnings in unrelated files)
