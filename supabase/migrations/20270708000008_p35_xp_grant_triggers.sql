-- Phase 35 D-01, D-04, D-05, GAME-01
-- AFTER INSERT triggers on source tables: injections, symptoms, weights, workouts.
-- grant_xp_for_action SECDEF: appends xp_ledger row + detects level-up + unlocks badges.
-- Pattern: append-only ledger trigger shape from supabase/migrations/20270708000001_p35_xp_ledger.sql
--          + AFTER INSERT trigger pattern per PLAN 35-03 Task 1.
-- Named dollar-quote tags ($body$) per reference_postgres_dollar_quote_nesting_in_cron_body.
-- NO auth.uid() — trigger functions take user_id from NEW row; SECDEF helper takes p_user param.
-- (memory: feedback_rpc_auth_uid_vs_service_role_mismatch)
--
-- Source table name mapping (verified via pg_tables query 2026-05-21):
--   injections → injections (user_id column confirmed)
--   weight_logs → weights (actual table name)
--   symptom_logs → symptoms (actual table name)
--   workouts → workouts (user_id column confirmed)
--
-- XP values (D-01 wide-scale):
--   injection_log: 25 XP
--   weight_log:    25 XP
--   symptom_log:   10 XP
--   workout_log:   50 XP

-- ============================================================
-- FUNCTION: public.grant_xp_for_action(p_user, p_action_type, p_xp_delta, p_source_ref)
-- SECDEF — called by AFTER INSERT triggers on source tables.
-- Takes p_user as PARAMETER (NOT auth.uid()) per
--   feedback_rpc_auth_uid_vs_service_role_mismatch — triggers run as table owner
--   (service-role context), NOT user context.
-- D-05: server-side ledger truth; detects level-up; inserts badge_unlocks idempotently.
-- ============================================================

