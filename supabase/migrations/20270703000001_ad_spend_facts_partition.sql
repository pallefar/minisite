-- Phase 33 Plan 01 — Migration 01
-- Partitioned ad_spend_facts table (RANGE on spend_date, monthly partitions).
-- Idempotency key: UNIQUE (network, ad_account_id, ad_id, hour_bucket) per D-04/ADETL-06.
-- Monthly pg_cron job drops partitions older than 13 months per D-03 discretion.
--
-- SECURITY NOTE: This table is admin-only. RLS applied in Migration 10.
-- Cross-tenant denial proof test lives in Plan 33-05.

begin;

-- =============================================================================
-- 1. Parent partitioned table
-- =============================================================================
create table if not exists public.ad_spend_facts (
  id                      uuid          not null default gen_random_uuid(),
  network                 text          not null check (network in ('meta', 'google', 'tiktok')),
  ad_account_id           text          not null,
  ad_id                   text          not null,
  campaign_id             text,
  adset_id                text,
  ad_name                 text,
  hour_bucket             timestamptz   not null,
  spend_date              date          not null,
  spend_local             numeric(12,6) not null default 0,
  spend_currency          text          not null default 'USD',
  spend_usd_at_spend_date numeric(12,6),         -- NULL when fx_rate missing (D-11)
  clicks                  bigint        not null default 0,
  impressions             bigint        not null default 0,
  conversions             bigint        not null default 0,
  created_at              timestamptz   not null default now(),
  updated_at              timestamptz   not null default now(),
  constraint ad_spend_facts_pkey primary key (id, spend_date),
  constraint ad_spend_facts_uq unique (network, ad_account_id, ad_id, hour_bucket, spend_date)
) partition by range (spend_date);

-- =============================================================================
-- 2. Starter monthly partitions (2026-05 through 2026-08)
-- =============================================================================
create table if not exists public.ad_spend_facts_y2026m05
  partition of public.ad_spend_facts
  for values from ('2026-05-01') to ('2026-06-01');

create table if not exists public.ad_spend_facts_y2026m06
  partition of public.ad_spend_facts
  for values from ('2026-06-01') to ('2026-07-01');

create table if not exists public.ad_spend_facts_y2026m07
  partition of public.ad_spend_facts
  for values from ('2026-07-01') to ('2026-08-01');

create table if not exists public.ad_spend_facts_y2026m08
  partition of public.ad_spend_facts
  for values from ('2026-08-01') to ('2026-09-01');

-- =============================================================================
-- 3. Monthly partition cleanup cron (drops partitions older than 13 months)
-- =============================================================================
select cron.unschedule('ad_spend_facts_drop_old_partitions')
  where exists (select 1 from cron.job where jobname = 'ad_spend_facts_drop_old_partitions');

select cron.schedule(
  'ad_spend_facts_drop_old_partitions',
  '0 2 1 * *',
  $$
  DO $$
  DECLARE
    r record;
    cutoff date := date_trunc('month', now() - interval '13 months')::date;
  BEGIN
    FOR r IN
      SELECT inhrelid::regclass AS partition_name,
             pg_get_expr(c.relpartbound, c.oid) AS bound
      FROM   pg_inherits
      JOIN   pg_class c ON c.oid = inhrelid
      WHERE  inhparent = 'public.ad_spend_facts'::regclass
    LOOP
      -- Only drop partition if its upper bound is <= cutoff
      IF substring(r.bound from 'TO \(''([^'']+)''') ::date <= cutoff THEN
        EXECUTE format('DROP TABLE IF EXISTS %s', r.partition_name);
        RAISE NOTICE 'Dropped old ad_spend_facts partition: %', r.partition_name;
      END IF;
    END LOOP;
  END;
  $$ LANGUAGE plpgsql;
  $$
);

commit;
