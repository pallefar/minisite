-- Phase 35 Plan 35-03 Task 5 — pgTAP combo badge trigger tests.
-- Exercises _p35_combo_badge_check (GAME-09) with 5 assertions.
-- IMPORTANT: runs inside begin/rollback — leaves no residue.
--
-- Assertion plan:
--   1. challenge-source unlock + streak>=7 → combo badge unlocked
--   2. combo badge grants +50 XP (combo_unlock action_type in xp_ledger)
--   3. low-streak user (streak=3) does NOT trigger combo
--   4. ON CONFLICT idempotency — combo badge unlocks at most once (second insert no-ops)
--   5. REVIEW-B-1: challenge-complete that also levels up → BOTH combo + level badges unlock exactly once each
--
-- Setup notes:
--   - Uses gen_random_uuid() for test user IDs (no auth.users row needed; FK is ON DELETE SET NULL)
--   - Uses transaction-local set_config to pass UIDs between anonymous DO blocks
--   - streak_state rows inserted directly (SECDEF function only needed by cron; pgTAP tests write directly)
--   - badge_unlocks have UNIQUE INDEX (user_id, badge_id) from Plan 35-01 migration
--   - xp_ledger rows written by grant_xp_for_action (SECDEF) when combo trigger fires
--   - Function signature: grant_xp_for_action(p_user uuid, p_xp_delta int, p_action_type text, p_source_ref text)

begin;
select plan(5);

-- ============================================================
-- Setup: User A — active streak (>= 7 days) for Tests 1, 2, 4
-- ============================================================

do $setup_a$
declare uid uuid := gen_random_uuid();
begin
  -- Insert into streak_state directly (bypass RLS via SECDEF context in pgTAP)
  insert into public.streak_state (user_id, current_streak_days, longest_streak_days, last_action_at, last_eval_date)
  values (uid, 12, 12, now(), current_date);

  -- Stash UID for subsequent statements
  perform set_config('p35_test.uid_combo', uid::text, true);
end $setup_a$;

-- ============================================================
-- Test 1: challenge-source badge_unlock + streak>=7 → combo badge fires
-- ============================================================

do $insert_challenge_a$
declare uid uuid := current_setting('p35_test.uid_combo')::uuid;
begin
  -- Inserting with source='challenge' triggers _p35_combo_badge_check
  -- The trigger checks streak_state.current_streak_days >= 7 (it is 12) → fires
  insert into public.badge_unlocks (user_id, badge_id, source, source_ref)
  values (uid, 'challenge-log-count', 'challenge', 'challenge:test-1');
end $insert_challenge_a$;

select ok(
  exists(
    select 1 from public.badge_unlocks
     where user_id = current_setting('p35_test.uid_combo')::uuid
       and badge_id = 'combo-cross-streak'
  ),
  'GAME-09: challenge-source unlock with streak>=7 triggers combo badge'
);

-- ============================================================
-- Test 2: combo badge also grants +50 XP via grant_xp_for_action
-- ============================================================

select is(
  (
    select sum(xp_delta)
      from public.xp_ledger
     where user_id = current_setting('p35_test.uid_combo')::uuid
       and action_type = 'combo_unlock'
  ),
  50::bigint,
  'GAME-09: combo grants +50 XP bonus (combo_unlock action_type in xp_ledger)'
);

-- ============================================================
-- Test 3: User B — low streak (3 days) does NOT trigger combo
-- ============================================================

do $setup_b$
declare uid uuid := gen_random_uuid();
begin
  insert into public.streak_state (user_id, current_streak_days, longest_streak_days, last_eval_date)
  values (uid, 3, 5, current_date);  -- below the 7-day threshold

  -- Insert badge_unlock with source='challenge' — combo should NOT fire
  insert into public.badge_unlocks (user_id, badge_id, source, source_ref)
  values (uid, 'challenge-log-count', 'challenge', 'challenge:test-3');

  perform set_config('p35_test.uid_nostreak', uid::text, true);
end $setup_b$;

select is(
  exists(
    select 1 from public.badge_unlocks
     where user_id = current_setting('p35_test.uid_nostreak')::uuid
       and badge_id = 'combo-cross-streak'
  ),
  false,
  'GAME-09: low-streak user (streak=3) does NOT trigger combo'
);

