-- Phase 64-01 — Legal Refresh data layer
-- =============================================================================
--
-- Creates public.email_lifecycle_exclusion — the email-lifecycle opt-out list.
-- Populated by Edge Fn 64-02 (privacy-optout-process) fan-out as part of the
-- Do-Not-Sell / unsubscribe flow (Phase 60 newsletter pattern).
--
-- Dual-key idempotency:
--   - Authenticated opt-outs: partial unique index on (user_id) where user_id not null.
--   - Unauthenticated opt-outs: partial unique index on (email) where user_id is null.
--   Both paths prevent duplicate exclusion rows per [[D-Do-Not-Sell-Opt-Out]].
--
-- Trust boundary: Edge Fn 64-02 (service role, bypasses RLS) → INSERT.
-- RLS: staff + service-role only (no user-facing read — exclusion is internal state).
--
-- Per [[reference_supabase_back_dated_migration_blocks_push]] — timestamp 20290103+
-- Per [[feedback_phase_close_out_supabase_gotchas]] — bare CREATE POLICY, no IF NOT EXISTS.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Table: public.email_lifecycle_exclusion
--    Surrogate PK (id) + two partial unique indexes for dual-path idempotency.
--    Postgres does not support coalesce() in PRIMARY KEY definition directly,
--    so we use id PK + UNIQUE WHERE partial indexes instead.
-- ---------------------------------------------------------------------------

create table public.email_lifecycle_exclusion (
  id          uuid        not null default gen_random_uuid() primary key,
  user_id     uuid        references auth.users(id) on delete cascade,
  email       text        not null,
  excluded_at timestamptz not null default now(),
  source      text        not null
                check (source in ('do_not_sell','unsubscribe','admin'))
);

-- ---------------------------------------------------------------------------
-- 2. Indexes — dual-key idempotency via partial unique indexes
-- ---------------------------------------------------------------------------

-- Authenticated path: exactly one row per user_id (when user is known)
create unique index email_lifecycle_exclusion_user_uq
  on public.email_lifecycle_exclusion(user_id)
  where user_id is not null;

-- Unauthenticated path: exactly one row per email (when no user_id)
create unique index email_lifecycle_exclusion_email_uq
  on public.email_lifecycle_exclusion(email)
  where user_id is null;

-- ---------------------------------------------------------------------------
-- 3. Enable Row Level Security
-- ---------------------------------------------------------------------------

alter table public.email_lifecycle_exclusion enable row level security;

-- ---------------------------------------------------------------------------
-- 4. RLS Policies — staff only (Edge Fn uses service role, bypasses RLS).
--    DROP IF EXISTS first for idempotency.
-- ---------------------------------------------------------------------------

drop policy if exists "staff_select_email_lifecycle_exclusion" on public.email_lifecycle_exclusion;
create policy "staff_select_email_lifecycle_exclusion"
  on public.email_lifecycle_exclusion
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "staff_insert_email_lifecycle_exclusion" on public.email_lifecycle_exclusion;
create policy "staff_insert_email_lifecycle_exclusion"
  on public.email_lifecycle_exclusion
  for insert
  to authenticated
  with check (public.is_staff());

commit;
