-- Phase 55 Plan 55-02 addendum (CR-03 fix — HEALTH-07 purge completeness)
--
-- Problem: syncNow() writes HealthKit-imported height to profiles.height but
-- purge_healthkit_imports never cleared it, leaving PHI on profile after purge.
--
-- Solution:
--   1. Add healthkit_height_source boolean to profiles (nullable; true = height
--      was imported from HealthKit; null/false = user-entered or unknown).
--   2. Update purge_healthkit_imports RPC: NULL-out profiles.height + clear the
--      marker WHERE healthkit_height_source IS TRUE for the requesting user.
--
-- The marker column lets us distinguish HK-imported height from manually entered
-- height, so we never accidentally null-out a user's self-recorded height.
--
-- Forward-dated; does not modify existing rows (all NULLs by default).
-- RLS: own-row policy on profiles already covers this column.

alter table public.profiles
  add column if not exists healthkit_height_source boolean default null;

comment on column public.profiles.healthkit_height_source is
  'True when profiles.height was imported from Apple HealthKit via syncNow(). '
  'NULL or false means user-entered or unknown origin. '
  'Set by syncNow(); cleared to NULL when purge_healthkit_imports is called.';

-- Update purge_healthkit_imports to also clear HK-sourced height.
create or replace function public.purge_healthkit_imports(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $purge$
begin
  -- T-55-02-01: caller must be the owner of the rows being deleted.
  if auth.uid() is null or auth.uid() != p_user_id then
    raise exception 'not_authorized'
      using errcode = '28000',
            detail  = 'Caller must match p_user_id to purge HealthKit imports.';
  end if;

  delete from public.weights
    where user_id = p_user_id and hk_source = 'apple_health';

  delete from public.sleep
    where user_id = p_user_id and hk_source = 'apple_health';

  delete from public.workouts
    where user_id = p_user_id and hk_source = 'apple_health';

  delete from public.meals
    where user_id = p_user_id and hk_source = 'apple_health';

  -- CR-03 fix: also purge HealthKit-imported height from profiles.
  -- Only clears height when healthkit_height_source IS TRUE (protects
  -- user-entered height which has healthkit_height_source = NULL/false).
  update public.profiles
    set height                  = null,
        healthkit_height_source = null
    where id = p_user_id
      and healthkit_height_source is true;
end;
$purge$;

revoke all on function public.purge_healthkit_imports(uuid) from public;
grant execute on function public.purge_healthkit_imports(uuid) to authenticated;
