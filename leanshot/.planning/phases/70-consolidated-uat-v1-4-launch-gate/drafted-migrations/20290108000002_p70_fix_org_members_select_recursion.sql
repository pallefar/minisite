-- DRAFT — Plan 70-07 cascade-37 — NOT pushed. Review then git mv into
-- supabase/migrations/ and `supabase db push --linked`.
--
-- Root cause R1 (see 70-07-UNIT-DRIFT-ROOTCAUSE.md):
--   20270601600004_p31_06_fix_org_member_rls_recursion.sql created the SECDEF
--   helper public._is_org_member(org_id, user_id) but then RE-created
--   org_members_select with its second clause still an inline self-subquery
--   `EXISTS (SELECT 1 FROM public.org_members direct_check ...)`. That subquery
--   re-invokes org_members_select → `42P17 infinite recursion detected in policy
--   for relation "org_members"`. The migration's own trailing comment admits the
--   inline form "does NOT avoid the recursion"; it only switched the
--   org_onboarding_flows policy to the helper.
--
--   Any query touching org_members — directly, or via another table's RLS policy
--   that joins org_members for a membership check (org_branding, org_settings,
--   org_invites, organizations, org_patient_links, org_consent_grants,
--   org_onboarding_flows, change_member_role) — trips the recursion.
--
--   This is ALSO a live production correctness bug: co-member visibility on org
--   tables is broken for authenticated B2B/clinic users, not just tests.
--
-- Fix: redefine org_members_select so the "see co-members of my orgs" clause uses
-- the existing SECURITY DEFINER helper (which selects org_members WITHOUT
-- re-triggering RLS), breaking the cycle. No later migration redefines this
-- policy (verified through 20271102…), so this is the authoritative definition.
--
-- Affected tests (live remote DB): src/lib/__tests__/rls-org-*.test.ts (T3 cross-
-- tenant SELECT, member-self SELECT), rls-change-member-role.test.ts (TC1-6),
-- rls-org-onboarding-flows.test.ts (A1/A2/A4), rls-org-organizations.test.ts
-- (T10/T10c), rls-org-patient-links.test.ts (T3/T7).

-- Ensure the SECDEF helper exists (idempotent; matches 20270601600004 definition).
create or replace function public._is_org_member(p_org_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = pg_catalog, public, extensions
stable
as $$
  select exists(
    select 1
    from public.org_members
    where org_id = p_org_id
      and user_id = p_user_id
  )
$$;

drop policy if exists "org_members_select" on public.org_members;

create policy "org_members_select"
  on public.org_members
  for select
  using (
    -- A user can always see their own membership row.
    auth.uid() = user_id
    -- A user can see all members of any org they belong to. The membership check
    -- goes through the SECDEF helper, which bypasses RLS on org_members and so
    -- does NOT re-invoke this policy (no recursion).
    OR public._is_org_member(org_members.org_id, auth.uid())
  );
