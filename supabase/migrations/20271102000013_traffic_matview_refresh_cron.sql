-- Phase 51 Plan 51-03 — Sequenced pg_cron refresh for the 4 traffic matviews.
-- Decision refs: D-14 (sequenced refresh chain), RESEARCH §Pattern 2.
-- Threat refs: T-51-20 (cron unscheduling P33's ad_revenue_refresh by
-- accident — preflight captures jobname).
--
-- Replaces P33's `ad_revenue_refresh` cron (defined in
-- 20270703000011_ad_etl_cron_schedules.sql) with a single combined job that:
--   1. select public.refresh_ad_revenue_normalized();   -- P33 work
--   2. refresh materialized view concurrently public.traffic_channel_rollup;
--   3. refresh materialized view concurrently public.traffic_channel_rollup_first;
--   4. refresh materialized view concurrently public.traffic_funnel_rollup;
--   5. refresh materialized view concurrently public.traffic_landing_page_rollup;
--
-- Schedule: '10 * * * *' (mirrors P33's ad_revenue_refresh slot — hourly at :10).
-- This keeps the existing P33 cadence; the chain runs strictly in series so
-- there's no risk of REFRESH MATERIALIZED VIEW CONCURRENTLY lock contention
-- between siblings.
--
-- Dollar-quote tag: the cron body contains no inner DO $$...$$ blocks, but per
-- memory `reference_postgres_dollar_quote_nesting_in_cron_body` we use a
-- NAMED tag `$body$...$body$` for cron.schedule's command argument so any
-- future inner block (or someone editing this file to add one) does not
-- silently close the outer quote. The pre-flight unschedule DO block uses
-- a separate named tag `$migration$` to avoid collision with anything the
-- cron body might contain.
--
-- Vault / service-role: this cron body does NOT call any Edge Fn via
-- net.http_post — every statement is pure SQL inside the same DB. So per
-- memory `reference_supabase_pg_cron_vault_service_role_pattern` no vault
-- decryption is required here.
--
-- P33 jobname capture: from the live source
-- 20270703000011_ad_etl_cron_schedules.sql the jobname is literally
-- 'ad_revenue_refresh' (line 34). We unschedule that exact name idempotently.
--
-- Migration timestamp: 20271102000013.

-- ---------------------------------------------------------------------------
-- 1. Idempotent unschedule of the P33 ad_revenue_refresh job.
-- ---------------------------------------------------------------------------
do $migration$
declare
  v_old_jobname text;
begin
  -- Primary: the P33 jobname is well-known. Look it up explicitly for
  -- maximum idempotency (works even if P33 was re-scheduled with a slightly
  -- different name in a future patch).
  select jobname into v_old_jobname
    from cron.job
   where jobname = 'ad_revenue_refresh'
   limit 1;
  if v_old_jobname is not null then
    perform cron.unschedule(v_old_jobname);
  end if;

  -- Defensive: any other job whose command calls refresh_ad_revenue_normalized
  -- (covers a hypothetical rename). Skips if zero rows.
  for v_old_jobname in
    select jobname from cron.job
     where command ilike '%refresh_ad_revenue_normalized%'
       and jobname <> 'ad_revenue_and_traffic_refresh'
  loop
    perform cron.unschedule(v_old_jobname);
  end loop;

  -- Also unschedule the new combined name if it already exists (re-run safety).
  if exists (select 1 from cron.job where jobname = 'ad_revenue_and_traffic_refresh') then
    perform cron.unschedule('ad_revenue_and_traffic_refresh');
  end if;
end
$migration$;

-- ---------------------------------------------------------------------------
-- 2. Combined sequenced refresh: P33 ad_revenue → P51 channel(last) → channel(first)
--    → funnel → landing. Named $body$...$body$ dollar-quote tag.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'ad_revenue_and_traffic_refresh',
  '10 * * * *',
  $body$
    select public.refresh_ad_revenue_normalized();
    refresh materialized view concurrently public.traffic_channel_rollup;
    refresh materialized view concurrently public.traffic_channel_rollup_first;
    refresh materialized view concurrently public.traffic_funnel_rollup;
    refresh materialized view concurrently public.traffic_landing_page_rollup;
  $body$
);

-- ---------------------------------------------------------------------------
-- DOWN (commented; run manually if needed):
-- select cron.unschedule('ad_revenue_and_traffic_refresh');
-- select cron.schedule('ad_revenue_refresh', '10 * * * *', $$select public.refresh_ad_revenue_normalized();$$);
-- ---------------------------------------------------------------------------
