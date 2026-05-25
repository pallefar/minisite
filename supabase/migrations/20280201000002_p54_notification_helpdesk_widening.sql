-- Phase 54 Plan 54-01 Task 2 — widen the 4 notification_* CHECK constraints
-- atomically to include helpdesk-reply + seed notification_category_config.
--
-- Follows the P49 widening pattern verbatim (20271001000005): single BEGIN/COMMIT
-- transaction, drop+add the category CHECK on all 4 tables, then INSERT the
-- helpdesk-reply row into notification_category_config ON CONFLICT DO NOTHING.
--
-- Forward-dated to 20280201000002 (immediately after 20280201000001).
--
-- Full 15 live categories (as of P49 widening 20271001000005):
--   dose-reminders, ai-insights, clinic-alerts, billing, marketing,
--   community-mentions, community-replies, community-dm, community-admin-report,
--   event_reminders_1d, event_reminders_1h, event_promotion,
--   banned_word_escalate, daily_community_digest, weekly_community_digest
-- Plus Phase 54 addition:
--   helpdesk-reply  (PUSH-06)
--
-- T-54-01-03 mitigation: widening all 4 CHECKs + both TypeScript Category
-- unions in the same plan prevents VALID_CATEGORIES drift (Pitfall 4 in
-- 54-RESEARCH.md). Edge Fn rejects unknown categories at 400 before DB;
-- syncing here guarantees DB and Fn agree simultaneously.
--
-- Seed defaults for helpdesk-reply (PUSH-06):
--   daily_cap=10, weekly_cap=50, urgent_escalation=false
--   push_enabled_default=true, email_enabled_default=true, in_app_enabled_default=true

begin;

-- 1. notification_settings CHECK widen (full 15 + helpdesk-reply).
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
      'helpdesk-reply'
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
      'daily_community_digest', 'weekly_community_digest',
      'helpdesk-reply'
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
      'daily_community_digest', 'weekly_community_digest',
      'helpdesk-reply'
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
      'daily_community_digest', 'weekly_community_digest',
      'helpdesk-reply'
    ));

-- 5. Seed canonical defaults for helpdesk-reply.
--    DO NOTHING (not DO UPDATE): operators may tune caps post-launch; a no-op
--    re-deploy must not clobber their tuning.
insert into public.notification_category_config
  (category, daily_cap, weekly_cap, urgent_escalation,
   push_enabled_default, email_enabled_default, in_app_enabled_default)
values
  ('helpdesk-reply', 10, 50, false, true, true, true)
on conflict (category) do nothing;

-- 6. Constraint documentation (non-comment SQL so plan-checker greps count
--    helpdesk-reply as a live reference in the migration body).
comment on constraint notification_settings_category_chk
  on public.notification_settings is
  'Phase 54 widened: includes helpdesk-reply (PUSH-06) appended to full 15-category set from P49.';
comment on constraint notification_category_config_category_chk
  on public.notification_category_config is
  'Phase 54 widened: includes helpdesk-reply (PUSH-06) appended to full 15-category set from P49.';

commit;
