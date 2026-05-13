-- Phase 9 Plan 09-01 — system roles seed trigger.
--
-- D-07: AFTER INSERT trigger on orgs seeds 3 system roles per org with
-- the correct permission_key set:
--   Owner       — all 10 keys
--   Coach       — org.read + members.list + patient_data.read + patient_photos.read
--   View-only   — org.read + members.list + patient_data.read
--
-- Pitfall #4 (trigger ordering): trigger fires AFTER INSERT FOR EACH ROW.
-- The create_org RPC (20260801000011) inserts the orgs row, this trigger
-- fires inline (same transaction), and the RPC THEN reads the seeded
-- Owner role.id and inserts the operator's membership. All three steps
-- complete inside one transaction.
--
-- Memory `reference_supabase_migration_gotchas.md` gotcha #2:
-- SECURITY DEFINER + `extensions` in search_path. The trigger function
-- itself does not call digest()/gen_random_bytes(), but downstream
-- RLS policies and RPCs do — extensions stays in scope as a defense-
-- in-depth.

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
  -- Owner — all 10 permissions.
  insert into public.roles (org_id, name, description, is_system)
  values (new.id, 'Owner',
          'Full access to the workspace, including settings, members, and patient data.',
          true)
  returning id into v_owner_id;

  insert into public.role_permissions (role_id, permission_key)
  select v_owner_id, key from public.permissions;

  -- Coach — patient data + photos + read members.
  insert into public.roles (org_id, name, description, is_system)
  values (new.id, 'Coach',
          'Reads patient data and photos. Cannot manage members, roles, or workspace settings.',
          true)
  returning id into v_coach_id;

  insert into public.role_permissions (role_id, permission_key) values
    (v_coach_id, 'org.read'),
    (v_coach_id, 'members.list'),
    (v_coach_id, 'patient_data.read'),
    (v_coach_id, 'patient_photos.read');

  -- View-only — read patient data without photos.
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
-- The trigger context calls the function as the table owner; no grant needed
-- for SECURITY DEFINER. We only grant to service_role for completeness in
-- case a backfill script ever invokes it directly.
grant execute on function public.seed_system_roles() to service_role;

-- Drop+recreate idempotent.
drop trigger if exists orgs_seed_system_roles_trigger on public.orgs;
create trigger orgs_seed_system_roles_trigger
  after insert on public.orgs
  for each row execute function public.seed_system_roles();
