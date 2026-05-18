-- =============================================================================
-- Phase 31 Plan 31-01 ORG-12 — has_permission() + get_caller_role() SECDEFs
--
-- Purpose:
--   Provides the security floor for the 12-key role permission matrix (D-02 / D-03).
--   `has_permission(role, perm)` is the single source of truth for capability checks;
--   `get_caller_role(org_id)` resolves the authenticated caller's role for a given org.
--
-- D-02 source-of-truth contract:
--   The DB function `has_permission` is the security floor.
--   `src/lib/org.ts` ROLE_PERMISSIONS const is the client-side UX-hint mirror.
--   Drift is caught by `src/lib/__tests__/role-matrix-sync.test.ts` which asserts
--   equality across all 36 (role, perm) pairs on every CI build.
--
-- 12 permission keys (D-03):
--   members.invite, members.revoke, members.list, members.role.edit,
--   settings.edit, branding.edit, onboarding.edit,
--   roster.view, roster.thresholds.edit,
--   alerts.ack, alerts.snooze,
--   billing.view
--
-- Role allocation (D-03):
--   owner     — ALL 12 keys
--   clinician — members.list, roster.view, alerts.ack, alerts.snooze
--   staff     — members.list, roster.view
--
-- IMPORTANT: Any future permission addition MUST land in BOTH this CASE expression
-- AND `src/lib/org.ts` ROLE_PERMISSIONS — drift is caught by role-matrix-sync.test.ts
-- (per [[feedback_planner_iter1_anti_patterns]] defensive-contract rule).
--
-- Downstream callers (plans 31-02 / 31-04 / 31-05):
--   Every admin-mutation SECDEF uses:
--     if not has_permission(get_caller_role(p_org_id), '<PERM>') then raise insufficient_privilege
--
-- NOTE: Migration is NOT pushed to live DB from this plan. Plan 31-04 owns the
-- BLOCKING `supabase db push --linked` that covers all Wave 1+2 P31 migrations.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- has_permission(p_role, p_perm) — pure CASE expression over (role, perm).
--
-- IMMUTABLE: no relation reads; pure function over its two arguments.
-- Returns false for NULL p_role (caller not a member → deny access).
-- Returns false for unknown perm (typo-safe; future enum values not yet allocated).
-- ---------------------------------------------------------------------------
create or replace function public.has_permission(
  p_role public.org_member_role,
  p_perm text
)
returns boolean
language sql
immutable
security definer
set search_path = pg_catalog, public, extensions
as $$
  select case p_role
    when 'owner' then p_perm = any(array[
      'members.invite',
      'members.revoke',
      'members.list',
      'members.role.edit',
      'settings.edit',
      'branding.edit',
      'onboarding.edit',
      'roster.view',
      'roster.thresholds.edit',
      'alerts.ack',
      'alerts.snooze',
      'billing.view'
    ])
    when 'clinician' then p_perm = any(array[
      'members.list',
      'roster.view',
      'alerts.ack',
      'alerts.snooze'
    ])
    when 'staff' then p_perm = any(array[
      'members.list',
      'roster.view'
    ])
    else false
  end
$$;

-- ---------------------------------------------------------------------------
-- get_caller_role(p_org_id) — resolves auth.uid()'s role in the given org.
--
-- STABLE: reads org_members table; not IMMUTABLE.
-- Returns null when caller is not a member of the org.
-- Security design: function takes p_org_id only; does NOT accept a p_user_id
-- parameter so callers cannot impersonate another user (T-31-01-03).
-- ---------------------------------------------------------------------------
create or replace function public.get_caller_role(
  p_org_id uuid
)
returns public.org_member_role
language sql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
  select role
  from public.org_members
  where org_id = p_org_id
    and user_id = auth.uid()
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- RBAC: revoke broad access, grant only to authenticated + service_role.
-- anon is NOT granted — no client code path requires anon-role capability checks
-- (reduces blast radius per T-31-01-04 mitigate disposition).
-- ---------------------------------------------------------------------------

revoke all on function public.has_permission(public.org_member_role, text) from public;
grant execute on function public.has_permission(public.org_member_role, text)
  to authenticated, service_role;

revoke all on function public.get_caller_role(uuid) from public;
grant execute on function public.get_caller_role(uuid)
  to authenticated, service_role;
