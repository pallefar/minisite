-- =============================================================================
-- Phase 34 Plan 01 — profiles.primary_goal column (D-11 8-goal catalog)
--
-- D-11 lets consumers self-classify into one of 8 primary goals. The column is
-- editable post-signup (D-14) via profile settings. Downstream plans (34-03
-- record-activation, 34-06 consumer renderer, 34-08 step builder) read this
-- value to gate goal-specific copy and activation thresholds.
--
-- Per [[feedback_planner_missed_status_enum_widening]]: ship the CHECK
-- constraint in the SAME migration as the column to avoid future 23514 errors
-- when downstream Edge Fns write a new value before a later migration widens.
-- =============================================================================

alter table public.profiles
  add column if not exists primary_goal text
    check (primary_goal in (
      'lose-weight',
      'build-muscle',
      'new-prescription',
      'build-habit',
      'doctor-monitored',
      'family-supporter',
      'manage-symptoms',
      'track-with-vial-supply'
    ));

comment on column public.profiles.primary_goal is
  'P34 D-11 8-goal catalog. Editable post-signup (D-14). Used by record-activation Edge Fn (Plan 34-03), consumer onboarding renderer (Plan 34-06), and AI personalization (Phase 38).';
