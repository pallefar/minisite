-- Phase 27 Plan 27-01 D-01/D-23 (ADMIN-04 bulk-action job ledger).
--
-- Creates `public.admin_bulk_jobs`: an append-only table that records every
-- bulk action an admin executes against the Members table. The synchronous
-- (≤100-row) branch of admin_bulk_action_execute does NOT insert here — it
-- writes per-row audit_logs entries inline. This table services the >100-row
-- branch where the worker (Plan 27-06) claims pending rows and drains them
-- in the background.
--
-- Companion migrations (shipped in the same plan):
--   20270602000002_bulk_action_undo_token.sql           — 60s undo token TTL table
--   20270602000003_admin_bulk_actions_extend_audit.sql  — docs-only audit-name catalog
--   20270602000004_admin_bulk_action_rpcs.sql           — SECDEF execute + undo RPCs
--   20270602000005_admin_bulk_actions_target_columns.sql — profiles.account_state/tags + grants table
--
-- Append-only tampering mitigation (Pattern S2):
--   - RLS enabled.
--   - SELECT policy restricts to requested_by = auth.uid().
--   - NO insert/update/delete policy for the authenticated role.
--   - Only the SECDEF RPC (admin_bulk_action_execute) and service_role write.
--
-- Status enum encoded as text + CHECK constraint per Pitfall 3 of
-- [[feedback_planner_iter1_anti_patterns]] (avoid pg_enum migration friction).
-- Partial index on status='pending' is IMMUTABLE-safe per
-- [[reference_supabase_migration_gotchas]].

create table public.admin_bulk_jobs (
  id              uuid primary key default gen_random_uuid(),
  action_type     text not null check (action_type in (
    'csv_export', 'tag', 'comp_plan', 'ban', 'force_password_reset'
  )),
  -- Reserved for future filter-based selection (D-05 cohort filters); v1 keeps it null.
  target_filter   jsonb,
  -- Explicit user-id selection used by the sync path; ALSO used by the async worker
  -- (Plan 27-06) when the admin chooses "all matching" >100 rows.
  target_user_ids uuid[] not null default '{}'::uuid[],
  requested_by    uuid not null references auth.users(id) on delete set null,
  status          text not null default 'pending'
                    check (status in ('pending','running','completed','failed')),
  rows_total      integer not null,
  rows_completed  integer not null default 0,
  error_log       jsonb not null default '[]'::jsonb,
  -- claimed_* set by the async worker when it dequeues a pending row
  claimed_by      uuid references auth.users(id),
  claimed_at      timestamptz,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

-- Worker queue lookup (partial = IMMUTABLE: status literal comparison).
create index idx_admin_bulk_jobs_pending
  on public.admin_bulk_jobs (created_at)
  where status = 'pending';

-- Per-admin recent-jobs listing.
create index idx_admin_bulk_jobs_requested_by
  on public.admin_bulk_jobs (requested_by, created_at desc);

alter table public.admin_bulk_jobs enable row level security;

-- SELECT: admin sees only their own jobs (D-23).
create policy "admin_bulk_jobs_select_own"
  on public.admin_bulk_jobs
  for select
  using (auth.uid() = requested_by);

-- Admin-at-least-admin can read ALL jobs for support investigations.
create policy "admin_bulk_jobs_select_admin"
  on public.admin_bulk_jobs
  for select
  using (public.is_admin_at_least('admin'::public.admin_role));

-- TAMPERING MITIGATION (STRIDE-T, threat T-27-01-02):
-- No INSERT/UPDATE/DELETE policies are created for the authenticated role.
-- Postgres RLS default-deny means any direct write attempt from a JWT-scoped
-- client returns 42501 / "violates row-level security". ONLY two write paths
-- exist:
--   1. The SECDEF admin_bulk_action_execute / async-worker RPC, which runs as
--      the function owner (postgres) and bypasses RLS by design.
--   2. The service_role JWT used by the async worker Edge Function (Plan 27-06).
--
-- Do NOT add INSERT/UPDATE/DELETE policies for authenticated; doing so would
-- defeat the append-only Tampering protection.

comment on table public.admin_bulk_jobs is
  'Phase 27 ADMIN-04: bulk-action job ledger. Sync path (≤100 rows) does NOT '
  'write here; async worker (Plan 27-06) claims rows where status=pending. '
  'Append-only via RLS — authenticated cannot write.';
