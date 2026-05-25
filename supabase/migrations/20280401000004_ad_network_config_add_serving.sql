-- Phase 56 Plan 02 — Migration 04
-- Idempotent ALTER of ad_network_config CHECK to add 'admob' and 'adsense'.
-- Then seed admob + adsense config rows ON CONFLICT DO NOTHING.
-- Forward-dated past 20280301000005 (Phase 55 ceiling).
--
-- Pitfall 2 (RESEARCH): original CHECK only has ('meta','google','tiktok').
-- Insert of admob/adsense rows would fail without this ALTER.
-- Pattern: DROP constraint if exists + ADD with full updated value list.

begin;

alter table public.ad_network_config
  drop constraint if exists ad_network_config_network_check;

alter table public.ad_network_config
  add constraint ad_network_config_network_check
  check (network in ('meta', 'google', 'tiktok', 'admob', 'adsense'));

-- Seed admob + adsense serving config rows.
insert into public.ad_network_config (network)
values
  ('admob'),
  ('adsense')
on conflict (network) do nothing;

commit;
