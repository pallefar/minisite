-- Phase 22 plan 01 — D-05: add impersonator_id column to audit_logs.
-- Analog: supabase/migrations/20260701000001_audit_logs_share_columns.sql (additive-column ALTER TABLE)
-- Pitfalls applied: Pitfall 1 (partial index WHERE clause uses column-vs-literal IS NOT NULL,
--                              IMMUTABLE-safe; no now()/current_*).
--
-- DEVIATION from plan body: plan instructed adding both `impersonator_id` AND `target_user_id`.
-- Inspection of 20260901000003_rank_org_patients_rpc.sql (lines 47-49) confirms `target_user_id uuid
-- references auth.users(id) on delete set null` was ALREADY added in Phase 10. To avoid a re-add of an
-- existing column (would error without IF NOT EXISTS; with IF NOT EXISTS it's a no-op but reads as
-- regression), this migration only adds the net-new `impersonator_id` column. The `target_user_id`
-- column is already in the live schema and behaves correctly for P22 impersonation audit rows.
--
-- ON DELETE SET NULL mirrors the existing `user_id` FK behaviour (20260601000001 lines 55-56) so the
-- audit row survives auth.users deletion — required for HBNR/GDPR forensic retention.
--
-- Partial index keeps the index thin: most audit rows have no impersonator (everyday user writes).

alter table public.audit_logs
  add column if not exists impersonator_id uuid references auth.users(id) on delete set null;

create index if not exists audit_logs_impersonator_idx
  on public.audit_logs (impersonator_id, timestamp desc)
  where impersonator_id is not null;
