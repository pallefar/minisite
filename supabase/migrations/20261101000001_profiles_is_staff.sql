-- Phase 15 Plan 01 — `public.profiles` table + `is_staff` boolean column.
--
-- D-11: a thin `is_staff` boolean gate replaces a full role system for
-- LeanShot-staff admin (Phase 22 owns the full staff-admin role surface).
--
-- Idempotency rules (memory `reference_supabase_migration_gotchas`):
--   - `create table if not exists` — safe to re-run on a fresh project
--   - `alter table … add column if not exists` — safe if `profiles` already exists
--   - `create or replace function` — safe across re-applications
--   - `do $$ … if not exists (select 1 from pg_trigger …)` — idempotent trigger creation
--   - `do $$ … if not exists (select 1 from pg_policies …)` — idempotent policy creation
--
-- Threat model:
--   - T-15-01-13: `handle_new_user()` trigger function: SECURITY DEFINER +
--     `set search_path = public, pg_catalog`. Function body only does
--     `insert ... on conflict do nothing`; no user input interpolated.
--
-- This migration MUST run BEFORE migration 06 (is_staff_helper) because that
-- helper reads from `public.profiles`.

-- ----------------------------------------------------------------------------
-- 1. Table — created if absent; if pre-existing, ensure the column.
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  is_staff   boolean not null default false,
  created_at timestamptz not null default now()
);

-- If the table existed before this migration (e.g. from an earlier phase),
-- make sure the column we need is present.
alter table public.profiles
  add column if not exists is_staff boolean not null default false;

-- ----------------------------------------------------------------------------
-- 2. Trigger function — auto-create a profiles row on auth.users insert.
-- SECURITY DEFINER so it can write into public.profiles regardless of caller.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;
-- The trigger runs as the function owner (SECURITY DEFINER); no GRANT to
-- service_role / authenticated needed for trigger firing.

-- ----------------------------------------------------------------------------
-- 3. Trigger on auth.users — idempotent.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'on_auth_user_created_profiles'
  ) then
    create trigger on_auth_user_created_profiles
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 4. RLS — every user can read their own row (so the client knows is_staff).
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'pol_profiles_select_self'
  ) then
    create policy pol_profiles_select_self on public.profiles
      for select to authenticated
      using (id = auth.uid());
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Backfill — any existing auth.users without a profiles row gets one.
-- Idempotent (on conflict do nothing).
-- ----------------------------------------------------------------------------
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;
