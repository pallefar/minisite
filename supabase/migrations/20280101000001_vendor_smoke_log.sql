-- =============================================================================
-- Phase 52 Plan 52-02 — vendor_smoke_log table + daily vendor-smoke cron.
--
-- Provides:
--   1. public.vendor_smoke_status enum (ok / fail / not_configured)
--   2. public.vendor_smoke_log table — one row per vendor; staff-SELECT RLS only
--   3. daily cron 'vendor-smoke-check' at 08:00 UTC → vendor-smoke Edge Fn
--
-- Security:
--   - RLS enabled; only staff can SELECT (via public.is_staff()).
--   - No client INSERT/UPDATE/DELETE policies — the Edge Fn writes via
--     service_role which bypasses RLS by design.
--   - Cron bearer is pulled at runtime from vault.decrypted_secrets
--     (key: 'service_role_key'); no secret literal in this file (T-52-07).
--
-- DEPLOY ORDERING CONSTRAINT (T-52-08):
--   The 'vendor-smoke' Edge Function (plan 52-01) MUST be deployed BEFORE this
--   migration is pushed to the remote DB. The cron fires within ~15 minutes of
--   'supabase db push' completing; a missing Fn would 404 every cron invocation.
--
-- Cron slot: 08:00 UTC daily. No conflict with existing slots:
--   audit-archive:      0 3 * * *  (Phase 24)
--   baa-expiry-check:   0 6 * * *  (Phase 25)
--   subprocessor-diff:  0 7 * * 1  (Phase 25, Mon-only)
--   traffic-rollup:     0 4 * * *  (Phase 51)
--   vendor-smoke-check: 0 8 * * *  (THIS migration)
--
-- Idempotency: enum uses DO/EXCEPTION guard; table uses IF NOT EXISTS;
--   cron.schedule upserts by job name (safe to re-run).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enum: vendor_smoke_status
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.vendor_smoke_status AS ENUM (
    'ok',
    'fail',
    'not_configured'
  );
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Table: vendor_smoke_log
--    One row per vendor (vendor_name PK). Upserted by the Edge Fn on each run.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendor_smoke_log (
  vendor_name  text                         PRIMARY KEY,
  status       public.vendor_smoke_status   NOT NULL DEFAULT 'not_configured',
  latency_ms   integer,                      -- NULL when not_configured
  message      text,                         -- human-readable detail / error
  checked_at   timestamptz                  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.vendor_smoke_log IS
  'Per-vendor smoke-test results. Staff-SELECT only via RLS. '
  'Written exclusively by the vendor-smoke Edge Fn via service_role (bypasses RLS).';

-- ---------------------------------------------------------------------------
-- 3. Row Level Security — staff-only SELECT; no client write policies
-- ---------------------------------------------------------------------------
ALTER TABLE public.vendor_smoke_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_smoke_log_select_staff
  ON public.vendor_smoke_log
  FOR SELECT
  USING (public.is_staff());

-- NOTE: No INSERT / UPDATE / DELETE policies are defined here.
-- The vendor-smoke Edge Fn calls supabase.from('vendor_smoke_log').upsert(...)
-- with a service_role client, which bypasses RLS entirely. Adding client write
-- policies would open an unnecessary privilege surface.

-- ---------------------------------------------------------------------------
-- 4. Daily cron — vendor-smoke-check at 08:00 UTC
--    Named dollar-tag $cron$ used (NOT bare $$) to avoid nesting collision when
--    the inner body itself contains $$ ... $$ expressions (RESEARCH Pitfall 1).
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'vendor-smoke-check',
  '0 8 * * *',
  $cron$
    SELECT net.http_post(
      url              := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/vendor-smoke',
      headers          := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret
          FROM   vault.decrypted_secrets
          WHERE  name = 'service_role_key'
          LIMIT  1
        )
      ),
      body             := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cron$
);
