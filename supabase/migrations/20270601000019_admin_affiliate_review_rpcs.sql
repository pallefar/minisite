-- Phase 22 plan 07 — ADMIN-06: status-writer RPCs for affiliate review queue.
--
-- Closes Phase 19 BL-11 status-graph gap. The Phase 19 cron
-- `affiliate-conversions-confirm` (migration 20270101000012) flips
-- pending → confirmed automatically ONLY when fraud_signals is empty/null.
-- Rows the fraud trigger (migration 20270101000008) marks as 'flagged' are
-- intentionally LEFT for manual review. Before this migration there was no
-- in-app writer for the flagged → confirmed transition; nor any writer for
-- 'on_hold' or operator-driven 'rejected'. As a result a) flagged rows would
-- accumulate forever, b) the monthly payout cron (19-09) would silently ship
-- $0 for every flagged conversion, and c) the materialization job
-- (20270101000012) referenced `confirmed_at` and `reviewed_at` columns that
-- never existed.
--
-- This migration:
--   1. Adds the missing `confirmed_at`, `reviewed_at`, `reviewed_by` columns
--      to public.affiliate_conversions (fixes the dangling column reference
--      in 20270101000012 — column adds are idempotent via IF NOT EXISTS).
--   2. Extends the affiliate_conversions.status CHECK constraint with
--      'on_hold' (drop+re-add pattern — analog: migration 20270601000002
--      audit_action_check).
--   3. Extends audit_logs.action CHECK with three new operator events:
--      affiliate_conversion_approved / _held / _rejected.
--   4. Ships three SECURITY DEFINER RPCs (admin_approve_affiliate_conversion,
--      admin_hold_affiliate_conversion, admin_reject_affiliate_conversion)
--      with is_staff gates + app.suppress_audit GUC + inline audit_logs INSERT.
--
-- Pitfalls applied:
--   - Pitfall 3 (Postgres DDL): status enum-style values live in a CHECK
--     constraint, NOT a real enum (same pattern as audit_logs.action). DROP +
--     re-ADD is safe in the same transaction; the 55P04 sqlstate trap does
--     not apply.
--   - Pitfall 4 (audit-trigger suppression): set_config('app.suppress_audit',
--     'true', true) inside each function body so the explicit audit_logs
--     INSERT we write is the only row that lands.
--
-- Analog: supabase/migrations/20270601000015_admin_stripe_action_audit_rpc.sql
-- (Phase 22 admin Stripe action audit RPCs — same shape).

-- =============================================================================
-- 1. ADD missing columns referenced by 20270101000012 + reviewer tracking
-- =============================================================================
alter table public.affiliate_conversions
  add column if not exists confirmed_at timestamptz;

alter table public.affiliate_conversions
  add column if not exists reviewed_at timestamptz;

alter table public.affiliate_conversions
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null;

-- =============================================================================
-- 2. EXTEND status CHECK with 'on_hold' (drop+re-add idiom)
-- =============================================================================
-- The Phase 19 baseline CHECK was: ('pending','confirmed','flagged','rejected','paid').
-- We add 'on_hold' so the Hold action has a distinct status (operationally
-- different from 'flagged' — flagged is system-generated, on_hold is
-- operator-driven). 'paid' kept verbatim — that's the post-payout terminal
-- state set by 19-09 affiliate-payout Edge Fn.

alter table public.affiliate_conversions
  drop constraint if exists affiliate_conversions_status_check;

alter table public.affiliate_conversions
  add constraint affiliate_conversions_status_check check (
    status in ('pending', 'confirmed', 'flagged', 'rejected', 'paid', 'on_hold')
  );

-- =============================================================================
-- 3. EXTEND audit_logs.action CHECK with 3 new Phase 22 ADMIN-06 values
-- =============================================================================
-- Drop+re-add the audit_action_check to add the three operator events.
-- Preserves every prior value from 20270601000002 + earlier extensions.
-- Source of truth for the prior list is migration 20270601000002 — keep
-- this list in sync if either is amended.

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
      -- Phase 9 — org lifecycle
      'org_create',
      'org_update',
      'org_delete',
      -- Phase 9 — invite + membership lifecycle
      'membership_invite_sent',
      'membership_invite_accepted',
      'membership_invite_rejected',
      'membership_invite_canceled',
      'membership_revoked',
      'membership_scope_updated',
      'membership_role_changed',
      -- Phase 9 — clinic data access
      'clinic_photo_view',
      -- Phase 9 — authorization gate failures
      'permission_denied',
      -- Phase 9 — role CRUD
      'role_create',
      'role_update',
      'role_delete',
      -- Phase 10 — roster ranking + drill-in
      'rank_computed',
      'rank_threshold_crossed',
      'section_view',
      'bulk_pdf_export',
      'bulk_csv_export',
      'clinic_snapshot_loaded',
      -- Phase 22 baseline (20270601000002_audit_action_enum_phase22.sql)
      'impersonate_start',
      'impersonate_end',
      'impersonate_blocked_write',
      'refund_issued',
      'subscription_canceled_admin',
      'subscription_comped',
      'feature_flag_override_set',
      'dsar_requested',
      'dsar_completed',
      'consent_recorded',
      'account_deletion_cancelled',
      -- Phase 22 plan 07 ADMIN-06 — affiliate review queue operator events
      'affiliate_conversion_approved',
      'affiliate_conversion_held',
      'affiliate_conversion_rejected'
    )
  );

