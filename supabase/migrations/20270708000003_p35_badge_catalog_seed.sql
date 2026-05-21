-- Phase 35 Research OQ-5 + CONTEXT Claude's-Discretion — badge_catalog reference table
-- + 17-badge seed (5 streak + 7 level + 3 challenge-category + 1 combo + 1 social-proof).
-- Also adds FK from badge_unlocks.badge_id → badge_catalog.id (ordered after table creation).
-- Pattern: PATTERNS §1 affiliate CHECK-via-enum; greenfield reference table.
-- Named dollar-quote tags per project convention (none needed in this DDL-only file).

-- ============================================================
-- TABLE: public.badge_catalog
-- Reference data for badge definitions; 17-badge seed below.
-- ============================================================

create table if not exists public.badge_catalog (
  id          text        primary key,
  -- slug like 'streak-7', 'level-5', 'combo-cross-streak'
  name        text        not null,
  -- display name e.g. "Week-One Warrior"
  description text        not null,
  -- one-sentence flavor copy
  category    text        not null check (
    category in ('streak', 'level', 'challenge', 'combo', 'social')
  ),
  tier        int         not null check (tier between 1 and 5),
  -- visual tier: 1=bronze, 2=silver, 3=gold, 4=platinum, 5=mythic
  icon_slug   text        not null,
  -- lucide-react icon name; render lookup happens client-side
  xp_reward   int         not null default 0 check (xp_reward >= 0),
  -- D-01: badge unlock +0 (badge is the reward); admin can override
  created_at  timestamptz not null default now()
);

-- ============================================================
-- RLS: badge_catalog — select-anyone (reference data, non-secret)
-- Service-role ALL for admin SQL workflow (no admin UI in v1.3)
-- ============================================================

alter table public.badge_catalog enable row level security;

create policy "badge_catalog_select_all"
  on public.badge_catalog
  for select
  using (true);

create policy "badge_catalog_service_write"
  on public.badge_catalog
  for all
  to service_role
  with check (true);

-- ============================================================
-- FK: badge_unlocks.badge_id → badge_catalog.id
-- ON DELETE RESTRICT: cannot delete a badge that has been unlocked
-- ON UPDATE CASCADE: if badge id slug is renamed, unlock records follow
-- Added here (after badge_catalog creation) to avoid ordering issues
-- ============================================================

alter table public.badge_unlocks
  add constraint badge_unlocks_badge_id_fkey
  foreign key (badge_id)
  references public.badge_catalog(id)
  on update cascade
  on delete restrict;

-- ============================================================
-- SEED: 17 badges
-- Breakdown per Research OQ-5:
--   5 streak + 7 level + 3 challenge-category + 1 combo + 1 social-proof = 17
-- ON CONFLICT (id) DO NOTHING makes this migration idempotent.
-- ============================================================

insert into public.badge_catalog (id, name, description, category, tier, icon_slug, xp_reward)
values

  -- ─────────────────────────────────────────────────────────
  -- STREAK BADGES (5) — tier 1 through 5
  -- ─────────────────────────────────────────────────────────
  (
    'streak-3',
    'Spark',
    'You logged three days in a row — momentum starts here.',
    'streak', 1, 'flame', 0
  ),
  (
    'streak-7',
    'Week-One Warrior',
    'Seven consecutive days of logging — a full week of commitment.',
    'streak', 2, 'zap', 0
  ),
  (
    'streak-30',
    'Month of Momentum',
    'Thirty straight days logged — a habit is officially forming.',
    'streak', 3, 'calendar-check', 0
  ),
  (
    'streak-90',
    'Quarter Champion',
    'Ninety days without missing a beat — you''re in the long game now.',
    'streak', 4, 'shield', 0
  ),
  (
    'streak-365',
    'Year of Discipline',
    'An entire year of consistent logging — an extraordinary achievement.',
    'streak', 5, 'award', 0
  ),

  -- ─────────────────────────────────────────────────────────
  -- LEVEL BADGES (7) — tiers 1 through 5
  -- ─────────────────────────────────────────────────────────
  (
    'level-1',
    'First Step',
    'You reached level 1 — every journey begins with a single step.',
    'level', 1, 'footprints', 0
  ),
  (
    'level-5',
    'Steady Climber',
    'Level 5 achieved — you''re building real traction with your treatment.',
    'level', 2, 'trending-up', 0
  ),
  (
    'level-10',
    'Established',
    'Level 10 — you''ve established a meaningful logging practice.',
    'level', 3, 'star', 0
  ),
  (
    'level-25',
    'Veteran',
    'Level 25 — you''ve seen results and kept going anyway.',
    'level', 3, 'medal', 0
  ),
  (
    'level-50',
    'Master',
    'Level 50 — mastery of your own health data, earned through consistency.',
    'level', 4, 'trophy', 0
  ),
  (
    'level-100',
    'Legend',
    'Level 100 — a legendary milestone that few ever reach.',
    'level', 5, 'crown', 0
  ),
  (
    'prestige-1',
    'Prestige I',
    'Beyond level 100 — you''ve entered prestige territory.',
    'level', 5, 'gem', 0
  ),

  -- ─────────────────────────────────────────────────────────
  -- CHALLENGE-CATEGORY BADGES (3) — one per challenge_type
  -- ─────────────────────────────────────────────────────────
  (
    'challenge-log-count',
    'Logging Streak Done',
    'You completed a log-count challenge — consistent tracking pays off.',
    'challenge', 2, 'check-circle', 0
  ),
  (
    'challenge-streak-days',
    'Streak Goal Hit',
    'You completed a streak-days challenge — discipline meets achievement.',
    'challenge', 2, 'activity', 0
  ),
  (
    'challenge-specific-action',
    'Mission Accomplished',
    'You completed a specific-action challenge — you set a goal and delivered.',
    'challenge', 2, 'target', 0
  ),

  -- ─────────────────────────────────────────────────────────
  -- COMBO BADGE (1) — GAME-09 cross-streak compound unlock
  -- ─────────────────────────────────────────────────────────
  (
    'combo-cross-streak',
    'Compound Consistency',
    'Challenge completed while maintaining an active streak — the rarest discipline.',
    'combo', 4, 'layers', 0
  ),

  -- ─────────────────────────────────────────────────────────
  -- SOCIAL-PROOF BADGE (1) — D-12 first leaderboard opt-in
  -- ─────────────────────────────────────────────────────────
  (
    'social-leaderboard-first',
    'First on the Board',
    'You joined your cohort leaderboard for the first time — welcome to the community.',
    'social', 2, 'users', 0
  )

on conflict (id) do nothing;

-- ============================================================
-- TABLE COMMENT
-- ============================================================

comment on table public.badge_catalog is
  'Phase 35 — reference data for badge unlocks. '
  '17-badge seed (5 streak + 7 level + 3 challenge-category + 1 combo + 1 social-proof) '
  'per Research OQ-5. New badges added by admin via SQL (no v1.3 admin UI — deferred per CONTEXT). '
  'ON CONFLICT DO NOTHING makes the seed migration idempotent. '
  'icon_slug maps to lucide-react icon names; render lookup happens client-side.';
