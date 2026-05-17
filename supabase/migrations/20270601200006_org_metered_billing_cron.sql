-- Phase 29 Plan 04 — Task 2
-- Register nightly metered-billing cron job at 02:00 UTC.
-- ORG-09 SC#2: nightly cron aggregates count_active_patients per org and
-- POSTs Stripe Meter Events (D-02).
--
-- Schedule: 02:00 UTC daily — verified clean slot (no collision):
--   01:xx — (none)
--   02:00 — p29_org_metered_billing_cron (this)  ←
--   03:00 — audit-archive-nightly (Phase 24)
--   03:15 — photos-trash-purge (Phase 23)
--   03:xx — affiliate-lifetime (Phase 19)
--   04:00 — p28_org_invites_expiry_purge (Phase 28)
--   04:30 — (pending p29-07 patient invite expiry cron)
--   05:xx — funnel-anomaly / undo-purge / matview-refresh
--   06:00 — vendor-baa (Phase 25)
--   Mon 07:00 — subprocessor-diff (Phase 25)
--
-- Auth: reads service_role_key from vault.decrypted_secrets (same secret
-- registered in Phase 24 Plan 24-01).
--
-- Idempotent: DO block unschedules any existing job by the same name first,
-- so re-running the migration is safe.
--
-- Precedent: Phase 24 migration 20270601000032_audit_archive_cron.sql
-- uses the same net.http_post + vault pattern.

begin;

-- Guard: unschedule any existing job by this name so re-runs are idempotent.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'p29_org_metered_billing_cron') then
    perform cron.unschedule('p29_org_metered_billing_cron');
  end if;
end
$$;

-- Register the nightly cron job at 02:00 UTC.
select cron.schedule(
  'p29_org_metered_billing_cron',
  '0 2 * * *',
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/org-metered-billing-cron',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'service_role_key'
          limit 1
        ),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    );
  $$
);

commit;
