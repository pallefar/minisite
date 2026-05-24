-- Phase 47 Plan 47-04 — widen notification category CHECK constraints across the
-- 4 sibling tables to include the 3 event categories; seed the
-- notification_category_config rows; backfill per-user notification_settings.
--
-- HARD BLOCKER per RESEARCH §Pitfall 1 (mirroring Phase 44/45 lessons): the 4
-- notification tables enumerate categories via CHECK constraints. The
-- event-reminders-fanout Edge Fn (Phase 47 later plans) would trigger Postgres
-- CHECK violation 23514 at production runtime without this migration.
--
-- Per feedback_planner_missed_status_enum_widening + Phase 44/45 lesson:
-- ALL 4 CHECK constraints PLUS the notification_category_config seed PLUS the
-- per-user backfill MUST land in the SAME migration and the SAME transaction.
-- Splitting across migrations = production 500 mid-deploy.
--
-- Live-DB timestamp ordering: this migration is dated 2027-08-01 and lands
-- BETWEEN Phase 45's 2027-07-27 widening (which extended to a 9-category set
-- by adding community-dm + community-admin-report) and Phase 48's 2027-09-01
-- widening (which re-widens its own snapshot to add banned_word_escalate).
-- Therefore at this migration's apply time, the existing CHECK includes the
-- Phase 45 9-category set; this file widens to a 12-category set. Phase 48's
-- own widening will be additive on its own timestamp.
--
-- P47 D-19: widen VALID_CATEGORIES with event_reminders_1d / event_reminders_1h
-- / event_promotion. Underscored per D-19 spec (Phase 44/45 used hyphens for
-- community-*; the CHECK constraint doesn't care about case style).
--
-- Threat model:
--   T-47-17 (category enum drift between tables): single transaction widens all
--           4 tables atomically — no visible state has inconsistent enum.
--
-- Seed-row defaults rationale (per D-19 + Phase 45 pattern):
--   event_reminders_1d:
--     daily_cap=5 weekly_cap=null urgent_escalation=false
--     push=true email=true in_app=true  (day-before nudge for an opted-in event)
--   event_reminders_1h:
--     daily_cap=5 weekly_cap=null urgent_escalation=false
--     push=true email=false in_app=true (hour-before nudge — push+in-app; email
--     omitted to reduce churn on the same opt-in)
--   event_promotion:
--     daily_cap=2 weekly_cap=null urgent_escalation=false
--     push=false email=true in_app=true (marketing-style; email is canonical;
--     no push to avoid promo push-spam)
--
-- UPSERT per reference_state_counter_table_needs_upsert_on_event so a re-apply
-- does not silently no-op on the seed.
--
-- Per-user backfill: per feedback_state_counter_table_needs_upsert_on_event the
-- new notification_settings rows are inserted with ON CONFLICT (user_id, category)
-- DO NOTHING — defaults ON for existing users, idempotent on re-apply.

begin;

-- 1. Widen all 4 notification tables in one atomic transaction.
--    Existing Phase 45 9-category set + Phase 47 additions
--    (event_reminders_1d, event_reminders_1h, event_promotion).

alter table public.notification_settings
  drop constraint if exists notification_settings_category_chk,
  add  constraint notification_settings_category_chk
    check (category in (
      'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
      'community-mentions', 'community-replies',
      'community-dm', 'community-admin-report',
      'event_reminders_1d', 'event_reminders_1h', 'event_promotion'
    ));

alter table public.notification_category_config
  drop constraint if exists notification_category_config_category_chk,
  add  constraint notification_category_config_category_chk
    check (category in (
      'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
      'community-mentions', 'community-replies',
      'community-dm', 'community-admin-report',
      'event_reminders_1d', 'event_reminders_1h', 'event_promotion'
    ));

alter table public.user_notifications
  drop constraint if exists user_notifications_category_chk,
  add  constraint user_notifications_category_chk
    check (category in (
      'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
      'community-mentions', 'community-replies',
      'community-dm', 'community-admin-report',
      'event_reminders_1d', 'event_reminders_1h', 'event_promotion'
    ));

alter table public.notification_dismissal_state
  drop constraint if exists notification_dismissal_state_category_chk,
  add  constraint notification_dismissal_state_category_chk
    check (category in (
      'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing',
      'community-mentions', 'community-replies',
      'community-dm', 'community-admin-report',
      'event_reminders_1d', 'event_reminders_1h', 'event_promotion'
    ));

-- 2. Seed the three new category config rows. UPSERT so re-apply is idempotent
--    (reference_state_counter_table_needs_upsert_on_event: bare UPDATE
--    silently no-ops on first event; ON CONFLICT DO UPDATE keeps the row in
--    sync with the canonical defaults shipped here).

insert into public.notification_category_config
  (category, daily_cap, weekly_cap, urgent_escalation,
   push_enabled_default, email_enabled_default, in_app_enabled_default)
values
  ('event_reminders_1d', 5, null, false, true,  true,  true),
  ('event_reminders_1h', 5, null, false, true,  false, true),
  ('event_promotion',    2, null, false, false, true,  true)
on conflict (category) do update set
  daily_cap              = excluded.daily_cap,
  weekly_cap             = excluded.weekly_cap,
  urgent_escalation      = excluded.urgent_escalation,
  push_enabled_default   = excluded.push_enabled_default,
  email_enabled_default  = excluded.email_enabled_default,
  in_app_enabled_default = excluded.in_app_enabled_default,
  updated_at             = now();

-- 3. Backfill per-user notification_settings — defaults ON for existing users.
--    INSERT … ON CONFLICT (user_id, category) DO NOTHING per
--    feedback_state_counter_table_needs_upsert_on_event: idempotent on re-apply,
--    no clobber of users who have already opted out.
--    in_app = true and email = true match the config seed for 1d/1h/promotion
--    (push toggle is a separate column added in Phase 48; not present on
--    notification_settings here per the original Phase 44 schema).

insert into public.notification_settings (user_id, category, in_app, email)
select p.id, c.category, true, true
  from public.profiles p
  cross join (
    values
      ('event_reminders_1d'),
      ('event_reminders_1h'),
      ('event_promotion')
  ) as c(category)
on conflict (user_id, category) do nothing;

commit;
