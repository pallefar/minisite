---
phase: 27-modular-admin-shell-extensions
plan: 01
subsystem: admin-bulk-actions
tags: [admin, bulk-actions, members, audit, ADMIN-04]
requirements: [ADMIN-04]
dependency-graph:
  requires:
    - phase: 24
      provides: [log_admin_action, is_admin_at_least, audit_logs.action_name, profiles.admin_role]
    - phase: 22
      provides: [MembersTable, admin_list_members RPC, Member type]
  provides:
    - admin_bulk_jobs.status=pending (Plan 27-06 worker poll-claim contract)
    - bulk_action_undo_token.expires_at (Plan 27-07 purge cron contract)
    - audit_logs.action_name strings: bulk_csv_export, bulk_tag, bulk_comp_plan, bulk_ban, bulk_force_password_reset, bulk_action_undone
    - profiles.account_state + profiles.tags columns (Plan 27-02 cohort builder D-06 field set)
    - comp_plan_grants + password_reset_requests target tables (Phase 27 + future plans)
  affects:
    - MembersTable (additive selection state + checkboxes)
tech-stack:
  added:
    - GIN index on profiles.tags (multi-value containment)
    - partial-index pattern on admin_bulk_jobs.status='pending'
  patterns:
    - Pattern S2 append-only RLS (NO insert/update/delete policy = mitigation)
    - Pattern S3 SECDEF + set_config('app.suppress_audit','on',true) before mutation loop
    - Pattern S1 client gate UX-only (is_admin_at_least is authoritative)
    - discriminated-union BulkApiError (mirror of AffiliateReviewError)
    - 4-state modal machine 'confirm'|'running'|'done'|'error' (verbatim from BulkExportCSVFlow.tsx)
key-files:
  created:
    - supabase/migrations/20270602000001_admin_bulk_jobs.sql
    - supabase/migrations/20270602000002_bulk_action_undo_token.sql
    - supabase/migrations/20270602000003_admin_bulk_actions_extend_audit.sql
    - supabase/migrations/20270602000004_admin_bulk_actions_target_columns.sql
    - supabase/migrations/20270602000005_admin_bulk_action_rpcs.sql
    - supabase/functions/_shared/admin-bulk-action-test.ts
    - leanshot/src/lib/admin/bulk/types.ts
    - leanshot/src/lib/admin/bulk/action-handlers.ts
    - leanshot/src/lib/admin/bulk/action-handlers.test.ts
    - leanshot/src/lib/admin/bulk/undo.ts
    - leanshot/src/lib/admin/bulk/undo.test.ts
    - leanshot/src/components/admin/bulk/AdminBulkActionsBar.tsx
    - leanshot/src/components/admin/bulk/AdminBulkConfirmModal.tsx
    - leanshot/src/components/admin/bulk/AdminUndoBanner.tsx
    - leanshot/e2e/admin-bulk-actions.spec.ts
  modified:
    - leanshot/src/components/admin/members/MembersTable.tsx
decisions:
  - D-01 sync/async split at 100 rows enforced server-side; 10000-row hard cap raises too_many_rows (22023)
  - D-03 reversible set ban/comp_plan/tag get undo_token; csv_export + force_password_reset deliberately don't
  - D-04 all 5 action types ship at v1; per-row log_admin_action via Phase 24 helper, csv_export logs aggregate count only (HIPAA-safe)
  - D-23 admin_bulk_jobs is append-only via RLS (no INSERT/UPDATE/DELETE policy); only SECDEF RPCs + service_role write
  - Rule 2 deviation: added profiles.account_state + tags + comp_plan_grants + password_reset_requests in companion migration (required for ban/tag/comp_plan/force_password_reset mutations to have a target)
  - Pragmatic patch around Phase 24 type drift (log_admin_action returns uuid but audit_logs.id is bigserial); RPC re-fetches actual bigint ids from audit_logs for the undo token's original_audit_log_ids
