-- Phase 48 Plan 48-02 — public.can_moderate_report_org(p_report_id uuid) SECDEF helper.
--
-- Decision refs:
--   D-04 CORRECTED (researcher live-DB pre-check 2026-05-23): live
--     `public.org_member_role` enum values are owner | clinician | staff |
--     support_admin | support_lead. Per CONTEXT D-04, the moderation tier for
--     clinic-org-scoped reports = (owner, support_admin). Clinicians focus on
--     patient care; staff / support_lead are not granted mod authority by
--     default at this layer. Phase 28 org_members is source of truth.
--
-- Threat model:
--   T-48-02 (I, cross-org info disclosure): clinic-org A admin must NOT see
--     clinic-org B reports. This helper joins community_reports → target row
--     (post / comment) → community_spaces → org_members(om.user_id =
--     auth.uid()) so org membership is derived from the resolved space's
--     org_id, never trusted from a caller-supplied argument.
--   T-48-10 (E, SECDEF schema-shadow): `set search_path = public, extensions`
--     prevents a malicious schema from shadowing public.community_reports /
--     community_posts / community_comments / community_spaces / org_members.
--
-- Memory refs:
--   reference_supabase_is_staff_helper — header/SECDEF shell forked from
--     supabase/migrations/20261101000006_is_staff_helper.sql.
--   reference_supabase_migration_gotchas — SECDEF requires explicit search_path
--     including `extensions` (Pitfall: SECDEF + search_path injection).
--   feedback_rpc_auth_uid_vs_service_role_mismatch — function uses auth.uid()
--     so the grant goes ONLY to `authenticated`; never to `service_role`.
--
-- Cross-plan integration:
--   Consumed by Plan 48-02 Task 3 RLS policy `community_reports_select_moderation`
--   as a 3-way OR predicate: is_staff() OR can_moderate_report_org(id) OR
--   reporter_user_id = auth.uid().
--
-- Domain edges:
--   - Global-space reports (community_spaces.org_id IS NULL) return FALSE here;
--     the platform-staff path in the RLS predicate (public.is_staff()) handles them.
--   - direct_messages target_type intentionally has NO clinic-org moderation
--     branch per CONTEXT D-08 (DMs uniformly skip auto-flag / per-org mod
--     routing; only platform staff via is_staff() see DM reports). target_type
--     = 'dm_message' or 'profile' therefore short-circuits to FALSE via the
--     UNION ALL containing no matching row.

create or replace function public.can_moderate_report_org(p_report_id uuid)
returns boolean
language sql
security definer
set search_path = public, extensions
stable
as $fn$
  with target as (
    select r.target_type, r.target_id
    from public.community_reports r
    where r.id = p_report_id
  ),
  resolved_space as (
    select cp.space_id
    from public.community_posts cp
    join target t on t.target_type = 'post' and cp.id = t.target_id
    union all
    select cc.space_id
    from public.community_comments cc
    join target t on t.target_type = 'comment' and cc.id = t.target_id
  )
  select exists (
    select 1
    from resolved_space rs
    join public.community_spaces s on s.id = rs.space_id
    join public.org_members om on om.org_id = s.org_id and om.user_id = auth.uid()
    where s.org_id is not null
      and om.role in ('owner','support_admin')
  );
$fn$;

revoke all on function public.can_moderate_report_org(uuid) from public;
grant execute on function public.can_moderate_report_org(uuid) to authenticated;
