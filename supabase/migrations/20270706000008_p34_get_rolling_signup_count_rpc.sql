-- =============================================================================
-- Phase 34 Plan 34-06 (ONBOARD-12) — get_rolling_signup_count RPC.
--
-- Returns the count of public.profiles rows created in the last 7 days as an
-- aggregate int. Consumed by the LiveSignupCounter component (30s setInterval
-- polling, gated on document.visibilityState === 'visible').
--
-- Threat model:
--   - T-34-06-02 (Information Disclosure): ACCEPT — aggregate count only,
--     no PII, intentionally public per ONBOARD-12.
--   - T-34-06-04 (DoS): MITIGATE — STABLE marker lets the query planner
--     reuse the result within a single statement; profiles.created_at is
--     already indexed (profiles_created_at_idx exists from Phase 1 onwards).
--     Client polling cadence is 30s + visibility-gated.
--
-- The function is SECURITY DEFINER so it can read the row count regardless
-- of the caller's RLS; the search_path lock-down + revoke-all-then-grant
-- pattern is per Supabase migration gotchas memory.
-- =============================================================================

create or replace function public.get_rolling_signup_count()
returns int
language sql
security definer
set search_path = pg_catalog, public, extensions
stable
as $$
  select count(*)::int
  from public.profiles
  where created_at >= now() - interval '7 days';
$$;

comment on function public.get_rolling_signup_count() is
  'Phase 34 Plan 34-06 (ONBOARD-12): 7-day rolling new-profile count. Public aggregate, no PII (T-34-06-02 disposition: accept).';

revoke all on function public.get_rolling_signup_count() from public;
grant execute on function public.get_rolling_signup_count() to anon, authenticated;
