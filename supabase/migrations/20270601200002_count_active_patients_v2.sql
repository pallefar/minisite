-- Phase 29 Plan 01 — count_active_patients v2
--
-- Replaces Phase 14's obsolete count_active_patients(p_clinic_id uuid) which:
--   - Used the Phase 9 `memberships` + `roles.name = 'View-only'` pattern
--   - Only UNIONed 5 event tables
--
-- P29 D-01 specification:
--   - Source: org_patient_links (Phase 28 schema), unlinked_at IS NULL
--   - Caller auth: org_members.role = 'admin' re-check (Pattern S1 dual-layer)
--   - Service-role bypass: auth.uid() IS NULL => skip admin check (cron caller)
--   - UNION across all 10 patient-data event tables
--   - explicit set search_path = pg_catalog, public, extensions (reference_supabase_migration_gotchas)
--
-- Called by:
--   - Plan 29-04 nightly cron (service_role, auth.uid() = null — bypasses admin check)
--   - Clinic admin billing surface (authenticated admin of org — goes through admin check)
--   - Plan 29-03 stripe-webhook invoice.created variance handler (service_role)
--
-- FUTURE: extend UNION when new patient-data tables added
--   (Plan-checker BLOCKER per D-01: any new patient-data table in v1.4+ MUST add a UNION arm here)

-- Drop old signature defensively to avoid ambiguity.
-- CREATE OR REPLACE handles same-signature; DROP covers the (unlikely) case
-- where Postgres treats p_clinic_id and p_org_id as distinct overloads.
drop function if exists public.count_active_patients(p_clinic_id uuid);

create or replace function public.count_active_patients(p_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
stable
as $$
declare
  v_uid   uuid := auth.uid();
  v_count integer;
begin
  -- Service-role bypass: cron callers have no JWT (auth.uid() = null).
  -- Authenticated callers MUST be an admin of the target org.
  if v_uid is not null then
    if not exists (
      select 1 from public.org_members
      where org_id = p_org_id
        and user_id = v_uid
        and role = 'admin'
    ) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  -- Count distinct patients linked to this org with any event in the last 30 days.
  -- Source: org_patient_links (Phase 28 schema) — NOT memberships (Phase 9 legacy).
  -- distinct on patient_user_id: same patient with events in multiple tables counts as 1.
  select count(distinct opl.patient_user_id)::integer into v_count
  from public.org_patient_links opl
  where opl.org_id = p_org_id
    and opl.unlinked_at is null
    and exists (
      select 1 from public.injections i
        where i.user_id = opl.patient_user_id and i.created_at > now() - interval '30 days'
      union all
      select 1 from public.weights w
        where w.user_id = opl.patient_user_id and w.created_at > now() - interval '30 days'
      union all
      select 1 from public.meals m
        where m.user_id = opl.patient_user_id and m.created_at > now() - interval '30 days'
      union all
      select 1 from public.mood mo
        where mo.user_id = opl.patient_user_id and mo.created_at > now() - interval '30 days'
      union all
      select 1 from public.sleep sl
        where sl.user_id = opl.patient_user_id and sl.created_at > now() - interval '30 days'
      union all
      select 1 from public.symptoms sy
        where sy.user_id = opl.patient_user_id and sy.created_at > now() - interval '30 days'
      union all
      select 1 from public.photos ph
        where ph.user_id = opl.patient_user_id and ph.created_at > now() - interval '30 days'
      union all
      select 1 from public.workouts wo
        where wo.user_id = opl.patient_user_id and wo.created_at > now() - interval '30 days'
      union all
      select 1 from public.vials vi
        where vi.user_id = opl.patient_user_id and vi.created_at > now() - interval '30 days'
      union all
      select 1 from public.ai_messages ai
        where ai.user_id = opl.patient_user_id and ai.created_at > now() - interval '30 days'
    );

  return coalesce(v_count, 0);
end;
$$;

comment on function public.count_active_patients(uuid) is
  'P29 D-01 — Returns count of distinct patient_user_ids in org_patient_links with any event in last 30 days. Service-role bypass for cron (Plan 29-04). Replaces Phase 14 legacy function (which used Phase 9 schema).';

revoke all on function public.count_active_patients(uuid) from public;
-- authenticated: admin-callable from clinic billing UI debug surfaces
grant execute on function public.count_active_patients(uuid) to authenticated;
-- service_role: cron caller (Plan 29-04) and webhook variance handler (Plan 29-03)
grant execute on function public.count_active_patients(uuid) to service_role;
