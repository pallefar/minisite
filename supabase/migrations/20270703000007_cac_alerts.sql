-- Phase 33 Plan 01 — Migration 07
-- cac_alerts table: written by cac-alert-cron when 7d-rolling CAC > threshold (D-15/ADETL-07).
-- idempotency_key (source || '|' || alert_date) prevents repeat notifications on cron re-runs.
-- Dedup via UNIQUE constraint on idempotency_key.
--
-- SECURITY NOTE: This table is admin-only. RLS applied in Migration 10.

begin;

create table if not exists public.cac_alerts (
  id               uuid          not null default gen_random_uuid() primary key,
  source           text          not null,     -- network name or 'all'
  alert_date       date          not null,
  cac_7d_usd       numeric(10,2) not null,
  target_ltv_usd   numeric(10,2) not null,
  breach_ratio     numeric(8,4)  not null,
  created_at       timestamptz   not null default now(),
  -- Dedup key: (source, alert_date) composite UNIQUE replaces the original
  -- `idempotency_key text generated always as (...)` generated column —
  -- Supabase Postgres rejects the date::text cast inside a generated expression as
  -- non-IMMUTABLE (DateStyle dependency). The composite UNIQUE gives the same
  -- semantic (one alert per source per date) without a generated column.
  constraint cac_alerts_idempotency_uq unique (source, alert_date)
);

commit;