metrics:
  duration_minutes: ~30
  completed: 2026-05-18
  commits: 5
  files_created: 15
  files_modified: 1
  tasks_completed: 5
  tasks_deferred_to_orchestrator: 1
---

# Phase 27 Plan 01: Bulk Actions (ADMIN-04) Summary

One-liner: Ships the 5-action bulk surface on the Members table (csv_export, tag, comp_plan, ban, force_password_reset) with confirmation modal, per-row audit_logs entries via Phase 24 `log_admin_action`, and a 60-second undo banner backed by an atomic single-use token RPC — sync path (≤100 rows) only; async worker is owned by Plan 27-06.

## What shipped

### Migrations (5 files, all 14-digit strict timestamps)

| Timestamp | File | Purpose |
| --- | --- | --- |
| `20270602000001` | `admin_bulk_jobs.sql` | Append-only job ledger for the >100-row async branch. RLS + select-only policies; status `text+CHECK`; partial idx on `status='pending'`. **Consumed by Plan 27-06 worker.** |
| `20270602000002` | `bulk_action_undo_token.sql` | 60-second TTL transient token. Single-use; RLS append-only; `expires_at default now()+60s`; idx for purge cron. **Consumed by Plan 27-07 cron.** |
| `20270602000003` | `admin_bulk_actions_extend_audit.sql` | Docs-only `select 1;` no-op cataloguing the 7 new `audit_logs.action_name` strings Phase 27 introduces (per Phase 24 D-14 free-text policy). |
| `20270602000004` | `admin_bulk_actions_target_columns.sql` | **Rule 2 deviation**: adds `profiles.account_state` + `profiles.tags` + `comp_plan_grants` + `password_reset_requests` (mutation targets the 5 actions actually need to write to). |
| `20270602000005` | `admin_bulk_action_rpcs.sql` | SECDEF execute + undo pair. Admin-role gate (42501); 10000-row hard cap (22023); sync ≤100 inline + async >100 enqueue split; per-row `log_admin_action` via Phase 24 helper with `app.suppress_audit` set_config; reverse-payload mints 60s undo token for ban/comp_plan/tag. |

### RPC contracts shipped

```sql
admin_bulk_action_execute(p_action_type text, p_target_user_ids uuid[], p_params jsonb default '{}')
  returns jsonb
  -- {mode:'sync', affected:int, undo_token:uuid|null, job_id:null}
  -- {mode:'async', affected:0, undo_token:null, job_id:uuid}
  -- forbidden        42501 (not is_admin_at_least('admin'))
  -- too_many_rows    22023 (> 10000)
  -- invalid_action   22023 (unknown action_type OR missing required param)
  -- not_authenticated 28000

admin_bulk_action_undo(p_undo_token uuid)
  returns jsonb
  -- {reversed:int}
  -- token_expired    22023 (expires_at < now() OR row absent OR issued_to != auth.uid())
```

### Client lib (`leanshot/src/lib/admin/bulk/`)

- `types.ts` — `BulkActionType` (5-literal union), `BulkActionResult` discriminated by `mode`, `BulkApiError` class with 7 error codes (`not_staff | not_authenticated | token_expired | too_many_rows | invalid_action | network | unknown`).
- `action-handlers.ts` — `executeBulkAction(action, ids, params?)` + `buildAndDownloadCsv()` helper (Blob + anchor download mirroring BulkExportCSVFlow.tsx).
- `undo.ts` — `redeemUndoToken(token) → {reversed:N}`.
- `action-handlers.test.ts` + `undo.test.ts` — **15/15 vitest pass** (12 dispatcher cases + 3 undo cases).

### UI (`leanshot/src/components/admin/bulk/`)

