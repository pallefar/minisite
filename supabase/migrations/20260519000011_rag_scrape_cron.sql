-- Phase 50 Plan 50-04: Register rag-scrape-tick cron (every 5 minutes) per D-09.
--
-- Invokes the rag-scrape-runner Edge Function via net.http_post; the Edge Fn
-- picks topics where next_scrape_at <= now() and runs the full scrape pipeline.
--
-- pg_cron + pg_net are already enabled from Phase 19/22.
--
-- Vault secret naming convention: matches the existing audit-archive-nightly
-- and photos-trash-purge crons which both use `service_role_key`. The plan spec
-- mentions `SUPABASE_SERVICE_ROLE_KEY` but standardizing on the existing entry
-- avoids needing a new vault entry per [[reference_supabase_pg_cron_vault_service_role_pattern]].
--
-- If the vault entry is absent, the cron fires but http_post returns 401 and
-- the Edge Fn returns 403 immediately (no Firecrawl call). Provisioning is a
-- one-time human-action checkpoint already documented in Phase 24.
--
-- Cron schedule offset: */5 * * * * (every 5 minutes). No collision with the
-- nightly batch crons (audit-archive, photos-trash-purge, cleanup-audit-logs,
-- finalize-account-deletions) which all run hourly or daily.
--
-- Idempotent: cron.schedule() upserts by job name. The DO-block guards a
-- pre-existing entry with a different cron expression by unscheduling first.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $unschedule$
begin
  if exists (select 1 from cron.job where jobname = 'rag-scrape-tick') then
    perform cron.unschedule('rag-scrape-tick');
  end if;
exception when others then
  -- Ignore: cron schema may not be visible to migration role on first apply.
  null;
end $unschedule$;

select cron.schedule(
  'rag-scrape-tick',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/rag-scrape-runner',
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
  $cron$
);
