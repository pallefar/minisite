-- Phase 48 — reporter_select_own SQL integration test (scaffold).
-- WAVE 0: RED — drives Plan 48-12 close-out to GREEN.
--
-- Validates community_reports SELECT RLS (Plan 48-02): reporter sees own
-- rows; non-reporter non-staff sees zero rows from another reporter.

\set ON_ERROR_STOP on
\echo 'p48_reporter_select_own — TODO: assertion body'

-- TODO (drive to GREEN at Plan 48-12 close-out):
-- 1. seed two users (alice, bob); each calls report_content() on a post target
-- 2. set role authenticated; jwt.sub = alice
-- 3. assert count(*) from community_reports where reporter_user_id = alice = 1
-- 4. assert count(*) from community_reports where reporter_user_id = bob   = 0
-- 5. raise exception 'assertion failed' if either does not match
