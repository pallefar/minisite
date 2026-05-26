-- Phase 64-01 — Legal Refresh data layer
-- =============================================================================
--
-- Creates public.ad_targeting_exclusion — the ad-network opt-out exclusion list.
-- Populated by Edge Fn 64-02 (privacy-optout-process) fan-out within 24h of a
-- Do-Not-Sell submission (CCPA 24h SLA per D-Do-Not-Sell-Opt-Out).
--
-- Supports two opt-out paths:
--   - Authenticated: user_id PK; unique-per-user row.
--   - Unauthenticated: user_id is NULL; partial unique index on email (unauth path).
--     Anonymous users who later authenticate are back-filled by Plan 64-02.
--
-- Trust boundary: Edge Fn 64-02 (service role, bypasses RLS) → INSERT.
-- Staff RLS: SELECT/INSERT for admin audit; Edge Fn bypasses via service role.
--
-- Per [[reference_supabase_back_dated_migration_blocks_push]] — timestamp 20290103+
-- Per [[feedback_phase_close_out_supabase_gotchas]] — bare CREATE POLICY, no IF NOT EXISTS.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Table: public.ad_targeting_exclusion
--    user_id PK: one row per authenticated user.
--    email also stored for unauth opt-outs (partial unique index below).
-- ---------------------------------------------------------------------------

create table public.ad_targeting_exclusion (
  user_id     uuid        primary key references auth.users(id) on delete cascade,
  email       text        not null,
  excluded_at timestamptz not null default now(),
  source      text        not null
                check (source in ('do_not_sell','admin','manual'))
);

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------

-- Partial unique index: unauth anonymous opt-outs keyed by email only.
-- Prevents duplicate rows for the same email when user_id is NULL.
-- (user_id PK prevents duplicate rows for authenticated users.)
-- Note: cannot insert a NULL user_id into this table due to PK constraint.
-- The unauth path uses a separate shadow table or email-only dedup via this index
-- when Edge Fn inserts with user_id = null by including a separate unauthenticated
-- exclusion record — user_id column allows NULL only if we remove PK constraint.
-- Plan requirement: support anonymous opt-outs via email-keyed partial unique index.
-- Resolution: drop PK constraint from user_id, use composite approach.

-- Re-create without PK on user_id to support nullable user_id for anon path:
-- (Dropping and recreating inline within this transaction)
alter table public.ad_targeting_exclusion drop constraint ad_targeting_exclusion_pkey;

-- Add surrogate PK
alter table public.ad_targeting_exclusion
  add column id uuid not null default gen_random_uuid();

alter table public.ad_targeting_exclusion
  add primary key (id);

-- Unique constraint for authenticated users (one row per user_id)
create unique index ad_targeting_exclusion_user_uq
  on public.ad_targeting_exclusion(user_id)
  where user_id is not null;

-- Unique constraint for unauthenticated opt-outs (one row per email when no user_id)
create unique index ad_targeting_exclusion_email_unauth_uq
  on public.ad_targeting_exclusion(email)
  where user_id is null;

-- ---------------------------------------------------------------------------
-- 3. Enable Row Level Security
-- ---------------------------------------------------------------------------

alter table public.ad_targeting_exclusion enable row level security;

-- ---------------------------------------------------------------------------
-- 4. RLS Policies — staff only (Edge Fn uses service role, bypasses RLS).
--    DROP IF EXISTS first for idempotency.
-- ---------------------------------------------------------------------------

drop policy if exists "staff_select_ad_targeting_exclusion" on public.ad_targeting_exclusion;
create policy "staff_select_ad_targeting_exclusion"
  on public.ad_targeting_exclusion
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "staff_insert_ad_targeting_exclusion" on public.ad_targeting_exclusion;
create policy "staff_insert_ad_targeting_exclusion"
  on public.ad_targeting_exclusion
  for insert
  to authenticated
  with check (public.is_staff());

commit;
