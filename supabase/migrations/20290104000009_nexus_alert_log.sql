-- Phase 65-08 — Stripe Tax + Payment Resilience (PAY-04 nexus alert de-dup log)
-- =============================================================================
--
-- Audit + de-dup log for Slack alerts fired by the nexus-monitor cron Edge Fn
-- (Plan 65-08). Each row records a single Slack alert for a (state, alert_tier)
-- pair. The nexus-monitor handler queries for a recent (≤23h) row before firing
-- to prevent duplicate alerts when the daily cron retries.
--
-- The /admin/tax dashboard (Plan 65-09) reads this table to show staff a
-- historical view of nexus alerts (when each state crossed each threshold).
--
-- Threat model (from Plan 65-08):
--   T-65-08-02 Repudiation (missed registration deadline): mitigate — daily cron
--     + this log table + 23h de-dup gate gives staff defensible audit trail
--     of when each nexus crossing was detected and escalated to Slack.
--   T-65-08-03 DoS (Slack spam): mitigate — 23h de-dup gate keyed on
--     (state, alert_tier, alerted_at) caps Slack traffic to ≤1/state/tier/day.
--
-- No CREATE POLICY IF NOT EXISTS ([[feedback_phase_close_out_supabase_gotchas]]).
-- Per [[reference_supabase_back_dated_migration_blocks_push]] — timestamp 20290104+
-- (sits AFTER 65-01's 20290104000007/000008 tax-nexus pair; this plan owns 000009).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Table: public.nexus_alert_log
-- ---------------------------------------------------------------------------

create table public.nexus_alert_log (
  id                       uuid          not null default gen_random_uuid() primary key,
  state                    text          not null check (length(state) = 2),
  alert_tier               text          not null
                                         check (alert_tier in ('monitoring','at_risk','nexus_established')),
  revenue_cents            bigint        not null check (revenue_cents >= 0),
  threshold_amount_cents   bigint        not null check (threshold_amount_cents > 0),
  proximity_percent        numeric(8,2)  not null check (proximity_percent >= 0),
  slack_message_ts         text,                                       -- Slack response.ts for future ack
  alerted_at               timestamptz   not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Index supports the 23h de-dup query (state, alert_tier, alerted_at desc).
-- ---------------------------------------------------------------------------

create index idx_nexus_alert_log_state_tier_alerted_at
  on public.nexus_alert_log (state, alert_tier, alerted_at desc);

-- ---------------------------------------------------------------------------
-- 3. Enable Row Level Security.
-- ---------------------------------------------------------------------------

alter table public.nexus_alert_log enable row level security;

-- ---------------------------------------------------------------------------
-- 4. RLS Policies — bare CREATE POLICY.
-- ---------------------------------------------------------------------------

-- Service role: full read/write (nexus-monitor Fn writes; admin dashboard reads).
create policy "service_role_all_nexus_alert_log"
  on public.nexus_alert_log
  for all
  to service_role
  using (true)
  with check (true);

-- Staff-only SELECT for /admin/tax history view (Plan 65-09).
create policy "staff_select_nexus_alert_log"
  on public.nexus_alert_log
  for select
  to authenticated
  using (public.is_staff());

-- ---------------------------------------------------------------------------
-- 5. Comment — operator docs.
-- ---------------------------------------------------------------------------

comment on table public.nexus_alert_log is
  'Audit + de-dup log for nexus-monitor Slack alerts (Plan 65-08, PAY-04). '
  'One row per (state, alert_tier) crossing; 23h de-dup gate keyed on alerted_at. '
  'Staff-readable via /admin/tax dashboard (Plan 65-09).';

commit;
