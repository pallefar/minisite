-- Phase 28 Plan 01 — Task 1 (migration 11/11)
-- pg_cron job: org_invites expiry purge at 04:00 UTC daily.
-- Per CONTEXT D-13 + plan Task 1 action item 11.
--
-- Schedule: 04:00 UTC daily — no collision with existing crons:
--   P24 audit-archive 03:00, P22 crons, P27 funnel-anomaly 5-min,
--   P27 matview 15-min, P27 undo-purge 1-min (per CONTEXT §Specific Ideas).
--
-- Status transition: pending → expired (per [[feedback_status_machine_transition_owner]])
-- Owner: this cron job.

select cron.schedule(
  'p28_org_invites_expiry_purge',
  '0 4 * * *',
  $$
    update public.org_invites
    set status = 'expired'
    where status = 'pending'
      and expires_at < now()
  $$
);
