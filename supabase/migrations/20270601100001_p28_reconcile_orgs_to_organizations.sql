-- Phase 28 Plan 28-00 RECONCILE — rename public.orgs → public.organizations.
-- Addendum A1 (2026-05-17) + CONTEXT D-11.
--
-- Single atomic transaction:
--   1. Create org_status enum (idempotent DO-block guard).
--   2. ALTER TABLE public.orgs RENAME TO organizations.
--   3. Rename owner_user_id → created_by.
--   4. Add 3 new D-11 columns: status, is_public_listing, current_rank_weights_version.
--   5. CREATE OR REPLACE create_org / update_org / delete_org SECURITY DEFINER bodies
--      so audit_logs.table_name inserts record 'organizations' (not 'orgs'), and
--      DML targets public.organizations (not public.orgs).
--
-- NOTE: create_org body is taken from Phase 10 Plan 10-03 hotfix
-- (20260901000006_fix_create_org_ambiguous_org_id.sql) which is the live body —
-- it includes the `r.org_id` alias fix for PL/pgSQL 42702 ambiguity.
-- update_org and delete_org bodies are from Phase 9 (20260801000011_clinic_rpcs.sql).
--
-- Postgres rewrites pg_depend automatically on RENAME TABLE for direct object refs
-- (RLS policies, FK constraints, indexes). String-literal references inside EXECUTE
-- format() or INSERT ... VALUES ('orgs', ...) are NOT rewritten — this migration
-- patches those manually via CREATE OR REPLACE.
--
-- Safety: migration filename matches strict 14-digit regex per
-- [[reference_supabase_migration_filename_regex]]. No letter suffix.

-- =============================================================================
-- Step 1: Create org_status enum (idempotent)
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'org_status' and typnamespace = 'public'::regnamespace) then
    create type public.org_status as enum ('active', 'suspended', 'archived');
  end if;
end $$;

-- =============================================================================
-- Step 2: Rename orgs → organizations
-- =============================================================================
alter table public.orgs rename to organizations;

-- =============================================================================
-- Step 3: Rename owner_user_id → created_by
-- =============================================================================
alter table public.organizations rename column owner_user_id to created_by;

-- =============================================================================
-- Step 4: Add 3 new columns (D-11)
-- =============================================================================
alter table public.organizations
  add column if not exists status public.org_status not null default 'active';

alter table public.organizations
  add column if not exists is_public_listing boolean not null default false;

alter table public.organizations
  add column if not exists current_rank_weights_version uuid null;

-- =============================================================================
-- Step 5a: CREATE OR REPLACE create_org (Phase 10 hotfix body — 42702 fix preserved)
--          Changes from live: 'orgs' → 'organizations' in audit_logs insert,
--          insert into public.organizations (not public.orgs),
--          column owner_user_id → created_by.
-- =============================================================================
create or replace function public.create_org(
  p_name text,
  p_slug text,
  p_description text,
  p_website_url text
)
returns table (org_id uuid, slug text)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_owner_role_id uuid;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;

  insert into public.organizations (slug, name, description, website_url, created_by)
  values (p_slug, p_name, p_description, p_website_url, v_uid)
  returning id into v_id;

  -- Trigger seeds 3 system roles for v_id (AFTER INSERT FOR EACH ROW fires inline).
  -- Use table alias `r` to disambiguate `r.org_id` from the RETURNS TABLE output
  -- variable `org_id` (PL/pgSQL 42702 — "could refer to either a variable or column").
  select r.id into v_owner_role_id
  from public.roles r
  where r.org_id = v_id and r.name = 'Owner' and r.is_system = true;

  insert into public.memberships (user_id, org_id, role_id, accepted_at)
  values (v_uid, v_id, v_owner_role_id, now());

  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
  values (
    v_uid,
    encode(digest(v_uid::text, 'sha256'), 'hex'),
    'organizations',
    v_id::text,
    'org_create',
    'org_operator',
    v_id
  );

  return query select v_id, p_slug;
exception
  when unique_violation then
    raise exception 'slug_taken' using errcode = '23505';
end;
$$;
revoke all on function public.create_org(text, text, text, text) from public;
grant execute on function public.create_org(text, text, text, text) to authenticated;

-- =============================================================================
-- Step 5b: CREATE OR REPLACE update_org
--          Changes from live: 'orgs' → 'organizations' in audit_logs insert,
--          update public.organizations (not public.orgs).
-- =============================================================================
create or replace function public.update_org(
  p_org_id uuid,
  p_name text,
  p_description text,
  p_website_url text,
  p_logo_storage_path text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if not public.has_permission(v_uid, p_org_id, 'org.update') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.organizations
  set name = coalesce(p_name, name),
      description = p_description,
      website_url = p_website_url,
      logo_storage_path = p_logo_storage_path
  where id = p_org_id;

  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
  values (
    v_uid,
    encode(digest(v_uid::text, 'sha256'), 'hex'),
    'organizations',
    p_org_id::text,
    'org_update',
    'org_operator',
    p_org_id
  );
end;
$$;
revoke all on function public.update_org(uuid, text, text, text, text) from public;
grant execute on function public.update_org(uuid, text, text, text, text) to authenticated;

-- =============================================================================
-- Step 5c: CREATE OR REPLACE delete_org (cascade-safe via dual GUCs)
--          Changes from live: 'orgs' → 'organizations' in audit_logs insert,
--          delete from public.organizations (not public.orgs).
-- =============================================================================
create or replace function public.delete_org(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if not public.has_permission(v_uid, p_org_id, 'org.delete') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Skeleton audit row written BEFORE cascade so we always have the trace
  -- even though audit_logs.org_id is set null by the cascade FK.
  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
  values (
    v_uid,
    encode(digest(v_uid::text, 'sha256'), 'hex'),
    'organizations',
    p_org_id::text,
    'org_delete',
    'org_operator',
    p_org_id
  );

  -- gotcha #4: suppress the audit_trigger() per-row fires on cascade DELETEs.
  perform set_config('app.suppress_audit', 'true', true);
  -- gotcha #3: allow direct DELETE on storage.objects for the org-logo cleanup.
  perform set_config('storage.allow_delete_query', 'true', true);

  -- Best-effort logo cleanup. The Storage RLS DELETE policy
  -- (objects_delete_org_logos) is satisfied because we bypass via the GUC.
  delete from storage.objects
  where bucket_id = 'org-logos'
    and (storage.foldername(name))[1] = p_org_id::text;

  -- Cascades memberships, invites, roles, role_permissions via FKs.
  delete from public.organizations where id = p_org_id;
end;
$$;
revoke all on function public.delete_org(uuid) from public;
grant execute on function public.delete_org(uuid) to authenticated;
