-- Phase 48 Plan 03 Task 1: user_moderation_state schema + RLS
-- Source of truth for mute/ban/temp_suspend state. Read by:
--   - mute RLS predicate (Plan 48-06)
--   - ban write-deny RLS predicate (Plan 48-06)
--   - AccountSuspended consumer blocker (Plan 48-11)
--   - moderation_action audit (Plan 48-04)
-- Writes ONLY through apply_user_moderation SECDEF RPC (Task 2 / 48-03).

begin;

create table if not exists public.user_moderation_state (
  user_id     uuid        primary key references auth.users(id) on delete cascade,
  status      text        not null check (status in ('active','muted','banned','temp_suspended')),
  applied_by  uuid        not null references auth.users(id),
  reason      text,
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint user_moderation_expires_chk check (
    (status = 'temp_suspended' and expires_at is not null) or
    (status <> 'temp_suspended' and expires_at is null)
  )
);

-- Partial index supporting mute RLS predicate (Plan 48-06).
create index if not exists user_moderation_state_muted_idx
  on public.user_moderation_state (user_id)
  where status = 'muted';

-- Partial index supporting ban write-deny RLS predicate (Plan 48-06).
create index if not exists user_moderation_state_banned_idx
  on public.user_moderation_state (user_id)
  where status in ('banned','temp_suspended');

alter table public.user_moderation_state enable row level security;

-- User reads own row.
create policy ums_select_own
  on public.user_moderation_state for select to authenticated
  using (auth.uid() = user_id);

-- Staff reads all rows.
create policy ums_select_staff
  on public.user_moderation_state for select to authenticated
  using (public.is_staff());

-- NO insert/update/delete policy for authenticated.
-- Writes ONLY through apply_user_moderation SECDEF RPC (Task 2).

commit;
