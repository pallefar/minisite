-- Phase 33 Plan 01 — Migration 05
-- ad_etl_gaps table: written by gap-detection cron when actual fact-row count < expected (D-12/ADETL-05).
-- Admin CAC dashboard renders per-network "Gaps detected" badge with Backfill button.
-- missing_rows is a generated column (expected_rows - actual_rows) for convenience.
--
-- SECURITY NOTE: This table is admin-only. RLS applied in Migration 10.

begin;

create table if not exists public.ad_etl_gaps (
  id                      uuid        not null default gen_random_uuid() primary key,
  network                 text        not null check (network in ('meta', 'google', 'tiktok')),
  gap_date                date        not null,
  expected_rows           integer     not null,
  actual_rows             integer     not null,
  missing_rows            integer     generated always as (expected_rows - actual_rows) stored,
  detected_at             timestamptz not null default now(),
  resolved_at             timestamptz,
  backfill_triggered_at   timestamptz
);

commit;
