-- Phase 42 Plan 42-05 (POLISH-05/06) — RLS deny-by-default + per-user policies
-- on the five notification tables + admin-write gate on notification_category_config.
--
-- Tables covered:
--   notification_settings           — per-user CRUD (auth.uid() = user_id)
--   notification_category_config    — authenticated SELECT; admin-only INSERT/UPDATE/DELETE
--   user_notifications              — per-user SELECT/UPDATE; INSERT by service role only;
--                                     no DELETE policy (append-only invariant)
--   notification_dismissal_state    — per-user SELECT; INSERT/UPDATE done by service-role Fn
--   push_subscriptions              — per-user CRUD
--
-- Cross-tenant impersonation proof in
-- leanshot/tests/rls/notification-settings-rls.test.ts (PROJECT RULE — every RLS
-- surface gets a live cross-tenant proof per memory reference_supabase_project).
--
-- DOWNWARD-cap trigger on notification_settings.user_cap_override (T-42-05-03
-- mitigation): the trigger compares user_cap_override against
-- notification_category_config.daily_cap and raises if user tries to RAISE
-- their cap above admin default. RAISE permitted only if admin cap is NULL
-- (unlimited) — in that case the user cap is the only cap and any value is allowed.

begin;

-- ─── notification_settings ───────────────────────────────────────────────────
alter table public.notification_settings enable row level security;

drop policy if exists notification_settings_select_own on public.notification_settings;
create policy notification_settings_select_own on public.notification_settings
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists notification_settings_insert_own on public.notification_settings;
create policy notification_settings_insert_own on public.notification_settings
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists notification_settings_update_own on public.notification_settings;
create policy notification_settings_update_own on public.notification_settings
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists notification_settings_delete_own on public.notification_settings;
create policy notification_settings_delete_own on public.notification_settings
  for delete to authenticated
  using (auth.uid() = user_id);

-- DOWNWARD-only cap trigger (T-42-05-03)
-- user_cap_override must be <= notification_category_config.daily_cap unless
-- the admin cap is NULL (unlimited) — in that case any non-negative override is allowed.
create or replace function public.notification_settings_enforce_downward_cap()
returns trigger
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $fn$
declare
  admin_daily_cap int;
begin
  if new.user_cap_override is null then
    return new;
  end if;

  select daily_cap into admin_daily_cap
  from public.notification_category_config
  where category = new.category;

  -- If admin sets unlimited (null), any override is fine.
  if admin_daily_cap is null then
    return new;
  end if;

  if new.user_cap_override > admin_daily_cap then
    raise exception
      'notification_settings.user_cap_override (%) cannot exceed admin daily_cap (%) for category %',
      new.user_cap_override, admin_daily_cap, new.category
      using errcode = '23514'; -- check_violation
  end if;

  return new;
end;
$fn$;

drop trigger if exists notification_settings_enforce_downward_cap_trg
  on public.notification_settings;
create trigger notification_settings_enforce_downward_cap_trg
  before insert or update of user_cap_override, category
  on public.notification_settings
  for each row execute function public.notification_settings_enforce_downward_cap();

-- ─── notification_category_config ────────────────────────────────────────────
alter table public.notification_category_config enable row level security;

drop policy if exists notification_category_config_select_auth on public.notification_category_config;
create policy notification_category_config_select_auth on public.notification_category_config
  for select to authenticated
  using (true);

drop policy if exists notification_category_config_insert_admin on public.notification_category_config;
create policy notification_category_config_insert_admin on public.notification_category_config
  for insert to authenticated
  with check (public.is_admin_at_least('admin'::public.admin_role));

drop policy if exists notification_category_config_update_admin on public.notification_category_config;
create policy notification_category_config_update_admin on public.notification_category_config
  for update to authenticated
  using (public.is_admin_at_least('admin'::public.admin_role))
  with check (public.is_admin_at_least('admin'::public.admin_role));

drop policy if exists notification_category_config_delete_admin on public.notification_category_config;
create policy notification_category_config_delete_admin on public.notification_category_config
  for delete to authenticated
  using (public.is_admin_at_least('admin'::public.admin_role));

-- ─── user_notifications ──────────────────────────────────────────────────────
-- INSERTs happen via service-role from notification-send Edge Fn (RLS bypassed).
-- Users may SELECT their own + UPDATE dismissed_at/clicked_at/snoozed_at via
-- the notification-dismiss / notification-snooze Edge Fns (which run with
-- the user's JWT so RLS applies).
alter table public.user_notifications enable row level security;

drop policy if exists user_notifications_select_own on public.user_notifications;
create policy user_notifications_select_own on public.user_notifications
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_notifications_update_own on public.user_notifications;
create policy user_notifications_update_own on public.user_notifications
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Intentionally NO INSERT policy for authenticated → only service_role can insert.
-- Intentionally NO DELETE policy → append-only invariant.

-- ─── notification_dismissal_state ────────────────────────────────────────────
-- UPSERTs done from notification-dismiss Edge Fn with user JWT (RLS applies).
alter table public.notification_dismissal_state enable row level security;

drop policy if exists notification_dismissal_state_select_own on public.notification_dismissal_state;
create policy notification_dismissal_state_select_own on public.notification_dismissal_state
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists notification_dismissal_state_insert_own on public.notification_dismissal_state;
create policy notification_dismissal_state_insert_own on public.notification_dismissal_state
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists notification_dismissal_state_update_own on public.notification_dismissal_state;
create policy notification_dismissal_state_update_own on public.notification_dismissal_state
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── push_subscriptions ──────────────────────────────────────────────────────
alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own on public.push_subscriptions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated
  using (auth.uid() = user_id);

commit;
