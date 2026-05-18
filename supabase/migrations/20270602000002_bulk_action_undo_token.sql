-- Phase 27 Plan 27-01 D-03 (60-second undo-window token).
--
-- Creates `public.bulk_action_undo_token`: a transient single-use token table
-- with a 60-second TTL. Issued by admin_bulk_action_execute for reversible
-- action types ('ban','comp_plan','tag') and consumed by
-- admin_bulk_action_undo. The 60s ceiling protects against late-arriving
-- "oops" clicks while keeping the window short enough that downstream side
-- effects (Stripe webhooks, audit reports, email sends) are still recoverable.
--
-- Companion migrations:
--   20270602000001_admin_bulk_jobs.sql                  — async-path job ledger
--   20270602000004_admin_bulk_action_rpcs.sql           — SECDEF execute + undo RPCs
-- Cron purge of expired tokens lives in Plan 27-07.
--
-- Append-only RLS tampering mitigation (Pattern S2):
--   - RLS enabled.
--   - SELECT policy restricts to issued_to = auth.uid().
--   - NO insert/update/delete policy for the authenticated role.
--   - Only the SECDEF RPCs and service_role write/delete.
--
-- TTL design: expires_at defaults to now() + 60 seconds. Index on
-- (expires_at) supports the purge cron's `delete where expires_at < now()`
-- predicate. Token is single-use — the undo RPC deletes the row as part of
-- redemption (atomic), so replay raises 'token_expired'.

create table public.bulk_action_undo_token (
  token                   uuid primary key default gen_random_uuid(),
  issued_to               uuid not null references auth.users(id) on delete cascade,
  action_type             text not null check (action_type in (
    'ban', 'comp_plan', 'tag'
  )),
  -- Reverse instructions: e.g. {restore_account_state: 'active'} for ban,
  -- {drop_tag: 'priority'} for tag, {revoke_grant_ids: [...]} for comp_plan.
  reverse_payload         jsonb not null,
  -- audit_logs.id is bigserial — so this is bigint[] not uuid[] (the plan's
  -- "uuid[]" name was anchored to Phase 24's log_admin_action signature,
  -- which RETURNS uuid but inserts into a bigserial pk — known Phase 24
  -- inconsistency, deferred for separate fix).
  original_audit_log_ids  bigint[] not null,
  -- Affected user ids — duplicated from the audit logs for fast reverse
  -- without a JOIN against audit_logs (which is RLS-restricted for non-admins).
  affected_user_ids       uuid[] not null,
  expires_at              timestamptz not null default (now() + interval '60 seconds'),
  created_at              timestamptz not null default now()
);

-- Purge-cron lookup (Plan 27-07 owns the cron job).
create index idx_bulk_undo_expires
  on public.bulk_action_undo_token (expires_at);

-- Per-admin lookup (rare; supports debugging "did this token exist?").
create index idx_bulk_undo_issued_to
  on public.bulk_action_undo_token (issued_to, created_at desc);

alter table public.bulk_action_undo_token enable row level security;

-- SELECT: admin sees only their own tokens (T-27-01-07 spoofing mitigation —
-- a stolen token bound to a different admin's session is invisible to the
-- attacker via direct SELECT, AND the undo RPC re-verifies issued_to = auth.uid()).
create policy "bulk_action_undo_token_select_own"
  on public.bulk_action_undo_token
  for select
  using (auth.uid() = issued_to);

-- TAMPERING + REPLAY MITIGATION (STRIDE-T, threat T-27-01-06):
-- No INSERT/UPDATE/DELETE policies for authenticated. The undo RPC deletes
-- the token row atomically as part of the redemption transaction; this
-- prevents replay because a re-issued undo for the same token cannot find
-- the row (raises 'token_expired'). The purge cron uses service_role.

comment on table public.bulk_action_undo_token is
  'Phase 27 ADMIN-04: 60-second single-use undo tokens for reversible bulk '
  'actions (ban/comp_plan/tag). Atomic delete-on-redeem prevents replay; '
  'expires_at purged by Plan 27-07 cron.';
