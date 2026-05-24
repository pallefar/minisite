-- Phase 48 — audit_log_coverage SQL integration test (scaffold).
-- WAVE 0: RED — drives Plan 48-12 close-out to GREEN.
--
-- Validates moderation_audit_log coverage: every apply_user_moderation
-- (Plan 48-03) action (mute / ban / temp_suspend / unmute / unban) and every
-- report_content call produces exactly one moderation_audit_log row.

\set ON_ERROR_STOP on
\echo 'p48_audit_log_coverage — TODO: assertion body'

-- TODO (drive to GREEN at Plan 48-12 close-out):
-- For each action_type in ('mute','ban','temp_suspend','unmute','unban'):
--   1. snapshot pre-count: select count(*) from public.moderation_audit_log
--      where action_type=<type> and target_id=<uid>;
--   2. call public.apply_user_moderation(<uid>, <type>, ...) via staff jwt;
--   3. assert post-count == pre-count + 1
-- For report_content:
--   1. snapshot pre-count where action_type='report_filed' and target_id=<post_id>
--   2. select public.report_content('post', <post_id>, 'spam');
--   3. assert post-count == pre-count + 1
-- 4. raise exception 'audit miss' on any (post - pre) != 1
