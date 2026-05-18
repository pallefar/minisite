-- Phase 33 Plan 01 — Migration 02
-- ad_network_config table: per-network attribution window defaults (D-09).
-- Seeded with 3 rows: meta (7d), google (30d), tiktok (7d).
-- Admin UPDATE for override; no code deploy required for threshold changes.
--
-- SECURITY NOTE: This table is admin-only. RLS applied in Migration 10.

begin;

create table if not exists public.ad_network_config (
  network                            text          primary key
    check (network in ('meta', 'google', 'tiktok')),
  default_attribution_window_seconds bigint        not null,
  default_attribution_model          text          not null default 'click',
  updated_at                         timestamptz   not null default now(),
  updated_by_admin_id                uuid          references auth.users(id)
);

-- Seed 3 rows per D-09: meta=7d (604800s), google=30d (2592000s), tiktok=7d (604800s)
insert into public.ad_network_config (network, default_attribution_window_seconds, default_attribution_model)
values
  ('meta',   604800,  'click'),
  ('google', 2592000, 'click'),
  ('tiktok', 604800,  'click')
on conflict (network) do nothing;

commit;
