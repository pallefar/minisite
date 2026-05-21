-- Phase 35 Plan 35-02 (GAME-03) — freeze_tokens_ledger append-only table + freeze_tokens_remaining helper.
--
-- freeze_tokens_ledger records all freeze-token events (grants + consumes) as
-- append-only rows. The usable balance is derived by SUM(delta) clamped to [0, 3].
-- No UPDATE/DELETE policies for authenticated — defense-in-depth triggers enforce this.
--
-- freeze_tokens_remaining(p_user uuid) — SECDEF helper called from:
--   - evaluate_streak_for_user() (service_role context via cron)
--   - admin-grant-freeze-token Edge Fn (admin user-JWT context)
--   - client SELECT via rpc() for StreakCard widget (authenticated user)
--   Takes p_user as parameter (not auth.uid()) to be callable from service_role crons.
--
-- Memory references honored:
--   [[reference_supabase_migration_gotchas]]         — SECDEF search_path; append-only triggers
--   [[feedback_rpc_auth_uid_vs_service_role_mismatch]] — param-passing, not auth.uid()
--   [[feedback_state_counter_table_needs_upsert_on_event]] — ledger is source of truth, no counter cols

-- ============================================================================
-- freeze_tokens_ledger table
-- ============================================================================

create table if not exists public.freeze_tokens_ledger (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete set null,
  delta                   int not null check (delta != 0),
  reason                  text not null check (reason in (
                            'monthly_grant',
                            'auto_apply',
                            'admin_grant',
                            'challenge_reward',
                            'manual_consume'
                          )),
  granted_by_admin_user_id uuid references auth.users(id) on delete set null,
  source_ref              text,
  created_at              timestamptz not null default now()
);

comment on table public.freeze_tokens_ledger is
  'Phase 35 D-08/D-10 — append-only freeze-token event log. '
  'Balance = GREATEST(0, LEAST(3, SUM(delta))). Admin grants include granted_by_admin_user_id.';

comment on column public.freeze_tokens_ledger.granted_by_admin_user_id is
  'D-10 audit: populated only for admin_grant rows. ON DELETE SET NULL preserves audit trail through admin account deletion.';

-- ============================================================================
-- Indexes
-- ============================================================================

-- Prevent duplicate grants for monthly/auto/challenge cycles (cron retry idempotency).
-- admin_grant and manual_consume are excluded — those can legitimately repeat.
create unique index freeze_tokens_ledger_idempotency_idx
  on public.freeze_tokens_ledger (user_id, reason, source_ref)
  where reason in ('monthly_grant', 'auto_apply', 'challenge_reward');

-- Performance: balance query + ledger history by user.
create index freeze_tokens_ledger_user_created_idx
  on public.freeze_tokens_ledger (user_id, created_at desc);

-- ============================================================================
-- RLS — select-own for authenticated; service_role insert; no UPDATE/DELETE
-- ============================================================================

alter table public.freeze_tokens_ledger enable row level security;
alter table public.freeze_tokens_ledger force row level security;

create policy freeze_tokens_select_own
  on public.freeze_tokens_ledger for select
  to authenticated
  using (auth.uid() = user_id);

-- Explicit service_role insert policy (grep-able intent; service_role also bypasses RLS).
create policy freeze_tokens_service_insert
  on public.freeze_tokens_ledger for insert
  to service_role
  with check (true);

-- NO UPDATE policy for authenticated.
-- NO DELETE policy for authenticated.
-- Defense-in-depth triggers below enforce append-only even for service_role accidents.

-- ============================================================================
-- Append-only triggers — defense-in-depth (Phase 7 audit_logs pattern)
-- ============================================================================

create or replace function public.freeze_tokens_ledger_deny_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $body$
begin
  raise exception 'freeze_tokens_ledger is append-only: UPDATE is forbidden. '
    'Insert a new row with an offsetting delta instead.';
end;
$body$;

create or replace function public.freeze_tokens_ledger_deny_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $body$
begin
  raise exception 'freeze_tokens_ledger is append-only: DELETE is forbidden. '
    'Insert a correcting row with an offsetting delta instead.';
end;
$body$;

create trigger freeze_tokens_ledger_no_update
  before update on public.freeze_tokens_ledger
  for each row execute function public.freeze_tokens_ledger_deny_update();

create trigger freeze_tokens_ledger_no_delete
  before delete on public.freeze_tokens_ledger
  for each row execute function public.freeze_tokens_ledger_deny_delete();

-- ============================================================================
-- freeze_tokens_remaining — SECDEF balance helper (D-08)
-- ============================================================================

create or replace function public.freeze_tokens_remaining(p_user uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_catalog
as $body$
  -- D-08: max stockpile 3; floor at 0. Sum of all delta rows, clamped to [0, 3].
  select greatest(0, least(3, coalesce(sum(delta), 0)))::int
  from public.freeze_tokens_ledger
  where user_id = p_user;
$body$;

comment on function public.freeze_tokens_remaining(uuid) is
  'Phase 35 D-08 — usable freeze token balance = GREATEST(0, LEAST(3, SUM(delta))). '
  'Callable by authenticated (StreakCard display) and service_role (cron auto-apply). '
  'SECDEF + p_user param: T-35-02-06 accept — COUNT is non-PII per threat model.';

revoke all on function public.freeze_tokens_remaining(uuid) from public;
grant execute on function public.freeze_tokens_remaining(uuid) to authenticated, service_role;
