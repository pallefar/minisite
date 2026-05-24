-- Phase 48 — banned_words_trigger SQL integration test (scaffold).
-- WAVE 0: RED — drives Plan 48-12 close-out to GREEN.
--
-- Validates banned_words match trigger (this plan, migration 20270901000013):
-- INSERT post body containing a banned word → community_reports row appears
-- with reason->>'source'='banned_word' AND reason->>'word' matches.

\set ON_ERROR_STOP on
\echo 'p48_banned_words_trigger — TODO: assertion body'

-- TODO (drive to GREEN at Plan 48-12 close-out):
-- 1. select public.banned_word_upsert('toxic_word', 'flag', true);
-- 2. insert post body containing 'this contains TOXIC_WORD here'
-- 3. assert exists (
--      select 1 from public.community_reports
--      where target_type='post' and target_id=<post_id>
--        and reason->>'source'='banned_word'
--        and reason->>'word'='toxic_word'
--    )
-- 4. INSERT same body again — assert STILL only 1 community_reports row (on conflict do nothing).
-- 5. repeat for community_comments target_type='comment'
-- 6. raise exception 'trigger failed' if assertion does not match
