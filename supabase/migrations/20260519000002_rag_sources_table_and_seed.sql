-- Phase 50: rag_sources — admin-allowlisted scrape sources + 12 seed rows per D-04/D-06/D-07/D-32
--
-- Tiered allowlist (Tier A = primary/regulatory, B = secondary/clinical, C = community/lay press).
-- Default freshness windows per tier (D-32): A=365d, B=90d, C=30d.
-- RLS enabled here; policies live in 20260519000009_rag_rls_policies.sql.
--
-- Idempotent (ON CONFLICT DO NOTHING on seed; IF NOT EXISTS everywhere else).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'rag_source_tier' and typnamespace = 'public'::regnamespace
  ) then
    create type public.rag_source_tier as enum ('A', 'B', 'C');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'rag_source_health' and typnamespace = 'public'::regnamespace
  ) then
    create type public.rag_source_health as enum ('ok', 'paused', 'failing');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Shared updated_at trigger function (used by multiple Phase 50 tables)
-- ---------------------------------------------------------------------------

create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.rag_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null unique,
  tier public.rag_source_tier not null,
  freshness_window_days int not null check (freshness_window_days between 1 and 3650),
  health public.rag_source_health not null default 'ok',
  consecutive_failures int not null default 0,
  paused_at timestamptz,
  paused_reason text,
  last_scrape_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rag_sources_tier_idx on public.rag_sources (tier);
create index if not exists rag_sources_health_idx on public.rag_sources (health);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_rag_sources_updated_at'
  ) then
    create trigger trg_rag_sources_updated_at
      before update on public.rag_sources
      for each row execute function public.tg_set_updated_at();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.rag_sources enable row level security;

-- ---------------------------------------------------------------------------
-- Seed: 12 curated rows per D-04 (5 Tier-A + 5 Tier-B + 2 Tier-C)
-- ---------------------------------------------------------------------------

insert into public.rag_sources (name, domain, tier, freshness_window_days) values
  ('PubMed E-utilities',           'pubmed.ncbi.nlm.nih.gov', 'A', 365),
  ('FDA Drug Labels (DailyMed)',   'dailymed.nlm.nih.gov',    'A', 365),
  ('NIH MedlinePlus',              'medlineplus.gov',         'A', 365),
  ('Eli Lilly tirzepatide PI',     'lilly.com',               'A', 365),
  ('Novo Nordisk semaglutide PI',  'novonordisk.com',         'A', 365),
  ('drugs.com monographs',         'drugs.com',               'B',  90),
  ('Examine.com',                  'examine.com',             'B',  90),
  ('Mayo Clinic peptide reference','mayoclinic.org',          'B',  90),
  ('Cleveland Clinic GLP-1',       'my.clevelandclinic.org',  'B',  90),
  ('UpToDate (public summaries)',  'uptodate.com',            'B',  90),
  ('Healthline GLP-1 (lay press)', 'healthline.com',          'C',  30),
  ('Diabetes Daily community',     'diabetesdaily.com',       'C',  30)
on conflict (domain) do nothing;
