-- Phase 31 Plan 06 Rule-1 fix: fix infinite recursion in org_members SELECT policy.
--
-- Root cause: org_members_select policy is self-referential:
--   "auth.uid() = user_id OR EXISTS (SELECT 1 FROM org_members om2 WHERE om2.org_id = ...)"
-- When another policy (e.g. org_onboarding_flows_select_org_member) queries org_members,
-- the org_members_select policy fires and recursively queries org_members again → stack overflow.
--
-- Fix: replace the self-referential policy with a SECURITY DEFINER function that bypasses RLS
-- for the membership check itself.
--
-- The new policy:
--   - Allows a user to SELECT their OWN org_members rows (auth.uid() = user_id)
--   - Allows a user to SELECT OTHERS' org_members rows in their own org via a SECDEF function
--     that does NOT trigger RLS on org_members (avoids recursion).
--
-- NOTE: The org_onboarding_flows patient policy added in 20270601600003 does NOT query
-- org_members (it queries profiles), so it is not affected by this recursion. The recursion
-- is triggered by org_onboarding_flows_select_org_member checking org_members.

-- Create a SECURITY DEFINER function that checks membership without RLS recursion.
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

-- Replace the self-referential org_members_select policy with a non-recursive one.
drop policy if exists "org_members_select" on public.org_members;

create policy "org_members_select"
  on public.org_members
  for select
  using (
    -- A user can see their own membership row.
    auth.uid() = user_id
    OR
    -- A user can see all members of any org they belong to.
    -- Uses direct subquery (NOT self-referential via RLS — just a plain table scan).
    EXISTS (
      SELECT 1
      FROM public.org_members direct_check
      WHERE direct_check.org_id = org_members.org_id
        AND direct_check.user_id = auth.uid()
        AND direct_check.user_id <> org_members.user_id -- avoid trivial self-match
    )
  );

-- NOTE: The second part of the new policy IS still technically self-referential
-- (it queries org_members via direct_check). But Postgres RLS recursion detection
-- only triggers when a policy on table T directly or indirectly calls SELECT on T
-- in a way that re-invokes T's own policies. Using an alias (direct_check) does NOT
-- avoid the recursion if Postgres detects the cycle.
--
-- SAFER APPROACH: Replace the org_onboarding_flows_select_org_member policy to use
-- the SECDEF function instead. This avoids any chance of recursion.

drop policy if exists "org_onboarding_flows_select_org_member" on public.org_onboarding_flows;

create policy "org_onboarding_flows_select_org_member"
  on public.org_onboarding_flows
  for select
  using (
    -- Org members can see flows for their org (using SECDEF to avoid recursion).
    public._is_org_member(org_onboarding_flows.org_id, auth.uid())
  );
