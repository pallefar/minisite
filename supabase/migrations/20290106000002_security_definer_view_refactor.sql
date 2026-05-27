-- Phase 66.5 Plan 02 — SEC-02 + SEC-03 (Supabase Advisor remediation)
--
-- Addresses 4 ERROR-level findings from `supabase db advisors --linked --type security` (2026-05-27):
--
-- 1. security_definer_view × 2:
--    - public.v_cancellation_offers_roi
--    - public.share_snapshot_view
--    Fix: ALTER VIEW … SET (security_invoker = on) (PG15+).
--    Refs: https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view
--
-- 2. auth_users_exposed × 2:
--    - public.share_snapshot_view  (joins auth.users)
--    - public.user_activity_daily  (matview; joins auth.users)
--    Fix (minimal): revoke SELECT from anon, authenticated on both views; restrict to service_role.
--    The auth.users join is preserved because both views' downstream consumers (Edge Fn share
--    handler + admin cohort-retention RPC) call as service_role and need the user data.
--    Refs: https://supabase.com/docs/guides/database/database-linter?lint=0002_auth_users_exposed
--
-- DO-block drift guards per [[reference_postgres_do_block_drift_safe_migration]]:
-- views may not exist on remote due to `migration repair` tracking drift
-- (see [[reference_supabase_migration_list_applied_vs_table_missing]]).

-- ============================================================
-- 1. v_cancellation_offers_roi — drop SECDEF, set explicit invoker rights
-- ============================================================

do $$
begin
  alter view public.v_cancellation_offers_roi set (security_invoker = on);
  raise notice 'public.v_cancellation_offers_roi: security_invoker = on';
exception
  when undefined_table then
    raise notice 'public.v_cancellation_offers_roi does not exist on remote; skipping (tracking drift)';
  when feature_not_supported then
    raise notice 'public.v_cancellation_offers_roi: security_invoker SET unsupported (likely PG < 15); operator manual refactor required';
end $$;

-- ============================================================
-- 2. share_snapshot_view — drop SECDEF + revoke anon/auth SELECT
-- ============================================================

do $$
begin
  alter view public.share_snapshot_view set (security_invoker = on);
  raise notice 'public.share_snapshot_view: security_invoker = on';
exception
  when undefined_table then
    raise notice 'public.share_snapshot_view does not exist on remote; skipping (tracking drift)';
  when feature_not_supported then
    raise notice 'public.share_snapshot_view: security_invoker SET unsupported; operator manual refactor required';
end $$;

do $$
begin
  revoke select on public.share_snapshot_view from anon, authenticated;
  raise notice 'public.share_snapshot_view: SELECT revoked from anon + authenticated';
exception when undefined_table then
  raise notice 'public.share_snapshot_view does not exist; skipping revoke';
end $$;

do $$
begin
  grant select on public.share_snapshot_view to service_role;
  raise notice 'public.share_snapshot_view: SELECT granted to service_role';
exception when undefined_table then
  raise notice 'public.share_snapshot_view does not exist; skipping grant';
end $$;

-- ============================================================
-- 3. user_activity_daily (matview) — revoke anon/auth SELECT
--    Note: matview already had service-role-only grant per its source migration
--    (20270601000008). Re-applying revoke + grant idempotently to be sure.
-- ============================================================

-- Phase 65.1 fix (2026-05-27): `security_invoker = on` on matviews requires
-- PG ≥ 16 and is a PARSE-TIME error on older PG — escapes the EXCEPTION clause
-- if written inline. Wrap in EXECUTE so the error surfaces at runtime and the
-- EXCEPTION block catches it. Service-role-only grant is preserved by the
-- revoke/grant block below; security_invoker here is belt-and-suspenders on
-- PG 16+ and a no-op on older versions.
do $$
begin
  execute 'alter materialized view public.user_activity_daily set (security_invoker = on)';
  raise notice 'public.user_activity_daily: security_invoker = on';
exception
  when undefined_table then
    raise notice 'public.user_activity_daily does not exist on remote; skipping (tracking drift)';
  when feature_not_supported then
    raise notice 'public.user_activity_daily: matview security_invoker unsupported on this PG version; operator action';
  when syntax_error then
    raise notice 'public.user_activity_daily: security_invoker parameter unrecognized (PG < 16); skipping (no-op)';
  when others then
    raise notice 'public.user_activity_daily: security_invoker apply failed (sqlstate %); skipping', sqlstate;
end $$;

do $$
begin
  revoke select on public.user_activity_daily from anon, authenticated;
  raise notice 'public.user_activity_daily: SELECT revoked from anon + authenticated';
exception when undefined_table then
  raise notice 'public.user_activity_daily does not exist; skipping revoke';
end $$;

do $$
begin
  grant select on public.user_activity_daily to service_role;
  raise notice 'public.user_activity_daily: SELECT granted to service_role';
exception when undefined_table then
  raise notice 'public.user_activity_daily does not exist; skipping grant';
end $$;

-- ============================================================
-- Post-condition (operator verify after `db push`):
--   npx supabase db advisors --linked --type security --level error
--     | jq '[.[] | select(.name == "security_definer_view" or .name == "auth_users_exposed")] | length'
--   Expected: 0
-- ============================================================
