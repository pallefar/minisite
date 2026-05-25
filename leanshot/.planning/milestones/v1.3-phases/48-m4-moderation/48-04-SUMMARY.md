---
phase: 48-m4-moderation
plan: 04
subsystem: database
tags: [postgres, supabase, secdef-rpc, rls, append-only-audit, hipaa-14, edge-fn, audit-archive]

# Dependency graph
requires:
  - phase: 24
    provides: audit-archive Edge Fn + 90d/Parquet cold-archive lifecycle + delete_archived_audit_rows SECDEF RPC
  - phase: 25
    provides: phi_access_log + log_phi_access SECDEF RPC (verbatim shape analog for moderation_audit_log + log_moderation_action)
  - phase: 47
    provides: public.is_staff() helper at supabase/migrations/20261101000006_is_staff_helper.sql
provides:
  - moderation_audit_log table (append-only, staff-only SELECT, REVOKE service_role UPDATE/DELETE)
  - log_moderation_action SECDEF RPC (single funnel for all moderation paths; auth.uid() sourced inside body; service_role + authenticated EXECUTE)
  - audit-archive Fn TABLES_TO_ARCHIVE registry (extended from single-table audit_logs to multi-table loop)
affects: [48-02 report_content, 48-03 apply_user_moderation, 48-07 claude-moderation Fn, 48-08 banned_words trigger, 48-09 ban-enforcement Fn, 48-10 triage_report/dismiss_report/resolve_report, 48-11 audit-archive widening migration + delete_archived_moderation_audit_rows RPC, 48-12 phase close-out (db push + Fn deploy)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Append-only audit table mirroring phi_access_log (Phase 25) — bigserial id, FK actor on delete set null, RLS staff-only SELECT, REVOKE service_role UPDATE/DELETE, no INSERT policy for authenticated"
    - "SECDEF RPC accepting NULL actor for system callers (cron, service-role triggers) — distinct from log_phi_access null-actor-raise; action_type disambiguates system origin"
    - "audit-archive multi-table registry pattern (TABLES_TO_ARCHIVE: ArchiveTable[]) — per-table independent fetch/upload/delete; partial-success (207) when delete RPC missing"

key-files:
  created:
    - supabase/migrations/20270901000008_p48_moderation_audit_log.sql
    - supabase/migrations/20270901000009_p48_log_moderation_action_rpc.sql
  modified:
    - supabase/functions/audit-archive/index.ts
    - supabase/functions/audit-archive/audit-archive.test.ts

key-decisions:
  - "Mirror phi_access_log immutability shape verbatim (D-16): RLS default-deny on writes + REVOKE UPDATE/DELETE on service_role + SECDEF-only insert path."
  - "Diverge from log_phi_access on actor_id nullability: log_moderation_action accepts NULL actor (cron, service-role triggers, claude-moderation Fn). action_type disambiguates system actions (temp_restore, auto_flag, banned_word_match)."
  - "Grant EXECUTE on log_moderation_action to BOTH authenticated AND service_role — the only Phase 48 SECDEF RPC granted to service_role (Edge Fn cron callers have no user JWT). Documented in commit message + migration header."
  - "Refactor audit-archive to TABLES_TO_ARCHIVE registry rather than parallel single-table Fn. Per-table loop tolerates missing delete RPC (returns 207 partial-success) so moderation_audit_log archival can be enabled before its delete RPC migration ships in Phase 48-11."

patterns-established:
  - "Negative-space tamper comment: every append-only audit migration enumerates the TWO write paths (SECDEF RPC + service_role INSERT) in a header block so reviewers see the invariant at a glance."
  - "audit-archive table registry: namespacing storage paths by short_name (`<table>/YYYY/MM/DD.csv`) + per-table delete RPC name (`delete_archived_<short>_rows`). Adding a new table = one ArchiveTable{} entry + one delete RPC migration."

requirements-completed: [MOD-05]

# Metrics
duration: ~20min
completed: 2026-05-24
---

# Phase 48 Plan 04: moderation_audit_log append-only schema + log_moderation_action SECDEF RPC + audit-archive Fn registry extension Summary

**Immutable moderation audit table (bigserial id, FK actor on-delete-set-null, target_type CHECK, staff-only SELECT, service_role UPDATE/DELETE REVOKEd) + single-funnel SECDEF RPC sourcing actor_id from auth.uid() inside body (accepts NULL for cron/service-role callers) + Phase 24 audit-archive Fn refactored from single-table audit_logs hardcode to TABLES_TO_ARCHIVE registry covering both audit_logs and moderation_audit_log**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-05-24T01:28Z
- **Completed:** 2026-05-24T01:49Z
- **Tasks:** 3
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- Append-only `moderation_audit_log` table with staff-only RLS + service_role REVOKE on UPDATE/DELETE — satisfies HIPAA-14 immutability invariant verbatim per Phase 25 phi_access_log analog (D-16).
- `log_moderation_action` SECDEF RPC: single write funnel for every moderation path (report_filed, mute_applied, ban_applied, temp_restore, auto_flag, banned_word_match, session_revoked, report_triaged). actor_id sourced from `auth.uid()` INSIDE the function body — caller-spoofed actor is impossible because the signature does not accept actor_id (T-48-16 mitigation).
- `audit-archive` Edge Fn refactored from single-table hardcode to a TABLES_TO_ARCHIVE registry; per-table independent archive pass; 207 partial-success when delete RPC missing so a new table can be registered before its delete RPC ships.

## Task Commits

Each task was committed atomically:

1. **Task 1: moderation_audit_log table + RLS + REVOKE** — `9de74af1` (feat)
2. **Task 2: log_moderation_action SECDEF RPC** — `aab60ab0` (feat)
3. **Task 3: audit-archive Fn TABLES_TO_ARCHIVE registry extension** — `ad52f548` (feat)

## Files Created/Modified
- `supabase/migrations/20270901000008_p48_moderation_audit_log.sql` (created) — Table DDL + 2 indexes + RLS staff-only SELECT policy + REVOKE UPDATE/DELETE on service_role.
- `supabase/migrations/20270901000009_p48_log_moderation_action_rpc.sql` (created) — SECDEF RPC with `set search_path = public, extensions`; v_actor := auth.uid(); accepts NULL actor; GRANT EXECUTE to authenticated + service_role.
- `supabase/functions/audit-archive/index.ts` (modified) — Added `TABLES_TO_ARCHIVE: ArchiveTable[]` exported constant containing audit_logs + moderation_audit_log entries; refactored handler to per-table loop; per-table 207 partial-success path on delete-RPC failure; aggregate response shape preserves single-table archived_count/archived_path back-compat via SUM and first-successful-path.
- `supabase/functions/audit-archive/audit-archive.test.ts` (modified) — Updated Test 2 to assert per-table archived_count and total = rows × tables (rather than single-table count). Updated Test 5 idempotency to require every uploaded path contain `-rerun-` (rather than `uploadPaths.length === 1`).

## Decisions Made
- **D-16 verbatim shape:** Mirror phi_access_log immutability — RLS default-deny on writes + REVOKE UPDATE/DELETE on service_role + SECDEF-only insert path + service_role INSERT retained for backfill. Decisions inlined in migration header.
- **NULL actor_id permitted** (divergence from log_phi_access): system callers (cron, service-role triggers, claude-moderation Fn) have null `auth.uid()`. Per RESEARCH note "actor_id nullability" + memory `feedback_rpc_auth_uid_vs_service_role_mismatch`. action_type disambiguates system vs admin actions.
- **service_role GRANT EXECUTE on log_moderation_action**: only Phase 48 SECDEF RPC granted to service_role — Edge Fn cron callers have no user JWT. All other Phase 48 SECDEF RPCs (`report_content`, `apply_user_moderation`, `banned_word_upsert`, `triage_report`) stay authenticated-only.
- **Registry refactor (Task 3) chosen over parallel hardcoded blocks**: future tables (e.g., future Phase 49+ event-log tables) can be added by appending one entry + shipping one delete RPC migration. Per-table 207 partial-success path means new entries can be registered before delete RPCs ship — no all-or-nothing deployment coupling.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated `audit-archive.test.ts` to preserve invariants under multi-table loop**
- **Found during:** Task 3 (audit-archive Fn refactor)
- **Issue:** Two existing tests encoded single-table assumptions that broke with multi-table archival:
  - Test 2 asserted `archived_count === 3` (now `rows.length × TABLES_TO_ARCHIVE.length` = 6 with mock fixture returning same rows per table).
  - Test 5 idempotency asserted `uploadPaths.length === 1` (now N uploads, one per registered table).
- **Fix:** Updated Test 2 to assert per-table archived_count + total = `rows.length × tables.length`. Updated Test 5 to assert every uploaded path contains `-rerun-` suffix (preserves the actual invariant: idempotent re-runs add suffix to every upload).
- **Files modified:** `supabase/functions/audit-archive/audit-archive.test.ts`
- **Verification:** `deno test --allow-all --no-check supabase/functions/audit-archive/audit-archive.test.ts` → `5 passed | 0 failed (30ms)`.
- **Committed in:** `ad52f548` (Task 3 commit).
- **Scope note:** Test file was NOT in plan `files_modified`. Per deviation Rule 3 (auto-fix blocking issues), updating tests to preserve invariants under intentional behavior changes is in-scope — the alternative (leave broken) would prevent Plan 48-06 RLS proofs + Plan 48-12 close-out from passing.

---

**Total deviations:** 1 auto-fixed (1 blocking — test update co-located with Task 3 refactor).
**Impact on plan:** Necessary for correctness. No scope creep — test changes mirror the registry refactor 1:1.

## Issues Encountered

- **Deno test top-level Deno.serve trap** (per memory `reference_deno_test_top_level_serve_trap`): a debug script left a dangling listener on port 8000 between runs. Killed via `lsof -ti :8000 | xargs kill -9` before re-running the test suite. No code change required — pre-existing project-wide pattern.

## Open Items / Carry-Over to Plan 48-11 + 48-12

- **`delete_archived_moderation_audit_rows(p_cutoff)` SECDEF RPC migration**: not in `files_modified` for this plan. Until Plan 48-11 (audit-archive widening migration per RESEARCH line 436) ships it, the per-table audit-archive pass for moderation_audit_log will return 207 partial-success (rows uploaded but not deleted). audit_logs archival is unaffected. Documented inline in `audit-archive/index.ts` registry comment.
- **Plan 48-12 close-out** owns `supabase db push --linked` for migrations `20270901000008` + `20270901000009` and `supabase functions deploy audit-archive` for the Fn refactor.

## User Setup Required

None — no external service configuration required. Plan 48-12 close-out handles all CLI dispatch.

## Next Phase Readiness

- `log_moderation_action` RPC is callable from Plans 48-02 (`report_content`), 48-03 (`apply_user_moderation` already merged), 48-07 (claude-moderation Fn), 48-08 (banned_words trigger), 48-09 (ban-enforcement Fn), 48-10 (`triage_report`/`dismiss_report`/`resolve_report`) — single funnel ready.
- audit-archive table list ready for moderation_audit_log archival; deferred behavior (delete) ships in 48-11.
- Plan 48-06 (`supabase/tests/p48_audit_log_immutability.sql`) RLS proof can be written against this schema.

## Self-Check: PASSED

- `supabase/migrations/20270901000008_p48_moderation_audit_log.sql` — exists.
- `supabase/migrations/20270901000009_p48_log_moderation_action_rpc.sql` — exists.
- `supabase/functions/audit-archive/index.ts` — modified (grep count `moderation_audit_log` = 4 ≥ 1).
- `supabase/functions/audit-archive/audit-archive.test.ts` — modified (5/5 Deno tests pass).
- Commits `9de74af1`, `aab60ab0`, `ad52f548` — all present in `git log`.
- All acceptance-criteria greps verified:
  - F1 create table = 1; revoke = 1; CHECK = 1; on delete set null = 1.
  - F2 create function = 1; v_actor = 1; search_path = 1; grant service_role = 1.
  - F3 moderation_audit_log >= 1 (actual: 4).
- Filename regex compliance: `20270901000008_*.sql` + `20270901000009_*.sql` both match `^[0-9]{14}_[a-z_]+\.sql` (no letter suffixes).
- Timestamp uniqueness within `20270901*` window: confirmed (000001, 000005, 000006, 000007, 000008, 000009).

---
*Phase: 48-m4-moderation*
*Completed: 2026-05-24*
