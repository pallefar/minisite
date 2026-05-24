-- Phase 51 Plan 51-01 — RLS policies for user_traffic_attribution + channel_groups
-- + referrer_channel_rules (3 surfaces; matview surfaces ship in Plan 51-03).
-- Decision refs: D-12 (per-clinic-org dashboard scope), CONTEXT discretion
-- §RLS posture (admin sees all; _is_org_clinician sees own-org rows; anon denied;
-- channel_groups + referrer_channel_rules admin-only).
-- Requirements: TRAFFIC-10 (cross-tenant RLS deny).
-- Threat refs: T-51-01 (info disclosure), T-51-03 (cross-org elevation),
-- T-51-04 (admin-only taxonomy).
--
-- Three RLS surfaces:
--   • user_traffic_attribution — three policies (admin, org-clinician, self).
--   • channel_groups            — admin-only (taxonomy admin surface).
--   • referrer_channel_rules    — admin-only.
--
-- Helper resolution: plan text mentions `public.is_admin()` but the canonical
-- helper on this codebase is `public.is_admin_at_least(min_role)` (Phase 24
-- migration 20270601000027). Pattern matches the Phase 33 admin-deny RLS
-- migration 20270703000010_rls_deny_ad_tables.sql exactly. _is_org_clinician
-- (Phase 31 migration 20270601300100) is used as documented.
--
-- Cross-tenant deny test (per reference_supabase_project) lives in
-- leanshot/test/rls-traffic-attribution.test.ts, shipped by Plan 51-10 Task 1.
--
-- Migration timestamp note: renamed from 20270712000006 to 20271102000006
-- per 51-01 execute-time preflight (reference_supabase_back_dated_migration_blocks_push).

-- ---------------------------------------------------------------------------
-- user_traffic_attribution — three layered policies (FOR SELECT)
-- ---------------------------------------------------------------------------
-- Admin: full access (CRUD).
create policy utat_admin_all
  on public.user_traffic_attribution
  for all
  using (public.is_admin_at_least('admin'::public.admin_role))
  with check (public.is_admin_at_least('admin'::public.admin_role));

-- Org clinician/owner: SELECT only own-org rows. Per memory
-- feedback_rpc_auth_uid_vs_service_role_mismatch, _is_org_clinician(...,
-- auth.uid()) is fine here because the policy is evaluated in user-JWT
-- context (not service-role).
create policy utat_org_clinician_select
  on public.user_traffic_attribution
  for select
  using (
    org_id is not null
    and public._is_org_clinician(org_id, auth.uid())
  );

-- Authenticated user: SELECT own stitched row.
create policy utat_self_user
  on public.user_traffic_attribution
  for select
  using (user_id = auth.uid());

-- Lock down grants — RLS narrows further per policy. anon denied entirely.
revoke all on public.user_traffic_attribution from anon, authenticated;
grant select on public.user_traffic_attribution to authenticated;

-- ---------------------------------------------------------------------------
-- channel_groups — admin-only ALL
-- ---------------------------------------------------------------------------
create policy channel_groups_admin_all
  on public.channel_groups
  for all
  using (public.is_admin_at_least('admin'::public.admin_role))
  with check (public.is_admin_at_least('admin'::public.admin_role));

revoke all on public.channel_groups from anon, authenticated;
grant select on public.channel_groups to authenticated;
-- (clinic_owner has no taxonomy admin surface; UI gates the navigation. The
-- SELECT grant is for the matview refresh path — RLS policy still denies
-- non-admin reads. Service-role refresh bypasses RLS.)

-- ---------------------------------------------------------------------------
-- referrer_channel_rules — admin-only ALL
-- ---------------------------------------------------------------------------
create policy referrer_channel_rules_admin_all
  on public.referrer_channel_rules
  for all
  using (public.is_admin_at_least('admin'::public.admin_role))
  with check (public.is_admin_at_least('admin'::public.admin_role));

revoke all on public.referrer_channel_rules from anon, authenticated;
grant select on public.referrer_channel_rules to authenticated;

comment on policy utat_admin_all on public.user_traffic_attribution is
  'Phase 51 / D-12 — Admin (is_admin()) sees and edits all attribution rows.';
comment on policy utat_org_clinician_select on public.user_traffic_attribution is
  'Phase 51 / D-12 — Clinic-org clinician/owner sees only own-org rows; cross-tenant deny tested in 51-10.';
comment on policy utat_self_user on public.user_traffic_attribution is
  'Phase 51 / D-12 — Stitched user sees own attribution row (self-service privacy).';
