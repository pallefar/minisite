-- Phase 24: Add admin_role + has_totp columns to profiles; ordinal comparator function
-- Decision ref: D-04, D-06, D-08
--
-- Adds:
--   profiles.admin_role  — 3-role enum (staff/admin/superadmin); nullable (null = regular user)
--   profiles.has_totp    — boolean gate for 2FA hard-cut middleware (D-06)
--
-- Backfills: existing `is_staff = true` rows default to 'admin' per D-04 mapping.
--
-- Creates `is_admin_at_least(min_role)` SECURITY DEFINER ordinal comparator
-- so RPCs + RLS policies can call a single function for role gating.
--
-- SECURITY DEFINER requires `set search_path = extensions, public, pg_temp`
-- per [[reference_supabase_migration_gotchas]].

alter table public.profiles
  add column if not exists admin_role public.admin_role;

alter table public.profiles
  add column if not exists has_totp boolean not null default false;

-- Backfill: existing is_staff = true users get admin role
update public.profiles
set admin_role = 'admin'
where is_staff = true and admin_role is null;

-- Ordinal comparator: checks whether the current user's admin_role is at least min_role.
-- Mapping per D-04:
--   superadmin => satisfies staff, admin, superadmin
--   admin      => satisfies staff, admin
--   staff      => satisfies staff only
--   null       => satisfies nothing
create or replace function public.is_admin_at_least(min_role public.admin_role)
returns boolean
language sql
stable
security definer
set search_path = extensions, public, pg_temp
as $$
  select case (
    select admin_role from public.profiles where id = auth.uid()
  )
    when 'superadmin' then array['staff', 'admin', 'superadmin']::public.admin_role[]
    when 'admin'      then array['staff', 'admin']::public.admin_role[]
    when 'staff'      then array['staff']::public.admin_role[]
    else                   array[]::public.admin_role[]
  end @> array[min_role]
$$;

grant execute on function public.is_admin_at_least(public.admin_role)
  to authenticated, anon;
