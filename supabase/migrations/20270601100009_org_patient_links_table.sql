-- Phase 28 Plan 01 — Task 1 (migration 7/11)
-- org_patient_links table + RLS.
-- Per CONTEXT D-17.
--
-- Note: consent_grant_id FK to org_consent_grants is added as ALTER TABLE
-- in migration 20270601100010_org_consent_grants_table.sql (after that table
-- is created), avoiding forward-reference issues.

create table if not exists public.org_patient_links (
  id                uuid        not null default gen_random_uuid() primary key,
  org_id            uuid        not null references public.organizations(id) on delete restrict,
  patient_user_id   uuid        not null references auth.users(id) on delete cascade,
  linked_by         uuid        null references auth.users(id) on delete set null,
  linked_at         timestamptz not null default now(),
  unlinked_at       timestamptz null,
  consent_grant_id  uuid        null
  -- FK added in migration 20270601100010 after org_consent_grants exists
);

alter table public.org_patient_links enable row level security;

-- SELECT: org members of this org OR the patient themselves (patient-self-read per D-17).
create policy "org_patient_links_select"
  on public.org_patient_links
  for select
  to authenticated
  using (
    auth.uid() = patient_user_id
    or exists (
      select 1 from public.org_members
      where org_id = org_patient_links.org_id
        and user_id = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE: SECDEF link_org_patient RPC only (default-deny).
