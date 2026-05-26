-- Phase 62 Plan 01 — profiles consent columns for research participation
-- =============================================================================
--
-- Adds three consent-tracking columns to public.profiles:
--   - research_consent      boolean NOT NULL DEFAULT false (opt-in required)
--   - consent_revoked_at    timestamptz (set when user opts out)
--   - last_purged_at        timestamptz (set by nightly purge cron in Plan 62-08)
--
-- Default `false` per HIPAA Privacy Rule §164.508 opt-in requirement
-- (CONTEXT.md D-CONTEXT decisions — patient authorization required for
-- use of PHI in research; silence ≠ consent).
--
-- Partial index on (research_consent=false AND consent_revoked_at IS NOT NULL)
-- supports the nightly purge cron (Plan 62-08) scanning revoked-but-not-yet-purged
-- profiles (T-62-01-05 mitigation in threat model).
--
-- Per [[reference_supabase_back_dated_migration_blocks_push]] — timestamp 20290102+
-- =============================================================================

begin;

alter table public.profiles
  add column if not exists research_consent     boolean   not null default false,
  add column if not exists consent_revoked_at   timestamptz,
  add column if not exists last_purged_at       timestamptz;

-- Partial index: cron-efficient scan for profiles pending purge.
-- Covers only the subset where consent was previously granted then revoked
-- but the purge cron has not yet run (last_purged_at < consent_revoked_at
-- or last_purged_at IS NULL).
create index if not exists idx_profiles_consent_purge
  on public.profiles(research_consent, consent_revoked_at, last_purged_at)
  where research_consent = false
    and consent_revoked_at is not null;

commit;
