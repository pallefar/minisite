-- Phase 47-03 — Reminder dedup + promotion fan-out queue tables.
--
-- Implements D-10 (event_reminder_sent UNIQUE(event_id, user_id, kind) — idempotent dedup
-- for the hourly fan-out per (event, user, kind)) and the back-end of D-03 (promotion
-- trigger writes into event_promotion_queue; fan-out Fn drains it once per promotion).
--
-- RLS posture (per <behavior>): both tables are service-role-only. RLS is enabled with NO
-- public policies → authenticated callers cannot SELECT/INSERT/UPDATE/DELETE. service_role
-- bypasses RLS by definition.

begin;

----------------------------------------------------------------------
-- event_reminder_sent — idempotent reminder dedup per (event, user, kind).
----------------------------------------------------------------------

create table if not exists public.event_reminder_sent (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  user_id    uuid not null references auth.users(id)    on delete cascade,
  kind       text not null check (kind in ('1d','1h','promotion')),
  sent_at    timestamptz not null default now(),
  constraint event_reminder_sent_unique unique (event_id, user_id, kind)
);

create index if not exists event_reminder_sent_event_idx
  on public.event_reminder_sent (event_id);

comment on table  public.event_reminder_sent is
  'P47 D-10: enforces idempotent dedup for hourly reminder fan-out per (event, user, kind). UNIQUE(event_id, user_id, kind) is the dedup key.';
comment on column public.event_reminder_sent.kind is
  'P47 D-10: reminder bucket — 1d (24h pre), 1h (60min pre), promotion (waitlist→going notify).';

----------------------------------------------------------------------
-- event_promotion_queue — fan-out drain queue for waitlist promotions.
----------------------------------------------------------------------

create table if not exists public.event_promotion_queue (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  user_id     uuid not null references auth.users(id)    on delete cascade,
  promoted_at timestamptz not null default now(),
  drained_at  timestamptz,
  constraint event_promotion_queue_unique unique (event_id, user_id)
);

-- Partial index on undrained rows — fan-out Fn `WHERE drained_at IS NULL` is the hot path.
create index if not exists event_promotion_queue_undrained_idx
  on public.event_promotion_queue (event_id, user_id)
  where drained_at is null;

comment on table  public.event_promotion_queue is
  'P47 D-03: fan-out drain queue; promote_waitlist_on_rsvp_change() trigger enqueues a row; service-role fan-out Fn drains once per promotion. UNIQUE(event_id, user_id) absorbs defensive double-insert.';
comment on column public.event_promotion_queue.drained_at is
  'NULL = pending fan-out; non-null = service-role drain timestamp.';

----------------------------------------------------------------------
-- RLS: service-role-only (no public policies).
----------------------------------------------------------------------

alter table public.event_reminder_sent    enable row level security;
alter table public.event_promotion_queue  enable row level security;
-- Intentionally NO policies. authenticated callers get zero rows / zero writes.
-- service_role bypasses RLS by definition (Supabase platform invariant).

commit;
