-- Phase 33 Plan 01 — Migration 11
-- pg_cron schedules for all 6 Edge Functions + matview refresh + gap detection.
--
-- Vault pattern (project-established; see 20270101000014_service_role_key_vault_load.sql):
--   Bearer token sourced from vault.decrypted_secrets WHERE name = 'service_role_key'
--   Hardcoded project URL: https://ytnsipxxmzgaebkqmokp.supabase.co
--   DO NOT use current_setting('app.service_role_key') — GUC does NOT exist (plan-checker BLOCKER fix).
--
-- Schedule map (staggered to avoid slot collision):
--   ad_spend_cron_meta    : '5  * * * *'  — hourly at :05
--   ad_spend_cron_google  : '6  * * * *'  — hourly at :06
--   ad_spend_cron_tiktok  : '7  * * * *'  — hourly at :07
--   ad_revenue_refresh    : '10 * * * *'  — hourly matview refresh after ETL ticks
--   fx_rates_ecb          : '0 17 * * *'  — daily after ECB publishes (~16:00 CET = 17:00 UTC)
--   ad_etl_gap_detect     : '0  5 * * *'  — daily 05:00 UTC; calls run_ad_etl_gap_detection()
--   cac_alert_cron        : '30 0 * * *'  — daily 00:30 UTC per D-15
--
-- DOWN block: cron.unschedule() calls at end of file for clean rollback.
-- Companion SECDEF helpers also created here:
--   public.refresh_ad_revenue_normalized() — CONCURRENTLY refresh wrapper
--   public.run_ad_etl_gap_detection()      — gap detection logic (plan-checker BLOCKER 1 fix)

begin;

-- =============================================================================
-- Idempotent pre-unschedule (safe re-run)
-- =============================================================================
select cron.unschedule('ad_spend_cron_meta')
  where exists (select 1 from cron.job where jobname = 'ad_spend_cron_meta');
select cron.unschedule('ad_spend_cron_google')
  where exists (select 1 from cron.job where jobname = 'ad_spend_cron_google');
select cron.unschedule('ad_spend_cron_tiktok')
  where exists (select 1 from cron.job where jobname = 'ad_spend_cron_tiktok');
select cron.unschedule('ad_revenue_refresh')
  where exists (select 1 from cron.job where jobname = 'ad_revenue_refresh');
select cron.unschedule('fx_rates_ecb')
  where exists (select 1 from cron.job where jobname = 'fx_rates_ecb');
select cron.unschedule('ad_etl_gap_detect')
  where exists (select 1 from cron.job where jobname = 'ad_etl_gap_detect');
select cron.unschedule('cac_alert_cron')
  where exists (select 1 from cron.job where jobname = 'cac_alert_cron');