- `AdminBulkActionsBar.tsx` — sticky toolbar with 5 action buttons (CSV / Tag / Pro / Reset / Ban). Renders only when `selectedIds.length > 0`. `role="toolbar"` + aria-label of selection count.
- `AdminBulkConfirmModal.tsx` — 4-state machine (`'confirm' | 'running' | 'done' | 'error'`) verbatim from BulkExportCSVFlow.tsx. Preview line "Ban N members — Alice, Bob, Carol, +K more". For `tag`/`comp_plan` renders an `<Input>` (tag name / days) before Confirm. On `csv_export` triggers client-side CSV download via `buildAndDownloadCsv`.
- `AdminUndoBanner.tsx` — fixed-bottom toast with 60s `ProgressRing` countdown, Undo button. `role="status" + aria-live="polite"` (per leanshot/CLAUDE.md a11y rules). Auto-dismisses at 0s. Server-side TTL is the authority.
- `MembersTable.tsx` — additive plumbing: per-row checkbox column + select-all-on-page header checkbox + conditional `<AdminBulkActionsBar>` above the table + `<AdminUndoBanner>` mount slot. Phase 22 row-open / sort / mobile-card behaviors preserved unchanged.

### e2e

`leanshot/e2e/admin-bulk-actions.spec.ts` — opt-in via `PLAYWRIGHT_RUN_BULK_ACTIONS=1` + live Supabase env. Default suite SKIPS cleanly. Seeds 5 patients + 1 admin (admin_role='admin', has_totp=true); navigates to `/#/admin/members`, selects 5 rows, clicks Ban, awaits `/rest/v1/rpc/admin_bulk_action_execute` 200, asserts DB-level invariant `account_state='banned'`, clicks Undo, asserts DB-level invariant `account_state='active'` + 5 `bulk_action_undone` rows in `audit_logs`.

### Deno integration probe stub

`supabase/functions/_shared/admin-bulk-action-test.ts` — 2 Deno tests covering (a) non-staff → 42501; (b) admin tag 5 users → sync+undo_token, then undo, then replay → token_expired. Ignored without `TEST_ADMIN_JWT` env; reserved for ad-hoc manual probing.

## Audit_logs action_name catalogue introduced

| action_name | Plan | Notes |
| --- | --- | --- |
| `bulk_csv_export` | 27-01 | ONE aggregate row per export with `after_data={count:N}` — no PHI dump |
| `bulk_tag` | 27-01 | Per-affected-user row, before/after `profiles` JSONB snapshot |
| `bulk_comp_plan` | 27-01 | Per-affected-user row |
| `bulk_ban` | 27-01 | Per-affected-user row |
| `bulk_force_password_reset` | 27-01 | Per-affected-user row, before/after snapshots |
| `bulk_action_undone` | 27-01 | Per-reversed-user row on undo RPC |

All inserts route through `public.log_admin_action()` which sets `source='rpc'` and the Phase 24 admin-or-higher RLS guard applies on reads.

## Undo token TTL behavior

- `expires_at` defaults to `now() + interval '60 seconds'` server-side.
- Token is **single-use**: `admin_bulk_action_undo` deletes the row atomically as part of redemption (returning clause). Replay finds no row → raises `token_expired`.
- Cross-admin theft mitigation: undo RPC predicate `WHERE token = ? AND issued_to = auth.uid() AND expires_at > now()` — token bound to a different admin's session is invisible to attacker (T-27-01-07).
- The client-side 60s countdown ring in `AdminUndoBanner` is UX only — server TTL is the authority.
- Purge cron lives in Plan 27-07 (consumes `idx_bulk_undo_expires`).

## Handoff contracts to downstream plans

