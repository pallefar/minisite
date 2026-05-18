-- Phase 30 Plan 05 — Fix get_clinic_alert_metrics: ambiguous org_id column (42702)
--
-- Root cause: the function `RETURNS TABLE(org_id uuid, ...)` declares an output
-- column named `org_id`. Inside the function, the unqualified `org_id` reference
-- in `WHERE org_id = p_org_id AND user_id = v_caller_uid` is ambiguous between
-- the TABLE output column and the org_members.org_id column → PostgreSQL raises
-- 42702 "column reference org_id is ambiguous". Rule 1 auto-fix.
--
-- Fix: use table alias `om` in the org_members SELECT to qualify the column.

begin;

create or replace function public.get_clinic_alert_metrics(p_org_id uuid)
returns table (
  org_id                uuid,
  alert_type            text,
  pending_count         bigint,
  acknowledged_count    bigint,
  total_count           bigint,
  ack_rate_pct          numeric,
  avg_time_to_ack_minutes numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_caller_uid uuid := auth.uid();
  v_role       public.org_member_role;
begin
  -- Unauthenticated guard
  if v_caller_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Pattern S1: DB-level role re-check (admin or staff)
  -- Use table alias to avoid ambiguity with the `org_id` output column (42702).
  select om.role into v_role
  from public.org_members om
  where om.org_id = p_org_id and om.user_id = v_caller_uid;

  if v_role is null or v_role not in ('admin', 'staff') then
    raise exception 'admin or staff role required' using errcode = '42501';
  end if;

  -- Return matview data filtered by org_id (cross-tenant isolation)
  return query
  select
    m.org_id,
    m.alert_type,
    m.pending_count,
    m.acknowledged_count,
    m.total_count,
    m.ack_rate_pct,
    m.avg_time_to_ack_minutes
  from public.mv_clinic_alert_metrics m
  where m.org_id = p_org_id;
end;
$$;

revoke all on function public.get_clinic_alert_metrics(uuid) from public;
grant execute on function public.get_clinic_alert_metrics(uuid) to authenticated;

commit;
