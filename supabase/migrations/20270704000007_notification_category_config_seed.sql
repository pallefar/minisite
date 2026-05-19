-- Phase 42 Plan 42-05 (POLISH-05/06) — notification_category_config seed.
--
-- Seeds the 5 categories per D-02 (defaults matrix) + D-04 (frequency caps):
--
-- | category        | daily_cap | weekly_cap | urgent_esc | push_def | email_def | in_app_def |
-- |-----------------|-----------|------------|------------|----------|-----------|------------|
-- | dose-reminders  |    NULL   |   NULL     |   false    |  true    |   true    |   true     |
-- | ai-insights     |     3     |   NULL     |   false    |  true    |   false   |   true     |
-- | clinic-alerts   |    NULL   |   NULL     |   true     |  true    |   true    |   true     |
-- | billing         |    NULL   |    1       |   false    |  false   |   true    |   false    |
-- | marketing       |    NULL   |    1       |   false    |  false   |   true    |   false    |
--
-- NULL daily_cap = unlimited (D-04 clinical-uncapped pattern).
-- billing/marketing daily_cap is NULL because weekly_cap is the limit.
--
-- ON CONFLICT DO UPDATE makes the migration idempotent — re-runs reset values
-- to the seeded matrix without erroring.

begin;

insert into public.notification_category_config
  (category, daily_cap, weekly_cap, urgent_escalation,
   push_enabled_default, email_enabled_default, in_app_enabled_default)
values
  ('dose-reminders', null, null, false, true,  true,  true),
  ('ai-insights',    3,    null, false, true,  false, true),
  ('clinic-alerts',  null, null, true,  true,  true,  true),
  ('billing',        null, 1,    false, false, true,  false),
  ('marketing',      null, 1,    false, false, true,  false)
on conflict (category) do update set
  daily_cap              = excluded.daily_cap,
  weekly_cap             = excluded.weekly_cap,
  urgent_escalation      = excluded.urgent_escalation,
  push_enabled_default   = excluded.push_enabled_default,
  email_enabled_default  = excluded.email_enabled_default,
  in_app_enabled_default = excluded.in_app_enabled_default,
  updated_at             = now();

commit;
