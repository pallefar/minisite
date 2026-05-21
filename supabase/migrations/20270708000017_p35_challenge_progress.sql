-- Phase 35 Plan 35-05 GAME-05 — Per-user challenge progress tracking.
-- D-21 idempotency: notified_kickoff_at / notified_nudge_at prevent multi-fire.
-- completed_at is MONOTONIC: once set non-null, can never be set back to null.
-- CRITICAL (iter-1 B-2): the monotonic trigger ONLY raises when
--   old.completed_at IS NOT NULL AND new.completed_at IS NULL.
--   notified_kickoff_at updates on already-completed rows MUST pass through.

create table public.challenge_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_id uuid not null references public.weekly_challenges(id) on delete cascade,
  -- Which variant the user was bucketed into (null = no variant / not A/B tested)
  variant_key text check (variant_key is null or variant_key in ('A','B')),
  progress_count int not null default 0 check (progress_count >= 0),
  completed_at timestamptz,
  -- D-21 Plan 35-09 Monday kickoff idempotency
  notified_kickoff_at timestamptz,
  -- D-21 Plan 35-09 24h-ahead nudge idempotency
  notified_nudge_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, challenge_id)
);

-- Index for Plan 35-09 batch sweep: find users with pending (incomplete) progress
create index idx_challenge_progress_pending on public.challenge_progress (challenge_id, completed_at)
  where completed_at is null;

alter table public.challenge_progress enable row level security;

create policy "challenge_progress_select_own" on public.challenge_progress
  for select to authenticated using (auth.uid() = user_id);

create policy "challenge_progress_service_write" on public.challenge_progress
  for all to service_role with check (true);

-- ---------------------------------------------------------------------------
-- Monotonic completed_at trigger.
-- ONLY raises when old.completed_at IS NOT NULL AND new.completed_at IS NULL.
-- This means:
--   - Setting completed_at from null to a timestamp: ALLOWED (challenge completion)
--   - Updating notified_kickoff_at on already-completed row: ALLOWED (idempotency write)
--   - Setting completed_at from a timestamp back to null: BLOCKED (monotonic guard)
-- ---------------------------------------------------------------------------
create or replace function public._p35_challenge_progress_no_uncomplete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $body$
begin
  -- Guard: ONLY block the specific transition completed_at IS NOT NULL → NULL.
  -- All other updates (including notified_kickoff_at writes on completed rows) pass through.
  if old.completed_at is not null and new.completed_at is null then
    raise exception 'challenge_progress.completed_at is monotonic (cannot uncomplete a completed challenge)'
      using errcode = '23514';
  end if;
  return new;
end;
$body$;

create trigger trg_p35_challenge_progress_no_uncomplete
  before update on public.challenge_progress
  for each row execute function public._p35_challenge_progress_no_uncomplete();

comment on table public.challenge_progress is
  'Phase 35 GAME-05 — per-user challenge tracking. D-21 idempotency via '
  'notified_kickoff_at/notified_nudge_at. completed_at is monotonic '
  '(cannot transition back to null once set). Trigger allows notified_kickoff_at '
  'updates on already-completed rows per iter-1 B-2 review.';
