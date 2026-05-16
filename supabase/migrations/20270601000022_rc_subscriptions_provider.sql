-- Phase 16 Plan 06 — MONEY-06 — RevenueCat provider discriminator (NO-OP migration).
--
-- ============================================================================
-- DEVIATION NOTE (Rule 1) — Phase 19 shipped this schema first.
-- ============================================================================
-- The original 16-06 plan called for adding:
--   • subscription_events.provider text column + CHECK constraint
--   • Partial unique index on subscriptions(user_id, provider)
--
-- BOTH already exist in production on project ytnsipxxmzgaebkqmokp, shipped by
-- Phase 19 (Plan 19-01 ahead-of-schedule via cross-phase contract D-04):
--   • subscription_events.provider text default 'stripe' — present
--   • CHECK (provider in ('stripe','revenuecat')) — present
--   • idx_subscriptions_user_provider_unique (UNIQUE, partial, IMMUTABLE
--     predicate `user_id IS NOT NULL`) — present
--
-- This file is kept as a defensive idempotency-only migration so a fresh DB
-- (new dev clone, CI seed, disaster recovery) can re-apply the schema cleanly
-- without depending on Phase 19 migration ordering. Every DDL is `IF NOT EXISTS`
-- or wrapped in a DO block that no-ops on existing objects.
--
-- Renumber: 20270101* → 20270601000022 (above live registry's highest applied
-- 20270601000021) per reference_supabase_migration_filename_regex to avoid the
-- silent CLI-skip trap.

-- ─── 1. subscription_events.provider column (no-op if exists) ────────────────
alter table public.subscription_events
  add column if not exists provider text not null default 'stripe';

-- ─── 2. CHECK constraint via DO block (no-op if exists) ──────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'subscription_events_provider_check'
      and conrelid = 'public.subscription_events'::regclass
  ) then
    alter table public.subscription_events
      add constraint subscription_events_provider_check
      check (provider in ('stripe','revenuecat'));
  end if;
end $$;

-- ─── 3. Per-provider event-stream index (no-op if exists) ────────────────────
create index if not exists idx_subscription_events_provider_received
  on public.subscription_events(provider, received_at desc);

-- ─── 4. Partial unique index on subscriptions(user_id, provider) ─────────────
-- Enables RevenueCat webhook upsert via { onConflict: 'user_id,provider' }.
-- Stripe rows with user_id IS NULL (clinic subs) remain unique only by id PK.
-- Predicate `user_id IS NOT NULL` is IMMUTABLE (column-only, no functions).
create unique index if not exists idx_subscriptions_user_provider_unique
  on public.subscriptions(user_id, provider)
  where user_id is not null;
