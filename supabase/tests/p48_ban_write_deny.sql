-- Phase 48 — ban_write_deny SQL integration test (scaffold).
-- WAVE 0: RED — drives Plan 48-12 close-out to GREEN.
--
-- Validates ban write-deny RLS widen (this plan): banned/temp_suspended user
-- cannot INSERT/UPDATE/DELETE on any of the 4 content tables.

\set ON_ERROR_STOP on
\echo 'p48_ban_write_deny — TODO: assertion body'

-- TODO (drive to GREEN at Plan 48-12 close-out):
-- 1. seed banned_user; insert user_moderation_state (banned_user, 'banned')
-- 2. set jwt.sub = banned_user
-- 3. begin; insert into public.community_posts (space_id, author_id, body) values …; commit;
--    → assert rowcount = 0 OR raises insufficient_privilege / new row violates RLS
-- 4. repeat for community_comments, community_reactions, direct_messages
-- 5. flip to temp_suspended; assert same write-deny on all 4 tables
-- 6. raise exception 'ban bypass' on any successful INSERT
