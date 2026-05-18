-- Phase 27 Plan 27-01 — schema dependencies the 5 bulk action types mutate.
--
-- The Phase 27 CONTEXT D-04 + D-06 reference fields and tables that have not
-- yet been added by earlier phases:
--   - profiles.account_state ('active'|'banned'|'comp'|'past_due')  — D-06 cohort field
--   - profiles.tags text[]                                          — bulk_tag target
--   - public.comp_plan_grants                                        — bulk_comp_plan ledger
--   - public.password_reset_requests                                 — bulk_force_password_reset queue
--
-- This migration ships the minimum schema the bulk RPCs require to mutate
-- profiles + write per-row audit_logs entries. Cohort filter integration
-- (D-06 `account_state` matview column) is owned by Plan 27-02.
--
-- All three new tables are nullable / default-friendly so existing profiles
-- rows remain valid without backfill.

-- ---------------------------------------------------------------------------
-- 1. profiles.account_state + tags
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists account_state text not null default 'active'
    check (account_state in ('active', 'banned', 'comp', 'past_due')),
  add column if not exists tags text[] not null default '{}'::text[];

-- Banned-user lookup (rare; supports admin/queries; partial index keeps it cheap).
create index if not exists idx_profiles_account_state_banned
  on public.profiles (id) where account_state = 'banned';

-- Tag-membership lookup uses GIN (multi-value containment queries).
create index if not exists idx_profiles_tags_gin
  on public.profiles using gin (tags);

-- ---------------------------------------------------------------------------
-- 2. comp_plan_grants — append-only grant ledger for bulk_comp_plan
-- ---------------------------------------------------------------------------
create table if not exists public.comp_plan_grants (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  days          integer not null check (days > 0 and days <= 3650),
  granted_by    uuid references auth.users(id) on delete set null,
  granted_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,  -- set by the undo RPC; absence = active grant
  reason        text
);

create index if not exists idx_comp_plan_grants_user_active
  on public.comp_plan_grants (user_id, expires_at)
  where revoked_at is null;

alter table public.comp_plan_grants enable row level security;

-- Users can see their OWN grants (e.g. for "your trial expires …" surfaces).
create policy "comp_plan_grants_select_own"
  on public.comp_plan_grants
  for select
  using (auth.uid() = user_id);

-- Admins read all for support.
create policy "comp_plan_grants_select_admin"
  on public.comp_plan_grants
  for select
  using (public.is_admin_at_least('admin'::public.admin_role));

-- Append-only via RLS — only the SECDEF RPC writes (T-27-01-02).

-- ---------------------------------------------------------------------------
-- 3. password_reset_requests — queue for bulk_force_password_reset
-- ---------------------------------------------------------------------------
-- Phase 27 deliberately leaves auth.users password-mutation to the existing
-- Supabase auth-API flow. This table tracks "admin requested a forced reset"
-- events so a downstream Edge Function (out of scope for v1) can email the
-- reset links. The Phase 27-01 RPC inserts a row here per affected user.
create table if not exists public.password_reset_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  requested_by    uuid references auth.users(id) on delete set null,
  reason          text not null default 'admin_forced_reset',
  status          text not null default 'queued'
                    check (status in ('queued','sent','delivered','failed')),
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_password_reset_requests_queued
  on public.password_reset_requests (created_at)
  where status = 'queued';

alter table public.password_reset_requests enable row level security;

create policy "password_reset_requests_select_own"
  on public.password_reset_requests
  for select
  using (auth.uid() = user_id);

create policy "password_reset_requests_select_admin"
  on public.password_reset_requests
  for select
  using (public.is_admin_at_least('admin'::public.admin_role));

comment on table public.comp_plan_grants is
  'Phase 27 ADMIN-04: complimentary Pro grants. Append-only (RLS); undo sets revoked_at.';

comment on table public.password_reset_requests is
  'Phase 27 ADMIN-04: queue for admin-forced password resets. Email send is out of scope for v1 (background worker).';
