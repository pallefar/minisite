-- =============================================================================
-- Phase 31 Plan 04 — profiles.completed_onboarding_at column
--
-- TS2 timestamp: 20270601400006 (lexicographically after TS1 20270601400005)
--
-- Adds nullable timestamptz column to public.profiles.
-- Written exactly once via mark_onboarding_complete() SECDEF (D-14 first-clinic-wins).
--
-- Design decisions (D-14):
--   - NOT adding an index — single-row reads via auth.uid() primary-key lookup;
--     column is consulted at most once per session.
--   - NO default — null means "not yet completed" (correct initial state for all
--     existing profiles).
--   - Written via SECDEF mark_onboarding_complete() only (IS NULL guard = idempotent).
--
-- DO NOT wrap in BEGIN/COMMIT — Supabase CLI manages transaction per migration.
-- =============================================================================

alter table public.profiles
  add column if not exists completed_onboarding_at timestamptz null;

comment on column public.profiles.completed_onboarding_at is
  'P31 D-14: first-clinic-wins onboarding completion timestamp. Written exactly once via mark_onboarding_complete() SECDEF.';
