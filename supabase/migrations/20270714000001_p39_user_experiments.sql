-- Phase 39 Plan 39-01 — user_experiments table.
--
-- CONTEXT references (39-CONTEXT.md):
--   D-01 (composite goal), D-08 (cohort routing), D-09 (UTM routing),
--   D-10 (cohort wins over UTM at resolve time).
--
-- Purpose:
--   Append-on-first-assignment table recording per-user variant assignment for
--   each A/B surface (paywall | page | pharma). Resolver Edge Fn (Wave 2)
--   INSERTs on first qualifying touch; subsequent reads bind to the same row
--   for stickiness (immune to V13-7 race).
--
-- T-39-01-01 mitigation: SELECT RLS restricts cross-tenant SELECT to
--   (user_id = auth.uid()) OR admin. pgTAP proof in
--   supabase/tests/p39_rls_user_experiments.sql asserts non-admin denial.
--
-- T-39-01-04 mitigation (repudiation): cohort_id + utm_variant_id + created_at
--   audit the deciding inputs at assignment time.
--
-- Writes flow only through Wave-2 SECDEF assignment RPC (no INSERT/UPDATE/DELETE
--   RLS policies present here — Pattern S2).

create table if not exists public.user_experiments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  surface         text not null check (surface in ('paywall', 'page', 'pharma')),
  variant_id      uuid,  -- nullable = control; FK added in 20270714000002 after variant_config exists
  cohort_id       uuid references public.cohort_definitions(id) on delete set null,
  utm_variant_id  uuid,  -- FK added in 20270714000003 after utm_variant_map exists
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, surface)
);

comment on table public.user_experiments is
  'Phase 39: per-user variant assignment, sticky on first qualifying touch. '
  'Resolver Edge Fn (Wave 2) INSERTs once per (user_id, surface); subsequent '
  'reads bind to the same row. cohort_id + utm_variant_id audit the deciding '
  'inputs (T-39-01-04). Writes flow only through SECDEF RPC.';

create index if not exists user_experiments_user_surface_idx
  on public.user_experiments (user_id, surface);

create index if not exists user_experiments_cohort_idx
  on public.user_experiments (cohort_id) where cohort_id is not null;

create index if not exists user_experiments_variant_idx
  on public.user_experiments (variant_id) where variant_id is not null;

alter table public.user_experiments enable row level security;

-- SELECT: owner OR admin (T-39-01-01).
create policy pol_user_experiments_self_or_admin_select
  on public.user_experiments
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin_at_least('admin'::public.admin_role)
  );

-- NO INSERT/UPDATE/DELETE policies — Pattern S2: writes only through Wave-2
-- SECDEF assignment RPC. Denial-by-default under RLS.
