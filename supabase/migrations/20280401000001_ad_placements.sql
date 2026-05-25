-- Phase 56 Plan 02 — Migration 01
-- ad_placements: per-placement admin config registry (AD-05).
-- Forward-dated past 20280301000005 (Phase 55 ceiling).

begin;

create table if not exists public.ad_placements (
  id                    uuid          not null default gen_random_uuid() primary key,
  key                   text          not null unique,
  surface               text          not null,
  mode                  text          not null check (mode in ('embed-code', 'ad-platform', 'house-ads')),
  network               text          check (network in ('admob', 'adsense')),
  freq_cap_per_session  int           not null default 3,
  ab_variant            text,
  enabled               boolean       not null default false,
  embed_html            text,
  house_ad_slug         text,
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now()
);

-- Admin-only RLS: mirrors 20270703000010_rls_deny_ad_tables.sql verbatim.
alter table public.ad_placements enable row level security;

create policy "ad_placements_admin_all"
  on public.ad_placements
  for all
  using (public.is_admin_at_least('admin'::public.admin_role))
  with check (public.is_admin_at_least('admin'::public.admin_role));

commit;
