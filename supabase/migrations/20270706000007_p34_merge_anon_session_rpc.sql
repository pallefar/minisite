-- Phase 34 Plan 34-05 (ONBOARD-01/11): merge anonymous_sessions into authenticated user.
--
-- D-07 richest-data merge under advisory lock. Picks the row with the highest
-- population_score (non-null preferences fields + draft_entries count) and
-- breaks ties by `last_activity_at desc`. All eligible rows (winner + siblings)
-- are tagged with merged_user_id so the weekly TTL cron (Plan 34-02) leaves
-- them alone — merged rows are retained for audit; orphan rows (merged_user_id
-- IS NULL) are the ones eligible for deletion.
--
-- D-08 propagation buckets are done by the Edge Fn caller (merge-anon-session):
--   (a) preferences → profiles update (locale, units, timezone, primary_goal)
--   (b) draft_entries → returned to browser for the dashboard's draft-replay flow
--   (c) PostHog alias → aliasServerSide() in the Edge Fn finally
--   (d) aff_code → affiliate_clicks.user_id propagation
--
-- Idempotency: re-running with the same cookie_ids returns {winner_id: null}
-- because all eligible rows have merged_user_id set after the first call.
--
-- Race-safety (T-34-05-02, ONBOARD-11): pg_advisory_xact_lock keyed on user_id
-- serializes concurrent calls for the same user across all replicas — only one
-- caller observes the unmerged rows; the other gets the no-op response.
--
-- Per memory reference_supabase_migration_gotchas:
--   - SECURITY DEFINER needs `extensions` in search_path (used here even though
--     we don't currently call into extensions — defensive against future edits).
--   - No partial-index expressions in this migration → IMMUTABLE rule N/A.

create or replace function public.merge_anon_session(
  p_user_id    uuid,
  p_cookie_ids text[]
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_winner record;
  v_result jsonb;
begin
  -- Race lock — keyed on the destination user so concurrent calls for the
  -- same user serialize, but calls for different users run in parallel.
  perform pg_advisory_xact_lock(hashtext('merge_anon_session:' || p_user_id::text));

  with eligible as (
    select
      a.id,
      a.cookie_id,
      a.preferences,
      a.draft_entries,
      a.aff_code,
      a.last_activity_at,
      -- D-07 population_score: count of non-null preference fields + draft entries.
      -- jsonb_each preserves all keys; we filter null values so {locale:null, units:'metric'}
      -- scores 1 not 2. jsonb_array_length is robust against null/empty arrays.
      (
        coalesce(
          (
            select count(*)
              from jsonb_each(coalesce(a.preferences, '{}'::jsonb))
              where value is not null and value::text <> 'null'
          ),
          0
        )
        + coalesce(jsonb_array_length(coalesce(a.draft_entries, '[]'::jsonb)), 0)
      ) as pop_score
    from public.anonymous_sessions a
    where a.cookie_id = any(p_cookie_ids)
      and a.merged_user_id is null
  )
  select id, cookie_id, preferences, draft_entries, aff_code, pop_score
    into v_winner
    from eligible
    order by pop_score desc, last_activity_at desc
    limit 1;

  if v_winner.id is null then
    return jsonb_build_object('winner_id', null);
  end if;

  -- Mark winner + all eligible siblings as merged so the TTL cron leaves them
  -- (cron deletes only `merged_user_id IS NULL` rows). Sibling rows are tagged
  -- with the same merged_user_id for audit; their preferences/drafts are NOT
  -- copied (D-07 richest-wins — losers are dropped).
  update public.anonymous_sessions
    set merged_user_id = p_user_id,
        last_activity_at = now()
    where cookie_id = any(p_cookie_ids)
      and merged_user_id is null;

  v_result := jsonb_build_object(
    'winner_id',     v_winner.id,
    'cookie_id',     v_winner.cookie_id,
    'preferences',   coalesce(v_winner.preferences, '{}'::jsonb),
    'draft_entries', coalesce(v_winner.draft_entries, '[]'::jsonb),
    'aff_code',      v_winner.aff_code
  );
  return v_result;
end$$;

-- D-10 trust boundary: only service_role can call this RPC. End-users go through
-- the merge-anon-session Edge Fn which auth.getUser()-validates the JWT first.
revoke all on function public.merge_anon_session(uuid, text[]) from public, anon, authenticated;
grant execute on function public.merge_anon_session(uuid, text[]) to service_role;

comment on function public.merge_anon_session(uuid, text[]) is
  'Phase 34 D-07/D-08 merge: picks richest anonymous_sessions row by (pop_score desc, last_activity_at desc) under pg_advisory_xact_lock, marks all eligible rows merged_user_id = p_user_id. Returns {winner_id, cookie_id, preferences, draft_entries, aff_code} on hit, {winner_id: null} on idempotent re-run.';

comment on column public.anonymous_sessions.merged_user_id is
  'Phase 34 D-07: NULL = orphan (eligible for TTL cron deletion); set = consumed by merge_anon_session, retained indefinitely for audit. The weekly TTL cron in 20270706000005 only deletes orphan rows.';