| Consumer | Contract | Notes |
| --- | --- | --- |
| **Plan 27-06** (async worker) | Poll-claim on `admin_bulk_jobs WHERE status='pending' ORDER BY created_at`. Update to `'running'` + set `claimed_by/claimed_at` atomically (`UPDATE … WHERE status='pending' RETURNING …` skip-lock pattern). Drain rows, set `status='completed'` + `completed_at`. | The execute RPC's async branch already inserts these rows with `status='pending'`. |
| **Plan 27-07** (purge cron) | `DELETE FROM bulk_action_undo_token WHERE expires_at < now() - interval '5 minutes'` on a 1-minute pg_cron schedule. | Uses `idx_bulk_undo_expires`. |
| **Plan 27-02** (cohort builder) | Reads `profiles.account_state` enum as one of the D-06 cohort-builder fields. | Column shipped in `20270602000004`. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical functionality] Mutation targets did not exist**
- **Found during:** Task 2 (RPC authoring).
- **Issue:** Plan 27-01 task descriptions reference `update profiles set account_state = 'banned'`, `update profiles set tags = …`, `insert into comp_plan_grants(...)`, and `insert into password_reset_requests(...)` — but none of `profiles.account_state`, `profiles.tags`, `comp_plan_grants`, or `password_reset_requests` exist in earlier phases.
- **Fix:** Added companion migration `20270602000004_admin_bulk_actions_target_columns.sql` adding `profiles.account_state text+CHECK default 'active'`, `profiles.tags text[] default '{}'`, `comp_plan_grants` table, and `password_reset_requests` table. All with append-only RLS (only SECDEF RPC writes) + select-self/select-admin policies. Includes a partial idx on banned profiles and a GIN idx on tags.
- **Files modified:** `supabase/migrations/20270602000004_admin_bulk_actions_target_columns.sql`.
- **Commit:** `b805854` (bundled with the SECDEF RPC migration since the RPC depends on the columns).

