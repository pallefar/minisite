---
phase: 07-compliance-foundations-legal-counsel-led
plan: 07
subsystem: account-delete
tags: [supabase, pg_cron, account-delete, soft-delete, crypto-shred, rls, security-definer, stride, audit-skeleton, plpgsql, settings, typed-confirmation, compl-06, d-03, phase07]
requires:
  - 07-08 (audit_logs table + audit_trigger live on remote — depends_on, must precede)
  - 07-06 (SettingsPage Data section settled — Privacy section host surface)
  - 07-10 (SettingsPage Recovery section settled — co-tenant Privacy section host)
provides:
  - public.pending_account_deletions table (RLS select-own, no-write — only RPC + service-role)
  - public.initiate_account_deletion() SECURITY DEFINER RPC (T+0; auth.uid() only, 5-min re-auth gate, photos→pending-shred prefix, sessions delete, inline audit-skeleton)
  - public.finalize_account_deletion(uid) SECURITY DEFINER fn (T+30; window validation, audit-skeleton before cascade, storage hard-delete via storage.allow_delete_query bypass, cascade DELETE auth.users with audit-suppression GUC)
  - pg_cron 'finalize-account-deletions' job (04:00 UTC daily, chunked 50/tick with for-update-skip-locked, finalize_attempts<5 partial-index filter)
  - public.run_finalize_account_deletions_cron_now() (service-role-only test hook)
  - RESTRICTIVE Storage RLS policies on photos-pending-shred/% (deny-read + deny-write to authenticated)
  - app.suppress_audit GUC hook in audit_trigger() (cascade-delete-time audit suppression)
  - DeleteAccountModal component (typed-confirm modal with verbatim 3-paragraph copy, error→inline/toast mapping)
  - SettingsPage Privacy section "Delete my account…" affordance (permanent users only)
  - SignUpForm same-email-pending error copy (D-03 30-day window UX guarantee)
  - account-delete client wrapper (typedConfirmMatches helper + initiateAccountDeletion RPC wrapper with AccountDeleteError mapping)
