-- Phase 64-01 — Legal Refresh data layer
-- =============================================================================
--
-- Creates public.privacy_optout_requests — the Do-Not-Sell / opt-out form
-- persistence table. Auth is optional: unauthenticated users may submit a
-- Do-Not-Sell request (UI-SPEC §2 "auth-optional public page").
--
-- Trust boundary: anonymous browser → form POST → INSERT here.
-- Threat T-64-01-01 (Tampering): INSERT-only for anon; CHECK constraints
--   enforce valid state_residency + opt_out_scope.
-- Threat T-64-01-02 (Spoofing): Plan 64-02 confirmation email round-trips
--   email ownership; only confirmed opt-outs propagate fan-out.
-- Threat T-64-01-03 (Repudiation): submitted_at + request_ip/UA captured by Fn.
--
-- RLS: DROP IF EXISTS + bare CREATE POLICY (no IF NOT EXISTS — unsupported on
-- remote PG per [[feedback_phase_close_out_supabase_gotchas]]).
--
-- Per [[reference_supabase_back_dated_migration_blocks_push]] — timestamp 20290103+
-- Per [[reference_profiles_email_vs_auth_users_email]] — email source is auth.users,
--   not public.profiles (profiles has no email column).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Table: public.privacy_optout_requests
--    user_id nullable — Do-Not-Sell form is auth-optional (UI-SPEC §2).
-- ---------------------------------------------------------------------------

create table public.privacy_optout_requests (
  id                         uuid        not null default gen_random_uuid() primary key,
  user_id                    uuid        references auth.users(id) on delete set null,
  email                      text        not null,
  name                       text        not null,
  state_residency            text        not null
                               check (state_residency in ('CA','VA','CO','CT','UT','OTHER')),
  opt_out_scope              text[]      not null
                               check (
                                 cardinality(opt_out_scope) between 1 and 3
                                 and opt_out_scope <@ array['advertising','sale','sharing']
                               ),
  submitted_at               timestamptz not null default now(),
  propagated_at              timestamptz,          -- null until fan-out completes (Plan 64-02)
  confirmation_email_sent_at timestamptz,
  request_ip                 text,
  request_user_agent         text
);

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------

-- Lookup by email for deduplication + confirmation round-trip
create index idx_privacy_optout_requests_email
  on public.privacy_optout_requests(email);

-- Lookup by authenticated user_id (partial — skips unauth rows)
create index idx_privacy_optout_requests_user_id
  on public.privacy_optout_requests(user_id)
  where user_id is not null;

-- Admin/cron scan for recent submissions (newest-first)
create index idx_privacy_optout_requests_submitted
  on public.privacy_optout_requests(submitted_at desc);

-- ---------------------------------------------------------------------------
-- 3. Enable Row Level Security
-- ---------------------------------------------------------------------------

alter table public.privacy_optout_requests enable row level security;

-- ---------------------------------------------------------------------------
-- 4. RLS Policies
--    DROP IF EXISTS first for idempotency on re-apply.
--    Bare CREATE POLICY — NO `IF NOT EXISTS`.
-- ---------------------------------------------------------------------------

-- Anonymous users may submit (INSERT) a Do-Not-Sell request.
-- No UPDATE or DELETE for anon (T-64-01-01 mitigation).
drop policy if exists "anon_insert_privacy_optout" on public.privacy_optout_requests;
create policy "anon_insert_privacy_optout"
  on public.privacy_optout_requests
  for insert
  to anon
  with check (true);

-- Authenticated users may also INSERT.
drop policy if exists "auth_insert_privacy_optout" on public.privacy_optout_requests;
create policy "auth_insert_privacy_optout"
  on public.privacy_optout_requests
  for insert
  to authenticated
  with check (true);

-- Authenticated users may SELECT their own rows (matched by user_id or email).
-- T-64-01-04: other users cannot read another user's opt-out request.
drop policy if exists "auth_select_own_privacy_optout" on public.privacy_optout_requests;
create policy "auth_select_own_privacy_optout"
  on public.privacy_optout_requests
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or email = (select email from auth.users where id = auth.uid())
  );

-- Staff: full SELECT + UPDATE (propagated_at, confirmation_email_sent_at).
-- T-64-01-06: UPDATE restricted to is_staff() — not row-ownership.
drop policy if exists "staff_select_privacy_optout" on public.privacy_optout_requests;
create policy "staff_select_privacy_optout"
  on public.privacy_optout_requests
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "staff_update_privacy_optout" on public.privacy_optout_requests;
create policy "staff_update_privacy_optout"
  on public.privacy_optout_requests
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

commit;
