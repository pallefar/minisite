-- Phase 48 — never_auto_remove regression-guard SQL test (scaffold).
-- WAVE 0: RED — drives Plan 48-12 close-out to GREEN.
--
-- Validates RESEARCH "NEVER auto-remove" invariant: no code path in the
-- claude-moderation Fn / auto_flag trigger / banned-words trigger may DELETE
-- community_posts or community_comments rows. Hard-delete is staff-only via
-- Plan 48-09 admin action. Implemented as a codebase grep regression guard.

\set ON_ERROR_STOP on
\echo 'p48_never_auto_remove — TODO: assertion body'

-- TODO (drive to GREEN at Plan 48-12 close-out):
-- This test is a codebase grep guard, NOT an in-DB assertion. Runner script:
--   ! grep -rE "delete from public\.community_posts.*claude|delete from public\.community_comments.*auto_flag" \
--       supabase/functions/claude-moderation/ supabase/migrations/20270901*p48*.sql
-- Inside this file we record the invariant via a NOTICE so the test is
-- archived alongside the other SQL tests.
do $$
begin
  raise notice 'p48_never_auto_remove: invariant tested by codebase grep guard — see supabase/tests/p48_never_auto_remove.sh (Plan 48-12 close-out).';
end $$;
