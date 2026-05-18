-- Phase 33 Plan 01 — Migration 04
-- ad_etl_health table: one row per network, upserted on every ETL tick (D-02).
-- Surfaces credential-missing and last-sync-failed badges in admin CAC module header.
-- Reuses admin-module-status convention from P27.
--
-- SECURITY NOTE: This table is admin-only. RLS applied in Migration 10.

begin;

create table if not exists public.ad_etl_health (
  network               text        primary key
    check (network in ('meta', 'google', 'tiktok')),
  credentials_present   boolean     not null default false,
  last_attempt_at       timestamptz,
  last_success_at       timestamptz,
  last_error            text,
  created_at            timestamptz not null default now()
);

-- Seed 3 rows (one per network), credentials_present=false per D-02.
-- ETL functions upsert ON CONFLICT (network) to update health state.
insert into public.ad_etl_health (network, credentials_present)
values
  ('meta',   false),
  ('google', false),
  ('tiktok', false)
on conflict (network) do nothing;

commit;
