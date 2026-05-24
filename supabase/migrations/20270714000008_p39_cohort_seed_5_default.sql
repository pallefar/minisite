-- Phase 39 Plan 39-01 — 5 default cohort seed rows.
--
-- CONTEXT references (39-CONTEXT.md):
--   D-08 (five default cohorts: free-user, past-due-3d, trial-day-3,
--   trial-day-7, post-activation. Each carries a rule jsonb describing the
--   user-state predicate and a compiled_sql fragment referencing
--   cohort_profile_view aliased `p`).
--
-- Schema target (from 20270602000010_cohort_definitions.sql):
--   cohort_definitions(id, name UNIQUE, rule jsonb, compiled_sql text,
--                      status text in {draft, active, archived}, created_by,
--                      created_at, updated_at)
--
-- Idempotency: ON CONFLICT (name) DO NOTHING — re-applying the migration is a
--   no-op once the 5 rows exist (per cohort_definitions.name UNIQUE).
--
-- compiled_sql notes:
--   The Phase 27 cohort_profile_view exposes 15 fields with null:: placeholders
--   for columns not yet wired. The free-user / post-activation rules use
--   already-wired columns (has_active_subscription, has_completed_onboarding).
--   trial-day-3 / trial-day-7 / past-due-3d reference columns that consumer
--   phases will wire — until then those cohorts populate 0 rows at rebuild,
--   which is the documented intent (see cohort_profile_view comment).
--
-- All rows ship with status='active' so cohort_membership_rebuild() picks them
--   up immediately at next 15-min tick.

insert into public.cohort_definitions (name, rule, compiled_sql, status)
values
  (
    'free-user',
    jsonb_build_object(
      'phase', 39,
      'description', 'Users without an active paid subscription',
      'predicate', jsonb_build_object('has_active_subscription', false)
    ),
    'p.has_active_subscription = false',
    'active'
  ),
  (
    'past-due-3d',
    jsonb_build_object(
      'phase', 39,
      'description', 'Past-due subscribers >= 3 days overdue',
      'predicate', jsonb_build_object('subscription_status', 'past_due', 'days_overdue_gte', 3)
    ),
    -- Placeholder until subscriptions.past_due wiring lands on cohort_profile_view.
    -- Today this matches 0 rows (account_state defaults to ''active''); intentional per
    -- the view''s null-placeholder pattern (see 20270602000010_cohort_definitions.sql).
    'p.account_state = ''past_due''',
    'active'
  ),
  (
    'trial-day-3',
    jsonb_build_object(
      'phase', 39,
      'description', 'Users currently on day 3 of their trial',
      'predicate', jsonb_build_object('trial_day', 3)
    ),
    -- days_since_signup approximates trial-day window pre-trial_started_at wiring.
    'p.days_since_signup = 3',
    'active'
  ),
  (
    'trial-day-7',
    jsonb_build_object(
      'phase', 39,
      'description', 'Users currently on day 7 of their trial',
      'predicate', jsonb_build_object('trial_day', 7)
    ),
    'p.days_since_signup = 7',
    'active'
  ),
  (
    'post-activation',
    jsonb_build_object(
      'phase', 39,
      'description', 'Users who have completed the Phase 34 activation event',
      'predicate', jsonb_build_object('has_completed_onboarding', true)
    ),
    'p.has_completed_onboarding = true',
    'active'
  )
on conflict (name) do nothing;
