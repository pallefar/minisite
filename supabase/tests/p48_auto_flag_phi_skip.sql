-- Phase 48 — auto_flag_phi_skip SQL integration test (scaffold).
-- WAVE 0: RED — drives Plan 48-12 close-out to GREEN.
--
-- Validates D-08 PHI gate at trigger WHEN clause: post in clinic-org-scoped
-- space (org_id IS NOT NULL) does NOT fire pg_net to claude-moderation Fn.

\set ON_ERROR_STOP on
\echo 'p48_auto_flag_phi_skip — TODO: assertion body'

-- TODO (drive to GREEN at Plan 48-12 close-out):
-- 1. seed clinic org + community_space with org_id = <clinic_org_id>
-- 2. snapshot pre-count: select count(*) from net._http_response where url like '%/claude-moderation';
-- 3. insert community_posts row in the clinic-scoped space
-- 4. wait briefly (pg_net is async); poll
-- 5. assert post-count == pre-count (NO new pg_net call to claude-moderation)
-- 6. control: insert post in a GLOBAL space (org_id IS NULL); assert post-count > pre-count
-- 7. raise exception 'PHI leak to Anthropic' if clinic-org content triggered the Fn
