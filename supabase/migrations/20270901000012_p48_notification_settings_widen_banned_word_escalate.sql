-- Phase 48 Plan 48-05 Task 3 — widen notification category CHECK constraints
-- across all 4 sibling tables to include `banned_word_escalate`; seed the
-- notification_category_config row.
--
-- Per feedback_planner_missed_status_enum_widening: ALL 4 CHECK constraints
-- plus the seed MUST land in the SAME migration and the SAME transaction.
-- Splitting across migrations = production 500 mid-deploy (email-router would
-- INSERT into user_notifications with an unrecognised category).
--
-- Live-DB pre-check (execute-time, 2026-05-23): Phase 47 event-categories
-- migration is NOT yet present on disk. The shipped CHECK lists are still the
-- Phase 44 widened 7-category set:
--   dose-reminders, ai-insights, clinic-alerts, billing, marketing,
--   community-mentions, community-replies
-- This migration extends that to 8 by adding `banned_word_escalate`. If
-- Phase 47 lands its `event_reminders_1d|1h|event_promotion` widening before
-- this migration is pushed, that widening will be additive on a different
-- timestamp; both extensions are CHECK-only and independent.
--
-- D-12: severity='escalate' fires urgent email to staff opted-in to the
-- `banned_word_escalate` category. Seed defaults:
--   urgent_escalation=true    (escalate-severity IS urgent by definition)
--   email_enabled_default=true
--   in_app_enabled_default=true
--   push_enabled_default=false (no community push pipeline yet, matches P44)
--   daily_cap=null + weekly_cap=null (no rate-limit on escalations)

begin;

alter table public.notification_settings
  drop constraint if exists notification_settings_category_chk,
  add  constraint notification_settings_category_chk
    check (category in (
      'dose-reminders','ai-insights','clinic-alerts','billing','marketing',
      'community-mentions','community-replies',
      'banned_word_escalate'
    ));

alter table public.notification_category_config
  drop constraint if exists notification_category_config_category_chk,
  add  constraint notification_category_config_category_chk
    check (category in (
      'dose-reminders','ai-insights','clinic-alerts','billing','marketing',
      'community-mentions','community-replies',
      'banned_word_escalate'
    ));

alter table public.user_notifications
  drop constraint if exists user_notifications_category_chk,
  add  constraint user_notifications_category_chk
    check (category in (
      'dose-reminders','ai-insights','clinic-alerts','billing','marketing',
      'community-mentions','community-replies',
      'banned_word_escalate'
    ));

alter table public.notification_dismissal_state
  drop constraint if exists notification_dismissal_state_category_chk,
  add  constraint notification_dismissal_state_category_chk
    check (category in (
      'dose-reminders','ai-insights','clinic-alerts','billing','marketing',
      'community-mentions','community-replies',
      'banned_word_escalate'
    ));

-- Seed row uses canonical Phase 42/44 schema columns (live-verified vs
-- 20270704000002_notification_category_config.sql +
-- 20270720000004_p44_notification_community.sql). UPSERT per
-- reference_state_counter_table_needs_upsert_on_event so re-applies don't
-- silently no-op on the seed.
insert into public.notification_category_config
  (category, daily_cap, weekly_cap, urgent_escalation,
   push_enabled_default, email_enabled_default, in_app_enabled_default)
values
  ('banned_word_escalate', null, null, true, false, true, true)
on conflict (category) do update set
  daily_cap              = excluded.daily_cap,
  weekly_cap             = excluded.weekly_cap,
  urgent_escalation      = excluded.urgent_escalation,
  push_enabled_default   = excluded.push_enabled_default,
  email_enabled_default  = excluded.email_enabled_default,
  in_app_enabled_default = excluded.in_app_enabled_default,
  updated_at             = now();

commit;
