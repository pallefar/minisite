-- Phase 45 Plan 45-02 — widen notification category CHECK constraints across
-- the 4 sibling tables to include 'community-dm' + 'community-admin-report';
-- seed the two new notification_category_config rows.
--
-- HARD BLOCKER per RESEARCH §Pitfall 1: the 4 notification tables currently
-- enumerate only the Phase 44-widened 7-category set (dose-reminders,
-- ai-insights, clinic-alerts, billing, marketing, community-mentions,
-- community-replies). The dm-create-thread Edge Fn (plan 45-04) and the
-- community-admin-report-digest cron (plan 45-05) would trigger Postgres
-- CHECK constraint violation 23514 at production runtime without this
-- migration.
--
-- Per feedback_planner_missed_status_enum_widening + Phase 44 44-02 lesson:
-- ALL 4 CHECK constraints PLUS the notification_category_config seed MUST
-- land in the SAME migration and the SAME transaction. Splitting across
-- migrations = production 500 mid-deploy.
--
-- Live-DB pre-check (execute-time, 2026-05-24): the migrations on disk that
-- touch these CHECK constraints are:
--   20270720000004_p44_notification_community.sql (P44, +mentions/+replies)
--   20270901000012_p48_notification_settings_widen_banned_word_escalate.sql
-- Phase 48 lands AFTER this migration timestamp (2027-09-01 vs 2027-07-27),
-- so it will re-widen its own CHECK to the 8-category set independently.
-- This file extends the Phase 44 7-category set to a 9-category set
-- (adding community-dm + community-admin-report). The two widenings are
-- additive on different timestamps and do NOT collide.
--
-- Threat model (from PLAN 45-02 <threat_model>):
--   T-45-02 (DoS via DM flood): daily_cap=10 for community-dm.
--   D-RPT (admin report digest): daily_cap=1 for community-admin-report.
--
-- Seed-row defaults rationale (from PLAN §Task 1 + RESEARCH §Pattern 6):
--   community-dm:
--     daily_cap=10  weekly_cap=null  urgent_escalation=false
--     push=true email=true in_app=true
--     (DMs are direct/explicit — opt-in to all channels by default)
--   community-admin-report:
--     daily_cap=1   weekly_cap=null  urgent_escalation=false
--     push=false email=true in_app=false
--     (daily digest to staff only; email is the canonical channel)
--
-- UPSERT per reference_state_counter_table_needs_upsert_on_event so a
-- re-apply does not silently no-op on the seed.

begin;

-- 1. Widen all 4 notification tables in one atomic transaction.
--    Existing Phase 44 7-category set + Phase 45 additions (community-dm,
--    community-admin-report). Order matches the analog
--    (20270720000004_p44_notification_community.sql) with new entries appended.

alter table public.notification_settings
  drop constraint if exists notification_settings_category_chk,
  add  constraint notification_settings_category_chk
    check (category in (
      'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
      'community-mentions', 'community-replies',
      'community-dm', 'community-admin-report'
    ));

alter table public.notification_category_config
  drop constraint if exists notification_category_config_category_chk,
  add  constraint notification_category_config_category_chk
    check (category in (
      'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
      'community-mentions', 'community-replies',
      'community-dm', 'community-admin-report'
    ));

alter table public.user_notifications
  drop constraint if exists user_notifications_category_chk,
  add  constraint user_notifications_category_chk
    check (category in (
      'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
      'community-mentions', 'community-replies',
      'community-dm', 'community-admin-report'
    ));

alter table public.notification_dismissal_state
  drop constraint if exists notification_dismissal_state_category_chk,
  add  constraint notification_dismissal_state_category_chk
    check (category in (
      'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
      'community-mentions', 'community-replies',
      'community-dm', 'community-admin-report'
    ));

-- 2. Seed the two new category config rows. UPSERT so re-apply is idempotent
--    (reference_state_counter_table_needs_upsert_on_event: bare UPDATE
--    silently no-ops on first event).

insert into public.notification_category_config
  (category, daily_cap, weekly_cap, urgent_escalation,
   push_enabled_default, email_enabled_default, in_app_enabled_default)
values
  ('community-dm',            10,   null, false, true,  true, true),
  ('community-admin-report',   1,   null, false, false, true, false)
on conflict (category) do update set
  daily_cap              = excluded.daily_cap,
  weekly_cap             = excluded.weekly_cap,
  urgent_escalation      = excluded.urgent_escalation,
  push_enabled_default   = excluded.push_enabled_default,
  email_enabled_default  = excluded.email_enabled_default,
  in_app_enabled_default = excluded.in_app_enabled_default,
  updated_at             = now();

commit;
