-- Phase 35 Plan 35-02 (GAME-02) — streak_state table + evaluate_streak_for_user SECDEF.
--
-- streak_state holds the per-user streak counter (current + longest + timestamps).
-- State is written ONLY by evaluate_streak_for_user (SECDEF) and service_role.
-- Authenticated users may SELECT their own row; no write policies.
--
-- evaluate_streak_for_user:
--   - DST-safe: keyed on (user_id, last_eval_date) — double-fire on DST fall-back is a no-op.
--   - Cross-action streak (D-06): ANY qualifying XP action yesterday keeps the streak.
--   - Auto-apply (D-08): if no action yesterday + freeze balance >= 1, consume one token.
--   - Calls freeze_tokens_remaining() and writes freeze_tokens_ledger (defined in next migration);
--     Postgres resolves function calls at runtime, not at DDL time.
--
-- Memory references honored:
--   [[reference_supabase_migration_gotchas]]  — SECDEF + set search_path
--   [[feedback_rpc_auth_uid_vs_service_role_mismatch]] — takes p_user param, not auth.uid()
--   [[feedback_state_counter_table_needs_upsert_on_event]] — INSERT…ON CONFLICT everywhere

-- ============================================================================
-- streak_state table
-- ============================================================================

create table if not exists public.streak_state (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  current_streak_days  int not null default 0 check (current_streak_days >= 0),
  longest_streak_days  int not null default 0 check (longest_streak_days >= 0),
  last_action_at       timestamptz,
  last_eval_date       date,
  updated_at           timestamptz not null default now()
);

comment on table public.streak_state is
  'Phase 35 D-07 — one row per user; cron-maintained; read-only to authenticated.';

-- ============================================================================
-- RLS — select-own for authenticated; no write policies (SECDEF + service_role only)
-- ============================================================================

alter table public.streak_state enable row level security;
alter table public.streak_state force row level security;

create policy streak_state_select_own
  on public.streak_state for select
  to authenticated
  using (auth.uid() = user_id);

-- NO INSERT / UPDATE / DELETE policies for authenticated.
-- Only service_role (bypasses RLS) and SECDEF function below can write.

-- ============================================================================
-- Append-only defense-in-depth: prevent direct UPDATE/DELETE from authenticated.
-- (RLS already denies it; triggers provide defense-in-depth for service_role misuse.)
-- Not strictly needed here since service_role writes are intentional,
-- but we add it for the streak_state to prevent accidental direct edits.
-- ============================================================================

-- No append-only triggers for streak_state — it IS mutated (current_streak changes).
-- The append-only pattern applies only to freeze_tokens_ledger (next migration).

-- ============================================================================
-- evaluate_streak_for_user — SECDEF cron helper
-- ============================================================================

create or replace function public.evaluate_streak_for_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $body$
declare
  v_tz               text;
  v_today_local      date;
  v_yesterday_local  date;
  v_has_action       boolean;
  v_state            record;
  v_freeze_balance   int;
begin
  -- Resolve user's IANA timezone; fall back to UTC if null or profile missing.
  select timezone into v_tz from public.profiles where id = p_user;
  if v_tz is null then
    v_tz := 'UTC';
  end if;

  v_today_local     := (now() at time zone v_tz)::date;
  v_yesterday_local := v_today_local - 1;

  -- Load current streak_state row (may be null for first-ever evaluation).
  select * into v_state from public.streak_state where user_id = p_user;

  -- Idempotency guard: if already evaluated today (in user's local tz), skip.
  -- This safely handles DST fall-back double-fire (Pitfall 2 from RESEARCH).
  if v_state.last_eval_date is not null and v_state.last_eval_date >= v_today_local then
    return;
  end if;

  -- D-06 cross-action: ANY qualifying XP action yesterday keeps the streak.
  select exists(
    select 1 from public.xp_ledger
     where user_id = p_user
       and action_type in ('injection_log','weight_log','symptom_log','workout_log')
       and (created_at at time zone v_tz)::date = v_yesterday_local
  ) into v_has_action;

  if v_has_action then
    -- Survived yesterday: increment streak.
    insert into public.streak_state
      (user_id, current_streak_days, longest_streak_days, last_action_at, last_eval_date, updated_at)
    values
      (p_user, 1, 1, now(), v_today_local, now())
    on conflict (user_id) do update set
      current_streak_days = streak_state.current_streak_days + 1,
      longest_streak_days = greatest(
        streak_state.longest_streak_days,
        streak_state.current_streak_days + 1
      ),
      last_action_at = now(),
      last_eval_date = v_today_local,
      updated_at     = now();

  else
    -- Missed yesterday.
    if coalesce(v_state.current_streak_days, 0) > 0 then
      -- User had an active streak; check freeze token balance (D-08 auto-apply).
      v_freeze_balance := public.freeze_tokens_remaining(p_user);

      if v_freeze_balance >= 1 then
        -- Consume one freeze token to protect the streak.
        -- The UNIQUE index on freeze_tokens_ledger prevents double-consume on retry.
        insert into public.freeze_tokens_ledger (user_id, delta, reason, source_ref)
        values (p_user, -1, 'auto_apply', 'streak:' || v_yesterday_local::text)
        on conflict (user_id, reason, source_ref) where reason in ('monthly_grant','auto_apply','challenge_reward')
        do nothing;

        -- Preserve streak count; only update eval tracking.
        insert into public.streak_state
          (user_id, current_streak_days, longest_streak_days, last_action_at, last_eval_date, updated_at)
        values
          (p_user,
           coalesce(v_state.current_streak_days, 0),
           coalesce(v_state.longest_streak_days, 0),
           v_state.last_action_at,
           v_today_local,
           now())
        on conflict (user_id) do update set
          last_eval_date = v_today_local,
          updated_at     = now();

        -- Plan 35-09 wires the user-facing "freeze auto-applied" notification.

      else
        -- No freeze tokens available; break the streak.
        insert into public.streak_state
          (user_id, current_streak_days, longest_streak_days, last_action_at, last_eval_date, updated_at)
        values
          (p_user,
           0,
           coalesce(v_state.longest_streak_days, 0),
           v_state.last_action_at,
           v_today_local,
           now())
        on conflict (user_id) do update set
          current_streak_days = 0,
          last_eval_date      = v_today_local,
          updated_at          = now();
      end if;

    else
      -- No prior streak; record the evaluation so idempotency guard works.
      insert into public.streak_state
        (user_id, current_streak_days, longest_streak_days, last_eval_date, updated_at)
      values
        (p_user, 0, 0, v_today_local, now())
      on conflict (user_id) do update set
        last_eval_date = v_today_local,
        updated_at     = now();
    end if;
  end if;
end;
$body$;

comment on function public.evaluate_streak_for_user(uuid) is
  'Phase 35 D-07 — cron-driven streak evaluation. DST-safe (idempotent on last_eval_date). '
  'Takes p_user param (not auth.uid()) so callable from service_role cron context.';

revoke all on function public.evaluate_streak_for_user(uuid) from public;
grant execute on function public.evaluate_streak_for_user(uuid) to service_role;
