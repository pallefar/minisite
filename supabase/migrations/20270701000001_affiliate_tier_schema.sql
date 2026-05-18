-- Phase 26 Plan 01 — Affiliate tier schema (D-15).
--
-- Adds tier classification + ratchet bookkeeping + freeze columns to the existing
-- public.affiliates table (shipped Phase 19, 20270101000001_affiliates_schema.sql).
--
-- D-15 / Pitfall 3 (RESEARCH): NEVER use Postgres enum types here. Always
-- `text not null check (...)` so future ALTER drop+readd works inside a single tx.
-- Pitfall 1 ([[reference_supabase_migration_gotchas]]): partial-index predicates
-- MUST be IMMUTABLE. `WHERE tier = 'lifetime' AND frozen_at IS NULL` is two
-- equality-to-literal clauses — both IMMUTABLE-safe.
--
-- Columns added:
--   tier                  text NOT NULL default 'standard' check in ('standard','gold','lifetime')
--   tier_promoted_at      timestamptz nullable — set by promotion trigger + admin RPCs
--   tier_grantor_user_id  uuid  → auth.users(id) on delete set null  — operator audit trail
--   frozen_at             timestamptz nullable — fraud freeze marker (D-04)
--   freeze_reason         text nullable        — fraud freeze reason
--
-- Hot path: idx_affiliates_lifetime supports the monthly recurring-payment cron
-- in Plan 26-06 (filters affiliates currently lifetime + not frozen).
--
-- Idempotent: `add column if not exists` + `create index if not exists` make
-- re-running `supabase db push` a no-op.

alter table public.affiliates
  add column if not exists tier text not null default 'standard'
    check (tier in ('standard','gold','lifetime'));

alter table public.affiliates
  add column if not exists tier_promoted_at timestamptz;

alter table public.affiliates
  add column if not exists tier_grantor_user_id uuid
    references auth.users(id) on delete set null;

alter table public.affiliates
  add column if not exists frozen_at timestamptz;

alter table public.affiliates
  add column if not exists freeze_reason text;

-- Partial index for the monthly recurring-payment cron's hot path (Plan 26-06).
-- IMMUTABLE-safe per Pitfall 1: both predicates are equality-to-literal.
create index if not exists idx_affiliates_lifetime
  on public.affiliates(id)
  where tier = 'lifetime' and frozen_at is null;
