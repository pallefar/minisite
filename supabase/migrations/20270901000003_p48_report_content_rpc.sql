-- Phase 48 Plan 48-02 — public.report_content() SECDEF RPC (D-02 cooldown).
--
-- Decision refs:
--   D-02 (cooldown via partial UNIQUE catch-23505): one active report per
--     (reporter_user_id, target_type, target_id) where status in
--     ('open','triaged'). UNIQUE index ships in Plan 48-01
--     (community_reports_active_dedup_uniq). This RPC catches unique_violation
--     and re-raises with `detail` so the UI can surface a friendly message
--     without round-tripping a SELECT-then-INSERT race.
--   D-16 (audit-log): RPC perform-calls public.log_moderation_action
--     (shipped in Plan 48-04). plpgsql function resolution is deferred to
--     CALL TIME (not function definition); both Plan 48-02 and Plan 48-04
--     migrations apply in the same `supabase db push --linked` at Plan
--     48-12 close-out, so the reference is resolvable at first invocation.
--
-- Threat model:
--   T-48-01 (D, report-flood from one reporter): mitigated by Plan 48-01
--     partial UNIQUE + this RPC's catch-23505 atomic enforcement.
--   T-48-10 (E, SECDEF schema-shadow): `set search_path = public, extensions`.
--
-- Memory refs:
--   reference_supabase_migration_gotchas — SECDEF + search_path including
--     extensions; revoke from public; explicit grant.
--   feedback_rpc_auth_uid_vs_service_role_mismatch — uses auth.uid(); MUST
--     be called with a user JWT; grant goes ONLY to `authenticated`.
--     NEVER `service_role`. service_role callers must INSERT directly into
--     community_reports (claude-moderation Fn / banned-words trigger paths).
--   reference_postgres_no_insert_on_conflict_do_delete — cooldown enforced via
--     RPC catch-23505, NOT via `ON CONFLICT DO DELETE`.
--   feedback_negation_grep_defeated_by_comment_string — no rejected-alternative
--     syntax (e.g. `ON CONFLICT DO DELETE`) appears in committed body / comments.
--
-- Pattern: SECDEF function shell forked from
--   supabase/migrations/20270720000005_p44_community_secdef_rpcs.sql.
--
-- Cross-plan integration:
--   - reason column shape `jsonb_build_object('source','user','text', p_reason)`
--     matches D-07 system-report shape `{source:'claude_auto_flag', …}` /
--     `{source:'banned_word', …}` so admin UI can render uniformly.
--   - Plan 48-04 ships log_moderation_action(p_action_type, p_target_type,
--     p_target_id, p_before, p_after, p_reason) → signature aligned.

create or replace function public.report_content(
  p_target_type text,
  p_target_id   uuid,
  p_reason      text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_user_id   uuid := auth.uid();
  v_report_id uuid;
begin
  -- Require authenticated caller (T-48-01 baseline + ensures
  -- reporter_user_id is never NULL).
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- Validate target_type (belt-and-suspenders beyond the table-level CHECK
  -- shipped in Phase 45 community_reports schema).
  if p_target_type not in ('post','comment','dm_message','profile') then
    raise exception 'invalid_target_type' using errcode = '22023';
  end if;

  insert into public.community_reports
    (reporter_user_id, target_type, target_id, reason, status)
  values
    (v_user_id, p_target_type, p_target_id,
     jsonb_build_object('source','user','text', p_reason),
     'open')
  returning id into v_report_id;

  -- D-16 audit row. Function resolved at CALL time (plpgsql deferred
  -- resolution); Plan 48-04 ships log_moderation_action in the same
  -- `supabase db push --linked` batch.
  perform public.log_moderation_action(
    p_action_type => 'report_filed',
    p_target_type => p_target_type,
    p_target_id   => p_target_id,
    p_before      => null,
    p_after       => jsonb_build_object('report_id', v_report_id),
    p_reason      => p_reason
  );

  return jsonb_build_object('report_id', v_report_id, 'status', 'open');
exception
  when unique_violation then
    -- D-02 cooldown: per-reporter active dedup UNIQUE (Plan 48-01) raised
    -- 23505. Re-raise with structured detail; UI surfaces from `detail`.
    raise exception 'already_reported' using errcode = '23505',
      detail = 'You have already reported this; admin is reviewing.';
end;
$fn$;

revoke all on function public.report_content(text, uuid, text) from public;
grant execute on function public.report_content(text, uuid, text) to authenticated;
