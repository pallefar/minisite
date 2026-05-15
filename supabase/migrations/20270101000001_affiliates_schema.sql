-- Phase 19 Plan 01 — Affiliates schema (AFF-01 + AFF-09).
--
-- Spec references:
--   - 19-CONTEXT.md D-05, D-06, D-08, D-16 (template_choice locks)
--   - 19-CONTEXT-ADDENDUM-research.md D-31 (tax_threshold_cents = 50000 default, configurable
--     fraud-reduction policy; not Stripe-platform default)
--   - 19-01-PLAN.md BL-3 (template_choice moved here from 19-08 so 19-08 can depend on 19-01
--     without circular schema ownership; affiliates_public_view ships in 20270101000004)
--   - Pitfall 7: `stripe_payouts_enabled` is webhook-set from `account.updated` (Plan 19-04),
--     NEVER user-set.
--
-- Landmine annotations (reference_supabase_migration_gotchas):
--   - Pitfall 1: Partial-index predicates MUST be IMMUTABLE. `WHERE col IS NULL`, text equality,
--     and IN-list against literals are IMMUTABLE-safe.
--   - Pitfall 2: No SECURITY DEFINER functions in this file. The `set_updated_at` trigger
--     function is plain SQL.
--   - feedback_planner_iter1_anti_patterns: No enum types — text columns with check constraints
--     to avoid enum-add-in-same-tx Postgres pitfall.
--
-- FK retention contract (CONTEXT D-33 step 3 — IRS 7-yr 1099 retention):
--   - affiliates.user_id → auth.users(id) ON DELETE SET NULL (NEVER cascade)
--     Affiliate row survives user deletion; anonymized in account-delete cascade (Plan 19-09).
--   - affiliates.reviewed_by → auth.users(id) ON DELETE SET NULL (operator-history preservation)

-- =============================================================================
-- 1. affiliates table
-- =============================================================================
create table public.affiliates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  email text not null,
  display_name text not null,
  audience_type text not null check (audience_type in ('Instagram','TikTok','YouTube','Newsletter','Coaching','Other')),
  audience_size integer not null check (audience_size >= 0),
  why_us text check (length(why_us) <= 500),
  status text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  referral_code text unique,
  commission_rate_cents integer not null default 1000,
  tax_threshold_cents integer not null default 50000,
  template_choice text not null default 'coach' check (template_choice in ('coach','story','method')),
  stripe_connect_account_id text unique,
  stripe_payouts_enabled boolean not null default false,
  photo_path text,
  blurb text check (length(blurb) <= 50),
  calendly_url text,
  testimonial_quote text check (length(testimonial_quote) <= 200),
  allowed_referer_hosts text[] not null default '{}',
  ip_signup inet,
  fingerprint_signup text,
  applied_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- 2. Partial indexes — IMMUTABLE-safe per reference_supabase_migration_gotchas Pitfall 1
-- =============================================================================
-- Operator queue + suspension review hot paths.
create index idx_affiliates_status on public.affiliates(status) where status in ('pending','suspended');
-- Referral-code lookup (for /r/{code} attribution + signup manual entry).
create index idx_affiliates_referral_code on public.affiliates(referral_code) where referral_code is not null;
-- user_id reverse lookup for /partner/* gating + cascade.
create index idx_affiliates_user_id on public.affiliates(user_id) where user_id is not null;
-- Public landing-page hot path (`/r/{code}/landing` → affiliates_public_view filters status='approved').
create index idx_affiliates_referral_code_approved on public.affiliates(referral_code) where status = 'approved';

-- =============================================================================
-- 3. updated_at trigger — keep updated_at in sync with row mutations.
--    Pattern mirrors set_updated_at from existing audit_logs/page_builder migrations.
-- =============================================================================
create or replace function public.set_affiliates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_affiliates_set_updated_at
  before update on public.affiliates
  for each row execute function public.set_affiliates_updated_at();

-- =============================================================================
-- 4. Enable RLS — policies are defined in 20270101000005_affiliate_rls.sql
-- =============================================================================
alter table public.affiliates enable row level security;
