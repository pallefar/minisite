-- =============================================================================
-- Plan 29-00 RECONCILE — Wave 0 prerequisite for Phase 29
--
-- PRE-FLIGHT AUDIT (captured 2026-05-17 via supabase db query --linked):
--   org_subs_table    = "org_subscriptions"  -- EXISTS (P28 deny-all skeleton)
--   has_seats_paid    = false                 -- ABSENT on subscriptions
--   has_seats_used    = false                 -- ABSENT on subscriptions
--   has_primary_org_id = false                -- ABSENT on profiles
--
-- REFERENCES:
--   CONTEXT A1  — DROP public.org_subscriptions (P28 deny-all skeleton, zero rows,
--                 zero data loss); extend Phase 14 public.subscriptions as canonical.
--   CONTEXT D-09 — ADD profiles.primary_org_id uuid references organizations(id)
--                 ON DELETE SET NULL; patient default workspace context.
--   CONTEXT D-10 — This Plan 29-00 RECONCILE migration ships as the Wave 0
--                 single-file migration covering all schema prerequisites.
--
-- BREAKING CHANGE:
--   public.org_subscriptions DROPPED — downstream callers MUST use
--   public.subscriptions WHERE clinic_id IS NOT NULL for clinic subscriptions.
--   Phase 14 subscriptions table is canonical going forward.
--
-- ROLLBACK NOTE:
--   No rollback path — DROP TABLE is irreversible. If rollback needed,
--   restore from Supabase snapshot. Phase 14 public.subscriptions is canonical;
--   org_subscriptions was always a P28 deny-all skeleton with zero data.
-- =============================================================================

begin;

-- =============================================================================
-- 1. DROP public.org_subscriptions (P28 deny-all skeleton, zero rows)
--    CASCADE drops the associated RLS policies on the table.
-- =============================================================================
drop table if exists public.org_subscriptions cascade;

-- =============================================================================
-- 2. Extend public.subscriptions with seats_* columns for clinic metered billing
--    (Phase 14 XOR check constraint already supports clinic_id IS NOT NULL rows)
-- =============================================================================
alter table public.subscriptions
  add column if not exists seats_paid integer not null default 0;

alter table public.subscriptions
  add column if not exists seats_used integer not null default 0;

comment on column public.subscriptions.seats_paid is
  'P29 — seat capacity for clinic metered billing; deprecates org_subscriptions.seats_paid';

comment on column public.subscriptions.seats_used is
  'P29 — active-seat usage for clinic metered billing; deprecates org_subscriptions.seats_used';

-- =============================================================================
-- 3. Add profiles.primary_org_id (D-09)
--    Patient default workspace context. Set by accept_org_patient_invite RPC (Plan 29-05).
--    Null = consumer user (no org). Multiple org membership supported in future;
--    primary_org_id is the default workspace loaded at sign-in.
-- =============================================================================
alter table public.profiles
  add column if not exists primary_org_id uuid
    references public.organizations(id) on delete set null;

comment on column public.profiles.primary_org_id is
  'P29 D-09 — patient default workspace context. Set by accept_org_patient_invite RPC (Plan 29-05). Null = consumer user (no org).';

-- Partial index on primary_org_id for efficient org-member lookups.
-- Predicate `WHERE primary_org_id IS NOT NULL` is IMMUTABLE-safe (column IS NULL
-- predicate has no functions or time references per reference_supabase_migration_gotchas).
create index if not exists profiles_primary_org_id_idx
  on public.profiles(primary_org_id)
  where primary_org_id is not null;

-- =============================================================================
-- 4. Add (user_id, created_at) composite indexes on the 5 event tables that
--    currently only have (user_id, date desc) indexes (RESEARCH Pitfall 6).
--    These indexes are required by the count_active_patients() UNION query in
--    Plan 29-01 which uses `created_at > now() - interval '30 days'` predicates.
--    Predicate-free indexes: IMMUTABLE-safe (no functions in index expression).
-- =============================================================================
create index if not exists mood_user_id_created_at_idx
  on public.mood(user_id, created_at);

create index if not exists sleep_user_id_created_at_idx
  on public.sleep(user_id, created_at);

create index if not exists symptoms_user_id_created_at_idx
  on public.symptoms(user_id, created_at);

create index if not exists photos_user_id_created_at_idx
  on public.photos(user_id, created_at);

create index if not exists vials_user_id_created_at_idx
  on public.vials(user_id, created_at);

commit;
