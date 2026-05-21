-- Phase 35 Plan 35-05 GAME-05/08 — Challenge SECDEF RPCs + leaderboard enable RPC.
-- All functions: SECURITY DEFINER + set search_path per reference_supabase_migration_gotchas.
-- All admin-facing RPCs: re-verify profiles.admin_role server-side (Pattern S1 dual-layer).
-- CRITICAL: PARAMETER p_user (never auth.uid()) in cron-callable RPCs per
--   memory feedback_rpc_auth_uid_vs_service_role_mismatch.

-- ---------------------------------------------------------------------------
-- 1. create_weekly_challenge(p_payload jsonb)
--    Admin-only writer. Creates challenge row + up to 2 A/B variants.
--    Admin re-verification: profiles.admin_role IN ('support_admin','support_lead','superadmin').
--    Note: 'support_admin' and 'support_lead' map to the 'admin'/'superadmin' enum in admin/roles.ts;
--    the DB stores the full support_ prefixed value in profiles.admin_role for helpdesk tier parity.
-- ---------------------------------------------------------------------------
create or replace function public.create_weekly_challenge(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $body$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_id uuid;
  v_variants jsonb;
  v_variant jsonb;
begin
  if v_caller is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select admin_role into v_role from public.profiles where id = v_caller;
  if v_role is null or v_role not in ('support_admin','support_lead','superadmin','admin') then
    raise exception 'forbidden_not_admin' using errcode = '42501';
  end if;

  -- Insert challenge row from p_payload jsonb shape:
  -- { title, framing, challenge_type, threshold, action_type?, duration, cohort_id?,
  --   reward_xp?, reward_badge_id?, reward_freeze_tokens?, reward_combo_badge_id?,
  --   starts_at, ends_at, status?, variants?: [{ variant_key, framing, threshold? }] }
  insert into public.weekly_challenges (
    title,
    framing,
    challenge_type,
    threshold,
    action_type,
    duration,
    cohort_id,
    reward_xp,
    reward_badge_id,
    reward_freeze_tokens,
    reward_combo_badge_id,
    starts_at,
    ends_at,
    status,
    created_by
  ) values (
    p_payload->>'title',
    p_payload->>'framing',
    p_payload->>'challenge_type',
    (p_payload->>'threshold')::int,
    p_payload->>'action_type',
    p_payload->>'duration',
    (p_payload->>'cohort_id')::uuid,
    coalesce((p_payload->>'reward_xp')::int, 0),
    p_payload->>'reward_badge_id',
    coalesce((p_payload->>'reward_freeze_tokens')::int, 0),
    p_payload->>'reward_combo_badge_id',
    (p_payload->>'starts_at')::timestamptz,
    (p_payload->>'ends_at')::timestamptz,
    coalesce(p_payload->>'status', 'draft'),
    v_caller
  ) returning id into v_id;

  -- Insert up to 2 A/B variants (D-20)
  v_variants := coalesce(p_payload->'variants', '[]'::jsonb);
  if jsonb_array_length(v_variants) > 2 then
    raise exception 'max_2_variants_per_challenge' using errcode = 'P0001';
  end if;

  for v_variant in select * from jsonb_array_elements(v_variants) loop
    insert into public.challenge_variants (challenge_id, variant_key, framing, threshold)
    values (
      v_id,
      v_variant->>'variant_key',
      v_variant->>'framing',
      (v_variant->>'threshold')::int
    );
  end loop;

  return v_id;
end;
$body$;

revoke all on function public.create_weekly_challenge(jsonb) from public;
grant execute on function public.create_weekly_challenge(jsonb) to authenticated;

comment on function public.create_weekly_challenge(jsonb) is
  'Phase 35 GAME-05 — admin-only challenge creator. Re-verifies admin_role server-side '
  '(Pattern S1 dual-layer). Creates challenge row + up to 2 A/B variants from jsonb payload. '
  'Max-2-variants enforced at both RPC level (P0001) and UNIQUE constraint.';

-- ---------------------------------------------------------------------------
-- 2. evaluate_challenge_progress_for_user(p_user uuid)
--    D-18 enforcement: max 2 active challenges per user (1 global + 1 cohort).
--    Cohort-specific wins over global if user is in both (alphabetical by cohort name tiebreak).
--    CRITICAL (iter-1 F-5): active_cohort CTE uses ORDER BY cd.name ASC, c.created_at DESC
--    for alphabetical-by-name tiebreak (stable across new-cohort additions).
--    PARAMETER p_user — never auth.uid() — callable from service-role cron context.
-- ---------------------------------------------------------------------------
create or replace function public.evaluate_challenge_progress_for_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $body$
declare
  r record;
  v_progress int;
  v_threshold int;
  v_completed boolean;
begin
  -- D-18: max 2 active per user — 1 global + 1 cohort.
  -- Iterate only the 2 that apply (1 global + 1 cohort-specific).
  for r in
    with active_global as (
      select c.* from public.weekly_challenges c
       where c.status = 'active'
         and c.cohort_id is null
         and c.ends_at > now()
       order by c.created_at desc
       limit 1
    ),
    active_cohort as (
      -- REVIEW-F-5: D-18 tiebreak is alphabetical by cohort NAME (stable across
      -- new-cohort additions) — NOT most-recent challenge.
      -- ORDER BY cd.name ASC first (alphabetical by cohort name), then by challenge
      -- creation date desc as secondary tiebreak for same-cohort challenges.
      select c.* from public.weekly_challenges c
        join public.cohort_membership cm on cm.cohort_id = c.cohort_id
        join public.cohort_definitions cd on cd.id = c.cohort_id
       where c.status = 'active'
         and cm.user_id = p_user
         and c.ends_at > now()
       order by cd.name asc, c.created_at desc
       limit 1
    )
    select * from active_global
    union all
    select * from active_cohort
  loop
    -- Compute progress based on challenge_type
    if r.challenge_type = 'log_count' then
      select count(*)::int into v_progress
        from public.xp_ledger
       where user_id = p_user
         and action_type in ('injection_log','weight_log','symptom_log','workout_log')
         and created_at >= r.starts_at
         and created_at < r.ends_at;
    elsif r.challenge_type = 'streak_days' then
      select coalesce(current_streak_days, 0) into v_progress
        from public.streak_state
       where user_id = p_user;
    elsif r.challenge_type = 'specific_action' then
      select count(*)::int into v_progress
        from public.xp_ledger
       where user_id = p_user
         and action_type = r.action_type
         and created_at >= r.starts_at
         and created_at < r.ends_at;
    else
      continue;
    end if;

    -- Use parent threshold (variant-specific threshold resolved client-side via PostHog flag)
    v_threshold := r.threshold;
    v_completed := v_progress >= v_threshold;

    -- Upsert progress row
    insert into public.challenge_progress (
      user_id, challenge_id, progress_count, completed_at, updated_at
    )
    values (
      p_user,
      r.id,
      v_progress,
      case when v_completed then now() else null end,
      now()
    )
    on conflict (user_id, challenge_id) do update set
      progress_count = excluded.progress_count,
      -- Monotonic: keep existing completed_at if already set (never null it)
      completed_at = coalesce(public.challenge_progress.completed_at, excluded.completed_at),
      updated_at = now();

    -- On NEW completion: dispatch D-19 rewards (idempotent via badge_unlocks source_ref check)
    if v_completed then
      -- Idempotent guard: skip if reward badge already inserted for this challenge
      if not exists (
        select 1 from public.badge_unlocks
         where user_id = p_user
           and source_ref = 'challenge:' || r.id::text
      ) then
        -- D-19 reward type 1: XP grant
        if r.reward_xp > 0 then
          perform public.grant_xp_for_action(
            p_user,
            'challenge_complete',
            r.reward_xp,
            'challenge:' || r.id::text
          );
        end if;
        -- D-19 reward type 2: badge unlock
        -- Inserting with source='challenge' triggers Plan 35-03 combo check
        if r.reward_badge_id is not null then
          insert into public.badge_unlocks (user_id, badge_id, source, source_ref)
          values (p_user, r.reward_badge_id, 'challenge', 'challenge:' || r.id::text)
          on conflict (user_id, badge_id) do nothing;
        end if;
        -- D-19 reward type 3: freeze token (+1; D-08 cap enforced at read/grant time)
        if r.reward_freeze_tokens > 0 then
          insert into public.freeze_tokens_ledger (user_id, delta, reason, source_ref)
          values (p_user, r.reward_freeze_tokens, 'challenge_reward', 'challenge:' || r.id::text)
          on conflict (user_id, reason, source_ref) do nothing;
        end if;
        -- D-19 reward type 4: combo / cross-streak badge
        -- reward_combo_badge_id, when set, is inserted with source='challenge' —
        -- Plan 35-03's combo trigger fires on badge_unlocks INSERT for this source.
        if r.reward_combo_badge_id is not null then
          insert into public.badge_unlocks (user_id, badge_id, source, source_ref)
          values (p_user, r.reward_combo_badge_id, 'challenge', 'combo:' || r.id::text)
          on conflict (user_id, badge_id) do nothing;
        end if;
      end if;
    end if;

  end loop;
end;
$body$;

revoke all on function public.evaluate_challenge_progress_for_user(uuid) from public;
-- service_role for Plan 35-09 cron batch eval; authenticated for live client read
grant execute on function public.evaluate_challenge_progress_for_user(uuid) to service_role, authenticated;

comment on function public.evaluate_challenge_progress_for_user(uuid) is
  'Phase 35 GAME-05 — D-18: max 2 active per user (1 global + 1 cohort). '
  'active_cohort CTE: ORDER BY cd.name ASC, c.created_at DESC (alphabetical-by-name '
  'tiebreak per iter-1 F-5). PARAMETER p_user (not auth.uid()) for service-role cron '
  'callability per feedback_rpc_auth_uid_vs_service_role_mismatch. '
  'Dispatches D-19 rewards idempotently on completion.';

-- ---------------------------------------------------------------------------
-- 3. ship_winner_challenge_variant(p_challenge_id uuid, p_winning_variant text)
--    Admin Ship-Winner: archives old challenge version + writes new active row
--    with winning variant framing. Client is responsible for invoking
--    ship-winner-flag Edge Fn to flip PostHog flag (not atomic but DB is truth).
--    Admin re-verification: support_lead or superadmin only (higher tier required).
-- ---------------------------------------------------------------------------
create or replace function public.ship_winner_challenge_variant(
  p_challenge_id uuid,
  p_winning_variant text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $body$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_old record;
  v_variant record;
  v_new_id uuid;
begin
  if v_caller is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select admin_role into v_role from public.profiles where id = v_caller;
  if v_role not in ('support_lead','superadmin') then
    raise exception 'forbidden_not_admin' using errcode = '42501';
  end if;

  if p_winning_variant not in ('A','B') then
    raise exception 'invalid_variant' using errcode = '22023';
  end if;

  select * into v_old from public.weekly_challenges where id = p_challenge_id;
  if v_old is null then
    raise exception 'challenge_not_found' using errcode = 'P0002';
  end if;

  select * into v_variant from public.challenge_variants
   where challenge_id = p_challenge_id
     and variant_key = p_winning_variant;
  if v_variant is null then
    raise exception 'variant_not_found' using errcode = 'P0002';
  end if;

  -- Archive old challenge (keeps history — no delete per T-35-05-08 accept)
  update public.weekly_challenges
     set status = 'archived', updated_at = now()
   where id = p_challenge_id;

  -- Write new active challenge with winning variant's framing
  insert into public.weekly_challenges (
    title, framing, challenge_type, threshold, action_type, duration, cohort_id,
    reward_xp, reward_badge_id, reward_freeze_tokens, reward_combo_badge_id,
    starts_at, ends_at, status, created_by, posthog_flag_id
  ) values (
    v_old.title,
    v_variant.framing,                               -- winning variant framing
    v_old.challenge_type,
    coalesce(v_variant.threshold, v_old.threshold),  -- variant threshold wins if set
    v_old.action_type,
    v_old.duration,
    v_old.cohort_id,
    v_old.reward_xp,
    v_old.reward_badge_id,
    v_old.reward_freeze_tokens,
    v_old.reward_combo_badge_id,
    v_old.starts_at,
    v_old.ends_at,
    'active',
    v_caller,
    v_old.posthog_flag_id
  ) returning id into v_new_id;

  -- NOTE: DB side complete. Caller (client) must ALSO invoke ship-winner-flag Edge Fn:
  --   supabase.functions.invoke('ship-winner-flag', { body: { flag_id, variant } })
  -- Phase 34 Edge Fn (re)verifies admin_role server-side. DB is truth if PostHog flip fails.
  return v_new_id;
end;
$body$;

revoke all on function public.ship_winner_challenge_variant(uuid, text) from public;
grant execute on function public.ship_winner_challenge_variant(uuid, text) to authenticated;

comment on function public.ship_winner_challenge_variant(uuid, text) is
  'Phase 35 GAME-08 — admin Ship-Winner. Archives old challenge + writes new active row '
  'with winning variant framing. support_lead/superadmin only. Client must ALSO invoke '
  'ship-winner-flag Edge Fn for PostHog flag flip (D-20; T-35-05-07 split-brain risk accepted).';

-- ---------------------------------------------------------------------------
-- 4. set_cohort_leaderboard_enabled(p_cohort_id uuid, p_enabled boolean)
--    D-11 admin leaderboard enable/disable. support_lead/superadmin only —
--    admin has ethical responsibility per D-11 advisory language.
-- ---------------------------------------------------------------------------
create or replace function public.set_cohort_leaderboard_enabled(
  p_cohort_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $body$
declare
  v_role text;
begin
  select admin_role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('support_lead','superadmin') then
    raise exception 'forbidden_not_admin' using errcode = '42501';
  end if;

  update public.cohort_definitions
     set leaderboard_enabled = p_enabled
   where id = p_cohort_id;
end;
$body$;

revoke all on function public.set_cohort_leaderboard_enabled(uuid, boolean) from public;
grant execute on function public.set_cohort_leaderboard_enabled(uuid, boolean) to authenticated;

comment on function public.set_cohort_leaderboard_enabled(uuid, boolean) is
  'Phase 35 D-11 — toggle leaderboard_enabled on cohort_definitions. '
  'support_lead/superadmin only: admin bears ethical responsibility per D-11 advisory '
  '(do not enable for newly-diagnosed / vulnerable cohorts).';
