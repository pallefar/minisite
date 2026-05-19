-- Phase 42 Plan 42-05 (POLISH-05/06) — notification_settings table.
--
-- Per-user × category × channel preference matrix. Each user gets one row per
-- (category, channel) combo on first authenticated load (defaults seeded from
-- notification_category_config.{push,email,in_app}_enabled_default — copied by
-- the application or a trigger; see plan 42-08 Wave 3 settings UI).
--
-- Columns:
--   user_id              uuid  → auth.users(id) on delete cascade
--   category             text  CHECK ∈ {dose-reminders, ai-insights, clinic-alerts, billing, marketing}
--   channel              text  CHECK ∈ {email, web-push, in-app}
--   enabled              boolean default false (seeded per D-02 matrix by app code)
--   snoozed_until        timestamptz null  (D-06 per-category snooze)
--   user_cap_override    int null          (D-04 user-tunable cap, DOWNWARD only)
--   created_at           timestamptz default now()
--   updated_at           timestamptz default now()
--
-- The DOWNWARD-only invariant (user_cap_override ≤ notification_category_config.daily_cap)
-- is enforced by a trigger in 20270704000006_notification_rls.sql (cross-row check).
--
-- RLS deny-by-default + per-user policies live in 20270704000006_notification_rls.sql.

begin;

create table if not exists public.notification_settings (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  category           text not null,
  channel            text not null,
  enabled            boolean not null default false,
  snoozed_until      timestamptz,
  user_cap_override  int,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Per feedback_planner_missed_status_enum_widening: CHECK ships in the same
  -- migration that introduces the column.
  constraint notification_settings_category_chk
    check (category in ('dose-reminders','ai-insights','clinic-alerts','billing','marketing')),
  constraint notification_settings_channel_chk
    check (channel in ('email','web-push','in-app')),
  constraint notification_settings_user_cap_nonneg_chk
    check (user_cap_override is null or user_cap_override >= 0)
);

-- One row per (user, category, channel)
do $$
begin
  alter table public.notification_settings
    add constraint notification_settings_user_cat_chan_uniq
    unique (user_id, category, channel);
exception when duplicate_object then null;
end $$;

create index if not exists notification_settings_user_id_idx
  on public.notification_settings (user_id);

create index if not exists notification_settings_user_snoozed_idx
  on public.notification_settings (user_id, snoozed_until)
  where snoozed_until is not null;

-- updated_at trigger
create or replace function public.notification_settings_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists notification_settings_touch_updated_at_trg on public.notification_settings;
create trigger notification_settings_touch_updated_at_trg
  before update on public.notification_settings
  for each row execute function public.notification_settings_touch_updated_at();

commit;
