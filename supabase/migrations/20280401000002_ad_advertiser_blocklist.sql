-- Phase 56 Plan 02 — Migration 02
-- ad_advertiser_blocklist: GLP-1 competitor domains (admin-editable).
-- ad_csp_allowlist: approved ad-network CDN hosts for CSP generation (AD-09).
-- Forward-dated past 20280301000005 (Phase 55 ceiling).

begin;

-- =============================================================================
-- 1. ad_advertiser_blocklist
-- =============================================================================
create table if not exists public.ad_advertiser_blocklist (
  id          uuid        not null default gen_random_uuid() primary key,
  hostname    text        not null unique,
  reason      text,
  created_at  timestamptz not null default now()
);

-- Seed GLP-1 competing brand domains.
-- Brand names kept only in SQL seed data; not referenced in TS source.
insert into public.ad_advertiser_blocklist (hostname, reason)
values
  ('wegovy.com',     'Competing GLP-1 brand'),
  ('ozempic.com',    'Competing GLP-1 brand'),
  ('mounjaro.com',   'Competing GLP-1 brand'),
  ('trulicity.com',  'Competing GLP-1 brand'),
  ('saxenda.com',    'Competing GLP-1 brand'),
  ('victoza.com',    'Competing GLP-1 brand'),
  ('rybelsus.com',   'Competing GLP-1 brand')
on conflict (hostname) do nothing;

alter table public.ad_advertiser_blocklist enable row level security;

create policy "ad_advertiser_blocklist_admin_all"
  on public.ad_advertiser_blocklist
  for all
  using (public.is_admin_at_least('admin'::public.admin_role))
  with check (public.is_admin_at_least('admin'::public.admin_role));

-- =============================================================================
-- 2. ad_csp_allowlist — approved ad-network CDN hosts for CSP generation.
-- =============================================================================
create table if not exists public.ad_csp_allowlist (
  id          uuid        not null default gen_random_uuid() primary key,
  hostname    text        not null unique,
  directive   text        not null check (directive in ('script-src', 'connect-src')),
  enabled     boolean     not null default true,
  created_at  timestamptz not null default now()
);

-- Seed approved ad-network hosts.
insert into public.ad_csp_allowlist (hostname, directive)
values
  ('pagead2.googlesyndication.com', 'script-src'),
  ('googleads.g.doubleclick.net',   'connect-src')
on conflict (hostname) do nothing;

alter table public.ad_csp_allowlist enable row level security;

create policy "ad_csp_allowlist_admin_all"
  on public.ad_csp_allowlist
  for all
  using (public.is_admin_at_least('admin'::public.admin_role))
  with check (public.is_admin_at_least('admin'::public.admin_role));

commit;
