-- Phase 39 Plan 39-01 — variant_config table + back-fill FK from user_experiments.
--
-- CONTEXT references (39-CONTEXT.md):
--   D-01 (composite_score column drives Ship-Winner gate),
--   D-02 (archived_at flips traffic to control on refund kill),
--   D-08 (cohort_id FK ties per-cohort variant routing),
--   D-11 (warned_at + archived_at = 42-day lifecycle: warn day 35, hard-cut day 42),
--   D-12 (Ship-Winner UI reads posterior to gate >=95% threshold).
--
-- Purpose:
--   The catalog of variant rows per surface (paywall | page | pharma). Each row
--   carries the variant config blob, composite_score (paid_rate *
--   retention_30d_rate), posterior (Bayesian), and 42-day lifecycle columns.
--
-- Writes flow only through Wave-2/3 SECDEF RPCs (Pattern S2).
-- SELECT RLS restricted to admins (variant catalogs are admin-only data).

create table if not exists public.variant_config (
  id              uuid primary key default gen_random_uuid(),
  surface         text not null check (surface in ('paywall', 'page', 'pharma')),
  cohort_id       uuid references public.cohort_definitions(id) on delete set null,
  config          jsonb not null default '{}'::jsonb,
  composite_score numeric,  -- D-01: paid_rate * retention_30d_rate, populated by experiment_results matview refresh
  posterior       numeric,  -- D-12: Bayesian posterior probability variant beats control
  warned_at       timestamptz, -- D-11: set when daily lifecycle cron flags variant >= 35 days old
  archived_at     timestamptz, -- D-11: set at day 42 OR by D-02 refund kill; traffic flips to control
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.variant_config is
  'Phase 39: catalog of A/B variant rows per surface. composite_score = '
  'paid_rate * retention_30d_rate (D-01). warned_at + archived_at = 42-day '
  'lifecycle (D-11). Writes flow only through SECDEF RPCs (Pattern S2).';

create index if not exists variant_config_surface_idx
  on public.variant_config (surface);

create index if not exists variant_config_cohort_idx
  on public.variant_config (cohort_id) where cohort_id is not null;

-- Partial index for the lifecycle cron (D-11) scanning unarchived variants.
-- archived_at IS NULL is an IMMUTABLE predicate (column-only, no time fn).
create index if not exists variant_config_active_created_idx
  on public.variant_config (created_at) where archived_at is null;

alter table public.variant_config enable row level security;

-- SELECT: admin-only (variant catalogs are admin data, not user-facing).
create policy pol_variant_config_admin_select
  on public.variant_config
  for select
  to authenticated
  using (public.is_admin_at_least('admin'::public.admin_role));

-- NO INSERT/UPDATE/DELETE policies — Pattern S2: writes only through Wave-2
-- SECDEF RPCs (variant_create, variant_archive, etc.). Denial-by-default.

-- Now that variant_config exists, back-fill FK on user_experiments.variant_id.
alter table public.user_experiments
  add constraint user_experiments_variant_id_fkey
  foreign key (variant_id) references public.variant_config(id) on delete set null;
