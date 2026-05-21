-- Phase 35 Plan 35-04 — leaderboard_optin table + handle validation + RLS.
--
-- Decision references:
--   - D-12: Opt-IN default (privacy-default). User does NOT appear on any
--     leaderboard until they explicitly opt-in via Settings → Leaderboards.
--   - D-13: User-chosen anonymized handle. Regex ^[a-zA-Z0-9_-]{6,24}$
--     rejects spaces, diacritics, real-name shapes. Uniqueness scoped per cohort.
--   - D-15: Opt-out within one refresh cycle. active=false; next 15-min
--     leaderboard_matview refresh excludes the row.
--
-- RLS design: user reads own row; all mutations go through set_leaderboard_optin
-- SECDEF RPC (Task 3 / 20270708000014). No INSERT/UPDATE/DELETE policies for
-- authenticated — defense-in-depth even if a developer adds a policy in a future
-- migration, the SECDEF still validates handle + cohort membership.

create table public.leaderboard_optin (
  user_id      uuid not null references auth.users(id) on delete cascade,
  cohort_id    uuid not null references public.cohort_definitions(id) on delete cascade,
  handle       text not null,
  active       boolean not null default true,
  opted_in_at  timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, cohort_id),
  -- D-13: handle regex — alphanumeric + dash/underscore, 6-24 chars;
  -- rejects spaces, diacritics, real-name shapes
  constraint leaderboard_optin_handle_format check (handle ~ '^[a-zA-Z0-9_-]{6,24}$')
);

-- D-13: per-cohort handle uniqueness (only enforced when active=true to allow
-- re-claim after opt-out). Partial UNIQUE index so opt-out (active=false) does
-- not block another user from taking the same handle in that cohort.
create unique index idx_leaderboard_optin_handle_per_cohort
  on public.leaderboard_optin (cohort_id, handle)
  where active = true;

-- Index for matview JOIN: looking up opted-in users by user_id efficiently.
create index idx_leaderboard_optin_user_active
  on public.leaderboard_optin (user_id) where active = true;

alter table public.leaderboard_optin enable row level security;

-- D-12 + privacy-default: user reads own row (to populate Settings → Leaderboards).
-- Service-role manages writes via SECDEF RPCs (set_leaderboard_optin).
create policy "leaderboard_optin_select_own" on public.leaderboard_optin
  for select to authenticated using (auth.uid() = user_id);

create policy "leaderboard_optin_service_write" on public.leaderboard_optin
  for all to service_role with check (true);

-- NO INSERT/UPDATE/DELETE policies for authenticated — all mutations go through
-- set_leaderboard_optin SECDEF (20270708000014_p35_leaderboard_rpcs.sql).
-- Defense-in-depth: even if a developer adds a policy in a future migration,
-- the SECDEF still validates handle + cohort membership.

comment on table public.leaderboard_optin is
  'Phase 35 D-12/D-13 — privacy-default opt-IN leaderboard membership. '
  'User does NOT appear until they explicitly opt-in via Settings → Leaderboards. '
  'Handle uniqueness scoped per-cohort (D-13); regex blocks real names. '
  'Opt-out: active=false; next leaderboard_matview refresh (15 min, D-15) excludes the row. '
  'All mutations go through set_leaderboard_optin SECDEF RPC (20270708000014).';

comment on column public.leaderboard_optin.active is
  'D-15: false = opted-out. Matview WHERE lo.active = true excludes this row on next refresh '
  '(worst-case 15-min stale display). Partial UNIQUE index on (cohort_id, handle) WHERE active=true '
  'allows another user to claim the same handle after opt-out.';
