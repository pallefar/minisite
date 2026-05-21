-- Phase 35 Plan 35-08 (GAME-04) — per-user leaderboard preference row.
--
-- Stores the one-time nudge dismissal timestamp (nudge_dismissed_at) so the
-- level-5 "join the leaderboard" nudge is single-shot and cross-device synced.
-- D-12: once nudge_dismissed_at is set it MUST NOT be rolled back (monotonic).
--       The before-update trigger enforces this at the DB layer.
--
-- Timestamp collision note: the plan specified 20270708000020 but that
-- timestamp was already used by p35_streak_warn_helper.sql.  Bumped to
-- 20270708000022 (first free slot after 20270708000021).

create table public.user_leaderboard_prefs (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  nudge_dismissed_at timestamptz,
  last_seen_at    timestamptz,
  updated_at      timestamptz not null default now()
);

alter table public.user_leaderboard_prefs enable row level security;

create policy "user_leaderboard_prefs_select_own" on public.user_leaderboard_prefs
  for select to authenticated using (auth.uid() = user_id);

create policy "user_leaderboard_prefs_insert_own" on public.user_leaderboard_prefs
  for insert to authenticated with check (auth.uid() = user_id);

create policy "user_leaderboard_prefs_update_own" on public.user_leaderboard_prefs
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- No DELETE policy — preference rows persist across sessions.
-- Account deletion cascades from auth.users via the FK above.

comment on table public.user_leaderboard_prefs is
  'Phase 35 D-12 — per-user UI state for the leaderboard nudge. '
  'nudge_dismissed_at is monotonic: once set, the dashboard nudge does NOT '
  're-surface (single-shot contract per D-12).';

comment on column public.user_leaderboard_prefs.nudge_dismissed_at is
  'ISO timestamp set when the user dismisses the level-5 leaderboard nudge. '
  'NULL = nudge has not been dismissed. Monotonic — see trigger trg_p35_lb_prefs_monotonic.';

-- Monotonic guard: prevent nudge_dismissed_at from being un-set via UPDATE.
-- T-35-08-01 mitigation (Tampering — user un-dismisses nudge via direct UPDATE).
create or replace function public._p35_lb_prefs_monotonic() returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $body$
begin
  if old.nudge_dismissed_at is not null and new.nudge_dismissed_at is null then
    raise exception 'nudge_dismissed_at is monotonic (cannot un-dismiss)';
  end if;
  -- Also refresh updated_at on every update.
  new.updated_at := now();
  return new;
end;
$body$;

create trigger trg_p35_lb_prefs_monotonic
  before update on public.user_leaderboard_prefs
  for each row execute function public._p35_lb_prefs_monotonic();
