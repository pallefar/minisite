-- Phase 9 Plan 09-01 — has_permission() helper.
--
-- D-07: single RLS dispatch primitive. Every clinic-scoped permission
-- check (RLS policies on orgs/memberships/invites/roles/role_permissions
-- + Storage RLS on org-logos + Edge Function gates on
-- /clinic-invite/* and /clinic-photo) calls this function.
--
-- Pitfall #3: STABLE volatility (NOT VOLATILE — the default for plpgsql)
-- so the RLS planner can cache the result within a single query plan.
-- Marking VOLATILE would make every row evaluation re-run the join,
-- collapsing the operator dashboard into a full-table-scan-per-row
-- pattern.
--
-- Memory `reference_supabase_migration_gotchas.md` gotcha #2:
-- SECURITY DEFINER functions need `extensions` in search_path so
-- pgcrypto helpers (digest, gen_random_bytes) resolve. We don't use them
-- in this function body, but downstream RPCs in 20260801000011 call this
-- helper FROM their own SECURITY DEFINER context, so adding `extensions`
-- here is also a defense-in-depth.
--
-- Forward-reference safety: this function is referenced by RLS policies
-- in migrations 02 (orgs), 06 (roles + role_permissions), 07 (memberships),
-- and 08 (invites). Postgres only resolves the function name during plan
-- time — DDL `create policy ... using (public.has_permission(...))` is
-- accepted even when the function does not yet exist. By the time any
-- query runs against those tables, this migration has applied.

create or replace function public.has_permission(
  p_user_id uuid,
  p_org_id uuid,
  p_permission_key text
)
returns boolean
language sql
security definer
set search_path = public, extensions, pg_catalog
stable
as $$
  select exists (
    select 1
    from public.memberships m
    join public.role_permissions rp on rp.role_id = m.role_id
    where m.user_id = p_user_id
      and m.org_id = p_org_id
      and m.revoked_at is null
      and rp.permission_key = p_permission_key
  );
$$;

revoke all on function public.has_permission(uuid, uuid, text) from public;
grant execute on function public.has_permission(uuid, uuid, text) to authenticated, service_role;
