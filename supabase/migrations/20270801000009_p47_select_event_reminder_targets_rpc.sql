-- Phase 47-08 — select_event_reminder_targets SECDEF RPC.
--
-- D-10 (reminder cron architecture) + D-11 (email-only) + D-19 (notification_settings
-- respect) + Pitfall 6 (PHI flag derivation from community_spaces.org_id).
--
-- Purpose: Hourly cron fan-out calls this RPC once per tick; one UNION ALL query
-- assembles every (event, user, kind) row that should send NOW. The fan-out Fn
-- iterates targets and dedups via INSERT INTO event_reminder_sent ON CONFLICT.
--
-- Service-role callable (no per-user JWT predicate in body) — per memory
-- feedback_rpc_user_jwt_vs_service_role_mismatch. service_role bypasses RLS,
-- and SECDEF + `search_path = public, extensions` allows the auth.users JOIN.
--
-- DST trade-off (plan-checker iter-1 W2, accepted v1): windowing uses
-- `(events.start_at - now())` UTC-instant delta. This is mathematically equivalent
-- to per-TZ delta except across DST transitions, where it can drift by ±1 hour
-- 2–4 times/year per timezone. Acceptable for reminder UX (users still get an
-- email; window is just slightly skewed).
--
-- email source: `auth.users.email` via JOIN — `public.profiles` has NO `email`
-- column (live-DB confirmed 2026-05-23). Per memory
-- `reference_profiles_email_vs_auth_users_email`.

begin;

create or replace function public.select_event_reminder_targets()
returns table(
  event_id        uuid,
  user_id         uuid,
  kind            text,
  phi             boolean,
  email           text,
  event_title     text,
  local_start_at  timestamptz
)
language sql
security definer
set search_path = public, extensions
as $fn$
  -- 1d window: events whose start is in [now+23h, now+25h).
  select e.id                                            as event_id,
         r.user_id                                       as user_id,
         '1d'::text                                      as kind,
         (s.org_id is not null)                          as phi,
         u.email                                         as email,
         e.title                                         as event_title,
         (e.start_at at time zone coalesce(p.timezone, 'UTC')) as local_start_at
    from public.events e
    join public.event_rsvps r       on r.event_id = e.id and r.status = 'going'
    join public.community_spaces s  on s.id = e.space_id
    join public.profiles p          on p.id = r.user_id
    join auth.users u               on u.id = r.user_id
    -- channel-based check: email enabled if row exists with channel='email' and enabled=true,
    -- or if no row exists (default ON per Phase 47 seed). Replaces old ns.email boolean column.
   where coalesce((
           select enabled from public.notification_settings ns2
            where ns2.user_id = r.user_id
              and ns2.category = 'event_reminders_1d'
              and ns2.channel = 'email'
            limit 1
         ), true) = true
     and (e.start_at - now()) >= interval '23 hours'
     and (e.start_at - now()) <  interval '25 hours'
     and not exists (
       select 1 from public.event_reminder_sent ers
        where ers.event_id = e.id
          and ers.user_id  = r.user_id
          and ers.kind     = '1d'
     )

  union all

  -- 1h window: events whose start is in [now, now+2h).
  select e.id,
         r.user_id,
         '1h'::text,
         (s.org_id is not null),
         u.email,
         e.title,
         (e.start_at at time zone coalesce(p.timezone, 'UTC'))
    from public.events e
    join public.event_rsvps r       on r.event_id = e.id and r.status = 'going'
    join public.community_spaces s  on s.id = e.space_id
    join public.profiles p          on p.id = r.user_id
    join auth.users u               on u.id = r.user_id
   where coalesce((
           select enabled from public.notification_settings ns2
            where ns2.user_id = r.user_id
              and ns2.category = 'event_reminders_1h'
              and ns2.channel = 'email'
            limit 1
         ), true) = true
     and (e.start_at - now()) >= interval '0 hours'
     and (e.start_at - now()) <  interval '2 hours'
     and not exists (
       select 1 from public.event_reminder_sent ers
        where ers.event_id = e.id
          and ers.user_id  = r.user_id
          and ers.kind     = '1h'
     )

  union all

  -- Promotion drain: every undrained event_promotion_queue row → kind='promotion'.
  select e.id,
         q.user_id,
         'promotion'::text,
         (s.org_id is not null),
         u.email,
         e.title,
         (e.start_at at time zone coalesce(p.timezone, 'UTC'))
    from public.event_promotion_queue q
    join public.events e            on e.id = q.event_id
    join public.community_spaces s  on s.id = e.space_id
    join public.profiles p          on p.id = q.user_id
    join auth.users u               on u.id = q.user_id
   where q.drained_at is null
     and coalesce((
           select enabled from public.notification_settings ns2
            where ns2.user_id = q.user_id
              and ns2.category = 'event_promotion'
              and ns2.channel = 'email'
            limit 1
         ), true) = true;
$fn$;

revoke all    on function public.select_event_reminder_targets() from public;
grant execute on function public.select_event_reminder_targets() to service_role;

comment on function public.select_event_reminder_targets() is
  'P47-08 D-10/D-11/D-19: hourly fan-out target selector. SECDEF + service_role-callable (no per-user JWT predicate in body). Emits (event_id, user_id, kind, phi, email, event_title, local_start_at) for 1d window + 1h window + promotion-queue drain. phi derived from community_spaces.org_id IS NOT NULL (Pitfall 6). email source = auth.users via JOIN (profiles has no email column).';

commit;
