-- Phase 38 Plan 01 — profiles.timezone column (D-06, RESEARCH §Environment Availability).
--
-- Default 'America/New_York' for all existing profiles (per CONTEXT D-06 — US-only
-- v1, EST is the natural default; users can opt to set their timezone via Settings).
--
-- IANA-name CHECK (RESEARCH Pitfall #7): must match Continent/City pattern with
-- 1-2 segments after the continent (e.g. 'America/Argentina/Buenos_Aires').
-- Rejects offset strings like '-05:00' or 'EST5EDT' aliases.

alter table public.profiles
  add column if not exists timezone text not null default 'America/New_York';

-- Add CHECK constraint idempotently (drop-and-recreate not needed; just guard).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_timezone_iana'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_timezone_iana
      check (timezone ~ '^[A-Za-z_]+/[A-Za-z_]+(/[A-Za-z_]+)?$');
  end if;
end $$;

comment on column public.profiles.timezone is
  'Phase 38 — IANA timezone name (e.g. America/New_York). Default America/New_York per CONTEXT D-06.';
