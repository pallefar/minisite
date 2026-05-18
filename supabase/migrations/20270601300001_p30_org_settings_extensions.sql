-- Phase 30 Plan 00 — Task 1 (migration 1/5)
-- Extends org_settings with ranking_weights + dose_trend_thresholds columns.
-- Per CONTEXT D-03, D-07.
--
-- CRITICAL: 'staff' is the correct enum value (NOT 'clinician') per
--   supabase/migrations/20270601100003_org_member_role_enum.sql
--
-- SECDEF search_path locked per [[reference_supabase_migration_gotchas]].
-- Validator function raises P0001 on invalid shape (not a CHECK — JSONB shape
-- validation is not expressible in CHECK; BEFORE INSERT OR UPDATE trigger used).

begin;

-- =============================================================================
-- 1. ADD ranking_weights column (nullable — NULL = use Phase 10 hardcoded defaults)
-- =============================================================================
alter table public.org_settings
  add column if not exists ranking_weights jsonb null default null;

-- =============================================================================
-- 2. ADD dose_trend_thresholds column (non-null JSONB with v1.3 defaults)
--    Keys: missed_doses_n (int), window_days_m (int), variance_pct_x (int)
-- =============================================================================
alter table public.org_settings
  add column if not exists dose_trend_thresholds jsonb not null
    default '{"missed_doses_n":2,"window_days_m":14,"variance_pct_x":25}'::jsonb;

-- =============================================================================
-- 3. Validator function: _validate_ranking_weights(p_weights jsonb)
--    Called by BEFORE INSERT OR UPDATE trigger on org_settings.ranking_weights.
--    When p_weights IS NULL: returns silently (NULL = Phase 10 defaults, always valid).
--    When p_weights NOT NULL: enforces all 4 keys present, each in [0,1], sum = 1.0±0.001.
--    Raises P0001 on violation.
-- =============================================================================
create or replace function public._validate_ranking_weights(p_weights jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_dose_adherence numeric;
  v_weight_loss    numeric;
  v_activity       numeric;
  v_symptoms       numeric;
  v_sum            numeric;
begin
  -- NULL = use Phase 10 hardcoded defaults; always valid.
  if p_weights is null then
    return;
  end if;

  -- All 4 required keys must be present.
  if p_weights->>'dose_adherence' is null or
     p_weights->>'weight_loss' is null or
     p_weights->>'activity' is null or
     p_weights->>'symptoms' is null then
    raise exception 'ranking_weights must contain all 4 keys: dose_adherence, weight_loss, activity, symptoms'
      using errcode = 'P0001';
  end if;

  -- Each value must be numeric.
  begin
    v_dose_adherence := (p_weights->>'dose_adherence')::numeric;
    v_weight_loss    := (p_weights->>'weight_loss')::numeric;
    v_activity       := (p_weights->>'activity')::numeric;
    v_symptoms       := (p_weights->>'symptoms')::numeric;
  exception when others then
    raise exception 'ranking_weights values must be numeric'
      using errcode = 'P0001';
  end;

  -- Each value must be in [0, 1].
  if v_dose_adherence < 0 or v_dose_adherence > 1 or
     v_weight_loss    < 0 or v_weight_loss    > 1 or
     v_activity       < 0 or v_activity       > 1 or
     v_symptoms       < 0 or v_symptoms       > 1 then
    raise exception 'ranking_weights values must each be in [0, 1]'
      using errcode = 'P0001';
  end if;

  -- Sum must equal 1.0 within ±0.001 tolerance.
  v_sum := v_dose_adherence + v_weight_loss + v_activity + v_symptoms;
  if abs(v_sum - 1.0) > 0.001 then
    raise exception 'ranking_weights must sum to 1.0 (±0.001); got %', v_sum
      using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public._validate_ranking_weights(jsonb) from public;
grant execute on function public._validate_ranking_weights(jsonb) to authenticated;

-- =============================================================================
-- 4. Trigger function: fires BEFORE INSERT OR UPDATE OF ranking_weights
--    Invokes _validate_ranking_weights(new.ranking_weights).
-- =============================================================================
create or replace function public._trg_validate_ranking_weights()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  perform public._validate_ranking_weights(new.ranking_weights);
  return new;
end;
$$;

-- =============================================================================
-- 5. Trigger on org_settings: BEFORE INSERT OR UPDATE OF ranking_weights
-- =============================================================================
drop trigger if exists org_settings_validate_ranking_weights_trigger on public.org_settings;

create trigger org_settings_validate_ranking_weights_trigger
  before insert or update of ranking_weights
  on public.org_settings
  for each row
  execute function public._trg_validate_ranking_weights();

commit;
