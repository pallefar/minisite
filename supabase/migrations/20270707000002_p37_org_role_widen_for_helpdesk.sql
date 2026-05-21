-- Phase 37 hot-fix (added 2026-05-21 during Phase 35 close-out attempt):
-- The original Plan 37-01 Task 1 created the helpdesk tables; Task 2 wrote RLS
-- policies referencing org_member_role values `support_admin`, `support_lead`,
-- and `support_agent` that don't exist on the live enum (`owner`, `clinician`,
-- `staff` only). Phase 37 close-out shipped all 9 follow-up migrations but never
-- ran `supabase db push --linked`, so the enum-vs-policies gap stayed hidden
-- until Phase 35 attempted its own push.
--
-- Phase 37 PLAN 01 declared these helpdesk roles in CONTEXT.md but no migration
-- ever widened the enum. This file closes that gap so the RLS policies (now in
-- 20270707000020_helpdesk_rls_policies.sql, renamed from 000002 to free this
-- slot) can apply cleanly.
--
-- Postgres restriction: ALTER TYPE ... ADD VALUE may run inside a transaction
-- but the new value cannot be USED in the same transaction. Therefore the
-- ALTER TYPEs go in this migration (and only this migration), and the policies
-- in the renamed 000020 reference them after this migration's transaction
-- commits.
--
-- IF NOT EXISTS guards make the file idempotent for re-runs.

alter type public.org_member_role add value if not exists 'support_admin';
alter type public.org_member_role add value if not exists 'support_lead';
alter type public.org_member_role add value if not exists 'support_agent';
