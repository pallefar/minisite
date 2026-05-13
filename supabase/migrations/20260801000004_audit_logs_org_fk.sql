-- Phase 9 Plan 09-01 — audit_logs.org_id → orgs(id) foreign key.
--
-- Deferred from 20260801000001 to step 4 because the orgs table did not
-- exist at that point. ON DELETE SET NULL so the org_delete skeleton
-- audit row (written inline by `delete_org` BEFORE the cascade) survives
-- the org row vanishing. This mirrors the Phase 7 pattern for
-- audit_logs.user_id (also `on delete set null`).

alter table public.audit_logs
  add constraint audit_logs_org_id_fkey
  foreign key (org_id) references public.orgs(id) on delete set null;
