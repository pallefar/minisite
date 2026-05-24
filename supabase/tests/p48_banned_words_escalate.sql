-- Phase 48 — banned_words_escalate SQL integration test (scaffold).
-- WAVE 0: RED — drives Plan 48-12 close-out to GREEN.
--
-- Validates banned_words trigger severity='escalate' branch: pg_net.http_post
-- fires to email-router with phi:false. Verifies via pg_net._http_response
-- table after the trigger runs.

\set ON_ERROR_STOP on
\echo 'p48_banned_words_escalate — TODO: assertion body'

-- TODO (drive to GREEN at Plan 48-12 close-out):
-- 1. select public.banned_word_upsert('urgent_word', 'escalate', true);
-- 2. insert post body containing 'this contains URGENT_WORD'
-- 3. wait briefly (pg_net is async); poll pg_net._http_response
-- 4. assert exists (
--      select 1 from net._http_response
--      where url like '%/functions/v1/email-router'
--    )
-- 5. assert request body contains '"phi":false' and '"category":"banned_word_escalate"'
-- 6. raise exception 'escalate failed' on miss
