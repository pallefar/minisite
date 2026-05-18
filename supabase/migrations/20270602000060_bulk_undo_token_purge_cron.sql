-- Phase 27 Plan 27-07 D-22 (bulk-undo-token-purge — pure SQL cron).
--
-- Spec references:
--   - 27-CONTEXT.md D-22: new Edge Fn proposal for bulk_undo_token purge.
--   - 27-RESEARCH.md correction #3: skip the Edge Fn — purge is pure SQL,
--     zero HTTP overhead, idempotent by design. Saves a deployment + a
--     vendor dependency (no Deno runtime needed for what's a 1-line DELETE).
--   - 27-PATTERNS.md B3 alternative recommendation aligned: pure SQL inside
--     `cron.schedule()` body is the recommended variant.
--
-- Pattern source: 20270101000009_click_baseline_refresh_cron.sql (Phase 19
-- analog — pure SQL inside `cron.schedule()` with no HTTP-post).
--
-- Collision matrix (verified per 27-PATTERNS Phase 27 cron table):
--   - bulk-undo-token-purge       '* * * * *'          (this migration)
--   - admin-bulk-job-worker       '* * * * *'          (Plan 27-06)
--   - funnel-anomaly-cron         '*/5 * * * *'        (Plan 27-04)
--   - cohort-membership-refresh   '7,22,37,52 * * * *' (Plan 27-02)
--   - existing prior phases       (various)
--
--   ACCEPTABLE: pg_cron parallelizes across distinct jobnames; per-jobname
--   single-instance overlap protection applies (a tick that hasn't finished
--   blocks the next tick of the same jobname only). bulk-undo-token-purge
--   AND admin-bulk-job-worker share the '* * * * *' schedule but run as
--   independent jobs in independent pg_cron worker slots — no functional
--   collision.
--
-- TWO purge targets in the same cron body (one tick, one transaction):
--
--   (1) public.bulk_action_undo_token (60-second TTL — ADMIN-04 D-03)
--       — Purge rows where expires_at < now(). Plan 27-01's
--         admin_bulk_action_undo RPC ALREADY deletes redeemed tokens
--         atomically (single-use), so this cron's job is to sweep the
--         tokens that were issued but never redeemed (admin ignored the
--         undo banner, closed the tab, or quit the session mid-action).
--       — Bounded by `expires_at < now()` predicate; cannot accidentally
--         drop unexpired tokens (T-27-07-02 mitigation — server clock
--         used consistently for both INSERT default + DELETE filter).
--
--   (2) public.events_mirror (30-day retention — Plan 27-04 dependency)
--       — Plan 27-04's funnel_anomaly_baseline_compute() reads
--         events_mirror with a max 29-day lookback (4-week DOW window).
--         A 30-day retention cap keeps the table size bounded so the
--         baseline queries stay under the 5-minute cron budget as event
--         volume grows. Without this retention sweep, events_mirror grows
--         unbounded → baseline-compute query latency climbs → */5 cron
--         starts to back up.
--       — Per the events_mirror migration comment: "RETENTION: deferred
--         to v1.4" — that deferral is closed here in v1.3 Plan 27-07.
--
-- IDEMPOTENT: re-running has no side effect — DELETE WHERE on already-purged
-- rows is a no-op. Safe under retry.
--
-- ROLLBACK (manual): select cron.unschedule('bulk-undo-token-purge');

create extension if not exists pg_cron;

-- Idempotent install: unschedule any prior version first, then re-schedule.
-- Mirrors the pattern from 20270602000013_cohort_matview_refresh_cron.sql.
do $$
begin
  perform cron.unschedule('bulk-undo-token-purge');
exception when others then
  -- "could not find valid entry for job" — first install path. Ignore.
  null;
end
$$;

select cron.schedule(
  'bulk-undo-token-purge',
  '* * * * *',
  $$
    delete from public.bulk_action_undo_token where expires_at < now();
    delete from public.events_mirror where created_at < now() - interval '30 days';
  $$
);
