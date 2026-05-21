-- Phase 35 Plan 35-04 — pgTAP: leaderboard_matview structure + rolling-7d correctness.
--
-- Run via: supabase test db --linked --file supabase/tests/35_leaderboard_matview.sql
--
-- Prerequisites: All Phase 35 migrations applied (Plan 35-10 deployment gates this).
-- xp_ledger is created in Plan 35-01 (sibling wave executor).
-- leaderboard_matview is created in Plan 35-04 migration 20270708000012.
--
-- Test plan (4 assertions):
--   1. D-16: user with higher rolling-7d XP ranks #1
--   2. D-16: rolling-7d XP sum is correct
--   3. D-11: matview excludes admin-disabled cohorts (leaderboard_enabled=false)
--   4. D-15: opt-out (active=false) drops user from matview on next refresh

begin;
select plan(4);

-- ============================================================================
-- Setup: 2 users in same admin-enabled cohort, both opted in
-- ============================================================================
do $body$
declare
  c  uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
begin
  insert into public.cohort_definitions (id, name, leaderboard_enabled, rule, compiled_sql)
    values (c, 'P35 test cohort', true, '{"type":"all","conditions":[]}'::jsonb, 'true');

  insert into public.profiles (id)
    values (u1), (u2);

  insert into public.cohort_membership (cohort_id, user_id)
    values (c, u1), (c, u2);

  insert into public.leaderboard_optin (user_id, cohort_id, handle, active, opted_in_at)
    values
      (u1, c, 'TestUser-1111', true, now()),
      (u2, c, 'TestUser-2222', true, now());

  -- u1 has 500 XP in last 7d; u2 has 200 XP in last 7d → u1 ranks #1 (D-16)
  insert into public.xp_ledger (user_id, action_type, xp_delta, created_at)
    values
      (u1, 'injection_log', 500, now()),
      (u2, 'injection_log', 200, now());

  -- Store UUIDs in local config for subsequent assertions.
  perform set_config('p35_test.c',  c::text,  true);
  perform set_config('p35_test.u1', u1::text, true);
  perform set_config('p35_test.u2', u2::text, true);
end $body$;

-- Initial refresh to populate the matview with our test data.
refresh materialized view public.leaderboard_matview;

-- ============================================================================
-- Test 1: D-16 — user with higher rolling-7d XP ranks #1
-- ============================================================================
select is(
  (select rank_in_cohort::bigint
     from public.leaderboard_matview
    where cohort_id = current_setting('p35_test.c')::uuid
      and user_id   = current_setting('p35_test.u1')::uuid),
  1::bigint,
  'D-16: user with higher rolling-7d XP (500) ranks #1'
);

-- ============================================================================
-- Test 2: D-16 — rolling-7d XP sum is correct
-- ============================================================================
select is(
  (select xp_7d
     from public.leaderboard_matview
    where cohort_id = current_setting('p35_test.c')::uuid
      and user_id   = current_setting('p35_test.u1')::uuid),
  500::bigint,
  'D-16: rolling-7d XP sum is correct (500)'
);

-- ============================================================================
-- Test 3: D-11 — matview excludes admin-disabled cohorts
-- ============================================================================
do $body$
declare
  c2 uuid := gen_random_uuid();
  u3 uuid := gen_random_uuid();
begin
  -- leaderboard_enabled = false (privacy-default)
  insert into public.cohort_definitions (id, name, leaderboard_enabled, rule, compiled_sql)
    values (c2, 'P35 disabled cohort', false, '{"type":"all","conditions":[]}'::jsonb, 'true');

  insert into public.profiles (id) values (u3);
  insert into public.cohort_membership (cohort_id, user_id) values (c2, u3);
  insert into public.leaderboard_optin (user_id, cohort_id, handle, active, opted_in_at)
    values (u3, c2, 'TestUser-3333', true, now());
  insert into public.xp_ledger (user_id, action_type, xp_delta, created_at)
    values (u3, 'injection_log', 999, now());

  perform set_config('p35_test.c2', c2::text, true);
end $body$;

refresh materialized view public.leaderboard_matview;

select is(
  (select count(*)::bigint
     from public.leaderboard_matview
    where cohort_id = current_setting('p35_test.c2')::uuid),
  0::bigint,
  'D-11: matview excludes admin-disabled cohorts (leaderboard_enabled=false)'
);

-- ============================================================================
-- Test 4: D-15 — opt-out drops user from matview on next refresh
-- ============================================================================
update public.leaderboard_optin
   set active = false
 where user_id   = current_setting('p35_test.u1')::uuid
   and cohort_id = current_setting('p35_test.c')::uuid;

refresh materialized view public.leaderboard_matview;

select is(
  (select count(*)::bigint
     from public.leaderboard_matview
    where user_id = current_setting('p35_test.u1')::uuid),
  0::bigint,
  'D-15: opt-out (active=false) drops user from matview on next refresh'
);

select * from finish();
rollback;
