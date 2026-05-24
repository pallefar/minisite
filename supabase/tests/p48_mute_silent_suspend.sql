-- Phase 48 — mute_silent_suspend SQL integration test (scaffold).
-- WAVE 0: RED — drives Plan 48-12 close-out to GREEN.
--
-- Validates mute RLS widen (this plan): muted author SEES their own content;
-- non-author non-staff sees ZERO rows; staff sees ALL (for moderation review).

\set ON_ERROR_STOP on
\echo 'p48_mute_silent_suspend — TODO: assertion body'

-- TODO (drive to GREEN at Plan 48-12 close-out):
-- 1. seed three users: muted_author, viewer (non-staff), staff_user (is_staff=true)
-- 2. insert post by muted_author; insert user_moderation_state (muted_author, 'muted')
-- 3. set jwt.sub = muted_author → assert count(*) community_posts where author_id=muted_author = 1
-- 4. set jwt.sub = viewer       → assert count(*) = 0  (silent suspend)
-- 5. set jwt.sub = staff_user   → assert count(*) = 1  (staff bypass)
-- 6. raise exception 'mute leak' if (4) > 0 or 'staff blocked' if (5) = 0
