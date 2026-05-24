-- Phase 48 — audit_log_immutability SQL integration test (scaffold).
-- WAVE 0: RED — drives Plan 48-12 close-out to GREEN.
--
-- Validates moderation_audit_log (Plan 48-04, migration 20270901000008)
-- append-only invariant: UPDATE / DELETE from any caller (including staff)
-- raises permission_denied.

\set ON_ERROR_STOP on
\echo 'p48_audit_log_immutability — TODO: assertion body'

-- TODO (drive to GREEN at Plan 48-12 close-out):
-- 1. seed a moderation_audit_log row via public.log_moderation_action(...)
-- 2. set role authenticated; jwt.sub = <any uuid>
-- 3. begin; update public.moderation_audit_log set reason='tampered' where id=<row_id>; commit;
--    → expect SQLSTATE 42501 (insufficient_privilege) or 0 rows updated
-- 4. begin; delete from public.moderation_audit_log where id=<row_id>; commit;
--    → expect SQLSTATE 42501 or 0 rows deleted
-- 5. additionally with staff jwt: same UPDATE/DELETE must also fail
-- 6. raise exception 'audit tampered' on any successful UPDATE/DELETE