-- =============================================================================
-- 4. admin_approve_affiliate_conversion — pending|flagged|on_hold → confirmed
-- =============================================================================
-- CLOSES Phase 19 BL-11. After this RPC writes status='confirmed', the
-- materialization cron (20270101000012) picks the row up on its next nightly
-- run (00:30 UTC), the monthly payout cron (1st of month 00:00 UTC) bundles
-- it into a transfer, and the affiliate is paid.

create or replace function public.admin_approve_affiliate_conversion(
  p_conversion_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_caller uuid := auth.uid();
  v_affiliate_id uuid;
  v_prev_status text;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Idempotency guard: re-approve is a no-op for already-confirmed rows.
  select status, affiliate_id into v_prev_status, v_affiliate_id
    from public.affiliate_conversions where id = p_conversion_id for update;
  if not found then
    raise exception 'conversion_not_found' using errcode = '22023';
  end if;
  if v_prev_status = 'confirmed' then
    return;  -- already approved; idempotent no-op
  end if;
  if v_prev_status = 'paid' then
    raise exception 'cannot_approve_paid' using errcode = '22023';
  end if;

  perform set_config('app.suppress_audit', 'true', true);

  update public.affiliate_conversions
     set status       = 'confirmed',
         confirmed_at = now(),
         reviewed_by  = v_caller,
         reviewed_at  = now()
   where id = p_conversion_id;

  insert into public.audit_logs (
    user_id, user_id_hash, table_name, row_id, action, target_user_id, metadata
  ) values (
    v_caller,
    encode(digest(v_caller::text, 'sha256'), 'hex'),
    'public.affiliate_conversions',
    p_conversion_id::text,
    'affiliate_conversion_approved',
    null,
    jsonb_build_object(
      'conversion_id', p_conversion_id,
      'affiliate_id',  v_affiliate_id,
      'prev_status',   v_prev_status
    )
  );
end;
$$;

revoke all on function public.admin_approve_affiliate_conversion(uuid) from public;
grant execute on function public.admin_approve_affiliate_conversion(uuid) to authenticated;

-- =============================================================================
-- 5. admin_hold_affiliate_conversion — any non-terminal → on_hold
-- =============================================================================
create or replace function public.admin_hold_affiliate_conversion(
  p_conversion_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_caller uuid := auth.uid();
  v_affiliate_id uuid;
  v_prev_status text;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select status, affiliate_id into v_prev_status, v_affiliate_id
    from public.affiliate_conversions where id = p_conversion_id for update;
  if not found then
    raise exception 'conversion_not_found' using errcode = '22023';
  end if;
  if v_prev_status in ('paid', 'rejected') then
    raise exception 'cannot_hold_terminal' using errcode = '22023';
  end if;

  perform set_config('app.suppress_audit', 'true', true);

  update public.affiliate_conversions
     set status      = 'on_hold',
         reviewed_by = v_caller,
         reviewed_at = now()
   where id = p_conversion_id;

  insert into public.audit_logs (
    user_id, user_id_hash, table_name, row_id, action, target_user_id, metadata
  ) values (
    v_caller,
    encode(digest(v_caller::text, 'sha256'), 'hex'),
    'public.affiliate_conversions',
    p_conversion_id::text,
    'affiliate_conversion_held',
    null,
    jsonb_build_object(
      'conversion_id', p_conversion_id,
      'affiliate_id',  v_affiliate_id,
      'prev_status',   v_prev_status
    )
  );
end;
$$;

revoke all on function public.admin_hold_affiliate_conversion(uuid) from public;
grant execute on function public.admin_hold_affiliate_conversion(uuid) to authenticated;

-- =============================================================================
-- 6. admin_reject_affiliate_conversion — any non-paid → rejected
-- =============================================================================
create or replace function public.admin_reject_affiliate_conversion(
  p_conversion_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_caller uuid := auth.uid();
  v_affiliate_id uuid;
  v_prev_status text;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select status, affiliate_id into v_prev_status, v_affiliate_id
    from public.affiliate_conversions where id = p_conversion_id for update;
  if not found then
    raise exception 'conversion_not_found' using errcode = '22023';
  end if;
  if v_prev_status = 'paid' then
    raise exception 'cannot_reject_paid' using errcode = '22023';
  end if;

  perform set_config('app.suppress_audit', 'true', true);

  update public.affiliate_conversions
     set status      = 'rejected',
         reviewed_by = v_caller,
         reviewed_at = now()
   where id = p_conversion_id;

  insert into public.audit_logs (
    user_id, user_id_hash, table_name, row_id, action, target_user_id, metadata
  ) values (
    v_caller,
    encode(digest(v_caller::text, 'sha256'), 'hex'),
    'public.affiliate_conversions',
    p_conversion_id::text,
    'affiliate_conversion_rejected',
    null,
    jsonb_build_object(
      'conversion_id', p_conversion_id,
      'affiliate_id',  v_affiliate_id,
      'prev_status',   v_prev_status,
      'reason',        coalesce(p_reason, '')
    )
  );
end;
$$;

revoke all on function public.admin_reject_affiliate_conversion(uuid, text) from public;
grant execute on function public.admin_reject_affiliate_conversion(uuid, text) to authenticated;
