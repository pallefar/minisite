-- Phase 55 Plan 02 (HEALTH-03, HEALTH-07)
-- Add hk_source tag column to all four HealthKit import-target tables.
--
-- hk_source is a nullable text column that identifies the import origin.
-- Rows imported from Apple HealthKit are tagged 'apple_health'.
-- Manually logged rows remain NULL (no change to existing data).
-- The purge_healthkit_imports RPC deletes only hk_source = 'apple_health' rows.
--
-- Idempotent: uses ADD COLUMN IF NOT EXISTS.

alter table public.weights  add column if not exists hk_source text;
alter table public.sleep    add column if not exists hk_source text;
alter table public.workouts add column if not exists hk_source text;
alter table public.meals    add column if not exists hk_source text;
