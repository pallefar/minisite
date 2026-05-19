-- Phase 42 Plan 42-05 (POLISH-05/06) — push_subscriptions table.
--
-- Web Push subscription endpoints registered via push-subscribe Edge Fn.
-- One row per (user, endpoint). On reconciliation a user may register the
-- same endpoint twice (e.g. p256dh key rotation) — UPSERT updates the keys.
--
-- p256dh + auth are base64url-encoded raw bytes per RFC 8291. user_agent is
-- captured for debugging (Chrome on macOS vs Firefox on Linux behave differently
-- under VAPID errors).
--
-- T-42-05-02 mitigation: RLS per-user policies + UNIQUE(user_id, endpoint).
-- The endpoint URL itself is high-entropy (FCM/Mozilla embeds an opaque token).

begin;

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint push_subscriptions_endpoint_nonempty_chk
    check (length(endpoint) > 0),
  constraint push_subscriptions_p256dh_nonempty_chk
    check (length(p256dh) > 0),
  constraint push_subscriptions_auth_nonempty_chk
    check (length(auth) > 0)
);

do $$
begin
  alter table public.push_subscriptions
    add constraint push_subscriptions_user_endpoint_uniq
    unique (user_id, endpoint);
exception when duplicate_object then null;
end $$;

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

-- updated_at trigger
create or replace function public.push_subscriptions_touch_updated_at()
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

drop trigger if exists push_subscriptions_touch_updated_at_trg on public.push_subscriptions;
create trigger push_subscriptions_touch_updated_at_trg
  before update on public.push_subscriptions
  for each row execute function public.push_subscriptions_touch_updated_at();

commit;
