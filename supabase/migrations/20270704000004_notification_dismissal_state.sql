-- Phase 42 Plan 42-05 (POLISH-05/06) — notification_dismissal_state.
--
-- D-05 dismissal-rate sentiment tracking. ONE row per (user, category).
-- consecutive_dismissals increments per dismissal event; resets to 0 on click.
-- When consecutive_dismissals >= 3, throttle_until is set to now() + 7d and the
-- effective cap for that category is halved by computeEffectiveCap() in
-- notification-fire-decision.ts.
--
-- Writes done via UPSERT (INSERT ... ON CONFLICT DO UPDATE) in the
-- notification-dismiss Edge Fn. A bare UPDATE silently no-ops on fresh-user
-- rows → consecutive_dismissals would never reach 3 → D-05 dead. The UPSERT
-- path is integration-tested in tests/integration/notification-dismissal-fresh-user.test.ts.

begin;

create table if not exists public.notification_dismissal_state (
  user_id                 uuid not null references auth.users(id) on delete cascade,
  category                text not null,
  consecutive_dismissals  int not null default 0,
  throttle_until          timestamptz,
  last_event_at           timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  primary key (user_id, category),
  constraint notification_dismissal_state_category_chk
    check (category in ('dose-reminders','ai-insights','clinic-alerts','billing','marketing')),
  constraint notification_dismissal_state_consecutive_nonneg_chk
    check (consecutive_dismissals >= 0)
);

create index if not exists notification_dismissal_state_throttle_idx
  on public.notification_dismissal_state (user_id, throttle_until)
  where throttle_until is not null;

-- updated_at trigger
create or replace function public.notification_dismissal_state_touch_updated_at()
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

drop trigger if exists notification_dismissal_state_touch_updated_at_trg
  on public.notification_dismissal_state;
create trigger notification_dismissal_state_touch_updated_at_trg
  before update on public.notification_dismissal_state
  for each row execute function public.notification_dismissal_state_touch_updated_at();

commit;
