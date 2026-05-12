-- Phase 7 D-04 (audit log retention policy) + D-03 (skeleton survives forever).
--
-- Nightly pg_cron job that deletes audit_logs rows older than 13 months,
-- EXCEPT rows whose action is one of the account-delete skeleton subset
-- (`account_deleted_initiated` / `account_deleted_finalized`). The skeleton
-- subset is retained INDEFINITELY — it is the legal accountability record.
--
-- STRIDE register:
--   T-07-08-06 (Denial of service): unbounded audit_logs growth would eventually
--     fill the project's DB quota. The 13-month rolling window covers HBNR's
--     60-day notification clock and an annual reporting cycle + 1 month buffer.
--   T-07-08-03 (Repudiation, "I never deleted my account"): the skeleton
--     subset's indefinite retention guarantees a forever-record of every
--     account-delete event. Since the row is hashed (user_id_hash, no PII),
--     it does NOT violate GDPR / WMHMDA right-to-erasure — once auth.users
--     is gone the hash is no longer "personal data".
--
-- Schedule rationale: 05:00 UTC, two hours after the Phase 4
-- `cleanup-anon-users` job (03:00 UTC, defined in
-- 20260512000002_anon_cleanup_pg_cron.sql). The two-hour gap avoids
-- contention with any Phase 4 cron run that might still be cleaning up
-- anon-user cascades when this one fires.

create extension if not exists pg_cron;
-- pg_cron was enabled in Phase 4 (20260512000002_anon_cleanup_pg_cron.sql).
-- `create extension if not exists` is the idempotent safety net.

select cron.schedule(
  'cleanup-audit-logs',
  '0 5 * * *',  -- nightly 05:00 UTC
  $$
    delete from public.audit_logs
    where timestamp < now() - interval '13 months'
      and action not like 'account_deleted_%';
  $$
);

-- The `action not like 'account_deleted_%'` filter is load-bearing. Both
-- enum values defined in 20260601000001_audit_logs.sql's CHECK constraint
-- (`account_deleted_initiated` and `account_deleted_finalized`) match the
-- LIKE pattern, so both flavors of skeleton row survive indefinitely.
--
-- Operational notes — inspect from the Supabase SQL editor:
--   select * from cron.job where jobname = 'cleanup-audit-logs';
--   select * from cron.job_run_details where jobid = (
--     select jobid from cron.job where jobname = 'cleanup-audit-logs'
--   ) order by start_time desc limit 5;
