-- Phase 22 Plan 22-04 — DSAR status-machine writer RPCs (S6 audit closure).
--
-- Plan 22-01 File 06 (dsar_requests_table) already shipped `admin_reject_dsar`
-- as a Wave 0 deviation (per 22-01-SUMMARY deviation #3) to close the 'rejected'
-- terminal-state writer gap up front. This migration adds the remaining
-- USER-callable writer (`create_dsar_request`) and re-publishes `admin_reject_dsar`
-- with CREATE OR REPLACE so this migration is the single canonical source
-- for both writers post-Wave 1.
--
-- Status-machine writer audit (S6 — per feedback_status_machine_transition_owner.md):
--   pending     ← public.create_dsar_request RPC          (THIS migration)
--   in_progress ← dsar-export Edge Function (plan 22-04)  — UPDATE on processing start
--   completed   ← dsar-export Edge Function (plan 22-04)  — UPDATE on success
--   rejected    ← public.admin_reject_dsar RPC            (THIS migration; first shipped in File 06)
--
-- Re-publishing admin_reject_dsar here is idempotent (CREATE OR REPLACE FUNCTION).
-- The body matches File 06 verbatim; the duplication makes Plan 22-04's S6 audit
-- self-contained — anyone reading this migration sees both user + admin writers
-- in one place.

-- =============================================================================
-- create_dsar_request — user-callable RPC; INSERTs a `pending` row.
-- =============================================================================
-- Why an RPC instead of a direct INSERT from the DsarPortalPage client?
--   - Single point of enforcement for the "one active request at a time" rule.
--     RLS on dsar_requests permits INSERT with status='pending' but cannot
--     reject based on a pre-existing pending row.
--   - Co-locates the audit_logs INSERT (action='dsar_requested') with the
--     dsar_requests INSERT in a single transaction.
--
-- Threat register (carried over from plan 22-04 <threat_model>):
--   - T-22-?? Spoofing: zero parameters; auth.uid() is the only identity source.
--     User cannot create a DSAR request for someone else's account.
--   - T-22-?? Abuse: 'already_pending' raise prevents request-spam (one open
--     request per user). Admin can reject + user can retry.
create or replace function public.create_dsar_request()
returns uuid
language plpgsql
security definer
-- `extensions` resolves digest() (pgcrypto) used by the audit_logs INSERT
-- (user_id_hash column — see 20260601000001_audit_logs.sql lines 60-62).
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_request_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Abuse-prevention guard: one active request at a time per user.
  if exists (
    select 1 from public.dsar_requests
     where user_id = v_uid
       and status in ('pending', 'in_progress')
  ) then
    raise exception 'already_pending' using errcode = 'P0008';
  end if;

  -- Suppress the audit_logs trigger for the dsar_requests INSERT below — the
  -- skeleton audit row is written inline (action='dsar_requested') and we don't
  -- want a duplicate generic 'insert' audit row for the same write. Pattern
  -- from reference_supabase_migration_gotchas.md finding 4 (app.suppress_audit).
  perform set_config('app.suppress_audit', 'true', true);

  insert into public.dsar_requests (user_id, status)
  values (v_uid, 'pending')
  returning id into v_request_id;

  -- Inline audit-skeleton row (target_user_id = self; the DSAR is the user
  -- exercising their own GDPR Article 15 right).
  insert into public.audit_logs (
    user_id, user_id_hash, table_name, row_id, action, target_user_id
  ) values (
    v_uid,
    encode(digest(v_uid::text, 'sha256'), 'hex'),
    'dsar_requests',
    v_request_id::text,
    'dsar_requested',
    v_uid
  );

  return v_request_id;
end;
$$;

revoke all on function public.create_dsar_request() from public;
grant execute on function public.create_dsar_request() to authenticated;

-- =============================================================================
-- admin_reject_dsar — is_staff-gated RPC; re-published here for S6 self-contained
-- documentation (originally shipped in 20270601000006_dsar_requests_table.sql).
-- =============================================================================
create or replace function public.admin_reject_dsar(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_caller_uid uuid := auth.uid();
  v_target_user uuid;
begin
  if v_caller_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  update public.dsar_requests
     set status = 'rejected',
         rejection_reason = p_reason,
         completed_at = now()
   where id = p_request_id
     and status in ('pending', 'in_progress')
  returning user_id into v_target_user;

  if v_target_user is null then
    raise exception 'dsar_request_not_found_or_finalized' using errcode = 'P0002';
  end if;

  perform set_config('app.suppress_audit', 'true', true);

  insert into public.audit_logs (
    user_id, user_id_hash, table_name, row_id, action, target_user_id
  ) values (
    v_caller_uid,
    encode(digest(v_caller_uid::text, 'sha256'), 'hex'),
    'dsar_requests',
    p_request_id::text,
    'dsar_completed', -- reusing dsar_completed enum for rejection finalization terminal state
    v_target_user
  );
end;
$$;

revoke all on function public.admin_reject_dsar(uuid, text) from public;
grant execute on function public.admin_reject_dsar(uuid, text) to authenticated;
