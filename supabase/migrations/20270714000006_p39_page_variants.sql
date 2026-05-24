-- Phase 39 Plan 39-01 — page_variants table.
--
-- CONTEXT references (39-CONTEXT.md):
--   D-11 (42-day lifecycle: warn day 35 via warned_at, hard-cut day 42 via
--   archived_at + traffic_to_control = true flips traffic back to control),
--   D-13 (per-block A/B variants; each block can carry its own variant_set_id
--   referenced via the variant_blocks jsonb shape).
--
-- Purpose:
--   Variant rows for the Phase 15 page-builder editor. canonical_page_id FK ties
--   the variant to its control page (landing_pages.id); PostHog flag controls
--   traffic_split. Lifecycle columns drive the daily cron (Plan 39-03/04).
--
-- Writes flow only through Wave-2/3 SECDEF RPCs (Pattern S2).
-- SELECT RLS: admin (variant catalog is admin data).

create table if not exists public.page_variants (
  id                   uuid primary key default gen_random_uuid(),
  canonical_page_id    uuid not null references public.landing_pages(id) on delete cascade,
  variant_blocks       jsonb not null default '[]'::jsonb,
  traffic_split        numeric not null default 0.5
                       check (traffic_split >= 0 and traffic_split <= 1),
  warned_at            timestamptz, -- D-11: set day 35 by lifecycle cron
  archived_at          timestamptz, -- D-11: set day 42 (or earlier on refund kill)
  traffic_to_control   boolean not null default false, -- D-11: true after archive flip
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.page_variants is
  'Phase 39 D-11/D-13: page-builder A/B variant rows. warned_at + archived_at + '
  'traffic_to_control implement the 42-day lifecycle (warn 35, hard-cut 42). '
  'Per-block A/B carried in variant_blocks jsonb shape.';

create index if not exists page_variants_canonical_idx
  on public.page_variants (canonical_page_id);

-- Partial index for lifecycle cron (D-11): scan only unarchived variants.
-- archived_at IS NULL is IMMUTABLE-safe per reference_supabase_migration_gotchas.
create index if not exists page_variants_active_created_idx
  on public.page_variants (created_at) where archived_at is null;

alter table public.page_variants enable row level security;

create policy pol_page_variants_admin_select
  on public.page_variants
  for select
  to authenticated
  using (public.is_admin_at_least('admin'::public.admin_role));

-- NO INSERT/UPDATE/DELETE policies — Pattern S2: SECDEF RPC writes only.
