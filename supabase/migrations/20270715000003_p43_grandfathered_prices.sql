-- Phase 43 Plan 02 — MEMBER-02 D-03 (per-cohort grandfathered Stripe price overrides).
--
-- CONTEXT references:
--   - MEMBER-02 / D-03: per-cohort grandfathered pricing storage.
--   - Pattern S2 (denial-by-default): table has only SELECT policy for admins;
--     writes via SECDEF RPCs (shipped in 20270715000004_p43_grandfathered_prices_rpcs.sql).
--
-- This migration ships ONE table + admin-read RLS:
--   1. `grandfathered_prices` — maps (cohort_id, stripe_price_id) overrides
--      consumed by `resolve_user_effective_price()` (shipped in 43-03). Stripe
--      remains the source-of-truth for the price OBJECT; this table only stores
--      cohort → stripe_price_id mapping + effective window + creator audit.
--   2. RLS — SELECT for admins, NO INSERT/UPDATE/DELETE policies (Pattern S2
--      denial-by-default; writes only via SECDEF RPCs in 20270715000004).
--
-- FK target is `public.cohort_definitions(id)` — NOT a generic `cohorts` table
-- (Phase 36 trap). ON DELETE CASCADE so archiving a cohort removes its
-- grandfathered overrides automatically.

-- ============================================================================
-- 1. grandfathered_prices table
-- ============================================================================
create table if not exists public.grandfathered_prices (
  id              uuid primary key default gen_random_uuid(),
  cohort_id       uuid not null
                  references public.cohort_definitions(id) on delete cascade,
  stripe_price_id text not null,
  effective_from  timestamptz not null default now(),
  effective_until timestamptz,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (cohort_id, stripe_price_id, effective_from)
);

comment on table public.grandfathered_prices is
  'P43 MEMBER-02: per-cohort grandfathered Stripe price overrides. '
  'resolve_user_effective_price() consumes this via cohort_is_member; '
  'admin-managed via SECDEF RPCs (grandfathered_price_create/_update/_delete).';

comment on column public.grandfathered_prices.cohort_id is
  'FK to public.cohort_definitions(id) ON DELETE CASCADE — archiving a cohort '
  'drops its overrides. NOT a generic cohorts table (Phase 36 FK-target trap).';

comment on column public.grandfathered_prices.stripe_price_id is
  'Stripe Price object id (price_XXXXXX). Validated by RPC against '
  '^price_[A-Za-z0-9]+$. Stripe is source-of-truth for the price OBJECT itself.';

comment on column public.grandfathered_prices.effective_until is
  'Nullable = open-ended override. When non-null, the resolver excludes rows '
  'where now() > effective_until.';

-- Index on cohort_id for the resolver join path (cohort_is_member → grandfathered_prices).
create index if not exists grandfathered_prices_cohort_id_idx
  on public.grandfathered_prices(cohort_id);

-- ============================================================================
-- 2. RLS — admin-readable; SECDEF RPCs are the only writers (Pattern S2)
-- ============================================================================
-- Pattern S2 denial-by-default — writes only via SECDEF RPCs in 20270715000004.
alter table public.grandfathered_prices enable row level security;

-- SELECT policy: any admin can list grandfathered prices (needed for
-- AdminGrandfatheredPriceList UI in 43-05).
create policy pol_grandfathered_prices_admin_read
  on public.grandfathered_prices
  for select
  to authenticated
  using (public.is_admin_at_least('admin'::public.admin_role));

-- NO insert/update/delete policies — Pattern S2: writes only via SECDEF RPCs
-- (grandfathered_price_create / _update / _delete in 20270715000004). The
-- absence of policies = denial-by-default under RLS.
