-- Phase 55 Plan 02 (HEALTH-07)
-- Per-user HealthKit sync state table: opt-in flag, sync interval, last-sync
-- timestamp, and revoke timestamp. One row per user; upserted via SECDEF RPC.
--
-- RLS: own-row policy — each user can only read/write their own row.
-- moddatetime trigger maintains LWW updated_at (matches project convention).
-- sync_interval CHECK enforces the three allowed polling cadences.

create table public.healthkit_sync_state (
  user_id          uuid        not null primary key
                               references auth.users(id) on delete cascade,
  healthkit_enabled boolean    not null default false,
  sync_interval    text        not null default '6h'
                               check (sync_interval in ('1h', '6h', '24h')),
  last_synced_at   timestamptz,
  revoked_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- LWW updated_at trigger (matches moddatetime convention used in weights, sleep,
-- workouts, meals, injections, etc.)
create trigger healthkit_sync_state_set_updated_at
  before update on public.healthkit_sync_state
  for each row
  execute function extensions.moddatetime(updated_at);

alter table public.healthkit_sync_state enable row level security;

-- Own-row policy: SELECT, INSERT, UPDATE, DELETE all gate on auth.uid() = user_id.
create policy "healthkit_sync_state_own"
  on public.healthkit_sync_state
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
