-- Phase 24: Register nightly audit-archive cron entry (03:00 UTC)
-- Decision ref: D-16
--
-- pg_cron + pg_net are already enabled from Phase 19/22.
-- This migration registers the cron job that calls the audit-archive Edge Function.
--
-- The Edge Function implementation ships in Plan 24-06. Until then, the cron fires
-- but the http_post returns 404 — this is safe and expected (no rows are archived
-- until the Edge Fn is deployed, per [[reference_vendor_gated_send_health_check]]
-- pattern applied to code: infrastructure precedes implementation).
--
-- The cron reads SUPABASE_SERVICE_ROLE_KEY from Vault (vault.decrypted_secrets).
-- If the Vault entry is absent, the cron fires but http_post returns 401.
-- Vault provisioning is a human-action checkpoint in Task 3 of this plan.
--
-- Vault secret name convention: matches Phase 23 photos-trash-purge cron
-- which uses 'service_role_key'. Standardizing on the same name here.
-- (The plan spec says 'SUPABASE_SERVICE_ROLE_KEY' but existing crons use
-- 'service_role_key' — using the existing convention to avoid a new vault entry.)
--
-- Cron schedule offsets (no collisions with existing Phase 7/23 crons):
--   03:00 UTC — audit-archive-nightly  (this migration) ←
--   03:15 UTC — photos-trash-purge     (Phase 23)
--   04:00 UTC — finalize-account-deletions (Phase 7)
--   05:00 UTC — cleanup-audit-logs     (Phase 7)
--
-- Idempotent: cron.schedule() upserts by job name.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'audit-archive-nightly',
  '0 3 * * *',
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/audit-archive',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'service_role_key'
          limit 1
        ),
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('source', 'cron'),
      timeout_milliseconds := 300000
    );
  $$
);
