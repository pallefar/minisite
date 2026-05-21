-- Phase 35 GAME-09, D-19 (reward type 4 — combo/cross-streak)
-- AFTER INSERT trigger on badge_unlocks where source='challenge':
-- checks active streak (>= 7 days) and unlocks combo-cross-streak badge + +50 XP.
-- Pattern: Plan 35-03 Task 2 spec; Phase 7 audit_logs row-trigger discipline.
-- Named dollar-quote tags ($body$) per reference_postgres_dollar_quote_nesting_in_cron_body.
-- NO auth.uid() — trigger function takes user_id from NEW row.
-- Recursion guard via transaction-local set_config('p35.in_combo', '1', true).
-- Defense-in-depth: exception when others wrapper prevents combo failure from
--   blocking the original badge_unlocks INSERT.
--
-- CALL STACK for combo trigger + grant_xp_for_action:
--   badge_unlocks INSERT (source='challenge')
--     → _p35_combo_badge_check fires
--       → checks streak_state.current_streak_days >= 7
--       → INSERT badge_unlocks (source='combo') via grant_xp_for_action path...
--         (actually: direct INSERT for combo badge, then grant_xp_for_action for XP)
--       → grant_xp_for_action(user, 50, 'combo_unlock', 'combo:<ref>')
--         → INSERT into xp_ledger
--         → detect level-up → INSERT badge_unlocks (source='level')
--           → _p35_combo_badge_check fires on level badge INSERT
--             → source='level' ≠ 'challenge' → returns early (no recursion)
-- Additionally, the transaction-local p35.in_combo guard prevents re-entry
-- even if a future code path inserts a source='challenge' badge during combo processing.

-- ============================================================
-- FUNCTION: public._p35_combo_badge_check()
-- AFTER INSERT trigger on public.badge_unlocks
-- Fires only when source='challenge' AND user has active streak >= 7 days.
-- ============================================================

create or replace function public._p35_combo_badge_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, extensions
as $body$
declare
  v_streak int;
begin
  -- GAME-09: combo requires challenge completion + active streak >= 7 days

  -- Recursion guard: transaction-local flag prevents re-entry
  -- set_config(key, value, is_local=true) — 3rd arg `true` makes it transaction-local
  -- (cleared at transaction end; never leaks across separate statements)
  if current_setting('p35.in_combo', true) = '1' then
    return new;
  end if;

  -- Only fire for challenge-source unlocks
  if new.source <> 'challenge' then
    return new;
  end if;

  -- Set recursion guard BEFORE any DML that could re-trigger this function
  perform set_config('p35.in_combo', '1', true);

  -- Check active streak (>= 7 days per GAME-09 "compound consistency" threshold)
  select current_streak_days
    into v_streak
    from public.streak_state
   where user_id = new.user_id;

  if coalesce(v_streak, 0) >= 7 then
    -- Insert combo-cross-streak badge if not already unlocked
    -- ON CONFLICT (user_id, badge_id) DO NOTHING — idempotency guaranteed by
    -- UNIQUE INDEX idx_badge_unlocks_user_badge from Plan 35-01 migration
    insert into public.badge_unlocks (user_id, badge_id, source, source_ref)
    values (new.user_id, 'combo-cross-streak', 'combo', 'combo:' || coalesce(new.source_ref, new.badge_id))
    on conflict (user_id, badge_id) do nothing;

    -- Grant +50 XP combo bonus (D-19 reward type 4)
    -- grant_xp_for_action takes p_user as parameter (NOT auth.uid())
    perform public.grant_xp_for_action(
      new.user_id,
      50,
      'combo_unlock',
      'combo:' || coalesce(new.source_ref, new.badge_id)
    );
  end if;

  -- Clear recursion guard after DML completes
  -- (transaction-local anyway; this makes the intent explicit)
  perform set_config('p35.in_combo', '', true);

  return new;
exception when others then
  -- Defense-in-depth: combo failure NEVER blocks the original badge_unlocks INSERT
  raise notice '_p35_combo_badge_check: error % — continuing (do not block badge unlock)', sqlerrm;
  return new;
end;
$body$;

comment on function public._p35_combo_badge_check() is
  'Phase 35 GAME-09 — fires AFTER INSERT on badge_unlocks where source=''challenge''. '
  'Checks streak_state.current_streak_days >= 7; if met, inserts combo-cross-streak badge '
  'and calls grant_xp_for_action for +50 XP combo bonus. '
  'Recursion guard: transaction-local set_config(''p35.in_combo'', ''1'', true) prevents '
  'infinite loop (level-up badge INSERT from grant_xp_for_action has source=''level'', '
  'which causes early return, so recursion cannot naturally occur; guard is defense-in-depth). '
  'Named dollar-quote tag $body$ per project convention.';

-- ============================================================
-- TRIGGER: trg_p35_combo_badge_check
-- AFTER INSERT on public.badge_unlocks
-- ============================================================

drop trigger if exists trg_p35_combo_badge_check on public.badge_unlocks;
create trigger trg_p35_combo_badge_check
  after insert on public.badge_unlocks
  for each row execute function public._p35_combo_badge_check();

-- ============================================================
-- RECURSION ANALYSIS (per PLAN 35-03 scope notes):
--
-- The combo trigger calls grant_xp_for_action which may insert into badge_unlocks.
-- That insert has source='level', NOT source='challenge'. The first if-check
-- (new.source <> 'challenge') immediately returns for level badges — no infinite loop.
--
-- The transaction-local p35.in_combo flag is an additional safety net: if any
-- future code path inserts a badge with source='challenge' DURING the combo
-- processing (e.g., a future challenge-completion trigger), the flag prevents
-- re-entry and avoids any recursive spiral. The flag is transaction-local
-- (set_config 3rd arg = true), meaning it is automatically cleared at transaction
-- commit and never leaks across separate INSERT statements.
--
-- UNIQUE INDEX on (user_id, badge_id) from Plan 35-01 (idx_badge_unlocks_user_badge)
-- ensures combo-cross-streak badge unlocks at most once per user regardless of
-- how many challenge completions occur.
-- ============================================================
