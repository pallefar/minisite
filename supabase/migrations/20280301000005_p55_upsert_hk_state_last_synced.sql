-- Phase 55 Plan 55-02 addendum (WR-02 fix)
--
-- Problem: upsert_healthkit_state ON CONFLICT DO UPDATE block did not set
-- last_synced_at, so the "Last synced" label always showed "Never" after
-- an app restart (only local React state was updated, not DB). Phase 70
-- background sync also needs this DB timestamp as a gating anchor.
--
-- Fix: update upsert_healthkit_state to set last_synced_at = now() when
-- healthkit_enabled IS true (a sync has just occurred); leave it unchanged
-- when disabling (revoke path should not touch last_synced_at).
--
-- Named dollar-tags used throughout to avoid $$ nesting conflicts.

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
    (user_id, healthkit_enabled, sync_interval, last_synced_at, revoked_at)
  values
    (
      auth.uid(),
      p_enabled,
      p_sync_interval,
      case when p_enabled then now() else null end,
      case when p_enabled then null else now() end
    )
  on conflict (user_id) do update
    set healthkit_enabled = excluded.healthkit_enabled,
        sync_interval     = excluded.sync_interval,
        last_synced_at    = case
                              when excluded.healthkit_enabled then now()
                              else public.healthkit_sync_state.last_synced_at
                            end,
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