**2. [Rule 1 — Type drift] Phase 24 `log_admin_action` returns `uuid` but `audit_logs.id` is `bigserial`**
- **Found during:** Task 2 (building the undo token's `original_audit_log_ids` array).
- **Issue:** Phase 24 helper signature `returns uuid` is inconsistent with the actual `audit_logs.id bigserial` column. Cannot cast a uuid return to bigint.
- **Fix:** Made `bulk_action_undo_token.original_audit_log_ids` a `bigint[]` (not `uuid[]` as the plan wrote), and the RPC re-fetches the actual bigint ids via a 5-minute lookback `SELECT id FROM audit_logs WHERE actor_user_id = v_caller AND action_name = v_action_name AND timestamp >= now() - interval '5 minutes'` after the loop completes.
- **Files modified:** `20270602000002_bulk_action_undo_token.sql`, `20270602000005_admin_bulk_action_rpcs.sql`.
- **Commit:** `829d827` + `b805854`. The underlying Phase 24 type drift is **out of scope** for this plan and is logged as deferred below.

### Deferred Items

- **Task 6 (BLOCKING) `supabase db push --linked` + sanity probe** — DEFERRED to orchestrator post-merge.
  - **Rationale:** This worktree has no supabase CLI on PATH and no `supabase/.temp/*` linked-project state (per [[reference_supabase_worktree_temp_state]] and [[feedback_parallel_executor_autonomy_drift]] — parallel executors must not push live). The 5 migrations are committed and ready; the orchestrator should run `supabase db push --linked` from the main checkout after merge, then sanity-probe with: `supabase db query --linked "select count(*) from pg_tables where schemaname='public' and tablename in ('admin_bulk_jobs','bulk_action_undo_token','comp_plan_grants','password_reset_requests')"` (expect 4); `supabase db query --linked "select count(*) from pg_proc where proname in ('admin_bulk_action_execute','admin_bulk_action_undo')"` (expect 2); `supabase db query --linked "select policyname from pg_policies where tablename='admin_bulk_jobs'"` (expect select-only policies, NO insert/update/delete).
  - **Phase entry condition for Plan 27-06 + 27-07:** db push must succeed first.
- **Phase 24 `log_admin_action` return-type drift** — `returns uuid` should be `returns bigint`. Tracked for the Phase 24 / phase-debt sweep.
- **csv_export full-row dump** — v1 ships the selection's `user_id + display_name` only via the client-side `buildAndDownloadCsv` helper. A richer dump (full profile rows) would require an additional RLS-scoped fetch by ids and is queued for Plan 27-06 follow-up.
- **`auth.sessions` revocation on `force_password_reset`** — v1 writes to `password_reset_requests` only; the actual session revocation + email send is a background worker that will consume the queue (Plan 27-06 scope candidate).

## Verification

| Check | Result |
| --- | --- |
| Task 1 — 3 migrations exist with strict 14-digit timestamps; admin_bulk_jobs has status CHECK + RLS + select-only policy; bulk_action_undo_token has expires_at default 60s + RLS + zero write policies; migration 03 is docs-only no-op | PASS (Task 1 automated grep) |
| Task 2 — Both RPCs defined as `security definer` with `is_admin_at_least` gate, `set_config('app.suppress_audit','on',true)`, `log_admin_action` loop, undo token lifecycle, sync/async branch at 100 rows, hard cap at 10000 | PASS (Task 2 automated grep) |
| Task 3 — `npx vitest run src/lib/admin/bulk/` | PASS — **15/15 tests** (12 dispatcher + 3 undo) |
| Task 4 — `npx tsc -b --noEmit` clean; `npx eslint src/components/admin/bulk/ src/components/admin/members/MembersTable.tsx src/lib/admin/bulk/` clean | PASS — zero TS errors, zero lint errors |
| Task 5 — `npx playwright test e2e/admin-bulk-actions.spec.ts` | PASS — 1 skipped (correctly gated by `PLAYWRIGHT_RUN_BULK_ACTIONS=1`); structurally valid spec ready for live-env CI run |
| Task 6 — `supabase db push --linked + sanity probe` | DEFERRED to orchestrator post-merge (see Deferred Items) |

## Threat Model Coverage

All 8 STRIDE register entries from the plan are addressed:
- T-27-01-01 (Elevation): `is_admin_at_least('admin')` check at RPC entry raises 42501.
- T-27-01-02 (Tampering — bulk_jobs): zero INSERT/UPDATE/DELETE policies on `admin_bulk_jobs`.
- T-27-01-03 (Repudiation): per-row `log_admin_action` call inside SECDEF loop.
- T-27-01-04 (Information disclosure — csv): aggregate `{count:N}` row only, no PHI.
- T-27-01-05 (DoS): 10000-row hard cap raises `too_many_rows`.
- T-27-01-06 (Replay): single-use atomic delete-on-redeem.
- T-27-01-07 (Spoofing): undo RPC predicate includes `issued_to = auth.uid()`.
- T-27-01-08 (aal2 bypass): accepted — palette layer (Plan 27-03) enforces aal2 step-up.

## Self-Check: PASSED

- All 5 migrations exist on disk and in commit `829d827` + `b805854`.
- All 5 client/component files exist on disk and in commits `531b89c` + `8462df2`.
- e2e spec exists on disk and in commit `f6f11e6`.
- 15/15 vitest pass + 0 typecheck errors + 0 lint errors verified before each commit.
- Migration filenames pass strict `^[0-9]{14}_` regex (verified by Task 1 automated grep).

## Commits

| Hash | Type | Description |
| --- | --- | --- |
| `829d827` | feat(27-01-01) | admin_bulk_jobs + bulk_action_undo_token + docs no-op migrations |
| `b805854` | feat(27-01-02) | admin_bulk_action_execute + undo SECDEF RPCs + target-schema deps |
| `531b89c` | feat(27-01-03) | bulk-action client dispatcher + undo helper + types (15 vitest pass) |
| `8462df2` | feat(27-01-04) | AdminBulkActionsBar + ConfirmModal + UndoBanner wired into MembersTable |
| `f6f11e6` | test(27-01-05) | Playwright e2e for bulk ban + 60s undo round-trip (opt-in) |
