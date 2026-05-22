-- Phase 43 Plan 03 — MEMBER-04 D-10 entitlement helpers
-- (auth.uid-and-service-role variants per [[feedback_rpc_auth_uid_vs_service_role_mismatch]])
-- + MEMBER-02 D-03 stripe_price_lookup support table.
--
-- CONTEXT references:
--   - MEMBER-04 / D-10: RLS predicate helper for pro-only resources (Phases 44/46/47).
--   - MEMBER-02 / D-03: per-plan default stripe_price_id lookup, consumed as the
--     fallback by resolve_user_effective_price() in migration 06.
--   - Pattern S1 (SECDEF + STABLE + set search_path); shape copied verbatim from
--     20270602000011_cohort_membership_matview.sql:114-139 (cohort_is_member).
--
-- This migration ships THREE objects:
--   1. `current_user_has_pro()` — SECDEF STABLE boolean reading auth.uid() against
--      tier_effective.has_active. Intended for RLS policy predicates in
--      Phases 44/46/47. CANNOT be invoked from service-role contexts.
--   2. `user_has_pro(p_user_id uuid)` — service-role-callable sibling that takes an
--      explicit user_id. Mitigates [[feedback_rpc_auth_uid_vs_service_role_mismatch]]
--      caught Phase 37-04. Same SECDEF + STABLE + search_path.
--   3. `stripe_price_lookup` table — (plan_name PK → stripe_price_id). Seeded with
--      5 empty placeholder rows; operator fills via Studio post-deploy
--      (vendor-gated-send pattern). RLS: admin-read only.

-- ============================================================================
-- 1. current_user_has_pro() — authenticated-only RLS predicate
-- ============================================================================
create or replace function public.current_user_has_pro()
returns boolean
language sql
security definer
stable
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select has_active from public.tier_effective where user_id = auth.uid()),
    false
  );
$$;

comment on function public.current_user_has_pro() is
  'P43 MEMBER-04 D-10: RLS predicate. Returns true if auth.uid() has '
  'has_active in tier_effective (covers pro+lifetime+trialing per P19 D-04). '
  'Marked STABLE so Postgres can inline at policy eval. CANNOT be invoked '
  'from service-role context (cron, fire-and-forget) — use user_has_pro(p_user_id) '
  'instead. See feedback_rpc_auth_uid_vs_service_role_mismatch.';

revoke all on function public.current_user_has_pro() from public;
grant execute on function public.current_user_has_pro() to authenticated;

-- ============================================================================
-- 2. user_has_pro(p_user_id) — service-role-callable sibling
-- ============================================================================
create or replace function public.user_has_pro(p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select has_active from public.tier_effective where user_id = p_user_id),
    false
  );
$$;

comment on function public.user_has_pro(uuid) is
  'P43 MEMBER-04 D-10: service-role-callable sibling of current_user_has_pro(). '
  'Takes explicit user_id — usable from cron / admin RPCs / Edge Fn service-role '
  'contexts that lack auth.uid(). The boolean is admin-controlled gating info '
  '(already inferable from "can user access pro-only resources") so granting '
  'execute to authenticated is intentional; abuse mitigated by call-site review '
  '(Phases 44/46/47 plan-checker greps that Edge Fns pass only the caller-authorized '
  'target user_id).';

revoke all on function public.user_has_pro(uuid) from public;
grant execute on function public.user_has_pro(uuid) to authenticated;

-- ============================================================================
-- 3. stripe_price_lookup — (plan_name → stripe_price_id) fallback table
-- ============================================================================
create table if not exists public.stripe_price_lookup (
  plan_name       text primary key,
  stripe_price_id text not null default '',
  updated_at      timestamptz not null default now()
);

comment on table public.stripe_price_lookup is
  'P43 MEMBER-02 D-03: maps plan_name (plus_monthly/plus_yearly/clinic_base/'
  'clinic_overage/lifetime) → stripe_price_id. Used by resolve_user_effective_price() '
  'as the fallback when no grandfathered cohort match exists. Empty stripe_price_id = '
  'vendor-gated 503 from checkout Edge Fn (vendor-gated-send pattern).';

comment on column public.stripe_price_lookup.stripe_price_id is
  'Stripe Price object id (price_XXXXXX). Empty string sentinel = operator has '
  'not yet configured this plan; resolve_user_effective_price returns NULL for it.';

-- Seed 5 empty placeholder rows — operator fills via Supabase Studio post-deploy.
insert into public.stripe_price_lookup (plan_name, stripe_price_id) values
  ('plus_monthly',   ''),
  ('plus_yearly',    ''),
  ('clinic_base',    ''),
  ('clinic_overage', ''),
  ('lifetime',       '')
on conflict (plan_name) do nothing;

-- RLS: admin-read only. No write policies (service-role / migrations only).
alter table public.stripe_price_lookup enable row level security;

create policy pol_stripe_price_lookup_admin_read
  on public.stripe_price_lookup
  for select
  to authenticated
  using (public.is_admin_at_least('admin'::public.admin_role));

-- NO insert/update/delete policies — Pattern S2 denial-by-default. Updates via
-- service-role (Supabase Studio) only.
