-- Phase 39 Plan 39-01 — utm_variant_map table + back-fill FK from user_experiments.
--
-- CONTEXT references (39-CONTEXT.md):
--   D-09 (per-UTM pricing-page routing: utm_source -> variant_id mapping; 4 seed rows
--   shipped in 20270714000009_p39_utm_variant_map_seed.sql),
--   D-10 (cohort wins over UTM at resolver conflict-resolution time).
--
-- Purpose:
--   Admin table mapping inbound utm_source string (captured via Phase 51's
--   lt_utm_source cookie) to a variant_config.id for paywall surface. The
--   resolver Edge Fn (Wave 2) reads cohort_id FIRST (D-10 precedence) then
--   falls back to utm_variant_id when no cohort matches.
--
-- Writes flow only through Wave-2/3 SECDEF RPCs (Pattern S2).
-- SELECT RLS restricted to admins.

create table if not exists public.utm_variant_map (
  id           uuid primary key default gen_random_uuid(),
  utm_source   text not null unique,
  variant_id   uuid references public.variant_config(id) on delete set null,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.utm_variant_map is
  'Phase 39 D-09: maps inbound utm_source string to variant_config.id for paywall '
  'routing. Seeded with 4 rows (lean, transformation, clinical, default). '
  'Resolver consults this AFTER cohort match (D-10 precedence).';

create index if not exists utm_variant_map_variant_idx
  on public.utm_variant_map (variant_id) where variant_id is not null;

alter table public.utm_variant_map enable row level security;

create policy pol_utm_variant_map_admin_select
  on public.utm_variant_map
  for select
  to authenticated
  using (public.is_admin_at_least('admin'::public.admin_role));

-- NO INSERT/UPDATE/DELETE policies — Pattern S2: SECDEF RPC writes only.

-- Back-fill FK on user_experiments.utm_variant_id.
alter table public.user_experiments
  add constraint user_experiments_utm_variant_id_fkey
  foreign key (utm_variant_id) references public.utm_variant_map(id) on delete set null;