-- =============================================================================
-- Hourly ETL schedules (staggered :05 / :06 / :07)
-- =============================================================================
select cron.schedule(
  'ad_spend_cron_meta',
  '5 * * * *',
  $$SELECT net.http_post(
    url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/ad-spend-cron-meta',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );$$
);

select cron.schedule(
  'ad_spend_cron_google',
  '6 * * * *',
  $$SELECT net.http_post(
    url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/ad-spend-cron-google',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );$$
);

select cron.schedule(
  'ad_spend_cron_tiktok',
  '7 * * * *',
  $$SELECT net.http_post(
    url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/ad-spend-cron-tiktok',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );$$
);

-- =============================================================================
-- Hourly matview refresh — calls SECDEF wrapper (created below)
-- =============================================================================
select cron.schedule(
  'ad_revenue_refresh',
  '10 * * * *',
  $$SELECT public.refresh_ad_revenue_normalized();$$
);

-- =============================================================================
-- Daily ECB FX rates pull — 17:00 UTC (after ECB publishes ~16:00 CET)
-- =============================================================================
select cron.schedule(
  'fx_rates_ecb',
  '0 17 * * *',
  $$SELECT net.http_post(
    url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/fx-rates-ecb-cron',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );$$
);

-- =============================================================================
-- Daily gap detection — 05:00 UTC (after nightly ETL, before business day)
-- Calls run_ad_etl_gap_detection() SECDEF (created below).
-- NOTE: This is gap-detection (row count vs expected), NOT cac-alert-cron.
-- plan-checker BLOCKER 1 fix: gap-detect and cac-alert have distinct responsibilities.
-- =============================================================================
select cron.schedule(
  'ad_etl_gap_detect',
  '0 5 * * *',
  $$SELECT public.run_ad_etl_gap_detection();$$
);

-- =============================================================================
-- Daily CAC alert evaluation — 00:30 UTC per D-15
-- =============================================================================
select cron.schedule(
  'cac_alert_cron',
  '30 0 * * *',
  $$SELECT net.http_post(
    url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/cac-alert-cron',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );$$
);

-- =============================================================================
-- SECDEF helper: refresh_ad_revenue_normalized()
-- Wraps REFRESH MATERIALIZED VIEW CONCURRENTLY for the pg_cron job.
-- CONCURRENTLY requires the unique index (ad_revenue_normalized_uq) to exist — created in migration 08.
-- =============================================================================
create or replace function public.refresh_ad_revenue_normalized()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  refresh materialized view concurrently public.ad_revenue_normalized;
end;
$$;

revoke all on function public.refresh_ad_revenue_normalized() from public;

-- =============================================================================
-- SECDEF helper: run_ad_etl_gap_detection()
-- Daily gap detection: compares actual spend fact row count vs expected (active_accounts x 24).
-- Writes ad_etl_gaps + admin_notifications for each gap found.
-- plan-checker BLOCKER 1 fix: dedicated SECDEF so gap-detect cron calls this, not cac-alert-cron.
-- =============================================================================
create or replace function public.run_ad_etl_gap_detection()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_yesterday       date    := (current_date - interval '1 day')::date;
  v_active_accounts integer;
  v_actual          integer;
  v_expected        integer;
  v_network         text;
begin
  for v_network in select unnest(array['meta', 'google', 'tiktok']) loop
    -- Count distinct ad_account_ids that wrote any row yesterday for this network.
    select count(distinct ad_account_id) into v_active_accounts
      from public.ad_spend_facts
      where network = v_network and spend_date = v_yesterday;

    if v_active_accounts = 0 then
      continue; -- No ad accounts active; not a gap, just no spend.
    end if;

    v_expected := v_active_accounts * 24;

    select count(*) into v_actual
      from public.ad_spend_facts
      where network = v_network and spend_date = v_yesterday;

    if v_actual < v_expected then
      -- Write gap row
      insert into public.ad_etl_gaps (network, gap_date, expected_rows, actual_rows)
      values (v_network, v_yesterday, v_expected, v_actual)
      on conflict do nothing;

      -- Admin notification per ADETL-05 + VALIDATION D5 (plan-checker iter-2 W7 fix)
      insert into public.admin_notifications (title, body, type)
      values (
        format('Ad ETL gap detected — %s', v_network),
        format(
          '%s missing %s of %s expected hourly rows for %s. Use Backfill button at /admin/growth/cac to recover.',
          v_network,
          v_expected - v_actual,
          v_expected,
          v_yesterday
        ),
        'ad_etl_gap'
      )
      on conflict do nothing;
    end if;
  end loop;
end;
$$;

revoke execute on function public.run_ad_etl_gap_detection() from public;

-- =============================================================================
-- DOWN: (commented reference for rollback — run manually if needed)
-- SELECT cron.unschedule('ad_spend_cron_meta');
-- SELECT cron.unschedule('ad_spend_cron_google');
-- SELECT cron.unschedule('ad_spend_cron_tiktok');
-- SELECT cron.unschedule('ad_revenue_refresh');
-- SELECT cron.unschedule('fx_rates_ecb');
-- SELECT cron.unschedule('ad_etl_gap_detect');
-- SELECT cron.unschedule('cac_alert_cron');
-- DROP FUNCTION IF EXISTS public.refresh_ad_revenue_normalized();
-- DROP FUNCTION IF EXISTS public.run_ad_etl_gap_detection();
-- =============================================================================

commit;
