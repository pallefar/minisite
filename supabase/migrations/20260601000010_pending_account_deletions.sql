-- Phase 7 D-03 (account-delete 30-day soft-delete bookkeeping).
-- Plan 07-07 / COMPL-06.
--
-- Single-row-per-user table tracking pending deletes. The T+30 finalize cron
-- (20260601000013) reads `initiated_at + interval '30 days' <= now()` and
-- invokes finalize_account_deletion (20260601000012).
--
-- STRIDE register (full text in 07-07-PLAN.md `<threat_model>`):
--   T-07-07-T2 Tampering: authenticated role has NO INSERT/UPDATE/DELETE
--     policy on this table. The absence of write policies IS the mitigation
--     (default-deny). The only legitimate writers are:
--       1. public.initiate_account_deletion() — SECURITY DEFINER RPC.
--       2. public.finalize_account_deletion() — SECURITY DEFINER (deletes via
--          auth.users cascade — this table is the cascade child, not directly
--          deleted by the function).
--       3. service_role JWT (bypasses RLS by Supabase convention).
--   T-07-07-I1 Information disclosure: SELECT policy is scoped to
--     `auth.uid() = user_id` so user A cannot see user B's pending row.
--     Cross-tenant proof in e2e/rls-pending-account-deletions.test.ts.

create table public.pending_account_deletions (
  -- FK on delete cascade — when finalize_account_deletion() deletes the
  -- auth.users row at T+30, this row is purged automatically. user_id is also
  -- the PK so a user can only have one pending deletion at a time (idempotent
  -- double-click guard inside the RPC raises P0008 if a row already exists).
  user_id uuid primary key references auth.users(id) on delete cascade,

  -- T+0 timestamp; the cron worker validates `initiated_at + interval '30 days' <= now()`.
  initiated_at timestamptz not null default now(),

  -- Set by initiate_account_deletion() AFTER the storage.objects rename
  -- succeeds. Nullable so a partial-failure path (RPC raised mid-flight) is
  -- inspectable post-mortem.
  photos_moved_at timestamptz,

  -- Cron worker increments on per-row finalize failure (the finalize fn
  -- catches `when others` and increments before re-raising). The cron's
  -- selector filters `finalize_attempts < 5` so stuck rows do not block the
  -- queue forever — they get surfaced to ops at attempt 5.
  finalize_attempts int not null default 0
);

alter table public.pending_account_deletions enable row level security;

-- Owner-only read: SettingsPage can show "Your account will be deleted on X"
-- by selecting their own row. RLS silently filters cross-tenant — user B's
-- SELECT for user A's row returns [] (not 403).
create policy "pending_account_deletions_select_own"
  on public.pending_account_deletions
  for select to authenticated
  using (auth.uid() = user_id);

-- TAMPERING MITIGATION (T-07-07-T2):
-- NO INSERT, UPDATE, or DELETE policy exists for the authenticated role.
-- Direct write attempts from a JWT-scoped client return 42501 /
-- "violates row-level security". Verified in
-- e2e/rls-pending-account-deletions.test.ts (assertions 2-4).
-- DO NOT add write policies here.

-- Partial index for the cron worker — only rows still eligible for finalize
-- need to be scanned at 04:00 UTC. Indexes on `initiated_at` directly (NOT
-- on the expression `initiated_at + interval '30 days'` — adding an interval
-- to a timestamptz is not IMMUTABLE in Postgres, so the expression form is
-- rejected with SQLSTATE 42P17). The cron's WHERE clause
-- `initiated_at + interval '30 days' <= now()` is rewriteable as
-- `initiated_at <= now() - interval '30 days'`, which uses this index for a
-- range scan. Partial filter on finalize_attempts<5 keeps stuck rows out of
-- the scan set so the queue cannot be blocked indefinitely.
create index pending_account_deletions_shred_idx
  on public.pending_account_deletions (initiated_at)
  where finalize_attempts < 5;
