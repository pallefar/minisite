-- Phase 22 plan 01 — D-05/D-04/D-06/D-08/D-01: extend audit_logs.action CHECK constraint with 11 new Phase 22 values.
-- Analog: supabase/migrations/20260901000001_extend_audit_action_enum_phase10.sql (drop+re-add idiom)
-- Pitfalls applied: Pitfall 3 (DDL-only migration; no ADD VALUE-in-same-tx use because audit_logs.action
--                              is a TEXT column with CHECK constraint, NOT an enum — confirmed via grep
--                              of 20260601000001 + 20260901000001. Therefore the 55P04 sqlstate risk
--                              does not apply, but we still ship as a separate migration before any
--                              downstream RPC that uses the new values (File 15).
--
-- DEVIATION from plan body: plan instructed `ALTER TYPE public.audit_action_type ADD VALUE …`. The
-- audit_logs.action column is TEXT with a CHECK constraint (not an enum). Switching to the drop+re-add
-- CHECK pattern established by Phase 8 (20260701000001), Phase 9 (20260801000001), and Phase 10
-- (20260901000001). All prior values preserved verbatim to avoid orphaning existing rows.
--
-- 11 new Phase-22 values (per must_haves):
--   impersonate_start, impersonate_end, impersonate_blocked_write   — D-05 read-only impersonation
--   refund_issued, subscription_canceled_admin, subscription_comped — D-05 admin stripe actions
--   feature_flag_override_set                                       — D-08 per-user PostHog overrides
--   dsar_requested, dsar_completed                                  — D-06 DSAR portal
--   consent_recorded                                                — D-07 cookie consent + email prefs
--   account_deletion_cancelled                                      — D-01 7-day cancel flow

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
      'clinic_snapshot_loaded',
      -- Phase 22 — owner/admin impersonation (D-05)
      'impersonate_start',
      'impersonate_end',
      'impersonate_blocked_write',
      -- Phase 22 — admin Stripe actions (D-05)
      'refund_issued',
      'subscription_canceled_admin',
      'subscription_comped',
      -- Phase 22 — PostHog feature-flag per-user overrides (D-08)
      'feature_flag_override_set',
      -- Phase 22 — DSAR portal (D-06)
      'dsar_requested',
      'dsar_completed',
      -- Phase 22 — cookie consent + email preferences (D-07)
      'consent_recorded',
      -- Phase 22 — 7-day soft-delete cancel flow (D-01)
      'account_deletion_cancelled'
    )
  );
