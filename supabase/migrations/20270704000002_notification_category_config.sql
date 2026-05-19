-- Phase 42 Plan 42-05 (POLISH-05/06) — notification_category_config table.
--
-- Admin-tunable per-category configuration. Read by all authenticated users
-- (so the client can show category defaults + cap limits); writes restricted
-- to admin role via RLS (see 20270704000006_notification_rls.sql).
--
-- Columns:
--   category                   text PK — CHECK ∈ {dose-reminders, ai-insights, clinic-alerts, billing, marketing}
--   daily_cap                  int null — NULL = unlimited (D-04 clinical-uncapped pattern)
--   weekly_cap                 int null — NULL = unlimited
--   urgent_escalation          boolean — true for clinic-alerts (D-03 web-push 'high' urgency)
--   push_enabled_default       boolean — D-02 sensible defaults matrix
--   email_enabled_default      boolean
--   in_app_enabled_default     boolean
--   created_at / updated_at
--
-- NULL semantics for daily_cap / weekly_cap: NULL ENCODES UNLIMITED. Application
-- code (notification-fire-decision.ts) treats NULL as "no cap" — explicit and
-- documented; no sentinel int value (avoids "is 999999 unlimited or a typo?").
--
-- Seed data lives in 20270704000007_notification_category_config_seed.sql.

begin;

create table if not exists public.notification_category_config (
  category                text primary key,
  daily_cap               int,
  weekly_cap              int,
  urgent_escalation       boolean not null default false,
  push_enabled_default    boolean not null default false,
  email_enabled_default   boolean not null default false,
  in_app_enabled_default  boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- Per feedback_planner_missed_status_enum_widening: CHECK ships with the column.
  constraint notification_category_config_category_chk
    check (category in ('dose-reminders','ai-insights','clinic-alerts','billing','marketing')),
  constraint notification_category_config_daily_cap_nonneg_chk
    check (daily_cap is null or daily_cap >= 0),
  constraint notification_category_config_weekly_cap_nonneg_chk
    check (weekly_cap is null or weekly_cap >= 0)
);

comment on column public.notification_category_config.daily_cap is
  'NULL = unlimited (D-04 clinical-uncapped pattern, e.g. dose-reminders + clinic-alerts). Otherwise hard daily cap.';
comment on column public.notification_category_config.weekly_cap is
  'NULL = unlimited. Otherwise hard weekly cap (e.g. billing + marketing = 1/week per D-04).';

-- updated_at trigger
create or replace function public.notification_category_config_touch_updated_at()
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

drop trigger if exists notification_category_config_touch_updated_at_trg
  on public.notification_category_config;
create trigger notification_category_config_touch_updated_at_trg
  before update on public.notification_category_config
  for each row execute function public.notification_category_config_touch_updated_at();

commit;
