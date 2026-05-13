-- Phase 9 Plan 09-01 — global permissions catalog.
--
-- The 10 permission keys are seeded here (D-07). Adding a new key is a
-- migration, not a runtime operation — the planner picks descriptions
-- from 09-UI-SPEC.md Permission grid; descriptions are user-facing
-- (rendered in the operator's Roles admin UI permission grid).
--
-- RLS contract: read-all for any authenticated user (the operator UI
-- needs the catalog to render the permission grid; the patient UI never
-- queries this table). NO writes — extending the catalog requires a new
-- migration.

create table if not exists public.permissions (
  key text primary key,
  description text not null
);

-- Seed the 10 keys per D-07. on conflict do nothing makes the migration
-- safely re-runnable.
insert into public.permissions (key, description) values
  ('org.read',           'See workspace name, members, and patient roster'),
  ('org.update',         'Change workspace name, URL, and logo'),
  ('org.delete',         'Permanently remove the workspace and all memberships'),
  ('members.invite',     'Send invitations to new patients'),
  ('members.revoke',     'End any active patient membership'),
  ('members.list',       'See the list of patients and pending invitations'),
  ('roles.manage',       'Create, edit, and delete custom roles'),
  ('patient_data.read',  'Read injections, weight, symptoms, and other tracked data (excluding photos)'),
  ('patient_photos.read','Read body photos that patients have shared'),
  ('audit_log.read',     'See who accessed what, and when')
on conflict (key) do nothing;

alter table public.permissions enable row level security;

-- Read-all for authenticated. No writes.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'permissions'
      and policyname = 'permissions_read_all'
  ) then
    create policy permissions_read_all on public.permissions
      for select to authenticated
      using (true);
  end if;
end $$;
