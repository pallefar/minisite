-- Phase 9 Plan 09-01 — audit_logs extension for clinic B2B (org_id + clinic actor types + clinic action whitelist).
--
-- Extends the Phase 7 audit_logs table (20260601000001_audit_logs.sql) and the
-- Phase 8 audit_actor_type enum (20260701000001_audit_logs_share_columns.sql)
-- with the columns + actor_type values + action whitelist Phase 9 needs to
-- record every operator/member write across orgs, memberships, invites,
-- roles, role_permissions, and Storage object access for clinic photos.
--
-- ORDERING: this migration adds an `org_id` NULLABLE column WITHOUT a foreign
-- key (the FK lands in 20260801000004 after the orgs table exists).
--
-- Per memory `reference_supabase_migration_gotchas.md`:
--   (gotcha 1) the new partial index on (org_id, created_at desc) WHERE
--   actor_type IN ('org_operator','org_member') uses ONLY column-vs-literal
--   comparisons, no now()/current_timestamp — IMMUTABLE-safe.
--
-- D-06 + D-18 + D-07 carry-forwards: every revoke / scope-change / role-edit
-- writes a row via SECURITY DEFINER RPCs (added in 20260801000011). The
-- `actor_type='org_operator'` rows are operator-side writes; the
-- `actor_type='org_member'` rows are patient-side writes (consent-scope edits,
-- self-revoke, accept-invite). The skeleton row written by `delete_org` lands
-- BEFORE the cascade so we still have an audit trace after the org row dies.
--
-- audit_logs has NO authenticated INSERT policy (Phase 7 default-deny). Only
-- the SECURITY DEFINER RPCs in 20260801000011 + the existing audit_trigger()
-- can write. This migration does not change that contract.

-- 1. Extend audit_actor_type enum with the two clinic actors. Each ADD VALUE
-- is its own statement because Postgres does NOT allow adding multiple enum
-- values inside a transaction with other DDL on the same enum (per the docs).
-- IF NOT EXISTS makes the migration safely re-runnable.
alter type public.audit_actor_type add value if not exists 'org_operator';
alter type public.audit_actor_type add value if not exists 'org_member';

-- 2. Add nullable org_id column. FK constraint lives in 20260801000004 (after
-- orgs exists). Nullable because pre-Phase-9 rows + non-clinic actions don't
-- carry an org_id.
alter table public.audit_logs
  add column if not exists org_id uuid;

-- 3. Extend the action whitelist. Postgres's auto-named CHECK constraint
-- from the chain Phase 7 → Phase 8 is `audit_logs_action_check`. Drop and
-- re-add idempotently with the union of all prior values plus the 13 new
-- clinic actions (D-06, D-07, D-12, D-18 + role CRUD + permission_denied +
-- clinic_photo_view).
alter table public.audit_logs
  drop constraint if exists audit_logs_action_check;

alter table public.audit_logs
  add constraint audit_logs_action_check
  check (action in (
    -- Phase 7 baseline (20260601000001_audit_logs.sql)
    'insert', 'update', 'delete',
    'account_deleted_initiated', 'account_deleted_finalized',
    -- Phase 8 (20260701000001_audit_logs_share_columns.sql)
    'share_view',
    -- Phase 9 — org lifecycle
    'org_create', 'org_update', 'org_delete',
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
    'role_create', 'role_update', 'role_delete'
  ));

-- 4. Partial index supporting clinic audit aggregate queries
-- (per-org timeline: "show me everything that happened in org X this week").
-- IMMUTABLE-safe: only column-vs-literal comparisons; no now()/current_*.
-- Sort by created_at desc to match the query shape (most-recent-first).
-- NOTE: audit_logs uses `timestamp` (not `created_at`) per Phase 7 schema —
-- column name is `timestamp` (default now()). Index uses that.
create index if not exists audit_logs_clinic_actor_idx
  on public.audit_logs (org_id, timestamp desc)
  where actor_type in ('org_operator', 'org_member');

-- 5. The audit_trigger() function from 20260601000017_audit_trigger_suppress_guc.sql
-- requires NO modification. It only inserts via tg_op (insert/update/delete),
-- which is unrelated to the new clinic actions. The clinic action rows are
-- written DIRECTLY by SECURITY DEFINER RPCs (in 20260801000011), bypassing
-- the trigger. The `app.suppress_audit` GUC bypass that the trigger honours
-- is what `delete_org` uses to suppress mid-cascade audit row writes.
