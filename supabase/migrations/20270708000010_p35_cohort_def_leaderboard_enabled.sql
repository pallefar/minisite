-- Phase 35 Plan 35-04 — D-11 privacy-default leaderboard column on cohort_definitions.
--
-- Decision reference:
--   - D-11: Admin-curated subset only. New column leaderboard_enabled default false.
--     Only cohorts admin explicitly enables get a leaderboard. Admin curates
--     psychological-fit (e.g., enable for "GLP-1 Veterans 6mo+"; do NOT enable
--     for "Newly Diagnosed"). Safest ethical posture; admin owns the responsibility.
--
-- Idempotent: `add column if not exists` (Postgres >= 9.6; project is on 15).

alter table public.cohort_definitions
  add column if not exists leaderboard_enabled boolean not null default false;

comment on column public.cohort_definitions.leaderboard_enabled is
  'Phase 35 D-11: admin opts cohort in to leaderboard surface. Default false (privacy-default). '
  'Admin must judge psychological fit before enabling (e.g., do NOT enable for newly-diagnosed cohorts). '
  'When false, the cohort is excluded from leaderboard_matview (WHERE cd.leaderboard_enabled = true). '
  'Documentation note: admin runbook (runbooks/leaderboard-cohort-criteria.md) describes the '
  'psychological-fit criteria — owned by Plan 35-05 admin module.';
