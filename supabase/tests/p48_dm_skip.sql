-- Phase 48 — dm_skip SQL integration test (scaffold).
-- WAVE 0: RED — drives Plan 48-12 close-out to GREEN.
--
-- Validates D-10 DM-uniformly-skip: banned_words trigger NOT declared on
-- direct_messages; INSERT direct_messages row containing a banned word
-- creates NO community_reports row.

\set ON_ERROR_STOP on
\echo 'p48_dm_skip — TODO: assertion body'

-- TODO (drive to GREEN at Plan 48-12 close-out):
-- 1. select public.banned_word_upsert('mute_test_word', 'flag', true);
-- 2. seed dm_thread between two users
-- 3. insert direct_messages with body containing 'MUTE_TEST_WORD'
-- 4. assert count(*) from public.community_reports
--      where target_type='dm_message' and reason->>'source'='banned_word'
--      and reason->>'word'='mute_test_word' = 0
-- 5. additionally grep pg_trigger for direct_messages trigger absence:
--    assert count(*) from pg_trigger
--      where tgname like 'trg_banned_words%' and tgrelid = 'public.direct_messages'::regclass = 0
-- 6. raise exception 'DM should skip' on any match
