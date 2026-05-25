---
phase: 24-foundation-modular-admin-shell-event-taxonomy-server-side-po
plan: "06"
subsystem: admin-audit
tags: [audit-log, cold-archive, rls, edge-function, parquet, csv, json-diff]
dependency_graph:
  requires: [24-01, 24-03]
  provides: [audit-log-viewer, audit-archive-edge-fn, delete-archived-rpc]
  affects: [admin-shell, audit_logs-table, audit-archive-storage-bucket]
tech_stack:
  added: []
  patterns:
    - TDD RED/GREEN for React component suite
    - cursor-based pagination (created_at desc, id desc)
    - SECURITY DEFINER RPC for RLS-bypass DELETE
    - DuckDB-attempt-then-CSV fallback pattern
    - DB-level RLS invariant e2e (feedback_realtime_layer_e2e_pattern)
key_files:
  created:
    - leanshot/src/components/admin/AuditLogModule.tsx
    - leanshot/src/components/admin/audit/JsonDiffViewer.tsx
    - leanshot/src/components/admin/audit/AuditFilterBar.tsx
    - leanshot/src/components/admin/audit/AuditRowExpand.tsx
    - leanshot/src/components/admin/__tests__/AuditLogModule.test.tsx
    - supabase/functions/audit-archive/index.ts
    - supabase/functions/audit-archive/audit-archive.test.ts
    - supabase/migrations/20270601000034_audit_archive_delete_rpc.sql
    - leanshot/e2e/admin-audit-rls.spec.ts
  modified:
    - leanshot/src/components/admin/AuditLogModule.tsx (replaced Plan 24-03 stub)
decisions:
  - "DuckDB Parquet path falls back to CSV: npm:duckdb build scripts blocked by Deno runtime (RESEARCH A2 confirmed unverified). CSV fallback active. Tracked as deviation."
  - "Migration filename renumbered from 20260518000009 to 20270601000034 per phase notes (reference_supabase_migration_filename_regex)."
  - "JsonDiffViewer is a shared component intended for both admin AuditLogModule and clinic AuditTab; exported from audit/JsonDiffViewer.tsx."
metrics:
  duration: "~35 minutes"
  completed: "2026-05-17"
  tasks_completed: 3
  tasks_total: 3
  files_created: 9
---

# Phase 24 Plan 06: Audit Log Viewer + Cold Archive — Summary

