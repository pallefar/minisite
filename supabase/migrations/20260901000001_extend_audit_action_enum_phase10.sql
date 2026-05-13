-- Phase 10 Plan 10-01 — extend audit_logs action_check constraint with 6 new Phase-10 actions.
--
-- T-10-01-01 (Tampering): This migration reads the FULL existing IN list from
-- Phase 9 migration 20260801000001_audit_logs_org_columns.sql and preserves
-- every prior enum value verbatim. Dropping any pre-existing value would orphan
-- existing audit_logs rows (constraint violation on the live table).
--
-- The constraint drop + re-add pattern is the established idiom per Phase 8 +
-- Phase 9 (20260701000001 and 20260801000001 both use it). Idempotent: if the
-- migration is re-applied the DROP IF EXISTS is a no-op and the ADD re-instates
-- the full set.
--
-- 6 NEW Phase-10 actions added (per D-04, D-09, D-18, D-21, D-22):
--   rank_computed         — one row per rank_org_patients RPC call (D-18)
--   rank_threshold_crossed — per-patient threshold-crossing event (D-18)
--   section_view          — operator viewed a specific section in drill-in (D-21)
--   bulk_pdf_export       — per-patient row during bulk PDF export (D-22)
--   bulk_csv_export       — per-patient row during bulk CSV export (D-22)
--   clinic_snapshot_loaded — operator loaded the full clinic-snapshot response (D-04)

alter table public.audit_logs
  drop constraint if exists audit_logs_action_check;

alter table public.audit_logs
  add constraint audit_logs_action_check check (
    action in (
      -- Phase 7 baseline (20260601000001_audit_logs.sql)
      'insert',
      'update',
      'delete',
      'account_deleted_initiated',
      'account_deleted_finalized',
      -- Phase 8 (20260701000001_audit_logs_share_columns.sql)
      'share_view',
      -- Phase 9 — org lifecycle (20260801000001_audit_logs_org_columns.sql)
      'org_create',
      'org_update',
      'org_delete',
      -- Phase 9 — invite + membership lifecycle (D-06, D-18)
      'membership_invite_sent',
      'membership_invite_accepted',
      'membership_invite_rejected',
      'membership_invite_canceled',
      'membership_revoked',
      'membership_scope_updated',
      'membership_role_changed',
      -- Phase 9 — clinic data access (D-12)
      'clinic_photo_view',
      -- Phase 9 — authorization gate failures
      'permission_denied',
      -- Phase 9 — role CRUD (D-07 admin UI)
      'role_create',
      'role_update',
      'role_delete',
      -- Phase 10 — roster ranking + per-patient threshold events (D-18)
      'rank_computed',
      'rank_threshold_crossed',
      -- Phase 10 — drill-in per-section audit (D-21)
      'section_view',
      -- Phase 10 — bulk export audit rows (D-22)
      'bulk_pdf_export',
      'bulk_csv_export',
      -- Phase 10 — clinic snapshot load audit (D-04)
      'clinic_snapshot_loaded'
    )
  );
