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
  idempotency_key  text          not null generated always as (source || '|' || alert_date::text) stored,
  created_at       timestamptz   not null default now(),
  constraint cac_alerts_idempotency_uq unique (idempotency_key)
);

commit;
