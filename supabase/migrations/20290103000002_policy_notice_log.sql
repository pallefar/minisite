-- Phase 64-01 — Legal Refresh data layer
-- =============================================================================
--
-- Creates public.policy_notice_log — idempotency log for the one-shot
-- grandfathered-policy-notice email campaign (Plan 64-03).
--
-- Primary key on user_id ensures `INSERT … ON CONFLICT (user_id) DO NOTHING`
-- produces exactly-once semantics — no user receives the notice more than once
-- regardless of how many times the Edge Fn cron fires (D-Grandfathered-Notice-Email).
--
-- Trust boundary: Edge Fn cron (service role) → INSERT here.
-- RLS: staff + service-role only — this is operator/Fn telemetry, no user-facing read.
--
-- RLS: DROP IF EXISTS + bare CREATE POLICY (no IF NOT EXISTS — unsupported on
-- remote PG per [[feedback_phase_close_out_supabase_gotchas]]).
--
-- Per [[reference_supabase_back_dated_migration_blocks_push]] — timestamp 20290103+
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Table: public.policy_notice_log
--    PK = user_id enables ON CONFLICT (user_id) DO NOTHING in Edge Fn 64-03.
-- ---------------------------------------------------------------------------

create table public.policy_notice_log (
  user_id           uuid        not null primary key references auth.users(id) on delete cascade,
  sent_at           timestamptz not null default now(),
  opened_at         timestamptz,
  unsubscribed_at   timestamptz,
  resend_message_id text
);

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------

-- Admin scan: most-recently-sent first
create index idx_policy_notice_log_sent
  on public.policy_notice_log(sent_at desc);

-- ---------------------------------------------------------------------------
-- 3. Enable Row Level Security
-- ---------------------------------------------------------------------------

alter table public.policy_notice_log enable row level security;

-- ---------------------------------------------------------------------------
-- 4. RLS Policies — staff and Edge Fn (service-role bypass) only.
--    No user-facing SELECT — this is operator telemetry.
--    DROP IF EXISTS first for idempotency.
-- ---------------------------------------------------------------------------

drop policy if exists "staff_all_policy_notice_log" on public.policy_notice_log;
create policy "staff_all_policy_notice_log"
  on public.policy_notice_log
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

commit;
