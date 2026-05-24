-- Phase 39 Plan 39-01 — pharma_content_versions append-only audit log.
--
-- CONTEXT references (39-CONTEXT.md):
--   D-05 + D-06 (safety-info carveout integrity requires immutable audit of any
--   pharma copy edit), regulatory posture from feedback_regulator_vs_user_audience_pattern.
--
-- Purpose:
--   Append-only audit log: every pharma_content edit creates exactly one row
--   here. clinical_signoff_by / clinical_signoff_at capture optional medical-
--   reviewer attestation. No UPDATE / DELETE possible from any role (T-39-01-02).
--
-- T-39-01-02 mitigation: NO INSERT/UPDATE/DELETE RLS policies present here.
--   Only SELECT (admin-only). Writes flow through future SECDEF RPC (Wave 2/3)
--   which appends but cannot rewrite. pgTAP proof p39_rls_pharma_content_versions.sql
--   asserts UPDATE + DELETE both fail under all roles.

create table if not exists public.pharma_content_versions (
  id                    uuid primary key default gen_random_uuid(),
  content_id            uuid not null references public.pharma_content(id) on delete cascade,
  diff                  jsonb not null default '{}'::jsonb,
  author_id             uuid references auth.users(id) on delete set null,
  clinical_signoff_by   uuid references auth.users(id) on delete set null,
  clinical_signoff_at   timestamptz,
  created_at            timestamptz not null default now()
);

comment on table public.pharma_content_versions is
  'Phase 39 D-05/D-06: append-only audit log of pharma_content edits. T-39-01-02 '
  'mitigation: no UPDATE/DELETE RLS policies (denial-by-default). Writes flow '
  'through future SECDEF RPC which appends but cannot rewrite. clinical_signoff_* '
  'optional medical-reviewer attestation.';

create index if not exists pharma_content_versions_content_idx
  on public.pharma_content_versions (content_id, created_at desc);

alter table public.pharma_content_versions enable row level security;

-- SELECT: admin only (audit log is admin-facing surface).
create policy pol_pharma_content_versions_admin_select
  on public.pharma_content_versions
  for select
  to authenticated
  using (public.is_admin_at_least('admin'::public.admin_role));

-- DELIBERATELY NO INSERT/UPDATE/DELETE policies.
-- Append flows ONLY through SECDEF RPC (Wave 2/3) which bypasses RLS.
-- Denial-by-default means even admin browsers cannot UPDATE or DELETE.
-- T-39-01-02 mitigation; proven by p39_rls_pharma_content_versions.sql.
