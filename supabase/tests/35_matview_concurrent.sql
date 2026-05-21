-- Phase 35 Plan 35-04 — pgTAP: UNIQUE INDEX existence + REFRESH CONCURRENTLY proof.
--
-- Run via: supabase test db --linked --file supabase/tests/35_matview_concurrent.sql
--
-- Purpose: Proves Pitfall 3 is mitigated:
--   "REFRESH MATERIALIZED VIEW CONCURRENTLY requires a UNIQUE index on the matview.
--    Without it, the refresh throws: ERROR: cannot refresh materialized view
--    'leaderboard_matview' concurrently."
--
-- Test plan (2 assertions):
--   1. UNIQUE INDEX idx_leaderboard_matview_cohort_user exists
--   2. REFRESH MATERIALIZED VIEW CONCURRENTLY succeeds (would throw if no UNIQUE INDEX)

begin;
select plan(2);

-- ============================================================================
-- Test 1: UNIQUE INDEX exists (load-bearing for CONCURRENTLY refresh)
-- ============================================================================
select ok(
  exists(
    select 1
      from pg_indexes
     where schemaname = 'public'
       and tablename  = 'leaderboard_matview'
       and indexname  = 'idx_leaderboard_matview_cohort_user'
       and indexdef   like 'CREATE UNIQUE INDEX%'
  ),
  'UNIQUE INDEX idx_leaderboard_matview_cohort_user exists (Pitfall 3 mitigation)'
);

-- ============================================================================
-- Test 2: REFRESH CONCURRENTLY succeeds (throws if no UNIQUE INDEX)
-- ============================================================================
select lives_ok(
  $sql$ refresh materialized view concurrently public.leaderboard_matview $sql$,
  'REFRESH MATERIALIZED VIEW CONCURRENTLY succeeds with UNIQUE INDEX present'
);

select * from finish();
rollback;
