-- =============================================================================
-- Phase 34 Plan 01 — public.activation_events ALTER (D-03 + D-10)
--
-- The table already exists from Phase 38 migration
-- 20270705000013_phase38_plan_personalize_facts_fn.sql as a SHELL with columns
-- (user_id pk, activated_at, activation_score, updated_at). Phase 34 extends
-- the shell with goal/action metadata so the record-activation Edge Fn (Plan
-- 34-03) can write goal-aware activation events.
--
-- Per RESEARCH Pitfall 6: this migration MUST be ALTER-only. The plan's
-- automated check rejects the file if any CREATE-TABLE-on-activation_events
-- statement appears (would conflict with the Phase 38 shell).
--
-- Per [[feedback_planner_missed_status_enum_widening]]: ship the goal_type
-- CHECK constraint in the SAME migration as the column to avoid future 23514
-- errors when the record-activation Edge Fn writes a new goal value before a
-- later migration widens the constraint.
-- =============================================================================

alter table public.activation_events
  add column if not exists goal_type   text,
  add column if not exists action_type text,
  add column if not exists window_days int,
  add column if not exists source      text;

-- ---------------------------------------------------------------------------
-- goal_type CHECK constraint (8-goal catalog, mirrors profiles.primary_goal)
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.activation_events'::regclass
      and conname = 'activation_events_goal_type_check'
  ) then
    alter table public.activation_events
      add constraint activation_events_goal_type_check
        check (goal_type is null or goal_type in (
          'lose-weight',
          'build-muscle',
          'new-prescription',
          'build-habit',
          'doctor-monitored',
          'family-supporter',
          'manage-symptoms',
          'track-with-vial-supply'
        ));
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- RLS — user-self-read only (writes via service-role Edge Fn)
-- ---------------------------------------------------------------------------
-- D-10: signed-in user can read their OWN activation row; never write directly.
-- The record-activation Edge Fn (Plan 34-03) writes with the service-role key
-- and bypasses RLS. No INSERT / UPDATE / DELETE policies → default-deny for
-- authenticated/anon roles.

alter table public.activation_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'activation_events'
      and policyname = 'activation_events_user_self_read'
  ) then
    create policy activation_events_user_self_read
      on public.activation_events
      for select to authenticated
      using (user_id = auth.uid());
  end if;
end$$;

comment on column public.activation_events.goal_type   is 'P34 D-03: goal at the moment of activation (8-goal catalog, mirrors profiles.primary_goal).';
comment on column public.activation_events.action_type is 'P34 D-03: action that triggered activation (e.g., first_injection, first_weight, first_food_log).';
comment on column public.activation_events.window_days is 'P34 D-03: days since signup at activation.';
comment on column public.activation_events.source      is 'P34 D-03: event source (e.g., record-activation Edge Fn caller).';
