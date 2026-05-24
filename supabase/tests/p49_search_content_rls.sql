-- Phase 49 Plan 05 — cross-tenant RLS proof for search_content RPC.
-- Per project rule: every RLS surface gets a live cross-tenant impersonation proof test.
--
-- Asserts: clinic-A-user impersonation does NOT return clinic B community_posts rows
-- via search_content, even when both rows match the FTS query.
--
-- TODO (Wave 1 GREEN): fixture seeding + jwt impersonation. Marked TODO until Wave 1
-- Edge Fn plans (49-06) wire the assertions inline.

begin;

-- 1. Create 2 clinic orgs (clinic_a, clinic_b).
-- 2. Create 1 profile per clinic (user_a, user_b).
-- 3. Seed 1 community_posts row per clinic, both containing the FTS term 'GLP-1'.
-- 4. set local request.jwt.claims = ('{"sub":"<user_a_uuid>","role":"authenticated"}')::jsonb;
-- 5. select * from public.search_content('GLP-1', 'english');
-- 6. assert: every returned row with type='post' has space_id IN (clinic_a spaces only).
-- 7. assert: NO row with space_id IN clinic_b spaces.
-- 8. Reverse: set jwt to user_b; assert only clinic_b posts returned.
-- 9. Both directions must pass for the test to count as a proof.

rollback;
