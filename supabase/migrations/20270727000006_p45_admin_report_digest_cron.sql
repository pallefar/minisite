-- Phase 45 Plan 45-05 — Daily admin report digest cron (COMMUNITY-09).
--
-- D-11 + RESEARCH §"Admin report digest cron": registers a daily pg_cron job
-- at 09:00 UTC that fires the `community-admin-report-digest` Edge Fn. The Fn
-- reads open `community_reports` rows, groups by target_type, and sends one
-- email per opted-in admin (profiles.is_staff=true AND
-- profiles.admin_digest_opt_in=true).
--
-- This bridges the Phase 45 report queue to admin visibility BEFORE Phase 48
-- ships the moderation UI (per CONTEXT integration-point — reports must not
-- be invisible until Phase 48).
--
-- Cron timing — `0 9 * * *` chosen to be clear of:
--   - `0 0 * * *` (midnight UTC daily jobs)
--   - `0 1 * * *` (affiliate_click_baseline refresh)
--   - `5 * * * *` (affiliate_ratio_baseline refresh — every hour)
--   - `0 3 * * *` (other daily jobs)
-- Aligns with `affiliate-anomaly-sla-reminder` (also 09:00 UTC) — both are
-- read-mostly admin batch jobs; running together is intentional.
--
-- Vault-based service_role_key extraction (memory
-- reference_supabase_pg_cron_vault_service_role_pattern):
--   `vault.decrypted_secrets` is the Supabase pattern for storing the
--   service_role_key inside the project's pgsodium-backed vault. Secret
--   loaded by 20270101000014_service_role_key_vault_load.sql (Phase 19).
--   NOTE: the app-namespaced GUC alternative does NOT exist on this project;
--   only vault.decrypted_secrets works for service-role bearer assembly.
--
-- Named dollar-quote tags (memory reference_postgres_dollar_quote_nesting_in_cron_body):
--   Bare `$$ ... $$` inside `cron.schedule(name, sched, $$ ... $$)` would
--   silently close at the FIRST nested `$$`. The DO unschedule block uses
--   `$unschedule$`; the schedule body uses `$cron$`. Neither contains the
--   other's tag.
--
-- Per memory feedback_fn_deploy_before_cron_db_push:
--   The Fn `community-admin-report-digest` MUST be deployed BEFORE this
--   migration is pushed via `supabase db push --linked`. If pushed before
--   the Fn exists, cron will fire within ≤15 min to a non-existent endpoint.
--   This is documented for the Phase 45 close-out plan (45-09).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Pre-flight: idempotent unschedule. Wrap in EXCEPTION block so re-running
-- the migration on a fresh db (no prior schedule) does not error.
do $unschedule$
begin
  perform cron.unschedule('community-admin-report-digest');
exception when others then
  null;
end
$unschedule$;

select cron.schedule(
  'community-admin-report-digest',
  '0 9 * * *',  -- daily 09:00 UTC
  $cron$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/community-admin-report-digest',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(
          (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1),
          ''
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cron$
);

-- Rollback hint (manual): select cron.unschedule('community-admin-report-digest');
