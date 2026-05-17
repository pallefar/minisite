-- Phase 28 Plan 01 — Task 1 (migration 3/11)
-- org_settings table + RLS.
-- Per CONTEXT D-15.

create table if not exists public.org_settings (
  org_id                          uuid        not null primary key
                                              references public.organizations(id) on delete restrict,
  default_timezone                text        not null default 'UTC',
  enforce_clinician_mfa           boolean     not null default true,
  auto_revoke_inactive_after_days integer     not null default 90,
  mask_patient_emails_in_roster   boolean     not null default false,
  notification_email              text null
);

alter table public.org_settings enable row level security;

-- SELECT: any org member can read settings.
create policy "org_settings_select"
  on public.org_settings
  for select
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = org_settings.org_id
        and user_id = auth.uid()
    )
  );

-- UPDATE: org admins only.
create policy "org_settings_update_admins"
  on public.org_settings
  for update
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = org_settings.org_id
        and user_id = auth.uid()
        and role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.org_members
      where org_id = org_settings.org_id
        and user_id = auth.uid()
        and role = 'admin'
    )
  );

-- INSERT/DELETE: SECDEF RPCs only (default-deny).
