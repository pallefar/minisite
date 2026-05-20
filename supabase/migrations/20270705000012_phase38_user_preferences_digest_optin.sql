-- Phase 38 Plan 01 — user_preferences.weekly_digest_opt_in (D-04 opt-IN default).
--
-- Creates user_preferences table if absent (likely net-new on this project;
-- 2026-05-20 grep confirmed no existing CREATE TABLE for user_preferences).
-- Default for weekly_digest_opt_in is FALSE per D-04 (opt-IN: user must
-- explicitly enable).

-- ----------------------------------------------------------------------------
-- 1. Table — created if absent.
-- ----------------------------------------------------------------------------
create table if not exists public.user_preferences (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  weekly_digest_opt_in boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Defensive: if user_preferences existed earlier without the column, add it.
alter table public.user_preferences
  add column if not exists weekly_digest_opt_in boolean not null default false;

comment on column public.user_preferences.weekly_digest_opt_in is
  'Phase 38 — opt-IN default false per D-04. Weekly Claude digest send gate.';

-- ----------------------------------------------------------------------------
-- 2. RLS — user reads/writes own row only.
-- ----------------------------------------------------------------------------
alter table public.user_preferences enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_preferences' and policyname = 'user_prefs_select_own') then
    create policy user_prefs_select_own on public.user_preferences
      for select
      to authenticated
      using (user_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_preferences' and policyname = 'user_prefs_insert_own') then
    create policy user_prefs_insert_own on public.user_preferences
      for insert
      to authenticated
      with check (user_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_preferences' and policyname = 'user_prefs_update_own') then
    create policy user_prefs_update_own on public.user_preferences
      for update
      to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. updated_at trigger (defensive — keep audit trail consistent).
-- ----------------------------------------------------------------------------
create or replace function public.tg_user_preferences_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

revoke all on function public.tg_user_preferences_touch_updated_at() from public;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'user_preferences_touch_updated_at'
      and tgrelid = 'public.user_preferences'::regclass
  ) then
    create trigger user_preferences_touch_updated_at
      before update on public.user_preferences
      for each row
      execute function public.tg_user_preferences_touch_updated_at();
  end if;
end $$;
