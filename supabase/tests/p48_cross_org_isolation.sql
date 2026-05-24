-- Phase 48 — cross_org_isolation SQL integration test (scaffold; LIVE-2-org).
-- WAVE 0: RED — drives Plan 48-12 close-out to GREEN.
--
-- Validates can_moderate_report_org() (Plan 48-02 helper) + community_reports
-- SELECT RLS: clinic A support_admin cannot see clinic B reports
-- (T-44-01 cross-tenant isolation parity for moderation surface).

\set ON_ERROR_STOP on
\echo 'p48_cross_org_isolation — TODO: assertion body'

-- TODO (drive to GREEN at Plan 48-12 close-out):
-- 1. seed orgs A + B; seed support_admin user a_admin in org A only
-- 2. seed clinic-org-scoped community_spaces (org_id=B); insert post + report
-- 3. set role authenticated; jwt.sub = a_admin
-- 4. assert count(*) visible community_reports rows for org-B target = 0
-- 5. flip jwt.sub to b_admin (org B); assert count(*) = 1
-- 6. raise exception 'cross-org leak' if a_admin sees > 0
