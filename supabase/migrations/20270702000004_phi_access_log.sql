-- Phase 25 Plan 02 — phi_access_log: append-only PHI access audit table.
--
-- Decision refs: D-07 (RPC-triggered per sensitive UI surface), D-08 (retention +
--   patient-side viewer), HIPAA-14 (right-of-accounting-of-disclosures).
-- Pattern refs: S2 (Append-only RLS), RESEARCH Pitfall 6 (service_role REVOKE).
--
-- Distinction from audit_logs (Phase 24):
--   audit_logs = every WRITE across PHI tables (INSERT/UPDATE/DELETE), triggered
--     by per-row table triggers (automated).
--   phi_access_log = every READ of PHI by staff/clinician (page open, photo view,
--     export run, conversation thread open), triggered by explicit RPC calls from
--     UI components per D-07 (call-site instrumentation owned by Phase 30+).
--   DO NOT collapse them. Phase 24 owns write-audit; Phase 25 owns read-audit.
--
-- STRIDE threat register (inline):
--   T-25-02-01 Tampering: append-only-by-policy + service_role REVOKE update/delete
--     below ensures no row can be modified or removed after write.
--   T-25-02-02 Information disclosure: dual SELECT policy (own-as-subject OR staff)
--     with RLS default-deny blocks cross-patient reads.
--   T-25-02-03 Repudiation: actor_user_id is ALWAYS sourced from auth.uid() at the
--     RPC layer (migration 20270702000005) — args cannot forge it. accessed_at
--     defaults to now() preventing backdating.
--
-- Negative-space tamper comment (mirror of audit_logs.sql convention):
--   ONLY TWO WRITE PATHS EXIST:
--     (1) The `log_phi_access` SECURITY DEFINER RPC (migration 20270702000005)
--         called from authenticated UI components at sensitive surfaces.
--         actor_user_id is sourced from auth.uid() inside the RPC — never from
--         an argument passed by the caller.
--     (2) service_role INSERT (for backfill or integration test fixtures).
--         service_role UPDATE and DELETE are EXPLICITLY REVOKED below.
--   There is NO direct INSERT policy for the authenticated role.
--   There is NO trigger-based write (contrast with audit_logs triggers).
--   Cross-patient actors CANNOT write rows attributing access to a different
--     actor_user_id — the RPC ignores any actor arg.

create table public.phi_access_log (
  id               bigserial   primary key,
  accessed_at      timestamptz not null default now(),

  -- actor_user_id: who accessed the data. `on delete set null` so the audit row
  -- survives after a staff member's account is deleted (the access event is still
  -- a fact). The log_phi_access RPC (migration 20270702000005) enforces that
  -- auth.uid() is non-null before inserting, so only `on delete set null` can
  -- produce a null here post-facto.
  actor_user_id    uuid        references auth.users(id) on delete set null,

  -- accessed_user_id: whose PHI was accessed. `on delete cascade` so patient
  -- account deletion removes all access rows (their data, their choice to erase).
  accessed_user_id uuid        not null references auth.users(id) on delete cascade,

  -- accessed_org_id: forward-compat for Phase 28 multi-org axis. Nullable at v1.3;
  -- Phase 28 will backfill and add FK to organizations.id.
  accessed_org_id  uuid,

  -- accessed_fields: which PHI fields were seen (e.g., ['dose_log.value','photos']).
  -- at least 1 element required (DDL check = single source of truth; no plpgsql
  -- pre-validation needed — avoids "defensive jsonb contracts" anti-pattern).
  accessed_fields  text[]      not null check (array_length(accessed_fields, 1) >= 1),

  -- reason: staff-authored free-text explaining why the access occurred.
  -- NOTE (T-25-02-05 accept): reason must NOT contain patient identifiers;
  -- documented at RPC level. Future audit-of-audit could lint this.
  reason           text        not null check (length(reason) between 1 and 500),

  -- request_ip_hash: sha256 of the client IP (hashed for GDPR compliance).
  -- Nullable — not available in all call paths at v1.3.
  request_ip_hash  text
);

-- Indexes for patient-side viewer pagination (accessed_user_id + time) and
-- staff investigation queries (actor_user_id + time).
create index phi_access_log_accessed_user_time_idx
  on public.phi_access_log (accessed_user_id, accessed_at desc);

create index phi_access_log_actor_time_idx
  on public.phi_access_log (actor_user_id, accessed_at desc);

-- Enable RLS (default-deny for all commands not covered by an explicit policy).
alter table public.phi_access_log enable row level security;

-- SELECT policy 1: patients see rows where they are the subject (D-08 viewer).
-- The two SELECT policies combine with OR within the same SQL command, so a
-- patient who is also staff sees all rows (staff policy covers them).
create policy phi_access_log_select_own_as_subject
  on public.phi_access_log
  for select
  using (auth.uid() = accessed_user_id);

-- SELECT policy 2: staff+ sees ALL rows for investigation (D-07 staff audit).
create policy phi_access_log_select_staff
  on public.phi_access_log
  for select
  using (public.is_admin_at_least('staff'::public.admin_role));

-- NO INSERT/UPDATE/DELETE policy for authenticated role.
-- Writes flow exclusively through the log_phi_access SECURITY DEFINER RPC
-- (migration 20270702000005). The absence of write policies IS the mitigation
-- (default-deny): any direct INSERT attempt by an authenticated browser client
-- will return 42501 insufficient_privilege.

-- RESEARCH Pitfall 6: service_role bypasses RLS by default. Explicitly REVOKE
-- UPDATE and DELETE from service_role so the append-only invariant holds even
-- for privileged callers (admin tooling, backfill scripts). service_role INSERT
-- is intentionally retained for test fixtures and future backfill.
revoke update, delete on public.phi_access_log from service_role;