-- ============================================================
-- Test 4: ON CONFLICT idempotency — combo badge unlocks at most once
-- Second challenge insert for user A should not re-unlock combo-cross-streak
-- (UNIQUE INDEX idx_badge_unlocks_user_badge from Plan 35-01 enforces this)
-- ============================================================

do $insert_challenge_a_again$
declare uid uuid := current_setting('p35_test.uid_combo')::uuid;
begin
  -- Second challenge completion for the same user — combo badge already unlocked
  insert into public.badge_unlocks (user_id, badge_id, source, source_ref)
  values (uid, 'challenge-streak-days', 'challenge', 'challenge:test-4');
end $insert_challenge_a_again$;

select is(
  (
    select count(*)
      from public.badge_unlocks
     where user_id = current_setting('p35_test.uid_combo')::uuid
       and badge_id = 'combo-cross-streak'
  ),
  1::bigint,
  'combo badge unlocks at most once per user (ON CONFLICT DO NOTHING idempotency)'
);

-- ============================================================
-- Test 5 (REVIEW-B-1): challenge-complete that ALSO levels up the user.
-- Call stack:
--   grant_xp_for_action(uid, 250, 'challenge_complete', ...) → +250 XP → level 4→5
--   INSERT badge_unlocks (source='challenge') → _p35_combo_badge_check fires
--     → streak>=7 → INSERT combo-cross-streak + grant_xp_for_action(uid, 50, 'combo_unlock')
--       → +50 XP → still level 5 (2700 total; no additional level-up)
--       → grant_xp_for_action also inserts level-5 badge via level-up detection on first call
-- Expected: BOTH combo-cross-streak AND level-5 badges present exactly once.
-- XP math: 2400 (seed) + 250 (challenge) + 50 (combo) = 2700 total
--          Level: compute_level(2700) = floor(sqrt(2700/100)) = floor(5.19) = 5 ✓
-- ============================================================

do $setup_c$
declare uid uuid := gen_random_uuid();
begin
  insert into public.streak_state (user_id, current_streak_days, longest_streak_days, last_action_at, last_eval_date)
  values (uid, 10, 10, now(), current_date);

  -- Seed user at exactly 2400 XP (level 4; level 5 boundary = 2500 = 5²×100)
  -- Note: 'seed' is not in xp_ledger's action_type CHECK constraint, use admin_adjustment instead
  insert into public.xp_ledger (user_id, xp_delta, action_type, source_ref)
  values (uid, 2400, 'admin_adjustment', 'test-5-seed');

  perform set_config('p35_test.uid_levelup', uid::text, true);
end $setup_c$;

do $challenge_and_combo_c$
declare uid uuid := current_setting('p35_test.uid_levelup')::uuid;
begin
  -- Simulate challenge completion: +250 XP via grant_xp_for_action
  -- This brings user from 2400 → 2650 XP, crossing level 5 boundary (2500)
  -- grant_xp_for_action detects level-up and inserts level-5 badge_unlock
  -- Function signature: (p_user uuid, p_xp_delta int, p_action_type text, p_source_ref text)
  perform public.grant_xp_for_action(uid, 250, 'challenge_complete', 'test-5-challenge');

  -- Challenge writer then inserts badge_unlock(source='challenge'), firing the combo trigger
  -- Combo trigger: streak>=7 → insert combo-cross-streak + grant 50 XP (combo_unlock)
  -- +50 XP: 2650 → 2700; still level 5 (no additional level-up)
  insert into public.badge_unlocks (user_id, badge_id, source, source_ref)
  values (uid, 'challenge-log-count', 'challenge', 'challenge:test-5');
end $challenge_and_combo_c$;

-- REVIEW-B-1 assertion: BOTH combo-cross-streak AND level-5 badges present exactly once each
-- The recursion guard (p35.in_combo transaction-local set_config) ensures no infinite loop
select is(
  (
    select count(*)
      from public.badge_unlocks
     where user_id = current_setting('p35_test.uid_levelup')::uuid
       and badge_id in ('combo-cross-streak', 'level-5')
  ),
  2::bigint,
  'GAME-09 REVIEW-B-1: challenge-complete-that-also-levels-up unlocks BOTH combo + level-5 badges exactly once each (recursion guard verified)'
);

select * from finish();
rollback;
