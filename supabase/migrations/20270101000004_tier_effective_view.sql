-- Phase 19 Plan 01 — tier_effective view + affiliates_public_view (D-01..D-04 + BL-3).
--
-- Spec references:
--   - 19-CONTEXT.md D-01..D-04 (cross-provider tier reconciliation; security_invoker=true)
--   - 19-01-PLAN.md BL-3 (affiliates_public_view moved here from 19-08 so 19-08 can depend on
--     19-01 without circular schema ownership)
--   - Supabase database-advisors lint 0010_security_definer_view: views MUST be created with
--     `security_invoker=true` to honor caller's RLS at query time.
--
-- D-03 (security): No SECURITY DEFINER views/functions in this file. Both views use
--   `WITH (security_invoker = true)` so they inherit per-row RLS from the underlying tables.
--
-- Cross-phase contract (D-04): When Phase 16 Plan 16-06 resumes, it inserts rows with
--   provider='revenuecat' into public.subscriptions. The tier_effective view immediately
--   returns MAX(current_period_end) across both providers with zero changes here.

-- =============================================================================
-- View 1: tier_effective — MAX(current_period_end) per user_id across providers (MONEY-07)
-- =============================================================================
-- The `winning_provider` column resolves to whichever provider has the latest
-- current_period_end (NULL-last so rows without an expiry don't win silently).
create or replace view public.tier_effective
  with (security_invoker = true)
as
select
  user_id,
  max(current_period_end) as effective_period_end,
  bool_or(status in ('active','trialing')) as has_active,
  bool_or(status in ('past_due','unpaid')) as has_past_due,
  (array_agg(provider order by current_period_end desc nulls last))[1] as winning_provider
from public.subscriptions
where user_id is not null
group by user_id;

comment on view public.tier_effective is
  'MONEY-07: unifies Stripe + RevenueCat subscriptions via MAX(current_period_end). '
  'security_invoker=true honors per-row RLS — caller only sees their own subscription rows.';

grant select on public.tier_effective to authenticated;

-- =============================================================================
-- View 2: affiliates_public_view — anon-readable approved-affiliate slice (BL-3 / AFF-09)
-- =============================================================================
-- Exposes EXACTLY 8 non-PII columns. PII columns (email, audience_size, ip_signup,
-- fingerprint_signup, commission_rate_cents, tax_threshold_cents, stripe_connect_account_id,
-- stripe_payouts_enabled, status, etc.) MUST NOT appear in this view.
--
-- The WHERE status='approved' filter is enforced both here AND at the underlying RLS policy
-- pol_affiliates_public_landing_read (defined in 20270101000005_affiliate_rls.sql).
create or replace view public.affiliates_public_view
  with (security_invoker = true)
as
select
  id,
  display_name,
  photo_path,
  blurb,
  calendly_url,
  testimonial_quote,
  template_choice,
  referral_code
from public.affiliates
where status = 'approved';

comment on view public.affiliates_public_view is
  'AFF-09 / BL-3: public-readable approved-affiliate slice for /r/{code}/landing page. '
  'security_invoker=true so the view inherits RLS from the underlying table; the '
  'WHERE status=''approved'' filter is enforced here for clarity even though RLS would also '
  'handle it via pol_affiliates_public_landing_read.';

grant select on public.affiliates_public_view to anon, authenticated;
