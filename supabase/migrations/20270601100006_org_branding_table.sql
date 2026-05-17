-- Phase 28 Plan 01 — Task 1 (migration 4/11)
-- org_branding table + RLS (skeleton — P31 owns full theme overlay).
-- Per CONTEXT D-16.

create table if not exists public.org_branding (
  org_id        uuid        not null primary key
                            references public.organizations(id) on delete restrict,
  logo_url      text        null,
  primary_color text        null,
  accent_color  text        null,
  font_family   text        null,
  support_email text null,
  updated_at    timestamptz not null default now()
);

alter table public.org_branding enable row level security;

-- SELECT: any org member can read branding.
create policy "org_branding_select"
  on public.org_branding
  for select
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = org_branding.org_id
        and user_id = auth.uid()
    )
  );

-- UPDATE: org admins only.
create policy "org_branding_update_admins"
  on public.org_branding
  for update
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = org_branding.org_id
        and user_id = auth.uid()
        and role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.org_members
      where org_id = org_branding.org_id
        and user_id = auth.uid()
        and role = 'admin'
    )
  );

-- INSERT/DELETE: SECDEF RPCs only (default-deny).
