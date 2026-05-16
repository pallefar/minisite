-- Phase 22 plan 01 — D-04: daily user-activity materialized view (cohort heatmap source).
-- Analog: supabase/migrations/20270101000007_affiliate_click_baseline_mv.sql (mv + UNIQUE-index pattern)
-- Pitfalls applied: Pitfall 1 (date_trunc on timestamptz is STABLE not IMMUTABLE — fine inside SELECT,
--                              NOT in an index predicate),
--                   Pitfall 5 (REFRESH MATERIALIZED VIEW CONCURRENTLY requires a UNIQUE index).
--
-- D-04 semantics:
--   cohort_week = date_trunc('week', users.created_at)  — Monday-anchored week of signup
--   activity_day = date_trunc('day', users.last_sign_in_at)
--   day_offset  = days between cohort_week and activity_day
--   The cohort_retention view (File 10) aggregates this matview into 13×91 cells.
--
-- Why a matview vs live view: cohort heatmap reads aggregate over all auth.users every render;
-- direct live aggregation is too expensive. Refreshed CONCURRENTLY at 02:00 UTC by File 09.
--
-- Data scope: admin-only. NO grant to authenticated — only service_role (read by admin RPC).

create materialized view if not exists public.user_activity_daily as
select
  u.id as user_id,
  date_trunc('week', u.created_at)::date as cohort_week,
  date_trunc('day', u.last_sign_in_at)::date as activity_day,
  (date_trunc('day', u.last_sign_in_at)::date - date_trunc('week', u.created_at)::date)::int as day_offset
from auth.users u
where u.last_sign_in_at is not null;

-- Pitfall 5: REFRESH CONCURRENTLY requires a UNIQUE index.
create unique index if not exists idx_uad_user_day
  on public.user_activity_daily (user_id, activity_day);

-- Range scans by cohort + offset (cohort_retention view aggregation).
create index if not exists idx_uad_cohort_offset
  on public.user_activity_daily (cohort_week, day_offset);

grant select on public.user_activity_daily to service_role;

comment on materialized view public.user_activity_daily is
  'ADMIN-08 (D-04): per-day activity matrix joined to signup-cohort week. Source for cohort_retention '
  'view (20270601000010). Refreshed CONCURRENTLY at 02:00 UTC by 20270601000009. Admin-only — '
  'no grant to authenticated.';
