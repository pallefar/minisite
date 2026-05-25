-- Phase 56 Plan 02 — Migration 05
-- Daily pg_cron for ad-revenue-etl Edge Fn + get_ad_revenue_dashboard SECDEF RPC (AD-12, AD-06).
-- Forward-dated past 20280301000005 (Phase 55 ceiling).
--
-- Cron pattern mirrors 20270703000011_ad_etl_cron_schedules.sql:
--   vault service_role bearer + hardcoded project URL.
--   Single-statement $$ body — no inner DO/$$ block (Pitfall 5 dollar-quote nesting).
--
-- RPC guard: public.is_admin_at_least('admin'::public.admin_role)
--   The single-arg is_admin helper does NOT exist in this codebase; use is_admin_at_least.

begin;

-- =============================================================================
-- Idempotent pre-unschedule (safe re-run)
-- =============================================================================
select cron.unschedule('ad_revenue_etl_cron')
  where exists (select 1 from cron.job where jobname = 'ad_revenue_etl_cron');

-- =============================================================================
-- Daily 03:00 UTC revenue ETL — after network report APIs refresh overnight.
-- =============================================================================
select cron.schedule(
  'ad_revenue_etl_cron',
  '0 3 * * *',
  $$SELECT net.http_post(
    url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/ad-revenue-etl',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );$$
);

-- =============================================================================
-- SECDEF RPC: get_ad_revenue_dashboard
-- Returns revenue rows from ad_revenue_facts to admins only.
-- Guard: is_admin_at_least('admin') — single-arg variant absent from this codebase.
-- search_path: locked to pg_catalog, public, extensions (T-56-07 search_path tampering).
-- =============================================================================
create or replace function public.get_ad_revenue_dashboard(
  p_start_date date default null,
  p_end_date   date default null
)
returns table (
  network               text,
  report_date           date,
  impressions           bigint,
  clicks                bigint,
  fill_rate             numeric,
  estimated_revenue_usd numeric,
  ecpm_usd              numeric,
  rpm_usd               numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $func$
begin
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  return query
    select
      f.network,
      f.report_date,
      f.impressions,
      f.clicks,
      f.fill_rate,
      f.estimated_revenue_usd,
      f.ecpm_usd,
      f.rpm_usd
    from public.ad_revenue_facts f
    where
      (p_start_date is null or f.report_date >= p_start_date)
      and (p_end_date is null or f.report_date <= p_end_date)
    order by f.report_date desc, f.network;
end;
$func$;

grant execute on function public.get_ad_revenue_dashboard(date, date) to authenticated;

commit;
