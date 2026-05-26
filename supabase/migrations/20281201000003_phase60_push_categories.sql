-- Phase 60 Plan 60-01 — data-layer foundation (file 3-of-3): push-category widening
-- ============================================================================
--
-- Widens the 4 notification_* CHECK constraints to include 'research_tips',
-- then seeds notification_category_config with research-tips defaults.
-- Follows Phase 54 widening pattern verbatim (20280201000002_p54_notification_helpdesk_widening.sql).
--
-- RAG-07: research_tips category enables Tip-of-Day push notifications (60-11).
-- Honors existing Phase 54 freq-cap + quiet-hours infrastructure (no changes needed there).
--
-- FULL CATEGORY HISTORY (cumulative per migration comments):
--   P44 (20270720000004): dose-reminders, ai-insights, clinic-alerts, billing, marketing,
--                          community-mentions, community-replies                      (7)
--   P45 (20270727000004): + community-dm, community-admin-report                      (9)
--   P47 (20270801000006): + event_reminders_1d, event_reminders_1h, event_promotion  (12)
--   P48 (20270901000012): + banned_word_escalate                                     (13)
--   P49 (20271001000005): + daily_community_digest, weekly_community_digest           (15)
--   P54 (20280201000002): + helpdesk-reply                                            (16)
--   P60 (this file):      + research_tips                                             (17)
--
-- PITFALL WARNING: drift between any of the 4 CHECK constraints causes SILENT
-- Edge Fn rejection at the category boundary (Pitfall 4 from 54-RESEARCH.md).
-- This migration drops+adds ALL 4 constraints in a SINGLE TRANSACTION (BEGIN/COMMIT)
-- to ensure they are always in sync. Never split across migrations.
--
-- T-60-01-09 mitigation: single transaction = atomic widening of all 4 tables.
-- Seed defaults for research_tips (RAG-07, CONTEXT.md Tip-of-Day):
--   daily_cap=1, weekly_cap=7, urgent_escalation=false
--   push=true, email=true, in_app=true (single tip per day; honors P54 freq-cap)
--
-- Idempotent: on conflict (category) do nothing; drop+add constraints are safe to replay.
-- ============================================================================

begin;

-- 1. notification_settings CHECK widen (full 16-category P54 baseline + research_tips)
alter table public.notification_settings
  drop constraint if exists notification_settings_category_chk,
  add  constraint notification_settings_category_chk
    check (category in (
      'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
      'community-mentions', 'community-replies',
      'community-dm', 'community-admin-report',
      'event_reminders_1d', 'event_reminders_1h', 'event_promotion',
      'banned_word_escalate',
      'daily_community_digest', 'weekly_community_digest',
      'helpdesk-reply',
      'research_tips'
    ));

-- 2. notification_category_config CHECK widen (same 17-category list)
alter table public.notification_category_config
  drop constraint if exists notification_category_config_category_chk,
  add  constraint notification_category_config_category_chk
    check (category in (
      'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
      'community-mentions', 'community-replies',
      'community-dm', 'community-admin-report',
      'event_reminders_1d', 'event_reminders_1h', 'event_promotion',
      'banned_word_escalate',
      'daily_community_digest', 'weekly_community_digest',
      'helpdesk-reply',
      'research_tips'
    ));

-- 3. user_notifications CHECK widen (same 17-category list)
alter table public.user_notifications
  drop constraint if exists user_notifications_category_chk,
  add  constraint user_notifications_category_chk
    check (category in (
      'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
      'community-mentions', 'community-replies',
      'community-dm', 'community-admin-report',
      'event_reminders_1d', 'event_reminders_1h', 'event_promotion',
      'banned_word_escalate',
      'daily_community_digest', 'weekly_community_digest',
      'helpdesk-reply',
      'research_tips'
    ));

-- 4. notification_dismissal_state CHECK widen (same 17-category list)
alter table public.notification_dismissal_state
  drop constraint if exists notification_dismissal_state_category_chk,
  add  constraint notification_dismissal_state_category_chk
    check (category in (
      'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
      'community-mentions', 'community-replies',
      'community-dm', 'community-admin-report',
      'event_reminders_1d', 'event_reminders_1h', 'event_promotion',
      'banned_word_escalate',
      'daily_community_digest', 'weekly_community_digest',
      'helpdesk-reply',
      'research_tips'
    ));

-- 5. Seed defaults for research_tips (RAG-07, CONTEXT.md Tip-of-Day config)
--    daily_cap=1: one tip per day maximum
--    weekly_cap=7: up to one per day over 7 days
--    urgent_escalation=false: tips are informational, not urgent
--    push/email/in_app all enabled_default=true: broad reach for awareness
--    on conflict (category) do nothing: operators may tune post-launch; no-op re-deploy safe
insert into public.notification_category_config
  (category, daily_cap, weekly_cap, urgent_escalation,
   push_enabled_default, email_enabled_default, in_app_enabled_default)
values
  ('research_tips', 1, 7, false, true, true, true)
on conflict (category) do nothing;

-- 6. Constraint documentation (non-comment SQL — plan-checker greps count
--    research_tips as live references per Phase 54 §6 pattern).
comment on constraint notification_settings_category_chk
  on public.notification_settings is
  'Phase 60 widened: includes research_tips (RAG-07) appended to Phase 54 16-category set.';
comment on constraint notification_category_config_category_chk
  on public.notification_category_config is
  'Phase 60 widened: includes research_tips (RAG-07) appended to Phase 54 16-category set.';

commit;

-- end migration 20281201000003
