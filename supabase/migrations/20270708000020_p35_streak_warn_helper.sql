-- Phase 35 plan 35-09 — F-1 reconciliation: SECDEF helper RPC for streak-warn query.
-- find_streak_warn_users(p_now timestamptz) → TABLE(user_id uuid, current_streak_days int)
--
-- Encapsulates the correlated NOT EXISTS query:
--   - streak >= 1 day
--   - current hour is 18 (6pm) user-local
--   - freeze_tokens_remaining = 0
--   - no qualifying action today (user-local date)
--
-- Takes p_now as a parameter (NOT auth.uid()) per feedback_rpc_auth_uid_vs_service_role_mismatch
-- so it can be called from service-role cron/Edge Fn context.

create or replace function public.find_streak_warn_users(p_now timestamptz)
returns table(user_id uuid, current_streak_days int)
language sql
security definer
stable
set search_path = public, pg_catalog
as $body$
  select
    ss.user_id,
    ss.current_streak_days
  from public.streak_state ss
  join public.profiles p on p.id = ss.user_id
  where
    -- Only users with an active streak (>= 1 day)
    ss.current_streak_days >= 1
    -- Only fire at 6pm user-local time (hour = 18)
    and extract(hour from (p_now at time zone coalesce(p.timezone, 'UTC'))) = 18
    -- Only users with no freeze tokens available
    and public.freeze_tokens_remaining(ss.user_id) = 0
    -- Only users who have NOT yet logged a qualifying action today (user-local date)
    and not exists (
      select 1
      from public.xp_ledger xl
      where xl.user_id = ss.user_id
        and xl.action_type in ('injection_log', 'weight_log', 'symptom_log', 'workout_log')
        and (xl.created_at at time zone coalesce(p.timezone, 'UTC'))::date
          = (p_now at time zone coalesce(p.timezone, 'UTC'))::date
    );
$body$;

comment on function public.find_streak_warn_users(timestamptz) is
  'Phase 35 plan 35-09 D-09 — returns users whose streak is at risk of breaking tonight '
  '(6pm user-local, no action today, no freeze tokens). Called from lifecycle-behavior-triggered.';

revoke all on function public.find_streak_warn_users(timestamptz) from public;
grant execute on function public.find_streak_warn_users(timestamptz) to service_role;
