-- Phase 42 Plan 42-05 (POLISH-05/06) — user_notifications (append-only fire history).
--
-- Source-of-truth row per fire attempt. Used for:
--   1. Frequency-cap window queries (firedTodayCount, firedThisWeekCount).
--   2. Per-user notification feed in /settings/notifications + in-app drawer.
--   3. Dismissal-rate sentiment input (D-05 — joins to notification_dismissal_state).
--   4. Audit trail for repudiation defense (T-42-05-06).
--
-- Append-only invariant: there is no DELETE policy. UPDATE allowed only for
-- dismissed_at / clicked_at / snoozed_at fields by the owning user (per
-- 20270704000006_notification_rls.sql).
--
-- payload jsonb is intentionally open per feedback_planner_iter1_anti_patterns
-- (no defensive jsonb contract). The notification-send Edge Fn zod-validates
-- shape for PHI-bearing categories (clinic-alerts → {subject, deeplink} only
-- per D-13). Other categories accept arbitrary payloads.

begin;

create table if not exists public.user_notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  category      text not null,
  channel       text not null,
  payload       jsonb not null default '{}'::jsonb,
  fired_at      timestamptz not null default now(),
  dismissed_at  timestamptz,
  clicked_at    timestamptz,
  snoozed_at    timestamptz,

  constraint user_notifications_category_chk
    check (category in ('dose-reminders','ai-insights','clinic-alerts','billing','marketing')),
  constraint user_notifications_channel_chk
    check (channel in ('email','web-push','in-app'))
);

-- Primary cap-window query index: per-user, per-category, ordered by fire time DESC.
create index if not exists user_notifications_user_cat_fired_idx
  on public.user_notifications (user_id, category, fired_at desc);

-- Dismissal-event query (D-05 sentiment tracking).
create index if not exists user_notifications_user_cat_dismissed_idx
  on public.user_notifications (user_id, category, dismissed_at desc)
  where dismissed_at is not null;

-- Recent-fires-per-user index for in-app feed.
create index if not exists user_notifications_user_fired_idx
  on public.user_notifications (user_id, fired_at desc);

commit;
