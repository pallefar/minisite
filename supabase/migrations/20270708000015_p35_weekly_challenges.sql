-- Phase 35 Plan 35-05 GAME-05 — Weekly challenges table.
-- Status enum CHECK ships with FULL 4-value list at table creation per
-- memory feedback_planner_missed_status_enum_widening — even if Phase 35 only
-- writes 'draft'/'active', future writers cannot retrofit the CHECK without
-- a separate migration.

create table public.weekly_challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 3 and 100),
  -- Default framing; A/B variants may override
  framing text not null check (length(framing) between 3 and 280),
  -- D-17 challenge_type enum: log_count | streak_days | specific_action
  challenge_type text not null check (challenge_type in ('log_count','streak_days','specific_action')),
  threshold int not null check (threshold > 0 and threshold <= 1000),
  -- specific_action requires action_type detail when challenge_type='specific_action'
  action_type text check (action_type is null or action_type in ('injection_log','weight_log','symptom_log','workout_log')),
  -- D-17 duration enum
  duration text not null check (duration in ('week','month')),
  -- D-17: cohort_id nullable — null = global (all users); else cohort-scoped
  cohort_id uuid references public.cohort_definitions(id) on delete cascade,
  -- D-19 reward fields — admin picks any combination
  reward_xp int not null default 0 check (reward_xp >= 0 and reward_xp <= 10000),
  -- Badge unlock reward (admin picks a badge_id from badge_catalog)
  reward_badge_id text references public.badge_catalog(id) on delete set null,
  -- Freeze token reward (+1 to stockpile, respects D-08 cap of 3)
  reward_freeze_tokens int not null default 0 check (reward_freeze_tokens between 0 and 3),
  -- D-19 type 4: combo / cross-streak — admin picks the combo badge
  reward_combo_badge_id text references public.badge_catalog(id) on delete set null,
  -- A/B variants binding (D-20) — PostHog Experiments flag ID
  posthog_flag_id text,
  -- CRITICAL: status CHECK ships with FULL 4-value list at table-creation time per
  -- memory feedback_planner_missed_status_enum_widening.
  status text not null default 'draft' check (status in ('draft','active','completed','archived')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Defensive constraint: non-draft rows MUST have starts_at + ends_at set (and ends_at > starts_at)
  constraint chk_active_dates check (
    status = 'draft' or (
      starts_at is not null and ends_at is not null and ends_at > starts_at
    )
  ),
  -- specific_action type requires action_type
  constraint chk_specific_action_type check (
    challenge_type <> 'specific_action' or action_type is not null
  )
);

create index idx_weekly_challenges_active on public.weekly_challenges (status, ends_at)
  where status = 'active';

create index idx_weekly_challenges_cohort on public.weekly_challenges (cohort_id)
  where cohort_id is not null;

alter table public.weekly_challenges enable row level security;

-- All authenticated users read active + completed challenges (needed by client
-- to render WeeklyChallengeCard via Plan 35-06)
create policy "weekly_challenges_read_active" on public.weekly_challenges
  for select to authenticated using (status = 'active' or status = 'completed');

-- service_role bypasses RLS already, but explicit policy for grep-able intent
create policy "weekly_challenges_service_write" on public.weekly_challenges
  for all to service_role with check (true);

-- NO INSERT/UPDATE/DELETE policies for authenticated — all writes through
-- create_weekly_challenge SECDEF RPC (Plan 35-05 Task 2) for admin-role enforcement.

comment on table public.weekly_challenges is
  'Phase 35 GAME-05 — admin-curated weekly challenges. Status enum has FULL value '
  'list at creation per memory feedback_planner_missed_status_enum_widening. '
  'Cohort_id nullable: null=global; D-18 enforced in evaluate_challenge_progress_for_user '
  '(max 2 active per user, cohort wins). Reward types per D-19.';
