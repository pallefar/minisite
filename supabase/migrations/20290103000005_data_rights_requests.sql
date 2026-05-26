-- Phase 64-01 — Legal Refresh data_rights_requests (DSAR state-flavor log)
-- =============================================================================
--
-- Creates public.data_rights_requests — the state-flavor DSAR request log.
-- Extends the existing Phase 22 DSAR portal (/account/data-rights) with
-- state-residency + per-state request-type variants per D-DSAR-Portal-Extensions.
--
-- Context: The existing DSAR portal writes to `pending_account_deletions` via
-- `initiate_account_deletion_rpc`. This NEW table captures the broader set of
-- state-specific rights requests (access, portability, correction, opt-out,
-- limit_sensitive_use, opt_in_sensitive) that go beyond deletion alone.
--
-- Request type coverage by state (per D-DSAR-Portal-Extensions):
--   CA:     deletion, access, portability, opt_out, limit_sensitive_use
--   VA:     deletion, access, portability, correction, opt_out
--   CO/CT:  deletion, access, portability, correction, opt_out, opt_in_sensitive
--   UT:     deletion, access (no portability under UCPA)
--
-- Trust boundary: authenticated browser → DSAR portal → INSERT (auth-required per UI-SPEC §3).
-- Threat T-64-01-04: SELECT restricted to auth.uid() = user_id or is_staff().
-- Threat T-64-01-06: UPDATE restricted to is_staff() only.
--
-- RLS: DROP IF EXISTS + bare CREATE POLICY (no IF NOT EXISTS — unsupported on
-- remote PG per [[feedback_phase_close_out_supabase_gotchas]]).
--
-- Per [[reference_supabase_back_dated_migration_blocks_push]] — timestamp 20290103+
-- Per [[reference_supabase_is_staff_helper]] — uses public.is_staff() directly.
-- Per [[reference_profiles_email_vs_auth_users_email]] — user_id is FK to auth.users(id).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Table: public.data_rights_requests
--    user_id not null — DSAR portal is auth-required (UI-SPEC §3).
-- ---------------------------------------------------------------------------

create table public.data_rights_requests (
  id              uuid        not null default gen_random_uuid() primary key,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  state_residency text        not null
                    check (state_residency in ('CA','VA','CO','CT','UT','OTHER')),
  request_type    text        not null
                    check (request_type in (
                      'deletion',
                      'access',
                      'portability',
                      'correction',
                      'opt_out',
                      'limit_sensitive_use',
                      'opt_in_sensitive'
                    )),
  details         text,
  status          text        not null default 'pending'
                    check (status in ('pending','in_progress','completed','rejected')),
  submitted_at    timestamptz not null default now(),
  completed_at    timestamptz,
  operator_note   text
);

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------

-- Per-user history sorted newest-first (supports portal "my requests" view)
create index idx_data_rights_requests_user_submitted
  on public.data_rights_requests(user_id, submitted_at desc);

-- Operator admin queue: pending requests scan
create index idx_data_rights_requests_pending
  on public.data_rights_requests(status)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- 3. Enable Row Level Security
-- ---------------------------------------------------------------------------

alter table public.data_rights_requests enable row level security;

-- ---------------------------------------------------------------------------
-- 4. RLS Policies
--    DROP IF EXISTS first for idempotency on re-apply.
--    Bare CREATE POLICY — NO `IF NOT EXISTS`.
-- ---------------------------------------------------------------------------

-- Authenticated users may SELECT their own requests.
-- Staff may SELECT all rows.
drop policy if exists "auth_select_own_data_rights" on public.data_rights_requests;
create policy "auth_select_own_data_rights"
  on public.data_rights_requests
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_staff()
  );

-- Authenticated users may INSERT their own requests.
-- user_id must match auth.uid() — cannot submit on behalf of another user.
drop policy if exists "auth_insert_own_data_rights" on public.data_rights_requests;
create policy "auth_insert_own_data_rights"
  on public.data_rights_requests
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- Staff may UPDATE status + completed_at + operator_note.
-- T-64-01-06: regular users cannot update their own request status to 'completed'.
drop policy if exists "staff_update_data_rights" on public.data_rights_requests;
create policy "staff_update_data_rights"
  on public.data_rights_requests
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

commit;
