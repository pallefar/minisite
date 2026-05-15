-- Phase 19 Plan 19-04 Task 3 (BL-1 / D-23) — feature_flags table.
--
-- A tiny key-value flag store backing the v1.2 "manual referral-code entry on
-- signup" web-fallback (D-23). Defaults OFF; admins flip via direct SQL UPDATE
-- in v1.2 (Phase 22 ADMIN-06 will surface a toggle UI later, see 19-CONTEXT
-- cross-phase contracts).
--
-- Non-goals (deferred):
--   - Per-user / per-cohort targeting → out of scope; this is a global flag.
--   - History / audit of flips → out of scope; admins can JOIN audit_logs if
--     they wrap the UPDATE in a Phase 22 admin RPC.
--   - Real-time push to clients → out of scope; clients load flags ONCE at app
--     boot (Map cache + pub/sub) and a flip requires a reload to take effect.
--
-- Landmine annotations (reference_supabase_migration_gotchas):
--   - Pitfall 1 (partial-index IMMUTABLE) — N/A, no partial indexes here.
--   - Pitfall 2 (SECURITY DEFINER search_path) — N/A, no functions defined.
--   - feedback_planner_iter1_anti_patterns Postgres DDL pitfall — table +
--     policies + seed live in one transaction; no enum-add-in-same-tx, all
--     forward-refs resolved (is_staff() ships in 20261101000006).

-- =============================================================================
-- 1. feature_flags table
-- =============================================================================
create table if not exists public.feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text,
  updated_at timestamptz not null default now()
);

comment on table public.feature_flags is
  'Phase 19 Plan 19-04 (D-23): global feature-flag store. Default OFF; admins flip via Phase 22 admin UI (or direct SQL in v1.2).';

-- =============================================================================
-- 2. updated_at trigger — mirror the affiliates pattern.
-- =============================================================================
create or replace function public.set_feature_flags_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_feature_flags_set_updated_at on public.feature_flags;
create trigger trg_feature_flags_set_updated_at
  before update on public.feature_flags
  for each row execute function public.set_feature_flags_updated_at();

-- =============================================================================
-- 3. RLS — authenticated read; staff write (Phase 22 admin gate).
-- =============================================================================
alter table public.feature_flags enable row level security;

-- Idempotent policy drops (Phase 19 RLS pattern — re-runnable migration).
drop policy if exists pol_feature_flags_authenticated_read on public.feature_flags;
drop policy if exists pol_feature_flags_staff_write on public.feature_flags;

-- Any signed-in user can read flag state. Values are intentionally non-sensitive
-- (they're product gates, not secrets — a leaked flag list is no worse than the
-- corresponding UI being visible in shipped JS).
create policy pol_feature_flags_authenticated_read on public.feature_flags
  for select to authenticated
  using (true);

-- Only staff can toggle flags. `is_staff()` ships in 20261101000006 (Phase 15).
create policy pol_feature_flags_staff_write on public.feature_flags
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- =============================================================================
-- 4. Seed — aff_manual_entry default OFF.
-- =============================================================================
insert into public.feature_flags (key, enabled, description)
values (
  'aff_manual_entry',
  false,
  'AFF-05 / D-23: web fallback for direct signups carrying a referral code from outside the cookie path. Default OFF; admin enables per campaign. When ON, SignUpForm renders a referral-code Input; the value is propagated to stripe-checkout via ?aff_manual=<code>.'
)
on conflict (key) do nothing;
