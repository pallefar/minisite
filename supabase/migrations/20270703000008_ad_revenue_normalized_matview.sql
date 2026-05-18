-- Phase 33 Plan 01 — Migration 08
-- ad_revenue_normalized materialized view + UNIQUE index + REVOKE + SECDEF get_cac_summary RPC.
--
-- Order matters (Pitfall per RESEARCH + P30 pattern reference):
--   1. CREATE MATERIALIZED VIEW
--   2. CREATE UNIQUE INDEX  (REQUIRED before CONCURRENTLY refresh can be used by cron)
--   3. REFRESH MATERIALIZED VIEW (non-CONCURRENTLY for initial empty state — safe)
--   4. REVOKE direct access from public + authenticated
--   5. CREATE SECURITY DEFINER accessor function with is_admin() gate
--
-- Attribution window: per-network seconds from ad_network_config.default_attribution_window_seconds.
-- Matview joins events_mirror on payment_completed events within the attribution window.
-- WHERE clause: asf.spend_usd_at_spend_date IS NOT NULL — excludes rows with missing FX rate (D-11).
--
-- SECURITY: matview does NOT support RLS. Access via SECDEF get_cac_summary() only.
-- T-33-01-02 mitigated: is_admin() check as first statement in accessor.

begin;

-- =============================================================================
-- 1. Materialized view
-- =============================================================================
create materialized view if not exists public.ad_revenue_normalized as
select
  asf.network,
  asf.ad_account_id,
  asf.ad_id,
  asf.campaign_id,
  asf.spend_date,
  asf.hour_bucket,
  asf.spend_usd_at_spend_date,
  asf.clicks,
  asf.impressions,
  anc.default_attribution_window_seconds,
  count(em.id) as attributed_conversions,
  case
    when count(em.id) > 0
    then asf.spend_usd_at_spend_date / count(em.id)
    else null
  end as cac_usd
from public.ad_spend_facts asf
left join public.ad_network_config anc on anc.network = asf.network
left join public.events_mirror em
  on em.user_id is not null
  and em.event_name = 'payment_completed'
  and em.created_at between asf.hour_bucket
    and asf.hour_bucket + (anc.default_attribution_window_seconds * interval '1 second')
where asf.spend_usd_at_spend_date is not null
group by
  asf.network,
  asf.ad_account_id,
  asf.ad_id,
  asf.campaign_id,
  asf.spend_date,
  asf.hour_bucket,
  asf.spend_usd_at_spend_date,
  asf.clicks,
  asf.impressions,
  anc.default_attribution_window_seconds;

-- =============================================================================
-- 2. UNIQUE index — REQUIRED for REFRESH MATERIALIZED VIEW CONCURRENTLY (Pitfall 2)
--    Must be created before any CONCURRENTLY refresh attempt.
--    Composite: (network, ad_account_id, ad_id, spend_date) per plan spec.
-- =============================================================================
create unique index if not exists ad_revenue_normalized_uq
  on public.ad_revenue_normalized (network, ad_account_id, ad_id, spend_date);

-- =============================================================================
-- 3. Initial populate (non-CONCURRENTLY — matview is empty on first create; safe)
-- =============================================================================
refresh materialized view public.ad_revenue_normalized;

-- =============================================================================
-- 4. REVOKE direct access — matview does not support RLS; SECDEF accessor below
-- =============================================================================
revoke all on public.ad_revenue_normalized from public;
revoke all on public.ad_revenue_normalized from authenticated;

-- =============================================================================
-- 5. SECURITY DEFINER get_cac_summary accessor (T-33-01-02 mitigation)
--    Admin-only gate: is_admin() check as first statement.
--    SET search_path = pg_catalog, public, extensions (migration gotchas compliance).
-- =============================================================================
create or replace function public.get_cac_summary(
  p_source     text    default null,
  p_start_date date    default null,
  p_end_date   date    default null
)
returns table (
  network                            text,
  ad_account_id                      text,
  ad_id                              text,
  campaign_id                        text,
  spend_date                         date,
  spend_usd_at_spend_date            numeric,
  clicks                             bigint,
  impressions                        bigint,
  attributed_conversions             bigint,
  cac_usd                            numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  -- Authorization gate: only admins may read CAC summary (T-33-01-02)
  if not public.is_admin(auth.uid()) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  return query
  select
    m.network,
    m.ad_account_id,
    m.ad_id,
    m.campaign_id,
    m.spend_date,
    m.spend_usd_at_spend_date,
    m.clicks,
    m.impressions,
    m.attributed_conversions,
    m.cac_usd
  from public.ad_revenue_normalized m
  where
    (p_source     is null or m.network    = p_source)
    and (p_start_date is null or m.spend_date >= p_start_date)
    and (p_end_date   is null or m.spend_date <= p_end_date);
end;
$$;

revoke all on function public.get_cac_summary(text, date, date) from public;
grant execute on function public.get_cac_summary(text, date, date) to authenticated;

commit;
