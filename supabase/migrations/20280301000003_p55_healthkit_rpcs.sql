-- Phase 55 Plan 02 (HEALTH-07)
-- Two SECDEF RPCs for the HealthKit import pipeline.
--
-- (1) purge_healthkit_imports(p_user_id uuid) → void
--     Deletes all hk_source = 'apple_health' rows belonging to p_user_id
--     across weights, sleep, workouts, and meals.
--     Guard: raises not_authorized (SQLSTATE 28000) if the caller is not p_user_id.
--     Revoke from public; grant execute to authenticated.
--
-- (2) upsert_healthkit_state(p_enabled bool, p_sync_interval text)
--       → public.healthkit_sync_state
--     Inserts or updates the per-user row in healthkit_sync_state.
--     Sets revoked_at = now() when disabling; clears it when re-enabling.
--     Guard: raises not_authorized if called unauthenticated.
--     Validates p_sync_interval; raises invalid_parameter_value if bad.
--     Revoke from public; grant execute to authenticated.
--
-- Named dollar-tags used throughout to avoid $$ nesting conflicts.
-- search_path fixed to prevent schema-injection.

-- ── purge_healthkit_imports ──────────────────────────────────────────────────

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
end;
$purge$;

revoke all on function public.purge_healthkit_imports(uuid) from public;
grant execute on function public.purge_healthkit_imports(uuid) to authenticated;

-- ── upsert_healthkit_state ───────────────────────────────────────────────────

create or replace function public.upsert_healthkit_state(
  p_enabled       boolean,
  p_sync_interval text
)
returns public.healthkit_sync_state
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $upsert$
declare
  v_row public.healthkit_sync_state;
begin
  -- Guard: unauthenticated callers cannot modify sync state.
  if auth.uid() is null then
    raise exception 'not_authorized'
      using errcode = '28000',
            detail  = 'Authentication required to update HealthKit sync state.';
  end if;

  -- T-55-02-03: validate sync_interval (mirrors CHECK constraint for clarity).
  if p_sync_interval not in ('1h', '6h', '24h') then
    raise exception 'invalid_parameter_value'
      using errcode = '22023',
            detail  = 'p_sync_interval must be one of ''1h'', ''6h'', ''24h''.';
  end if;

  insert into public.healthkit_sync_state
    (user_id, healthkit_enabled, sync_interval, revoked_at)
  values
    (
      auth.uid(),
      p_enabled,
      p_sync_interval,
      case when p_enabled then null else now() end
    )
  on conflict (user_id) do update
    set healthkit_enabled = excluded.healthkit_enabled,
        sync_interval     = excluded.sync_interval,
        revoked_at        = case
                              when excluded.healthkit_enabled then null
                              else now()
                            end
  returning * into v_row;

  return v_row;
end;
$upsert$;

revoke all on function public.upsert_healthkit_state(boolean, text) from public;
grant execute on function public.upsert_healthkit_state(boolean, text) to authenticated;