Implements the audit log viewer (replacing Plan 24-03 stub) and the nightly cold-archive Edge Function. Superadmins can now view, filter, and diff all audit_logs rows. The pg_cron entry from Plan 24-01 now targets a real function that writes rows older than 90 days to the private `audit-archive` Storage bucket, then deletes them via a SECURITY DEFINER RPC. ADMIN-02 acceptance criteria closed.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | AuditLogModule failing tests | 3258ad2 | AuditLogModule.test.tsx |
| 1 (GREEN) | AuditLogModule + JsonDiffViewer + AuditFilterBar + AuditRowExpand | 405c18b | AuditLogModule.tsx, audit/*.tsx |
| 2 | audit-archive Edge Function + SECDEF migration | 19497a5 | audit-archive/index.ts, audit-archive.test.ts, migration |
| 3 | e2e admin-audit-rls spec | 194a535 | e2e/admin-audit-rls.spec.ts |

## What Was Built

### AuditLogModule (Task 1)

- **AuditLogModule.tsx**: Replaces Plan 24-03 stub. Fetches `audit_logs` via Supabase SELECT (`*, actor:auth.users!actor_user_id(email), target:auth.users!target_user_id(email)`). Cursor-based pagination on `(created_at desc, id desc)`. Filter bar wired to query refetch. Row click expands `AuditRowExpand`.
- **JsonDiffViewer.tsx**: Hand-rolled recursive diff renderer. `diffKeys(a, b)` computes `added/removed/changed/unchanged` status for each key. Renders as `<dl>` with `data-diff-status` attributes (AA-contrast colors). T-24-03d PHI string truncation at 200 chars with "truncated" indicator.
- **AuditFilterBar.tsx** (admin version): actor email, target email, table_name (select from D-14 list), action_name (free text), date range — all 300ms debounced.
- **AuditRowExpand.tsx**: Header with action/actor/target/timestamp metadata + `<JsonDiffViewer>` body.
- **5 RTL tests pass**: column render, filter input presence, row expand, diff status attributes, load-more button.

### audit-archive Edge Function (Task 2)

- **supabase/functions/audit-archive/index.ts**: Verifies service-role bearer. Checks `audit-archive` bucket exists and is private (T-24-18). Validates `p_cutoff >= 90 days ago` (T-24-03c). Fetches rows in 10k chunks. Attempts DuckDB Parquet; falls back to CSV (see deviation). Uploads to `audit-archive/YYYY/MM/DD.csv`. Idempotent: appends `-rerun-<epoch>` if file already exists. Calls `delete_archived_audit_rows` SECDEF RPC.
- **5 Deno tests pass**: SMOKE/DuckDB-fallback, 200+archived_count, RPC called, bucket-missing 500, idempotency suffix.
- **20270601000034_audit_archive_delete_rpc.sql**: `delete_archived_audit_rows(p_cutoff)` SECURITY DEFINER, `set search_path = extensions, public, pg_temp`, `app.suppress_audit = 'on'` local, `p_cutoff > now() - 89d` guard, GRANT to `authenticated, service_role`.

### e2e Spec (Task 3)

- **admin-audit-rls.spec.ts**: 3 DB-level invariant tests + 1 UI test (guarded by `PLAYWRIGHT_RUN_ADMIN_AUDIT=1`). DB tests: superadmin SELECT pass, low-priv SELECT returns empty (RLS filters), service_role SELECT pass. UI test: navigate, find row by action_name, click to expand, assert diff renders. Auto-skips without live Supabase creds.

## Deviations from Plan

### Auto-fixed Issues

None.

### Rule 1 (DuckDB Parquet path unavailable — CSV fallback)

**Found during:** Task 2 implementation and SMOKE test
**Issue:** RESEARCH A2 flagged DuckDB Deno-compat as UNVERIFIED. When `npm:duckdb` is imported in Deno, the build scripts are blocked because `nodeModulesDir` is not configured. The DuckDB Database constructor cannot run without the native binary built by postinstall scripts.
**Fix:** The SMOKE test confirms DuckDB fails gracefully. CSV fallback path is the active archive format. Archive files are written as `.csv` to `audit-archive/YYYY/MM/DD.csv`. A `CRITICAL:` warning is logged to surface in any future review.
**Files modified:** `supabase/functions/audit-archive/index.ts`
**Status:** Known limitation per RESEARCH A2. Future plan: configure `"nodeModulesDir": "auto"` in a Deno config and re-verify DuckDB Parquet path. CSV archives are still queryable (DuckDB CLI, pandas, etc.).
**Commit:** 19497a5

### Migration filename renumbered (Phase notes direction)

**Issue:** Plan listed `20260518000009_audit_archive_delete_rpc.sql` but phase-specific notes required renaming to `20270601000034` to follow the Phase 24 migration numbering series and avoid the 14-digit timestamp regex trap.
**Fix:** Created `20270601000034_audit_archive_delete_rpc.sql`.
**Commit:** 19497a5

## Threat Surface Scan

| Flag | File | Description |
|------|------|-------------|
| threat_flag: service_role_bypass | supabase/functions/audit-archive/index.ts | Edge Fn uses service_role to bypass RLS for SELECT + delegates DELETE to SECDEF RPC; caller auth checks service_role bearer equality |
| threat_flag: secdef_rpc | supabase/migrations/20270601000034_audit_archive_delete_rpc.sql | SECURITY DEFINER function grants DELETE bypass with p_cutoff guard (T-24-03c mitigated) |

Both threats are in the plan's `<threat_model>` (T-24-03c, T-24-17, T-24-18) — mitigations applied per plan.

## Self-Check: PASSED
