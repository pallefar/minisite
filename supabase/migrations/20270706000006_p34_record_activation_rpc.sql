-- Phase 34 Plan 34-03 (ONBOARD-05/06) — record_activation_event SECDEF RPC.
--
-- Purpose: atomic fire-once gate for the record-activation Edge Fn.
--   1. pg_advisory_xact_lock(hashtext('record_activation:' || user_id)) serializes
--      concurrent invocations for the same user_id (D-04 + D-15 fire-once).
--   2. SELECT activated_at — if NOT NULL, return did_fire:false (already_activated).
--   3. INSERT ... ON CONFLICT (user_id) DO UPDATE — UPSERT (memory
--      feedback_state_counter_table_needs_upsert_on_event: bare UPDATE silently
--      no-ops on first event because the activation_events shell row may not exist).
--      DO UPDATE clause guards with WHERE activation_events.activated_at IS NULL
--      to ensure we never overwrite a winning concurrent write.
--   4. did_fire = true only if our INSERT/UPDATE actually wrote activated_at this turn.
--
-- Depends on (Wave 1 — applied earlier in this milestone):
--   20270706000004_p34_activation_events_alter.sql (Plan 34-01) — ALTERs the
--   Phase 38-06 activation_events shell to add goal_type, action_type, window_days,
--   source. Our INSERT references those columns; this RPC migration runs AFTER
--   that ALTER by virtue of the lexicographic timestamp ordering (...000004 < ...000006).
--
-- Threat-model (34-03-PLAN.md):
--   - T-34-03-02 (EoP / replay): the advisory_xact_lock + activated_at IS NOT NULL
--     check serializes concurrent invocations; only one writer wins.
--   - SECURITY DEFINER: callable by the Edge Fn via service-role; never exposed
--     to authenticated/anon roles (REVOKE EXECUTE below).
--   - search_path locked per reference_supabase_migration_gotchas Pitfall 2.

create or replace function public.record_activation_event(
  p_user_id    uuid,
  p_goal_type  text,
  p_action     text,
  p_days       int
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_existing  timestamptz;
  v_did_fire  boolean := false;
begin
  -- 1. Per-user advisory lock — serializes the read-then-write under contention.
  perform pg_advisory_xact_lock(hashtext('record_activation:' || p_user_id::text));

  -- 2. Fire-once check.
  select activated_at into v_existing
    from public.activation_events
   where user_id = p_user_id;
  if v_existing is not null then
    return jsonb_build_object('did_fire', false, 'reason', 'already_activated');
  end if;

  -- 3. UPSERT — covers the shell-row-absent and shell-row-present-but-NULL cases.
  --    WHERE clause on DO UPDATE is the race-safety net under concurrent writers
  --    that pass the lock barrier in distinct backends (different advisory lock
  --    namespaces — defense-in-depth).
  insert into public.activation_events (
    user_id, activated_at, goal_type, action_type, window_days, source, updated_at
  )
  values (
    p_user_id, now(), p_goal_type, p_action, 7, 'first_log', now()
  )
  on conflict (user_id) do update
    set activated_at = excluded.activated_at,
        goal_type    = excluded.goal_type,
        action_type  = excluded.action_type,
        window_days  = 7,
        source       = 'first_log',
        updated_at   = now()
    where public.activation_events.activated_at is null;

  -- 4. Confirm we actually wrote activated_at this turn (defense-in-depth: if
  --    the WHERE clause filtered DO UPDATE out, activated_at stays NULL on row
  --    we did not own — but the v_existing check above already returned, so this
  --    is a safety reassertion).
  select activated_at into v_existing
    from public.activation_events
   where user_id = p_user_id;
  v_did_fire := (v_existing is not null);

  return jsonb_build_object('did_fire', v_did_fire, 'days_since_signup', p_days);
end$$;

comment on function public.record_activation_event(uuid, text, text, int) is
  'Phase 34 Plan 34-03 — atomic fire-once gate for the record-activation Edge Fn. '
  'pg_advisory_xact_lock + activated_at IS NULL guard + UPSERT. '
  'Returns { did_fire: boolean, reason?: string, days_since_signup?: int }. '
  'SECDEF: callable only by service_role.';

-- Lock down EXECUTE to service_role (the Edge Fn admin client) — never expose
-- to anon/authenticated. The function bypasses RLS by virtue of SECURITY DEFINER.
revoke all on function public.record_activation_event(uuid, text, text, int) from public;
revoke all on function public.record_activation_event(uuid, text, text, int) from anon;
revoke all on function public.record_activation_event(uuid, text, text, int) from authenticated;
grant execute on function public.record_activation_event(uuid, text, text, int) to service_role;
