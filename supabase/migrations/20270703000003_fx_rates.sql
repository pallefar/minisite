-- Phase 33 Plan 01 — Migration 03
-- fx_rates table: daily ECB exchange rates keyed on (currency, rate_date) (ADETL-09 / D-11).
-- ETL cron reads: SELECT rate_eur_to_currency FROM fx_rates
--                 WHERE currency = ? AND rate_date <= ? ORDER BY rate_date DESC LIMIT 1
-- Missing row → ETL writes spend_usd_at_spend_date = NULL on ad_spend_facts (last-known-rate fallback).
--
-- EUR base identity row seeded: rate_eur_to_currency = 1.0 for EUR is definitional.
--
-- SECURITY NOTE: This table is admin-only. RLS applied in Migration 10.

begin;

create table if not exists public.fx_rates (
  id                    uuid          not null default gen_random_uuid() primary key,
  currency              text          not null,
  rate_date             date          not null,
  rate_eur_to_currency  numeric(16,8) not null,
  created_at            timestamptz   not null default now(),
  constraint fx_rates_currency_date_uq unique (currency, rate_date)
);

-- EUR base identity row (1.0 by definition)
insert into public.fx_rates (currency, rate_date, rate_eur_to_currency)
values ('EUR', current_date, 1.0)
on conflict (currency, rate_date) do nothing;

commit;
