-- Phase 49 Plan 49-04 Task 2 — digest_send_log table for idempotent per-day
-- per-user digest dispatch tracking.
--
-- Refs: D-12 (UPSERT idempotency via UNIQUE on user_id + kind + sent_date).
--
-- Per feedback_state_counter_table_needs_upsert_on_event: counter tables
-- keyed by (user, slot) need INSERT … ON CONFLICT, not bare UPDATE. The
-- digest Edge Fn (community-daily-digest / community-weekly-digest) will
-- UPSERT one row per send with onConflict: 'user_id,kind,sent_date'.
--
-- sent_date is a GENERATED ALWAYS column (UTC) so the conflict key collapses
-- to one row per calendar day regardless of multiple intra-day fire-and-retry
-- attempts. Generated-stored avoids functional-index gotcha from
-- reference_supabase_migration_gotchas (partial-index predicates must be
-- IMMUTABLE; a stored generated column sidesteps the issue).
--
-- RLS posture (per reference_supabase_is_staff_helper):
--   - SELECT own (auth.uid() = user_id)
--   - SELECT staff via public.is_staff() (SECDEF stable; reads profiles.is_staff)
--   - INSERT/UPDATE/DELETE revoked from authenticated — writes only via
--     service-role Edge Fn bearer (bypasses RLS write policies).
--
-- Threat model (T-49-08 + T-49-09 mitigated):
--   - Users cannot fabricate digest_send_log rows to appear unsubscribed
--     (write revoke).
--   - Users cannot read other users' send-history (RLS own + staff SELECT).

begin;

create table if not exists public.digest_send_log (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  kind          text        not null check (kind in ('daily','weekly')),
  sent_at       timestamptz not null default now(),
  sent_date     date        generated always as ((sent_at at time zone 'UTC')::date) stored,
  status        text        not null check (status in ('sent','skipped:no-content','skipped:opted_out','error')),
  error_message text
);

-- Idempotency key — one row per (user, kind, calendar-day-UTC).
create unique index if not exists digest_send_log_user_kind_date_uniq
  on public.digest_send_log (user_id, kind, sent_date);

-- Lookup index — admin/staff inspection by recency.
create index if not exists digest_send_log_user_sent_at_idx
  on public.digest_send_log (user_id, sent_at desc);

alter table public.digest_send_log enable row level security;

-- SELECT own.
drop policy if exists dsl_select_own on public.digest_send_log;
create policy dsl_select_own
  on public.digest_send_log for select to authenticated
  using (auth.uid() = user_id);

-- SELECT staff (via canonical SECDEF helper).
drop policy if exists dsl_select_staff on public.digest_send_log;
create policy dsl_select_staff
  on public.digest_send_log for select to authenticated
  using (public.is_staff());

-- Writes blocked for authenticated callers; service-role bearer bypasses RLS.
revoke insert, update, delete on public.digest_send_log from authenticated;

commit;
