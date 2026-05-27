-- Phase 66-01 Task 1: auth_attempts_log
-- Sign-in attempt audit log for lockout + brute-force detection.
-- 30d retention via pg_cron (registered in 66-07 close-out).

create table if not exists public.auth_attempts_log (
  id             bigserial   primary key,
  attempt_at     timestamptz not null default now(),
  email          text        null,            -- captured from sign-in form (nullable for magic-link)
  ip_address     inet        null,            -- captured by Edge Fn
  user_agent     text        null,
  outcome        text        not null check (outcome in ('success','failed','locked','captcha')),
  failure_reason text        null,            -- 'invalid_credentials','user_not_found','locked', etc.
  source         text        not null default 'password' check (source in ('password','magic_link','oauth','mfa'))
);

create index if not exists idx_auth_attempts_email_ts
  on public.auth_attempts_log (lower(email), attempt_at desc)
  where email is not null;

create index if not exists idx_auth_attempts_ip_ts
  on public.auth_attempts_log (ip_address, attempt_at desc)
  where ip_address is not null;

create index if not exists idx_auth_attempts_failed_recent
  on public.auth_attempts_log (attempt_at desc)
  where outcome = 'failed';

alter table public.auth_attempts_log enable row level security;

-- service_role bypass only; no PostgREST surface for authenticated users
-- (Edge Fn writes via service-role bearer; reads are SECDEF-RPC-only)
create policy "auth_attempts_log_deny_all"
  on public.auth_attempts_log
  for all
  to authenticated
  using (false)
  with check (false);

comment on table public.auth_attempts_log is
  'Sign-in attempt audit log for lockout + brute-force detection. 30d retention via cron (registered Phase 66-07). Writes by Edge Fn service-role only; no direct authenticated access.';
comment on column public.auth_attempts_log.outcome is
  'success | failed | locked | captcha';
comment on column public.auth_attempts_log.source is
  'password | magic_link | oauth | mfa';
