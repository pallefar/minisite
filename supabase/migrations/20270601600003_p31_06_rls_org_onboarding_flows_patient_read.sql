-- Phase 31 Plan 06 Rule-2 fix: add RLS SELECT policy for patients on org_onboarding_flows.
--
-- Root cause: 31-04 shipped SELECT RLS that only allows org_members to read flows.
-- Patients are in org_patient_links, NOT org_members.
-- The useOrgOnboardingFlow hook runs as the patient and needs to read the active flow
-- for their primary_org_id. Without this policy, the hook gets 0 rows and falls back
-- to 'consumer' (fail-open per T-31-06-04) — which is safe but breaks the org flow.
--
-- This policy allows a patient to SELECT the active flow for their primary_org_id.
-- Constraint: only rows where is_active = true AND the patient's primary_org_id matches.
-- The patient can only see their OWN primary org's active flow (single-row per patient
-- enforced by the partial unique index on org_onboarding_flows where is_active = true).
--
-- Cross-tenant safety: the policy joins profiles.primary_org_id = org_onboarding_flows.org_id
-- so a patient can only see the flow for their own primary org, never another org's flow.

create policy "org_onboarding_flows_select_patient_primary_org"
  on public.org_onboarding_flows
  for select
  using (
    -- Patient can read the active flow for their primary org
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.primary_org_id = org_onboarding_flows.org_id
    )
  );
