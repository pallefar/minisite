-- Phase 65-01 — Stripe Tax + Payment Resilience (PAY-04 rollup)
-- =============================================================================
--
-- Materialized view aggregating trailing-365-day per-state revenue from
-- tax_collection_log. The nexus-monitor cron (Plan 65-08) refreshes this
-- daily and joins against tax_nexus_thresholds to compute proximity %.
--
-- IMPORTANT: A unique index on `state` is required for
-- `refresh materialized view concurrently` (otherwise refresh holds an
-- ACCESS EXCLUSIVE lock that blocks reads — T-65-01-06 DoS mitigation).
--
-- Refresh schedule: daily at 03:00 UTC via pg_cron, registered in close-out
-- Plan 65-10 per [[feedback_fn_deploy_before_cron_db_push]] — the matview
-- (and dependent Fn) must exist BEFORE the cron schedule references them.
--
-- No CREATE POLICY IF NOT EXISTS — matviews use GRANT, not RLS, anyway.
-- Per [[reference_supabase_back_dated_migration_blocks_push]] — timestamp 20290104+
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Materialized View: public.tax_nexus_state_revenue
--    Aggregates last 365 days of tax_collection_log per US state.
--
--    NOTE: now() inside a matview definition is FROZEN at refresh time,
--    not query time — which is exactly what we want for daily snapshots.
-- ---------------------------------------------------------------------------

create materialized view public.tax_nexus_state_revenue as
select
  customer_state                  as state,
  sum(total_cents)::bigint        as revenue_cents,
  count(*)::bigint                as transaction_count,
  max(created_at)                 as last_transaction_at,
  now()                           as snapshot_at
from public.tax_collection_log
where customer_state is not null
  and created_at >= now() - interval '365 days'
group by customer_state;

-- ---------------------------------------------------------------------------
-- 2. Unique index on state — REQUIRED for REFRESH MATERIALIZED VIEW CONCURRENTLY.
-- ---------------------------------------------------------------------------

create unique index idx_tax_nexus_state_revenue_state
  on public.tax_nexus_state_revenue(state);

-- ---------------------------------------------------------------------------
-- 3. Grants — service_role + authenticated SELECT.
--    Matviews don't support RLS; use GRANT for access control.
--    Staff-only filtering happens at the /admin/tax UI layer (is_staff gated route).
-- ---------------------------------------------------------------------------

grant select on public.tax_nexus_state_revenue to service_role;
grant select on public.tax_nexus_state_revenue to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Comment — operator docs.
-- ---------------------------------------------------------------------------

comment on materialized view public.tax_nexus_state_revenue is
  'Per-US-state trailing-365d revenue rollup from tax_collection_log. '
  'MUST be refreshed daily by nexus-monitor cron (Plan 65-08). '
  'Refresh CONCURRENTLY (unique index on state required) to avoid blocking reads. '
  'Join against tax_nexus_thresholds to compute economic-nexus proximity %.';

commit;
