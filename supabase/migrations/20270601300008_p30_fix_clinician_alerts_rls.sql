-- =============================================================================
-- Phase 30 Plan 05 — Fix clinician_alerts_select RLS infinite recursion (42P17)
-- =============================================================================
-- Root cause:
--   The `clinician_alerts_select` RLS policy queries `org_members` directly:
--     EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = clinician_alerts.org_id
--             AND om.user_id = auth.uid() AND om.role IN ('admin','staff'))
--   But `org_members` has its own SELECT policy:
--     auth.uid() = user_id OR EXISTS (SELECT 1 FROM org_members om2 WHERE ...)
--   → querying org_members from another table's policy triggers the org_members
--     policy, which itself queries org_members → infinite recursion (42P17).
--
-- Fix pattern: SECURITY DEFINER wrapper function bypasses org_members RLS.
-- This is the same pattern used by `_is_org_admin` (Phase 22 migration
-- 20270601200003_org_patient_invites.sql §"RLS helper").
--
-- NOTE: All P30 tables that reference org_members in RLS must use this SECDEF.
-- The `org_patient_thresholds_select` policy in 20270601300002 has the same
-- recursion risk — fixed here by replacing its policy too.
-- =============================================================================

-- 1. SECDEF helper: check admin OR staff membership (bypasses org_members RLS)
create or replace function public._is_org_clinician(p_org_id uuid, p_user_id uuid)
returns boolean
  language sql
  security definer
  stable
  set search_path = pg_catalog, public, extensions
as $$
  SELECT exists (
    select 1 from public.org_members
    where org_id = p_org_id
      and user_id = p_user_id
      and role in ('admin', 'staff')
  );
$$;

-- Grant execute to authenticated so RLS policies can invoke it
grant execute on function public._is_org_clinician(uuid, uuid) to authenticated;

-- 2. Replace clinician_alerts_select — use SECDEF to avoid org_members recursion
drop policy if exists "clinician_alerts_select" on public.clinician_alerts;

create policy "clinician_alerts_select"
  on public.clinician_alerts
  for select
  to authenticated
  using (
    public._is_org_clinician(clinician_alerts.org_id, auth.uid())
  );

-- 3. Replace clinician_alert_deliveries_select — same recursion risk
drop policy if exists "clinician_alert_deliveries_select" on public.clinician_alert_deliveries;

create policy "clinician_alert_deliveries_select"
  on public.clinician_alert_deliveries
  for select
  to authenticated
  using (
    exists (
      select 1 from public.clinician_alerts ca
      where ca.id = clinician_alert_deliveries.alert_id
        and public._is_org_clinician(ca.org_id, auth.uid())
    )
  );

-- 4. Replace org_patient_thresholds_select — same recursion risk
--    (original policy in 20270601300002 does a direct org_members EXISTS)
drop policy if exists "org_patient_thresholds_select" on public.org_patient_thresholds;

create policy "org_patient_thresholds_select"
  on public.org_patient_thresholds
  for select
  to authenticated
  using (
    public._is_org_clinician(org_patient_thresholds.org_id, auth.uid())
  );
