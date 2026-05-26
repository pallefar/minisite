-- Phase 60 Plan 15 — pg_cron schedules for the 7 Phase 60 jobs.
-- STRICT ordering rule: this migration is pushed ONLY after `supabase functions deploy`
-- of all 10 Phase 60 Fns succeeds (per [[feedback_fn_deploy_before_cron_db_push]]).
--
-- Cron pattern mirrors 20280401000005_ad_revenue_etl_cron_rpc.sql:
--   vault.decrypted_secrets service_role bearer + hardcoded project URL.
--   Each cron.schedule body uses $cron$...$cron$ named dollar-quote tag
--   to avoid nesting collision with any inner DO/DECLARE blocks
--   (per [[reference_postgres_dollar_quote_nesting_in_cron_body]]).
--
-- Project ref: ytnsipxxmzgaebkqmokp.
-- Deploy timestamp: 2026-05-26 (all 10 Fns confirmed ACTIVE before this migration).
--
-- Auth pattern: vault.decrypted_secrets WHERE name = 'service_role_key'
--   (NOT current_setting GUC — does not exist on this project per
--    [[reference_supabase_pg_cron_vault_service_role_pattern]]).
--
-- 7 jobs registered (all prefixed phase60_ for lifecycle management):
--   1. phase60_federated_pubmed_sync   — daily 03:00 UTC
--   2. phase60_federated_fda_sync      — daily 03:00 UTC
--   3. phase60_federated_dailymed_sync — daily 03:00 UTC
--   4. phase60_embed_worker            — every 5 minutes
--   5. phase60_tip_of_day_generate     — daily 00:00 UTC
--   6. phase60_newsletter_weekly       — Sunday 13:00 UTC (09:00 EDT / 08:00 EST)
--   7. phase60_eval_nightly            — daily 02:00 UTC (eval-sweep mode on rag-retrieve)

begin;

-- =============================================================================
-- Idempotent pre-unschedule (safe re-run — removes existing jobs before re-adding)
-- =============================================================================
select cron.unschedule('phase60_federated_pubmed_sync')
  where exists (select 1 from cron.job where jobname = 'phase60_federated_pubmed_sync');

select cron.unschedule('phase60_federated_fda_sync')
  where exists (select 1 from cron.job where jobname = 'phase60_federated_fda_sync');

select cron.unschedule('phase60_federated_dailymed_sync')
  where exists (select 1 from cron.job where jobname = 'phase60_federated_dailymed_sync');

select cron.unschedule('phase60_embed_worker')
  where exists (select 1 from cron.job where jobname = 'phase60_embed_worker');

select cron.unschedule('phase60_tip_of_day_generate')
  where exists (select 1 from cron.job where jobname = 'phase60_tip_of_day_generate');

select cron.unschedule('phase60_newsletter_weekly')
  where exists (select 1 from cron.job where jobname = 'phase60_newsletter_weekly');

select cron.unschedule('phase60_eval_nightly')
  where exists (select 1 from cron.job where jobname = 'phase60_eval_nightly');

-- =============================================================================
-- phase60_federated_pubmed_sync — daily 03:00 UTC
-- Syncs PubMed abstracts into federated_source_cache via rag-federated-pubmed Fn.
-- =============================================================================
select cron.schedule(
  'phase60_federated_pubmed_sync',
  '0 3 * * *',
  $cron$SELECT net.http_post(
    url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/rag-federated-pubmed',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );$cron$
);

-- =============================================================================
-- phase60_federated_fda_sync — daily 03:00 UTC
-- Syncs FDA OpenFDA drug data into federated_source_cache via rag-federated-fda Fn.
-- =============================================================================
select cron.schedule(
  'phase60_federated_fda_sync',
  '0 3 * * *',
  $cron$SELECT net.http_post(
    url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/rag-federated-fda',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );$cron$
);

-- =============================================================================
-- phase60_federated_dailymed_sync — daily 03:00 UTC
-- Syncs DailyMed drug label data into federated_source_cache via rag-federated-dailymed Fn.
-- =============================================================================
select cron.schedule(
  'phase60_federated_dailymed_sync',
  '0 3 * * *',
  $cron$SELECT net.http_post(
    url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/rag-federated-dailymed',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );$cron$
);

-- =============================================================================
-- phase60_embed_worker — every 5 minutes
-- Processes pending approved KB chunks through the embedding pipeline.
-- High frequency to keep embedding backlog near-zero.
-- =============================================================================
select cron.schedule(
  'phase60_embed_worker',
  '*/5 * * * *',
  $cron$SELECT net.http_post(
    url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/rag-embed-approved',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );$cron$
);

-- =============================================================================
-- phase60_tip_of_day_generate — daily 00:00 UTC
-- Generates tomorrow's tip-of-day entry in kb_tip_of_day via rag-tip-of-day-generate Fn.
-- Runs at midnight UTC so tip is ready for 00:00 local in all timezones.
-- =============================================================================
select cron.schedule(
  'phase60_tip_of_day_generate',
  '0 0 * * *',
  $cron$SELECT net.http_post(
    url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/rag-tip-of-day-generate',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );$cron$
);

-- =============================================================================
-- phase60_newsletter_weekly — Sunday 13:00 UTC (09:00 EDT / 08:00 EST)
-- Sends weekly research digest to opted-in subscribers via rag-newsletter-sender Fn.
-- Schedule: AI-SPEC §7 "Sunday 09:00 ET"; pg_cron UTC-only so 13:00 UTC = 09:00 EDT.
-- 1-hour drift to 08:00 EST during winter is accepted; Phase 67 OPS may add DST-flip.
-- =============================================================================
select cron.schedule(
  'phase60_newsletter_weekly',
  '0 13 * * 0',
  $cron$SELECT net.http_post(
    url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/rag-newsletter-sender',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );$cron$
);

-- =============================================================================
-- phase60_eval_nightly — daily 02:00 UTC
-- Invokes rag-retrieve in eval-sweep mode to run the Phase 60 gold-set evaluation suite.
-- Body: {"mode":"eval-sweep"} — rag-retrieve routes to gold-set sweep when this flag present.
-- Emits $ai_evaluation PostHog events for the RAG Phase 60 dashboard.
-- =============================================================================
select cron.schedule(
  'phase60_eval_nightly',
  '0 2 * * *',
  $cron$SELECT net.http_post(
    url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/rag-retrieve',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{"mode":"eval-sweep"}'::jsonb
  );$cron$
);

commit;
