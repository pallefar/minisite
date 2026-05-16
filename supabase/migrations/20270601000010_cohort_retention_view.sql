-- Phase 22 plan 01 — D-04: cohort retention aggregation view over user_activity_daily matview.
-- Analog: supabase/migrations/20270101000004_tier_effective_view.sql (security_invoker=true view shape)
-- Pitfalls applied: Pitfall 1 (k-anonymity guard is a CONTRACT enforced client-side; view itself
--                              exposes raw counts so the admin client can choose the bucket threshold).
--
-- D-04 contract:
--   cohort_week × day_offset (0..90) grid of retention percentages.
--   active_users = count(distinct user_id) for that cohort × offset.
--   retention_pct = active_users / cohort_size_at_signup × 100.
--
-- K-ANONYMITY CONTRACT (T-22-10 mitigation): cells where active_users < 10 MUST be rendered as
-- "<10" client-side (the admin React component owns the privacy-preserving display). The view
-- exposes the raw count so the client can decide its own threshold; downstream RPC layer (separate
-- plan) wraps this view and bucket-suppresses before responding to the admin UI.
--
-- security_invoker=true honors per-row RLS — but underlying matview is service_role-only, so the
-- view in practice is only callable by service_role (admin RPC). Authenticated callers get an
-- empty result because they cannot read user_activity_daily.

create or replace view public.cohort_retention
  with (security_invoker = true)
as
select
  uad.cohort_week,
  uad.day_offset,
  count(distinct uad.user_id)::int as active_users,
  (count(distinct uad.user_id)::float
    / nullif(
        (select count(*)::float from auth.users
          where date_trunc('week', created_at)::date = uad.cohort_week),
        0)
  ) * 100 as retention_pct
from public.user_activity_daily uad
where uad.day_offset between 0 and 90
group by uad.cohort_week, uad.day_offset;

comment on view public.cohort_retention is
  'ADMIN-08 (D-04): cohort heatmap aggregation — 13 cohort weeks × 91 day offsets. '
  'K-anonymity contract: clients MUST render active_users < 10 as "<10" — enforced in '
  'leanshot/src/components/admin/cohorts/CohortHeatmap.tsx per T-22-10.';

grant select on public.cohort_retention to service_role;
