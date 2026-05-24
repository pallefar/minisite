-- Phase 48 — temp_suspended_cron SQL integration test (scaffold).
-- WAVE 0: RED — drives Plan 48-12 close-out to GREEN.
--
-- Validates temp_suspended_restore cron (Plan 48-03, migration 20270901000007):
-- when expires_at < now() and status='temp_suspended', cron flips status='active'
-- and clears expires_at; emits moderation_audit_log row action='temp_restore'.

\set ON_ERROR_STOP on
\echo 'p48_temp_suspended_cron — TODO: assertion body'

-- TODO (drive to GREEN at Plan 48-12 close-out):
-- 1. insert user_moderation_state (uid, 'temp_suspended', now() - interval '1 minute')
-- 2. manually call cron body fn (or `perform public.temp_suspended_restore_tick()`)
-- 3. assert (select status from public.user_moderation_state where user_id=uid) = 'active'
-- 4. assert (select expires_at from public.user_moderation_state where user_id=uid) is null
-- 5. assert exists (select 1 from public.moderation_audit_log where target_id=uid and action_type='temp_restore')
-- 6. raise exception 'cron failed' if any assertion does not match