create or replace function public.grant_xp_for_action(
  p_user       uuid,
  p_xp_delta   int,
  p_action_type text,
  p_source_ref text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog, extensions
as $body$
declare
  v_prior_total int;
  v_prior_level int;
  v_new_total   int;
  v_new_level   int;
  v_level_step  int;
begin
  -- 1. Compute prior XP total + level (deterministic; no cached state per D-04)
  v_prior_total := public.xp_total_for(p_user);
  v_prior_level := public.compute_level(v_prior_total);

  -- 2. Append ledger row (D-04 determinism; D-05 source of truth)
  insert into public.xp_ledger (user_id, action_type, xp_delta, source_ref)
  values (p_user, p_action_type, p_xp_delta, p_source_ref);

  -- 3. Detect level-up
  v_new_total := v_prior_total + p_xp_delta;
  v_new_level := public.compute_level(v_new_total);

  if v_new_level > v_prior_level then
    -- Unlock level badges for each new level crossed
    -- badge_catalog has level-1, level-5, level-10, level-25, level-50, level-100 (Plan 35-01 seed)
    -- Only insert if a matching badge_catalog row exists; otherwise skip (no row, no unlock)
    for v_level_step in (v_prior_level + 1) .. v_new_level loop
      if exists(select 1 from public.badge_catalog where id = 'level-' || v_level_step::text) then
        insert into public.badge_unlocks (user_id, badge_id, source, source_ref)
        values (p_user, 'level-' || v_level_step::text, 'level', 'level:' || v_level_step::text)
        on conflict (user_id, badge_id) do nothing;
      end if;
    end loop;

    -- Prestige check (D-03): prestige unlocks at level 100/200/300/...
    if (v_new_level / 100) > (v_prior_level / 100) then
      if exists(select 1 from public.badge_catalog where id = 'prestige-' || (v_new_level / 100)::text) then
        insert into public.badge_unlocks (user_id, badge_id, source, source_ref)
        values (
          p_user,
          'prestige-' || (v_new_level / 100)::text,
          'level',
          'prestige:' || (v_new_level / 100)::text
        )
        on conflict (user_id, badge_id) do nothing;
      end if;
    end if;
  end if;
end;
$body$;

comment on function public.grant_xp_for_action(uuid, int, text, text) is
  'Phase 35 D-05 — server-side XP grant called by AFTER INSERT triggers on injections/symptoms/weights/workouts. '
  'Append-only: writes to xp_ledger; detects level-up; inserts badge_unlocks. Does NOT cache level (D-04 determinism). '
  'Takes p_user as parameter, NOT auth.uid() (memory feedback_rpc_auth_uid_vs_service_role_mismatch).';

revoke all on function public.grant_xp_for_action(uuid, int, text, text) from public;
grant execute on function public.grant_xp_for_action(uuid, int, text, text) to service_role;

-- ============================================================
-- TRIGGER 1: injections → injection_log (25 XP)
-- Source table: public.injections (verified 2026-05-21 — table exists)
-- ============================================================

create or replace function public._p35_xp_on_injection()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, extensions
as $body$
begin
  -- D-01: injection_log = 25 XP (GAME-01 qualifying action)
  -- new.user_id — takes user_id from NEW row (NOT auth.uid()) per
  --   feedback_rpc_auth_uid_vs_service_role_mismatch
  perform public.grant_xp_for_action(
    new.user_id,
    25,
    'injection_log',
    'injections:' || new.id::text
  );
  return new;
exception when others then
  -- D-05 defense-in-depth: gamification error NEVER blocks the source insert
  raise notice '_p35_xp_on_injection: XP grant error % — continuing (do not block source insert)', sqlerrm;
  return new;
end;
$body$;

drop trigger if exists trg_p35_xp_on_injection on public.injections;
create trigger trg_p35_xp_on_injection
  after insert on public.injections
  for each row execute function public._p35_xp_on_injection();

-- ============================================================
-- TRIGGER 2: symptoms → symptom_log (10 XP)
-- Source table: public.symptoms (actual name; verified 2026-05-21)
-- Note: plan used 'symptom_logs' but actual table is 'symptoms' — name adjusted.
-- ============================================================

create or replace function public._p35_xp_on_symptom()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, extensions
as $body$
begin
  -- D-01: symptom_log = 10 XP (GAME-01 qualifying action)
  perform public.grant_xp_for_action(
    new.user_id,
    10,
    'symptom_log',
    'symptoms:' || new.id::text
  );
  return new;
exception when others then
  raise notice '_p35_xp_on_symptom: XP grant error % — continuing (do not block source insert)', sqlerrm;
  return new;
end;
$body$;

drop trigger if exists trg_p35_xp_on_symptom on public.symptoms;
create trigger trg_p35_xp_on_symptom
  after insert on public.symptoms
  for each row execute function public._p35_xp_on_symptom();

-- ============================================================
-- TRIGGER 3: weights → weight_log (25 XP)
-- Source table: public.weights (actual name; verified 2026-05-21)
-- Note: plan used 'weight_logs' but actual table is 'weights' — name adjusted.
-- ============================================================

create or replace function public._p35_xp_on_weight()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, extensions
as $body$
begin
  -- D-01: weight_log = 25 XP (GAME-01 qualifying action)
  perform public.grant_xp_for_action(
    new.user_id,
    25,
    'weight_log',
    'weights:' || new.id::text
  );
  return new;
exception when others then
  raise notice '_p35_xp_on_weight: XP grant error % — continuing (do not block source insert)', sqlerrm;
  return new;
end;
$body$;

drop trigger if exists trg_p35_xp_on_weight on public.weights;
create trigger trg_p35_xp_on_weight
  after insert on public.weights
  for each row execute function public._p35_xp_on_weight();

-- ============================================================
-- TRIGGER 4: workouts → workout_log (50 XP)
-- Source table: public.workouts (verified 2026-05-21 — table exists)
-- ============================================================

create or replace function public._p35_xp_on_workout()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, extensions
as $body$
begin
  -- D-01: workout_log = 50 XP (GAME-01 qualifying action — highest value)
  perform public.grant_xp_for_action(
    new.user_id,
    50,
    'workout_log',
    'workouts:' || new.id::text
  );
  return new;
exception when others then
  raise notice '_p35_xp_on_workout: XP grant error % — continuing (do not block source insert)', sqlerrm;
  return new;
end;
$body$;

drop trigger if exists trg_p35_xp_on_workout on public.workouts;
create trigger trg_p35_xp_on_workout
  after insert on public.workouts
  for each row execute function public._p35_xp_on_workout();

-- ============================================================
-- TRIGGER ORDER NOTE (per Research OQ-4):
-- AFTER INSERT is safe with Phase 5 Realtime sync because Realtime
-- LISTEN/NOTIFY fires from logical decoding (WAL-based), NOT from row
-- triggers. The trigger function INSERTing into xp_ledger will itself
-- emit a separate WAL event which Realtime can also subscribe to
-- (Plan 35-06 dashboard subscribes to xp_ledger for level-up notification).
-- ============================================================

-- ============================================================
-- IDEMPOTENCY NOTE:
-- Phase 5 sync layer de-dupes via primary key on source tables.
-- xp_ledger has UNIQUE INDEX on (user_id, action_type, cycle_id) WHERE
-- cycle_id IS NOT NULL — this guards streak/cycle double-grants. Action
-- triggers do NOT set cycle_id, so they rely on source-table PK uniqueness
-- for de-duplication (an injection can only INSERT once per id).
-- ============================================================
