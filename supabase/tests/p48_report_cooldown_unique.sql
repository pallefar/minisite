-- Phase 48 — report_cooldown_unique SQL integration test (scaffold).
-- WAVE 0: RED — drives Plan 48-12 close-out to GREEN.
-- Run: psql ${SUPABASE_DB_URL} -f supabase/tests/p48_report_cooldown_unique.sql
--
-- Validates D-02 partial UNIQUE: second invocation of public.report_content()
-- for the same (reporter, target) while status IN ('open','triaged') must
-- raise 23505 unique_violation; report_content RPC catches and re-raises
-- with detail='already_reported'.

\set ON_ERROR_STOP on
\echo 'p48_report_cooldown_unique — TODO: assertion body'

-- TODO (drive to GREEN at Plan 48-12 close-out):
-- 1. set role authenticated; set request.jwt.claim.sub = '<reporter_uuid>'
-- 2. select public.report_content('post', '<target_uuid>', 'spam');
-- 3. select public.report_content('post', '<target_uuid>', 'spam');  -- expect raise
-- 4. assert error code 23505 with detail 'already_reported'
