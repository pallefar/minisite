-- Phase 56 Plan 02 — Migration 03
-- ad_revenue_facts: per-network revenue inflow table (AD-12).
-- NEW — distinct from the spend-side ad_revenue_normalized matview (Phase 33).
-- Forward-dated past 20280301000005 (Phase 55 ceiling).

begin;

create table if not exists public.ad_revenue_facts (
  id                    uuid          not null default gen_random_uuid() primary key,
  network               text          not null check (network in ('admob', 'adsense')),
  placement_id          uuid,         -- FK to ad_placements; null = network-level aggregate
  report_date           date          not null,
  impressions           bigint        not null default 0,
  clicks                bigint        not null default 0,
  fill_rate             numeric(5,4),           -- 0.0000–1.0000
  estimated_revenue_usd numeric(12,6) not null default 0,
  ecpm_usd              numeric(12,6),          -- (estimated_revenue_usd / impressions) * 1000
  rpm_usd               numeric(12,6),          -- revenue per 1000 page views (set by ETL)
  raw_payload           jsonb,                  -- full API response; field names TBD until P70 approval
  etl_run_at            timestamptz   not null default now(),
  constraint ad_revenue_facts_uq unique (network, placement_id, report_date)
);

-- Admin-only RLS: mirrors 20270703000010_rls_deny_ad_tables.sql verbatim.
alter table public.ad_revenue_facts enable row level security;

create policy "ad_revenue_facts_admin_all"
  on public.ad_revenue_facts
  for all
  using (public.is_admin_at_least('admin'::public.admin_role))
  with check (public.is_admin_at_least('admin'::public.admin_role));

commit;
