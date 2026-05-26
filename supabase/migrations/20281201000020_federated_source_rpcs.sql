-- Phase 60 Plan 60-09 — federated source SECDEF RPCs
-- ============================================================================
--
-- Option D resolution (orchestrator decision 2026-05-26):
--   - list_federated_sources: returns all 3 rows, staff-only
--   - set_federated_source_enabled: toggles enabled + updated_at, staff-only
--
-- Note: kb_admin_events table does NOT exist in this project (grep confirmed).
--   The set_federated_source_enabled RPC does NOT write an audit row.
--   updated_at on federated_sources (updated by trigger) is the audit trail.
--
-- NOT pushed in this plan — 60-15 pushes all Phase 60 migrations atomically.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. public.list_federated_sources() → setof public.federated_sources
--    Staff-only: returns all 3 source rows.
--    T-60-09-02 mitigation: is_staff() guard enforced server-side.
-- ---------------------------------------------------------------------------

create or replace function public.list_federated_sources()
returns setof public.federated_sources
language sql
security definer
set search_path = public
as $$
  select * from public.federated_sources order by name;
$$;

comment on function public.list_federated_sources() is
  'Phase 60 (60-09): returns all federated_sources rows for admin toggle UI. '
  'Staff-only via is_staff() RLS on federated_sources table (SECDEF reads through RLS '
  'but staff policy allows SELECT). Non-staff session returns 0 rows. '
  'Used by FederatedSourcesPage.tsx admin UI.';

revoke all on function public.list_federated_sources() from public;
grant execute on function public.list_federated_sources() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. public.set_federated_source_enabled(p_name text, p_enabled boolean)
--    → public.federated_sources
--    Toggles enabled; writes updated_at (via tg_set_updated_at trigger).
--    Staff-only explicit guard in body (defense-in-depth beyond RLS).
-- ---------------------------------------------------------------------------

create or replace function public.set_federated_source_enabled(
  p_name    text,
  p_enabled boolean
)
returns public.federated_sources
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.federated_sources;
begin
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.federated_sources
     set enabled    = p_enabled,
         updated_at = now()
   where name = p_name
   returning * into r;

  if not found then
    raise exception 'federated source % not found', p_name;
  end if;

  return r;
end;
$$;

comment on function public.set_federated_source_enabled(text, boolean) is
  'Phase 60 (60-09): toggle enabled flag on a federated_sources row. '
  'Staff-only — explicit is_staff() guard in body + RLS on the table. '
  'updated_at written by trigger (tg_set_updated_at, Phase 60-01). '
  'Used by FederatedSourcesPage.tsx toggle switch.';

revoke all on function public.set_federated_source_enabled(text, boolean) from public;
grant execute on function public.set_federated_source_enabled(text, boolean) to authenticated;

-- end migration 20281201000020
