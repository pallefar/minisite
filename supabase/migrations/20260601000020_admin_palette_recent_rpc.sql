-- Phase 27 Plan 27-03 — ADMIN-06 command-palette recent-items SECDEF RPC.
--
-- Decision refs:
--   D-10  Command palette via cmdk
--   D-11  3-source index: ADMIN_MODULES manifest (build-time) + recent items
--         (lazy-loaded via this SECDEF) + static quick-actions
--   D-12  destructive quick-actions gated on aal2 freshness (15-min window) —
--         see leanshot/src/lib/admin/palette/aal2-step-up.ts
--
-- Contract (frozen at Plan 27-03):
--   admin_palette_recent() returns table (
--     item_type            text,        -- 'member' | 'helpdesk_ticket' | 'affiliate' | 'cohort' | 'audit_log_entry'
--     item_id              text,        -- audit_logs.row_pk or target_user_id::text
--     label                text,        -- display label (lazy-rendered; richer JOIN deferred to v1.4)
--     route                text,        -- admin route to navigate to
--     last_interacted_at   timestamptz
--   )
--
-- Behavior:
--   - Raises 'forbidden' (42501) if not is_admin_at_least('admin').
--   - Returns top 20 distinct (item_type, item_id) rows from audit_logs filtered
--     to the caller's recent actions in the last 7 days, ordered by
--     max(created_at) desc.
--   - SECURITY DEFINER + STABLE (no audit-log write — palette open is a read-only
--     UX surface per CONTEXT D-11).
--
-- audit_logs columns (Phase 24 actual shape, NOT the older Phase 7 names):
--   actor_user_id, target_user_id, table_name, row_pk, action_name,
--   timestamp (note: Phase 7 column is `timestamp`, not `created_at`).
--
-- Skeleton sourced from supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql
-- lines 145–203 (admin_approve_affiliate_conversion) per plan instruction.

create or replace function public.admin_palette_recent()
returns table (
  item_type          text,
  item_id            text,
  label              text,
  route              text,
  last_interacted_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public, pg_catalog
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  with recent_actions as (
    select
      al.table_name,
      al.row_pk,
      al.target_user_id,
      max(al.timestamp) as last_at
    from public.audit_logs al
    where al.actor_user_id = v_caller
      and al.timestamp > now() - interval '7 days'
      and al.row_pk is not null
    group by al.table_name, al.row_pk, al.target_user_id
    order by max(al.timestamp) desc
    limit 20
  )
  select
    case
      when ra.table_name = 'profiles'           then 'member'
      when ra.table_name = 'tickets'            then 'helpdesk_ticket'
      when ra.table_name = 'affiliate_program'  then 'affiliate'
      when ra.table_name = 'cohort_definitions' then 'cohort'
      else 'audit_log_entry'
    end as item_type,
    coalesce(ra.target_user_id::text, ra.row_pk) as item_id,
    case
      when ra.table_name = 'profiles' then
        'Member ' || coalesce(ra.target_user_id::text, ra.row_pk)
      when ra.table_name = 'tickets' then
        'Ticket ' || ra.row_pk
      when ra.table_name = 'affiliate_program' then
        'Affiliate ' || ra.row_pk
      when ra.table_name = 'cohort_definitions' then
        'Cohort ' || ra.row_pk
      else
        ra.table_name || ' ' || ra.row_pk
    end as label,
    case
      when ra.table_name = 'profiles' then
        '/admin/users/' || coalesce(ra.target_user_id::text, ra.row_pk)
      when ra.table_name = 'tickets' then
        '/admin/helpdesk/' || ra.row_pk
      when ra.table_name = 'affiliate_program' then
        '/admin/affiliates/' || ra.row_pk
      when ra.table_name = 'cohort_definitions' then
        '/admin/cohorts/' || ra.row_pk
      else
        '/admin/audit-log?row=' || ra.row_pk
    end as route,
    ra.last_at as last_interacted_at
  from recent_actions ra
  order by ra.last_at desc;
end;
$$;

revoke all on function public.admin_palette_recent() from public;
grant execute on function public.admin_palette_recent() to authenticated;

comment on function public.admin_palette_recent() is
  'Phase 27 Plan 27-03 ADMIN-06 D-11. Returns up to 20 recent admin-interacted '
  'items from the caller''s own audit_logs within the last 7 days. '
  'Powers the cmdk command palette ''Recent'' group. '
  'Read-only — palette open is not an auditable event in v1.';
