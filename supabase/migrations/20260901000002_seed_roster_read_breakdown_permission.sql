-- Phase 10 Plan 10-01 — seed `roster.read_breakdown` permission row + back-fill
-- Coach + Owner role_permissions across all existing orgs + update the
-- seed_system_roles_for_org trigger function for FUTURE orgs.
--
-- Per D-13 (LOCKED):
--   Coach + Owner get `roster.read_breakdown` = true
--   View-only does NOT get this permission
--
-- T-10-01-02 (EoP): idempotent ON CONFLICT DO NOTHING prevents re-grant on re-run.
-- T-10-01-03 (InfoDisc): search_path = public, extensions, pg_catalog per memory
-- `reference_supabase_migration_gotchas.md` gotcha #2 (SECURITY DEFINER functions).
--
-- NOTE: role_permissions uses a composite PK of (role_id, permission_key) — the
-- ON CONFLICT target is the PK pair, not a UNIQUE constraint named `permission_id`.

-- 1. Insert the new permission row idempotently (11th permission in the catalog).
insert into public.permissions (key, description)
values ('roster.read_breakdown', 'See per-signal score breakdown on roster rows')
on conflict (key) do nothing;

-- 2. Back-fill role_permissions for every existing Coach system role across all orgs.
insert into public.role_permissions (role_id, permission_key)
select r.id, 'roster.read_breakdown'
from public.roles r
where r.is_system = true
  and r.name = 'Coach'
on conflict (role_id, permission_key) do nothing;

-- 3. Back-fill for Owner system roles (Owner inherits ALL permissions).
insert into public.role_permissions (role_id, permission_key)
select r.id, 'roster.read_breakdown'
from public.roles r
where r.is_system = true
  and r.name = 'Owner'
on conflict (role_id, permission_key) do nothing;

-- 4. Update seed_system_roles() so FUTURE orgs automatically get Coach + Owner
--    seeded with `roster.read_breakdown`. The trigger DDL stays as Phase 9
--    created it — only the function body changes (CREATE OR REPLACE).
--
--    Original Coach key set (Phase 9): org.read, members.list, patient_data.read, patient_photos.read
--    Updated Coach key set (Phase 10): + roster.read_breakdown
--
--    Owner set uses `select key from public.permissions` (inserts ALL keys), so
--    Owner will automatically pick up `roster.read_breakdown` once the row exists.
--    No change needed to the Owner INSERT — it stays as the wildcard SELECT.
--    However, we re-emit the full function body with an explicit Coach grant for
--    clarity and to preserve idempotency on re-run.
create or replace function public.seed_system_roles()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_owner_id uuid;
  v_coach_id uuid;
  v_viewonly_id uuid;
begin
  -- Owner — all permissions (wildcard SELECT ensures new keys are auto-included).
  insert into public.roles (org_id, name, description, is_system)
  values (new.id, 'Owner',
          'Full access to the workspace, including settings, members, and patient data.',
          true)
  returning id into v_owner_id;

  insert into public.role_permissions (role_id, permission_key)
  select v_owner_id, key from public.permissions;

  -- Coach — patient data + photos + read members + score breakdown.
  -- Phase 10 adds roster.read_breakdown to the Coach key set (D-13).
  insert into public.roles (org_id, name, description, is_system)
  values (new.id, 'Coach',
          'Reads patient data and photos. Cannot manage members, roles, or workspace settings.',
          true)
  returning id into v_coach_id;

  insert into public.role_permissions (role_id, permission_key) values
    (v_coach_id, 'org.read'),
    (v_coach_id, 'members.list'),
    (v_coach_id, 'patient_data.read'),
    (v_coach_id, 'patient_photos.read'),
    (v_coach_id, 'roster.read_breakdown');

  -- View-only — read patient data without photos; no score breakdown.
  -- Intentionally omits roster.read_breakdown per D-13.
  insert into public.roles (org_id, name, description, is_system)
  values (new.id, 'View-only',
          'Reads patient data without photos. Cannot manage anything.',
          true)
  returning id into v_viewonly_id;

  insert into public.role_permissions (role_id, permission_key) values
    (v_viewonly_id, 'org.read'),
    (v_viewonly_id, 'members.list'),
    (v_viewonly_id, 'patient_data.read');

  return new;
end;
$$;

revoke all on function public.seed_system_roles() from public;
grant execute on function public.seed_system_roles() to service_role;
