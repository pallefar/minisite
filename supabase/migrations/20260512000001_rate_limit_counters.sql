-- Phase 4 D-04 + AI-02 (Per-user rate limiting).
--
-- public.rate_limit_counters — sliding-window hit counts per (user, window,
-- bucket_start) tuple. Three windows are tracked (minute / hour / day);
-- thresholds live in the Edge Function consumer (30 / 60 / 200 per
-- `.planning/decisions/supabase.md`).
--
-- Race-safety invariant (T-04-02 mitigation):
--   `increment_rate_limit` is a `security definer` plpgsql function owned
--   by the service role. The atomic `INSERT … ON CONFLICT DO UPDATE`
--   serialises concurrent writers on the same row via Postgres row-lock,
--   eliminating the read-modify-write race that a client-side counter
--   would have.
--
-- RLS posture: users can READ their own counters (future "AI usage"
-- Settings panel can read this without service-role privilege). Writes
-- are service-role only — there is no insert/update/delete policy for
-- non-service-role principals.

create table public.rate_limit_counters (
  user_id uuid not null references auth.users(id) on delete cascade,
  "window" text not null check ("window" in ('minute', 'hour', 'day')),
  bucket_start timestamptz not null,
  hits integer not null default 0,
  primary key (user_id, "window", bucket_start)
);

alter table public.rate_limit_counters enable row level security;

-- Users can read their own counters (future "AI usage" Settings panel).
create policy "rate_limit_counters_select_own"
  on public.rate_limit_counters
  for select
  using (auth.uid() = user_id);

-- Atomic increment RPC. Race-safe via Postgres row-lock during UPDATE on
-- the ON CONFLICT path.
create or replace function public.increment_rate_limit(
  p_user_id uuid,
  p_window text,
  p_bucket_start timestamptz
) returns integer
language plpgsql
security definer
as $$
declare
  v_hits integer;
begin
  insert into public.rate_limit_counters (user_id, "window", bucket_start, hits)
  values (p_user_id, p_window, p_bucket_start, 1)
  on conflict (user_id, "window", bucket_start)
    do update set hits = rate_limit_counters.hits + 1
  returning hits into v_hits;
  return v_hits;
end;
$$;

-- Explicit grant: service-role only. Anon / authenticated roles MUST NOT
-- be able to invoke this RPC client-side (would defeat T-04-02 mitigation
-- by letting a malicious client manipulate their own counter).
revoke execute on function public.increment_rate_limit(uuid, text, timestamptz) from public;
grant execute on function public.increment_rate_limit(uuid, text, timestamptz) to service_role;