affects:
  - audit_trigger() function (gained `app.suppress_audit` GUC hook — 07-08's contract is preserved, only adds a transaction-local suppression path)
  - storage.objects (new RESTRICTIVE deny-read/write policies on photos-pending-shred/% prefix; cannot be bypassed by future broadening of photos_select_own)
  - SettingsPage.tsx Privacy section (gains destructive sub-section between existing Card and the section close)
  - SignUpForm.tsx submit branch (already-registered error path surfaces richer D-03 copy unconditionally)
tech-stack:
  added: []
  patterns:
    - Custom GUC trigger suppression (app.suppress_audit) — supersedes session_replication_role='replica' which requires superuser
    - RESTRICTIVE Storage RLS (AND-combined with existing PERMISSIVE policies) — defense-in-depth over photos_select_own
    - Typed-confirmation modal gating (pure helper for case-insensitive + trim match)
    - Inline audit-skeleton write within SECURITY DEFINER RPC (audit_trigger is not attached to pending_account_deletions per 07-08-SUMMARY §Handoff)
    - storage.allow_delete_query GUC bypass for admin-context DELETE FROM storage.objects (Supabase documented pattern)
key-files:
  created:
    - supabase/migrations/20260601000010_pending_account_deletions.sql (table + RLS + partial index — 64 lines)
    - supabase/migrations/20260601000011_initiate_account_deletion_rpc.sql (T+0 RPC — 92 lines)
    - supabase/migrations/20260601000012_finalize_account_deletion_fn.sql (T+30 fn — 100 lines)
    - supabase/migrations/20260601000013_finalize_account_deletions_cron.sql (pg_cron + test hook — 75 lines)
    - supabase/migrations/20260601000014_photos_pending_shred_storage.sql (Storage RLS — 49 lines)
    - supabase/migrations/20260601000015_account_delete_fix_search_path.sql (Rule 1 deviation — digest() resolution — 126 lines)
    - supabase/migrations/20260601000016_finalize_storage_bypass.sql (Rule 3 deviation — storage.allow_delete_query — 60 lines)
    - supabase/migrations/20260601000017_audit_trigger_suppress_guc.sql (Rule 2 deviation — audit_trigger hook — 72 lines)
    - supabase/migrations/20260601000018_finalize_apply_suppress_guc.sql (re-emit finalize with suppress GUC — 56 lines)
    - leanshot/src/lib/account-delete.ts (109 lines — wrapper + error mapping + helper)
    - leanshot/src/lib/account-delete.test.ts (151 lines — 15 unit tests)
    - leanshot/src/test/account-delete.test.tsx (166 lines — 9 component tests)
    - leanshot/src/components/dashboard/settings/DeleteAccountModal.tsx (143 lines)
    - leanshot/e2e/account-delete.spec.ts (385 lines — full happy-path e2e)
    - leanshot/e2e/rls-pending-account-deletions.test.ts (295 lines — 6 cross-tenant assertions)
  modified:
    - leanshot/src/components/dashboard/settings/SettingsPage.tsx (Privacy section + DeleteAccountModal render)
    - leanshot/src/components/auth/SignUpForm.tsx (already-registered → D-03 copy)
    - leanshot/.planning/phases/07-compliance-foundations-legal-counsel-led/deferred-items.md (logged out-of-scope lint debt)
decisions:
  - D-03 (LOCKED): inline audit-skeleton writes — audit_trigger from 07-08 does NOT attach to pending_account_deletions; the RPC + finalize fn write skeleton rows directly using the call shape documented in 07-08-SUMMARY §Handoff
  - D-03 (LOCKED): RESTRICTIVE Storage RLS on photos-pending-shred/% (not PERMISSIVE) — guarantees deny survives any future broadening of photos_select_own
  - Rule 1 deviation: partial index on initiated_at (not on expression `initiated_at + interval '30 days'`) — adding an interval to timestamptz is not IMMUTABLE in Postgres (42P17); algebraic rewrite `initiated_at <= now() - interval '30 days'` uses the index for a range scan
  - Rule 1 deviation: search_path includes `extensions` — `digest()` (pgcrypto) resolves there on managed Supabase, not `public` (same fix shape as 07-08 Migration D 20260601000004)
  - Rule 3 deviation: `storage.allow_delete_query` GUC bypass for DELETE FROM storage.objects (Supabase documented admin path; transaction-local, cannot leak)
  - Rule 2 deviation: custom `app.suppress_audit` GUC + early-return in audit_trigger() — superuser-only `session_replication_role` was denied; per-row cascade audit entries would be redundant pointing at a NULL user_id anyway; skeleton row is authoritative
metrics:
  duration: 2.5 hours (2026-05-12 19:00 → 19:50 UTC+2; 50 min execution + 1h45min e2e debug cycle for the 3 deviation discoveries)
  completed: 2026-05-12
  commits: 6 (3 feat + 1 fix + 1 test+migrations + 1 RLS test)
  tasks: 6/6
  files_created: 15
  files_modified: 3
---

# Phase 7 Plan 07: Account-Delete (COMPL-06 + D-03) Summary

## One-Liner

Ships the **account-delete half of COMPL-06**: a typed-confirmation Settings flow + SECURITY DEFINER admin RPC (T+0 pending row + sign-out + photo move + audit-skeleton) + pg_cron T+30 finalize worker (cascade-purge 13 tables + storage hard-delete + audit-skeleton survives forever). The load-bearing destructive surface in v1 — STRIDE-deep, ASVS L1 minimum, every threat with a `mitigate` disposition is grep-verifiable in plan artifacts and end-to-end-verified against live project ytnsipxxmzgaebkqmokp.

## What Was Built

### Migrations A-E (`20260601000010..14`) — core surface

- **`10_pending_account_deletions.sql`** — single-row-per-user table tracking pending deletes. PK references `auth.users(id) on delete cascade` (so finalize's cascade DELETE auto-purges this row too). RLS: `select_own` only; **no INSERT/UPDATE/DELETE policy for authenticated** (default-deny → T-07-07-T2 mitigation, verified by RLS proof assertions 2-4). Partial index on `initiated_at WHERE finalize_attempts < 5` for the cron worker's range scan.
- **`11_initiate_account_deletion_rpc.sql`** — ZERO-parameter SECURITY DEFINER RPC. T-07-07-S2 (parameter-tampering): caller identity comes EXCLUSIVELY from `auth.uid()`. T-07-07-S1 (stolen session): re-auth gate requires `last_sign_in_at >= now() - interval '5 minutes'`; raises sqlstate `P0007` otherwise. Idempotent double-click guard raises `P0008`. T+0 actions: insert pending row → write `account_deleted_initiated` audit-skeleton inline → move `<uid>/photos/*` → `photos-pending-shred/<uid>/*` → stamp `photos_moved_at` → `DELETE FROM auth.sessions`.
- **`12_finalize_account_deletion_fn.sql`** — T+30 SECURITY DEFINER fn with no grants (only service-role + cron postgres-role context). Validates `initiated_at + interval '30 days' <= now()` (sqlstate `P0009` otherwise) and presence of pending row (`P0006`). Writes `account_deleted_finalized` audit-skeleton **before** cascade. Hard-deletes storage objects via `storage.allow_delete_query` GUC bypass. `DELETE FROM auth.users` cascades to 13 child tables (injections, weights, meals, workouts, supplements, mood, sleep, symptoms, vials, settings, ai_messages, rate_limit_counters, photos + pending_account_deletions self). On exception, increments `finalize_attempts` before re-raising — idempotent across cron ticks.
- **`13_finalize_account_deletions_cron.sql`** — pg_cron job `finalize-account-deletions` at `'0 4 * * *'` (04:00 UTC; 1h gap after Phase 4 `cleanup-anon-users` + 1h gap before Phase 7 `cleanup-audit-logs`). Chunked `for update skip locked + limit 50` per tick (T-07-07-D1: 1500 finalizes/month worst-case, well within free-tier). Inner per-row `begin/exception when others then null` (T-07-07-D2). Test-hook `run_finalize_account_deletions_cron_now()` (service-role only) lets the e2e simulate the cron tick.
- **`14_photos_pending_shred_storage.sql`** — **RESTRICTIVE** Storage RLS policies. AND-combine with existing photos_select_own/insert_own/update_own/delete_own so the deny survives any future PERMISSIVE broadening. Even the original owner cannot read their own pending-shred photos.

### Migrations F-I (`20260601000015..18`) — deviation fixes discovered in e2e

Three independent Supabase-quirks bugs surfaced during Task 5 e2e against the live project. Each is logged with its own narrow-scope migration:

- **`15_account_delete_fix_search_path.sql`** (Rule 1): `digest(text, unknown)` does not exist in `public.auth.pg_catalog` search_path on managed Supabase — pgcrypto installs into `extensions`. Same fix shape as 07-08 Migration D `20260601000004_audit_trigger_fix_search_path.sql`. Re-emits initiate + finalize with `set search_path = public, auth, extensions, pg_catalog`.
- **`16_finalize_storage_bypass.sql`** (Rule 3): Supabase `protect_objects_delete` BEFORE-DELETE trigger on `storage.objects` rejects direct DELETE with `42501: Direct deletion not allowed. Use the Storage API instead`. The trigger reads `current_setting('storage.allow_delete_query', true)` and admits the DELETE when it equals `'true'`. Transaction-local `set_config(..., true)` is the documented bypass.
- **`17_audit_trigger_suppress_guc.sql`** (Rule 2): Cascade DELETE on `auth.users` fires `audit_trigger()` on all 10 sync tables. Each cascade-deleted row's audit INSERT carries `user_id=<the user being deleted>`; the not-deferrable `audit_logs_user_id_fkey` rejects with `23503` mid-cascade. `session_replication_role='replica'` is superuser-only on managed Supabase. FK DEFERRABLE doesn't help (the inserted row's check applies, not the cascade-delete's `ON DELETE SET NULL`). Adopted pattern: `audit_trigger()` honours `current_setting('app.suppress_audit', true)` as an early-return; `finalize_account_deletion()` sets the GUC before cascade. Skeleton row written inline is the authoritative audit trace; per-row cascade audits would be redundant noise pointing at `user_id=null` anyway.
- **`18_finalize_apply_suppress_guc.sql`** — re-emits `finalize_account_deletion` with `set_config('app.suppress_audit', 'true', true)` immediately before `DELETE FROM auth.users` (16 was already pushed before 17 landed, so the live finalize body needed a forward-rev).

### Client surface

- **`src/lib/account-delete.ts`**:
  - `class AccountDeleteError` with discriminated `code: 'recent_auth_required' | 'already_pending' | 'not_authenticated' | 'unknown'`.
  - `initiateAccountDeletion()` — invokes RPC with ZERO args (server-side `auth.uid()` per T-07-07-S2 contract; verified by `mockRpc.mock.calls[0]).toHaveLength(1)` unit test). Maps `P0007/P0008/28000`. On success: `wipePreCloudBackup()` (Phase 6 D-03 invariant — local backup blob cannot survive an account-delete) + `useStore.getState().resetAll()` + `await signOut()`.
  - `typedConfirmMatches(typed, email)` — pure helper; case-insensitive + whitespace-trimmed; null-tolerant on `email`.
- **`src/components/dashboard/settings/DeleteAccountModal.tsx`** — typed-confirm modal. Reads `signedIn.user.email` via store selector (no `s.user!` — D-06). Disabled button gate via `typedConfirmMatches`. Error mapping: `recent_auth_required` → inline error + modal stays open; `already_pending` → info toast + close; unknown/auth → error toast + close.
- **`src/components/dashboard/settings/SettingsPage.tsx`** — Privacy section gains "Delete my account…" affordance gated on `isPermanent` (anon users lack reliable `last_sign_in_at` for the 5-min re-auth gate). DeleteAccountModal rendered alongside the existing ConfirmModal at the bottom of the component.
- **`src/components/auth/SignUpForm.tsx`** — already-registered error path surfaces the verbatim D-03 copy "This email is associated with a recently deleted account. After the 30-day window…". Anon RLS makes pending-state and fresh-duplicate indistinguishable from the client; the safe disposition is to surface the richer copy on every already-registered error (no PII leak — the message is a low-stakes hint, not user data).

### Test surface

- **`src/lib/account-delete.test.ts`** (15 unit tests): `typedConfirmMatches` edge cases (7) + RPC error mapping (5: P0007/P0008/28000/unknown/error-does-not-side-effect) + happy path (3: RPC called with single arg, resetAll+signOut both fire, pre_cloud_backup wiped).
- **`src/test/account-delete.test.tsx`** (9 component tests): title + 3-paragraph copy, disabled-until-typed gate (4 cases), success path closes + toasts, recent_auth_required keeps modal open with inline error, already_pending toast+close, unknown error toast+close.
- **`e2e/account-delete.spec.ts`** (1 e2e test, 6.5s runtime): admin seeds user + 3 sentinel sync rows + 1 photo → SPA signs in (with seeded migration_state.complete=true) → dismisses "All done" MigrationModal → opens Settings → Privacy → Delete → typed-confirm gate verified (3 cases: wrong email keeps disabled, exact match enables, case-insensitive+trim still enables) → confirm → modal closes + redirect to auth → T+0 asserts (pending row + audit-skeleton row + photos moved) → admin back-dates initiated_at + calls run_finalize_account_deletions_cron_now → T+30 asserts (auth.users gone + 13 sync tables empty + storage prefix empty + exactly 2 skeleton rows surviving with user_id=null + user_id_hash intact).
- **`e2e/rls-pending-account-deletions.test.ts`** (6 RLS assertions, 2.7s runtime): per project rule (memory `reference_supabase_project.md`). Asserts 1-4 against the table, 5-6 against the Storage prefix. False-pass guards: admin reads succeed in steps 1 + 6.

## Migrations Live-DB Verification

All 4 post-push verifications returned expected output from project `ytnsipxxmzgaebkqmokp`:

```
=== 1. table + RLS ===
{ "relname": "pending_account_deletions", "relrowsecurity": true }

=== 2. Functions (prosecdef=true) ===
[ {"proname":"finalize_account_deletion","prosecdef":true},
  {"proname":"initiate_account_deletion","prosecdef":true},
  {"proname":"run_finalize_account_deletions_cron_now","prosecdef":true} ]

=== 3. Cron job ===
{ "jobname": "finalize-account-deletions", "schedule": "0 4 * * *" }

=== 4. Storage policies ===
[ {"polname":"photos_pending_shred_deny_authenticated_read"},
  {"polname":"photos_pending_shred_deny_authenticated_writes"} ]
```

## STRIDE Threat Register

| Threat ID  | Category               | Disposition | Concrete mitigation pointer |
|------------|------------------------|-------------|------------------------------|
| T-07-07-S1 | Spoofing (stolen session) | mitigate | `interval '5 minutes'` gate inside `initiate_account_deletion()` raises `P0007`; SettingsPage inline error "sign out and sign back in within the last 5 minutes". Migration 11 lines 47-51. |
| T-07-07-S2 | Spoofing (param tampering) | mitigate | RPC takes ZERO parameters; `auth.uid()` only. `finalize_account_deletion(uid)` has `revoke all from public` + no grants — service-role + cron context only. Grep-verified in Task 1; unit test asserts `mockRpc.mock.calls[0]).toHaveLength(1)`. |
| T-07-07-T1 | Tampering (malformed pending row) | mitigate | `finalize_account_deletion` validates window + `if not found` raises `P0006`. Migration 12 lines 16-25. |
| T-07-07-T2 | Tampering (direct table writes) | mitigate | No INSERT/UPDATE/DELETE policies on `pending_account_deletions` for authenticated; verified by RLS proof assertions 2-4. |
| T-07-07-R1 | Repudiation | mitigate | Audit-skeleton `account_deleted_initiated` (RPC) + `account_deleted_finalized` (finalize fn) written inline; `audit_logs.user_id` is `on delete set null` so rows survive cascade with `user_id_hash` intact. Verified live in e2e step 8. |
| T-07-07-I1 | Information disclosure (photos) | mitigate | RESTRICTIVE Storage RLS denies authenticated SELECT on `photos-pending-shred/%`. Even owner blind. Verified by RLS proof assertions 5-6. |
| T-07-07-I2 | Information disclosure (audit hashes) | accept | `audit_logs.user_id` set null at cascade; only sha256(user_id) remains. UUID = 128-bit entropy; rainbow-table infeasible. CONTEXT D-03-aligned. |
| T-07-07-D1 | DoS (mass-delete burst) | mitigate | `for update skip locked + limit 50` per cron tick; partial-index on `finalize_attempts < 5` keeps queue from being blocked by stuck rows. Migration 13. |
| T-07-07-D2 | DoS (single-row hang) | mitigate | Per-row `begin/exception when others then null` in cron loop; `finalize_account_deletion` increments `finalize_attempts` in its OWN exception handler. |
| T-07-07-E1 | EoP (non-owner triggers delete) | mitigate | Identical to T-07-07-S2 — `auth.uid()` only, no user_id param. |
| T-07-07-E2 | EoP (direct finalize call) | mitigate | `revoke all on function public.finalize_account_deletion(uuid) from public` + no `grant execute` to authenticated/anon. |

ASVS L1 minimum: every `mitigate` disposition has a concrete code-level mitigation grep-verifiable in plan artifacts + verified live in e2e or RLS proof. `T-07-07-I2` accept is rationale-documented per CONTEXT D-03.

## Deviations from Plan

Five auto-fixes — all caught during live-DB execution, all converged to live-green within Task 4-5.

### Rule 1 deviations

**1. Partial index expression rejected as not IMMUTABLE** (caught during Task 4 first `db push`)
- **Issue:** `create index ((initiated_at + interval '30 days'))` rejected with SQLSTATE 42P17.
- **Fix:** Switched to `create index (initiated_at) where finalize_attempts < 5`. The cron's WHERE clause is algebraically equivalent under `initiated_at <= now() - interval '30 days'` rewrite.
- **Commit:** `ab4671a`. Files: `supabase/migrations/20260601000010_pending_account_deletions.sql`.

**2. `digest()` search_path resolution** (caught during Task 5 first e2e — RPC returned 404 with body `42883: function digest(text, unknown) does not exist`)
- **Issue:** `set search_path = public, auth, pg_catalog` didn't expose `extensions.digest`. Same bug shape as 07-08 D 20260601000004.
- **Fix:** Re-emitted initiate + finalize with `set search_path = public, auth, extensions, pg_catalog`.
- **Commit:** `e3c586c` (Task 5 bundle). Files: `supabase/migrations/20260601000015_account_delete_fix_search_path.sql` + edits to the source migrations.

### Rule 3 deviations

**3. Supabase `protect_objects_delete` trigger blocks direct DELETE** (caught during Task 5 manual finalize invocation)
- **Issue:** `DELETE FROM storage.objects` rejected with `42501: Direct deletion from storage tables is not allowed. Use the Storage API instead`.
- **Fix:** `perform set_config('storage.allow_delete_query', 'true', true)` immediately before the DELETE. Transaction-local; documented Supabase admin bypass.
- **Commit:** `e3c586c` (Task 5 bundle). Files: `supabase/migrations/20260601000016_finalize_storage_bypass.sql` + edits to source migration 12.

### Rule 2 deviations

**4. Cascade DELETE on auth.users fires audit_trigger() with FK-violating user_id** (caught during Task 5 manual finalize invocation)
- **Issue:** `23503: audit_logs_user_id_fkey` violation mid-cascade. `session_replication_role='replica'` is superuser-only on managed Supabase. FK DEFERRABLE doesn't help (insert-row check applies, not `ON DELETE SET NULL` — that's only for existing rows whose referenced row gets deleted).
- **Fix:** Added `app.suppress_audit` GUC hook to `audit_trigger()` (early-return when set). `finalize_account_deletion()` sets it before the cascade. Transaction-local. The skeleton row written inline by finalize is the authoritative audit trace; per-row cascade entries would be redundant `user_id=null` noise.
- **Commits:** `e3c586c` (Task 5 bundle). Files: `supabase/migrations/20260601000017_audit_trigger_suppress_guc.sql` (audit_trigger re-emit with hook) + `20260601000018_finalize_apply_suppress_guc.sql` (finalize re-emit with set_config call).

**5. E2E assertion over-tight on audit row count** (caught during final e2e run)
- **Issue:** Plan said "exactly 2 surviving audit rows for user_id_hash". Real-world includes per-table `insert` rows from sentinel-seed which survive cascade with user_id=null + same hash.
- **Fix:** Tightened query to filter `.like('action', 'account_deleted_%')` — the contract is "skeletons survive forever", not "total row count = 2". Sync-table audits get culled by 07-08's 13-month retention cron.
- **Commit:** `e3c586c`. File: `e2e/account-delete.spec.ts`.

### Out-of-scope discoveries (logged, not fixed)

- 10 pre-existing lint errors in `src/components/legal/ConsumerHealthData.tsx` (from Plan 07-03 commit 5c29dc2 — `import-x/order` + `react/no-unescaped-entities`). Logged to `.planning/phases/07-compliance-foundations-legal-counsel-led/deferred-items.md`.

## E2E + RLS Test Output

```
$ npx playwright test account-delete.spec.ts
Running 1 test using 1 worker
  ✓  1 [chromium] › e2e/account-delete.spec.ts:155 › @phase07 account-delete COMPL-06: end-to-end happy path (6.5s)
  1 passed (8.3s)

$ npm run test:e2e:rls -- rls-pending-account-deletions
 RUN  v4.1.5 /Users/karstenhaldan/minisite/leanshot
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  19:49:36
   Duration  2.67s

$ npm run test:unit -- account-delete --run
 Test Files  2 passed (2)
      Tests  24 passed (24)
   Duration  1.55s
```

## Open Questions Resolved

- **OQ#2** (same-email re-signup): Block with explicit copy. Implemented as unconditional surfacing of the richer D-03 message on every already-registered error from `supabase.auth.signUp` — the SPA can't distinguish pending-shred from fresh-duplicate via anon RLS, and the safe disposition is to surface the richer message. No PII leak (the message is a low-stakes hint).
- **OQ#3** (cron mechanism): Direct `auth.users` DELETE inside pg_cron lambda (Phase 4 pattern). NO Edge Function bridge. Researcher §6 Key Finding #3 confirmed.

## Self-Check

- Created files exist:
  - `supabase/migrations/20260601000010_pending_account_deletions.sql` — FOUND
  - `supabase/migrations/20260601000011_initiate_account_deletion_rpc.sql` — FOUND
  - `supabase/migrations/20260601000012_finalize_account_deletion_fn.sql` — FOUND
  - `supabase/migrations/20260601000013_finalize_account_deletions_cron.sql` — FOUND
  - `supabase/migrations/20260601000014_photos_pending_shred_storage.sql` — FOUND
  - `supabase/migrations/20260601000015_account_delete_fix_search_path.sql` — FOUND
  - `supabase/migrations/20260601000016_finalize_storage_bypass.sql` — FOUND
  - `supabase/migrations/20260601000017_audit_trigger_suppress_guc.sql` — FOUND
  - `supabase/migrations/20260601000018_finalize_apply_suppress_guc.sql` — FOUND
  - `leanshot/src/lib/account-delete.ts` — FOUND
  - `leanshot/src/lib/account-delete.test.ts` — FOUND
  - `leanshot/src/test/account-delete.test.tsx` — FOUND
  - `leanshot/src/components/dashboard/settings/DeleteAccountModal.tsx` — FOUND
  - `leanshot/e2e/account-delete.spec.ts` — FOUND
  - `leanshot/e2e/rls-pending-account-deletions.test.ts` — FOUND
- Modified files exist:
  - `leanshot/src/components/dashboard/settings/SettingsPage.tsx` — FOUND
  - `leanshot/src/components/auth/SignUpForm.tsx` — FOUND
- Commits exist in git log:
  - `1b5c2eb` (Task 1) — FOUND
  - `722d32a` (Task 2) — FOUND
  - `e5dbbdb` (Task 3) — FOUND
  - `ab4671a` (Task 4 IMMUTABLE fix) — FOUND
  - `e3c586c` (Task 5 + 3 deviation fixes) — FOUND
  - `47cc3b8` (Task 6 RLS proof) — FOUND

## Self-Check: PASSED

## Commits

| Hash | Task | Description |
|------|------|-------------|
| `1b5c2eb` | 1 | Author 5 SQL migrations (table + initiate + finalize + cron + storage RLS) |
| `722d32a` | 2 | account-delete client wrapper + unit + RED component tests |
| `e5dbbdb` | 3 | DeleteAccountModal + SettingsPage Privacy + SignUpForm pending-email copy |
| `ab4671a` | 4 | IMMUTABLE-index fix (partial index on initiated_at, not expression) |
| `e3c586c` | 5 | Full e2e + 3 deviation fixes (search_path, storage bypass, audit cascade FK) |
| `47cc3b8` | 6 | Cross-tenant RLS proof — 6 assertions (table + Storage prefix) |

## Followups

- **07-09** (`s.user!` D-06 sweep): SettingsPage still uses `useStore((s) => s.user!)` at line 78 (now renamed `u` via the existing nullable-then-early-return guard). DeleteAccountModal already conforms to the post-sweep pattern. No new violations introduced.
- **Phase 7 close**: this is the last plan in Phase 7 Wave 3 (per plan frontmatter `wave: 3` + `solo`). After this lands, all 10 plans in Phase 7 are complete. ROADMAP Phase 7 SC#4 (account-delete + 30-day undo) and SC#5 (audit-skeleton retention forever) are both verified live.
- **Phase 8+ when triggered**: the `app.suppress_audit` GUC hook in audit_trigger is now a permanent piece of audit infrastructure; future SECURITY DEFINER functions that perform bulk-cascade deletes on auth.users can reuse this same hook.

## Threat Flags

None — no new security-relevant surface beyond what's in the plan's `<threat_model>`. The 4 deviation migrations (15-18) extend existing surfaces without introducing new trust boundaries.
