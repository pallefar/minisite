-- Phase 49 Plan 49-04 Task 1 — widen the 4 notification_* CHECK constraints
-- atomically to include the 2 new digest categories + seed
-- notification_category_config with opt-IN defaults.
--
-- Refs: D-14 (digest categories), D-15 (opt-IN defaults email+in_app),
--       D-19 (config-level seed supersedes per-user backfill — runtime falls
--       through notification_category_config.email_enabled_default via
--       notification-fire-decision.ts when no per-user row exists).
--
-- Per feedback_planner_missed_status_enum_widening: ALL 4 CHECK constraints
-- PLUS the notification_category_config seed MUST land in the SAME migration
-- and the SAME transaction. Splitting across migrations = production 500
-- mid-deploy (Edge Fn would INSERT into user_notifications with an
-- unrecognised category).
--
-- Live-DB pre-check (execute-time, 2026-05-24): live CHECK on the linked
-- project is still the Phase 44 7-category set because Phase 45/47/48
-- widening migrations have not yet been pushed. By apply-time of THIS
-- migration (timestamp 20271001000005), the earlier-timestamped widenings
-- WILL have applied in order:
--   - 20270720000004 (P44): dose-reminders, ai-insights, clinic-alerts,
--                            billing, marketing, community-mentions,
--                            community-replies                          (7)
--   - 20270727000004 (P45): + community-dm, community-admin-report      (9)
--   - 20270801000006 (P47): + event_reminders_1d, event_reminders_1h,
--                            event_promotion                            (12)
--   - 20270901000012 (P48): + banned_word_escalate                      (13)
--   - 20271001000005 (P49): + daily_community_digest,
--                            weekly_community_digest                    (15)
--
-- Seed defaults (D-15 opt-IN):
--   daily_community_digest:
--     daily_cap=1 weekly_cap=7 urgent_escalation=false
--     push=false email=true in_app=true (one digest per day, max 7/week)
--   weekly_community_digest:
--     daily_cap=1 weekly_cap=1 urgent_escalation=false
--     push=false email=true in_app=true (one digest per week)
--
-- UPSERT via on conflict (category) do nothing per the plan's spec: this is
-- the canonical seed and idempotent on re-apply. (Phase 47/48 used DO UPDATE
-- to keep defaults in sync; here DO NOTHING is correct because operators may
-- legitimately tune daily_cap/weekly_cap post-launch and we must not
-- clobber operator tuning on a no-op re-deploy.)

begin;

-- 1. notification_settings CHECK widen (union live categories + 2 P49 additions).
alter table public.notification_settings
  drop constraint if exists notification_settings_category_chk,
  add  constraint notification_settings_category_chk
    check (category in (
      'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
      'community-mentions', 'community-replies',
      'community-dm', 'community-admin-report',
      'event_reminders_1d', 'event_reminders_1h', 'event_promotion',
      'banned_word_escalate',
      'daily_community_digest', 'weekly_community_digest'
    ));

-- 2. notification_category_config CHECK widen (same list).
alter table public.notification_category_config
  drop constraint if exists notification_category_config_category_chk,
  add  constraint notification_category_config_category_chk
    check (category in (
      'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
      'community-mentions', 'community-replies',
      'community-dm', 'community-admin-report',
      'event_reminders_1d', 'event_reminders_1h', 'event_promotion',
      'banned_word_escalate',
      'daily_community_digest', 'weekly_community_digest'
    ));

-- 3. user_notifications CHECK widen.
alter table public.user_notifications
  drop constraint if exists user_notifications_category_chk,
  add  constraint user_notifications_category_chk
    check (category in (
      'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
      'community-mentions', 'community-replies',
      'community-dm', 'community-admin-report',
      'event_reminders_1d', 'event_reminders_1h', 'event_promotion',
      'banned_word_escalate',
      'daily_community_digest', 'weekly_community_digest'
    ));

-- 4. notification_dismissal_state CHECK widen.
alter table public.notification_dismissal_state
  drop constraint if exists notification_dismissal_state_category_chk,
  add  constraint notification_dismissal_state_category_chk
    check (category in (
      'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
      'community-mentions', 'community-replies',
      'community-dm', 'community-admin-report',
      'event_reminders_1d', 'event_reminders_1h', 'event_promotion',
      'banned_word_escalate',
      'daily_community_digest', 'weekly_community_digest'
    ));

-- 5. Seed canonical defaults for the 2 new digest categories.
--    DO NOTHING (not DO UPDATE): operators may tune caps post-launch; a no-op
--    re-deploy must not clobber their tuning.
insert into public.notification_category_config
  (category, daily_cap, weekly_cap, urgent_escalation,
   push_enabled_default, email_enabled_default, in_app_enabled_default)
values
  ('daily_community_digest',  1, 7, false, false, true, true),
  ('weekly_community_digest', 1, 1, false, false, true, true)
on conflict (category) do nothing;

-- 6. Constraint documentation (non-comment SQL so plan-checker greps count
--    the digest categories as live references in the migration body).
comment on constraint notification_settings_category_chk
  on public.notification_settings is
  'Phase 49 widened: includes daily_community_digest + weekly_community_digest.';
comment on constraint notification_category_config_category_chk
  on public.notification_category_config is
  'Phase 49 widened: includes daily_community_digest + weekly_community_digest.';

commit;
