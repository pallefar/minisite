-- Phase 9 Plan 09-01 — roles + role_permissions tables.
--
-- D-07: per-org `roles` table (3 system + N custom). System roles seeded
-- by the trigger in 20260801000010 immediately after orgs row INSERT.
-- The `is_system` flag protects Owner/Coach/View-only from accidental
-- mutation by the operator UI (the role-update/delete RPCs in
-- 20260801000011 raise on is_system=true).
--
-- role_permissions is a many-to-many between roles and the global
-- permissions catalog (20260801000005). Composite PK doubles as the
-- uniqueness gate (a role can't hold the same permission_key twice) and
-- the lookup index for `has_permission` (20260801000009).
--
-- RLS contract: SELECT gated by has_permission(uid, org_id, 'org.read')
-- — every active member can see the role catalogue (needed to render the
-- "Your role: Coach" UI hints). NO writes — only `create_role` /
-- `update_role` / `delete_role` SECURITY DEFINER RPCs in 20260801000011
-- write, gated on `roles.manage`.

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 40),
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

-- Per-org name uniqueness (case-insensitive). Operator can't have two
-- roles called "coach" + "Coach" in the same workspace.
create unique index if not exists roles_org_name_idx on public.roles (org_id, lower(name));

-- Lookup-by-org for the workspace settings UI.
create index if not exists roles_org_idx on public.roles (org_id);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete restrict,
  primary key (role_id, permission_key)
);

-- Reverse-lookup index for has_permission() join shape:
--   memberships join role_permissions on rp.role_id = m.role_id
-- The PK already covers (role_id, permission_key); the dedicated index on
-- (role_id) alone is implicit via the PK left-prefix.
-- Add a permission_key index for "which roles grant patient_photos.read?"
-- queries the operator UI may run.
create index if not exists role_permissions_perm_idx
  on public.role_permissions (permission_key);

alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;

-- SELECT roles by any active org member.
create policy roles_select_by_member on public.roles
  for select to authenticated
  using (public.has_permission(auth.uid(), org_id, 'org.read'));

-- SELECT role_permissions by any active member of the role's org.
-- The role_id → org_id hop happens via a subselect; has_permission keeps
-- this on the gate function rather than re-implementing the join here.
create policy role_permissions_select_by_member on public.role_permissions
  for select to authenticated
  using (
    public.has_permission(
      auth.uid(),
      (select org_id from public.roles where id = role_permissions.role_id),
      'org.read'
    )
  );

-- NO INSERT / UPDATE / DELETE policies — only SECURITY DEFINER RPCs write.
