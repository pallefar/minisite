-- Phase 65-08 — Stripe Tax + Payment Resilience (PAY-04 nexus-monitor RPCs)
-- =============================================================================
--
-- SECDEF SQL functions used by the nexus-monitor Edge Fn (Plan 65-08):
--
--   public.refresh_nexus_revenue()
--     Refreshes the tax_nexus_state_revenue matview CONCURRENTLY. Service-role
--     only. Wraps the privileged REFRESH MATERIALIZED VIEW operation behind a
--     parameterless RPC so the Edge Fn does not need raw SQL exec capability.
--
--   public.get_nexus_proximity()
--     Returns a per-state proximity rollup joining tax_nexus_thresholds (LEFT)
--     with tax_nexus_state_revenue. Each row carries the proximity_percent
--     (revenue / threshold * 100). Service-role + authenticated callers.
--     Authenticated callers see the same rows (matview already grants SELECT
--     to authenticated; admin /tax dashboard reads via this RPC for a single
--     query path shared with the Fn).
--
-- Threat model (from Plan 65-08):
--   T-65-08-01 Tampering (matview poisoning): mitigate — SECDEF + service-role
--     EXECUTE only on refresh_nexus_revenue. Public/anon revoked.
--
-- Per [[reference_supabase_back_dated_migration_blocks_push]] — timestamp 20290104+.
-- This is the 10th migration in the 65-01 / 65-08 cluster (000007/000008/000009/000010).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. public.refresh_nexus_revenue() — service-role only.
-- ---------------------------------------------------------------------------

create or replace function public.refresh_nexus_revenue()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.tax_nexus_state_revenue;
end;
$$;

revoke all on function public.refresh_nexus_revenue() from public;
revoke all on function public.refresh_nexus_revenue() from anon;
revoke all on function public.refresh_nexus_revenue() from authenticated;
grant execute on function public.refresh_nexus_revenue() to service_role;

comment on function public.refresh_nexus_revenue() is
  'Refresh tax_nexus_state_revenue matview CONCURRENTLY. Service-role only. '
  'Called daily by nexus-monitor Edge Fn (Plan 65-08, PAY-04).';

-- ---------------------------------------------------------------------------
-- 2. public.get_nexus_proximity() — service-role + authenticated.
--    Returns one row per US state in tax_nexus_thresholds with current
--    proximity_percent computed from the matview (LEFT JOIN: states with
--    zero recorded revenue still surface at 0%).
-- ---------------------------------------------------------------------------

create or replace function public.get_nexus_proximity()
returns table (
  state                   text,
  state_name              text,
  threshold_amount_cents  bigint,
  revenue_cents           bigint,
  proximity_percent       numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select
    t.state,
    t.state_name,
    t.threshold_amount_cents,
    coalesce(r.revenue_cents, 0)::bigint                                  as revenue_cents,
    (coalesce(r.revenue_cents, 0)::numeric
       / nullif(t.threshold_amount_cents, 0)::numeric
       * 100)                                                             as proximity_percent
  from public.tax_nexus_thresholds t
  left join public.tax_nexus_state_revenue r on r.state = t.state
  order by proximity_percent desc nulls last, t.state asc;
$$;

revoke all on function public.get_nexus_proximity() from public;
revoke all on function public.get_nexus_proximity() from anon;
grant execute on function public.get_nexus_proximity() to service_role;
grant execute on function public.get_nexus_proximity() to authenticated;

comment on function public.get_nexus_proximity() is
  'Per-state economic-nexus proximity rollup. Joins tax_nexus_thresholds with '
  'tax_nexus_state_revenue matview. Called by nexus-monitor (Plan 65-08) and '
  'the /admin/tax dashboard (Plan 65-09).';

commit;
