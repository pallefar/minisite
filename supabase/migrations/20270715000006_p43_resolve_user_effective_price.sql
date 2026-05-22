-- Phase 43 Plan 03 — MEMBER-02 D-03/D-04 resolver consumed by stripe-checkout
-- Edge Fn BEFORE sessions.create. Returns the Stripe price_id the user should
-- be charged for plan p_plan, with grandfathered-cohort override winning over
-- the stripe_price_lookup default.
--
-- CONTEXT references:
--   - MEMBER-02 / D-03: per-cohort grandfathered pricing.
--   - MEMBER-02 / D-04: most-recent-effective_from wins precedence
--     (RESEARCH OQ-resolution; operator controls ordering via effective_from).
--   - Pattern S1 (SECDEF + STABLE + set search_path); shape mirrors P27
--     cohort_is_member (20270602000011_cohort_membership_matview.sql).
--
-- Fallback chain:
--   grandfathered_prices match (most-recent effective_from)
--     → stripe_price_lookup default
--     → NULL (Edge Fn responds 503 vendor_unconfigured)

-- ============================================================================
-- 1. resolve_user_effective_price(p_user_id, p_plan)
-- ============================================================================
create or replace function public.resolve_user_effective_price(
  p_user_id uuid,
  p_plan    text
)
returns text
language plpgsql
security definer
stable
set search_path = public, pg_catalog
as $$
declare
  v_default_price_id text;
  v_grandfathered    text;
begin
  -- Fallback: lookup table seeded in migration 05.
  select stripe_price_id into v_default_price_id
    from public.stripe_price_lookup
    where plan_name = p_plan;

  -- Grandfathered override: MOST-RECENT effective_from wins (operator controls
  -- precedence per RESEARCH OQ-resolution).
  select gp.stripe_price_id into v_grandfathered
    from public.grandfathered_prices gp
    where public.cohort_is_member(p_user_id, gp.cohort_id)
      and gp.effective_from <= now()
      and (gp.effective_until is null or gp.effective_until > now())
    order by gp.effective_from desc
    limit 1;

  -- NULLIF treats empty-string sentinel from stripe_price_lookup as "unset",
  -- so the Edge Fn can branch on NULL → 503 vendor_unconfigured.
  return coalesce(nullif(v_grandfathered, ''), nullif(v_default_price_id, ''));
end;
$$;

comment on function public.resolve_user_effective_price(uuid, text) is
  'P43 MEMBER-02 D-03/D-04: returns the Stripe price_id the user should be '
  'charged for plan p_plan. Grandfathered override (most-recent effective_from '
  'per RESEARCH OQ-resolution) wins over stripe_price_lookup default. Returns '
  'NULL if neither match — checkout Edge Fn responds 503 (vendor-gated-send '
  'pattern). cohort_is_member is the existing P27 SECDEF boolean helper that '
  'does not leak cohort contents.';

revoke all on function public.resolve_user_effective_price(uuid, text) from public;
grant execute on function public.resolve_user_effective_price(uuid, text) to authenticated;
