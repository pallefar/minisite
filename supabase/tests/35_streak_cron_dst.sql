-- Phase 35 Plan 35-02 pgTAP: DST-safe streak evaluation + idempotency proofs.
--
-- 5 assertions:
--   Test 1: first evaluation (action yesterday-local) increments streak to 1
--   Test 2: re-evaluation same day is idempotent (DST double-fire safe — Pitfall 2)
--   Test 3: missed-day user with no freeze tokens → streak breaks to 0
--   Test 4: longest_streak preserved across streak break
--   Test 5: null timezone falls back to UTC without erroring
--
-- Run via: supabase test db --linked --file supabase/tests/35_streak_cron_dst.sql
-- Note: Tests use gen_random_uuid() for isolation; run inside a transaction + rollback.

begin;
select plan(5);

-- ============================================================================
-- Test 1 + Test 2 setup: user with America/New_York timezone + qualifying action yesterday
-- ============================================================================

do $setup$
declare
  uid uuid := gen_random_uuid();
begin
  -- Insert profile with timezone
  insert into public.profiles (id, timezone)
  values (uid, 'America/New_York')
  on conflict (id) do update set timezone = 'America/New_York';

  -- Insert qualifying injection_log "yesterday" in New_York local time.
  -- We use `now() at time zone 'America/New_York' - interval '1 day'` to
  -- produce a timestamp that is `v_yesterday_local` inside evaluate_streak_for_user.
  insert into public.xp_ledger (id, user_id, action_type, xp_delta, created_at)
  values (
    gen_random_uuid(),
    uid,
    'injection_log',
    25,
    (now() at time zone 'America/New_York' - interval '1 day')
  );

  -- Store uid in session config for subsequent statements.
  perform set_config('p35_test.uid', uid::text, true);
end $setup$;

-- Test 1: first evaluation increments streak to 1
select public.evaluate_streak_for_user(current_setting('p35_test.uid')::uuid);

select is(
  (select current_streak_days
     from public.streak_state
    where user_id = current_setting('p35_test.uid')::uuid),
  1::int,
  'Test 1: first evaluation with qualifying action yesterday → streak = 1'
);

-- Test 2: re-evaluation same day is idempotent (simulates DST double-fire from Pitfall 2)
select public.evaluate_streak_for_user(current_setting('p35_test.uid')::uuid);

select is(
  (select current_streak_days
     from public.streak_state
    where user_id = current_setting('p35_test.uid')::uuid),
  1::int,
  'Test 2: DST double-fire: second call same day is no-op (idempotent on last_eval_date)'
);

-- ============================================================================
-- Test 3 + Test 4 setup: user with active streak, no freeze tokens, missed day
-- ============================================================================

do $setup_break$
declare
  uid_break uuid := gen_random_uuid();
begin
  -- Insert profile
  insert into public.profiles (id, timezone)
  values (uid_break, 'America/New_York')
  on conflict (id) do update set timezone = 'America/New_York';

  -- Pre-seed streak_state with an existing 10-day streak, longest=12.
  -- last_eval_date is null (never evaluated today) so idempotency guard won't skip.
  insert into public.streak_state (user_id, current_streak_days, longest_streak_days, last_eval_date)
  values (uid_break, 10, 12, null);

  -- No freeze_tokens_ledger rows → balance = 0.
  -- No xp_ledger rows for yesterday → v_has_action = false.

  perform set_config('p35_test.uid_break', uid_break::text, true);
end $setup_break$;

-- Evaluate: missed day, no freeze tokens → streak breaks to 0
select public.evaluate_streak_for_user(current_setting('p35_test.uid_break')::uuid);

select is(
  (select current_streak_days
     from public.streak_state
    where user_id = current_setting('p35_test.uid_break')::uuid),
  0::int,
  'Test 3: missed day without freeze tokens → streak breaks to 0'
);

select is(
  (select longest_streak_days
     from public.streak_state
    where user_id = current_setting('p35_test.uid_break')::uuid),
  12::int,
  'Test 4: longest_streak_days preserved (12) across streak break'
);

-- ============================================================================
-- Test 5: null timezone falls back to UTC without erroring
-- ============================================================================

do $setup_notz$
declare
  uid_notz uuid := gen_random_uuid();
begin
  -- Insert profile with null timezone (should fall back to UTC in evaluate_streak_for_user)
  insert into public.profiles (id, timezone)
  values (uid_notz, null)
  on conflict (id) do update set timezone = null;

  perform set_config('p35_test.uid_notz', uid_notz::text, true);
end $setup_notz$;

select lives_ok(
  $sql$
  select public.evaluate_streak_for_user(current_setting('p35_test.uid_notz')::uuid)
  $sql$,
  'Test 5: null timezone falls back to UTC — no error thrown'
);

select * from finish();
rollback;
