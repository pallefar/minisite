-- P29 D-13: daily 04:30 UTC expiry sweep.
-- Retains expired-and-unaccepted rows 90 days for audit (IRS/HIPAA audit retention window).
-- No collision with P28 04:00 job (30min gap, safe at v1.3 scale).
-- Parallel cron jobs: P24 audit-archive 03:00, P28 org_invites-expiry 04:00, this cron 04:30.

begin;

-- Idempotent unschedule — safe to re-run on repeat migrations.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'p29_org_patient_invites_expiry_purge') then
    perform cron.unschedule('p29_org_patient_invites_expiry_purge');
  end if;
end $$;

-- Schedule daily purge at 04:30 UTC.
-- Purges org_patient_invites rows where:
--   - accepted_at IS NULL (never accepted)
--   - expires_at < now() - interval '90 days' (expired more than 90 days ago — audit retention honoured)
-- The 90-day window ensures audit_logs rows from send_org_patient_invite (separate append-only table)
-- have been captured before the invite row is purged (T-29-07-05 mitigation).
select cron.schedule(
  'p29_org_patient_invites_expiry_purge',
  '30 4 * * *',
  $$ delete from public.org_patient_invites
     where accepted_at is null
       and expires_at < now() - interval '90 days'; $$
);

commit;
