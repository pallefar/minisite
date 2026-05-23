-- Phase 44 Plan 44-02 — widen notification category CHECK constraints + seed
-- community category config rows.
--
-- HARD BLOCKER per RESEARCH §3.1: the 4 notification tables have CHECK
-- constraints that enumerate only the original 5 categories. The
-- notify-community Edge Fn (plan 44-05) would trigger a Postgres CHECK
-- constraint violation without this migration.
--
-- Per feedback_planner_missed_status_enum_widening: ALL 4 CHECK constraints
-- plus the notification_category_config seed MUST land in the SAME migration
-- and the SAME transaction. Splitting across migrations = production 500.
--
-- Threat model:
--   T-44-06 (DoS via mention flood): daily_cap=20 for community-mentions.
--   D-14 fan-out asymmetry: community-mentions email=true, community-replies email=false.

begin;

-- 1. Widen all 4 notification tables in one atomic transaction.
--    Original 5 categories: dose-reminders, ai-insights, clinic-alerts, billing, marketing.
--    Adding: community-mentions, community-replies.

alter table public.notification_settings
  drop constraint if exists notification_settings_category_chk,
  add constraint notification_settings_category_chk
    check (category in (
      'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
      'community-mentions', 'community-replies'
    ));

alter table public.notification_category_config
  drop constraint if exists notification_category_config_category_chk,
  add constraint notification_category_config_category_chk
    check (category in (
      'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
      'community-mentions', 'community-replies'
    ));

alter table public.user_notifications
  drop constraint if exists user_notifications_category_chk,
  add constraint user_notifications_category_chk
    check (category in (
      'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
      'community-mentions', 'community-replies'
    ));

alter table public.notification_dismissal_state
  drop constraint if exists notification_dismissal_state_category_chk,
  add constraint notification_dismissal_state_category_chk
    check (category in (
      'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
      'community-mentions', 'community-replies'
    ));

-- 2. Seed new category config rows.
--    community-mentions: email=true  (Skool parity, D-14 fan-out: mentions deserve email)
--    community-replies:  email=false (conservative D-14 fan-out; reply notifications in-app only)
--    Both: push=false (no push implemented for community yet), in_app=true.
--    daily_cap=20 for both — mention spam DoS defense (T-44-06).
--
--    UPSERT per reference_state_counter_table_needs_upsert_on_event: bare UPDATE
--    silently no-ops on first event. ON CONFLICT ... DO UPDATE ensures idempotency.

insert into public.notification_category_config
  (category, daily_cap, weekly_cap, urgent_escalation,
   push_enabled_default, email_enabled_default, in_app_enabled_default)
values
  ('community-mentions', 20, null, false, false, true,  true),
  ('community-replies',  20, null, false, false, false, true)
on conflict (category) do update set
  daily_cap              = excluded.daily_cap,
  weekly_cap             = excluded.weekly_cap,
  urgent_escalation      = excluded.urgent_escalation,
  push_enabled_default   = excluded.push_enabled_default,
  email_enabled_default  = excluded.email_enabled_default,
  in_app_enabled_default = excluded.in_app_enabled_default,
  updated_at             = now();

commit;
