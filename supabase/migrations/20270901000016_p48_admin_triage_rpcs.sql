-- Phase 48 Plan 48-10 — admin triage RPCs: triage_report / dismiss_report / resolve_report.
--
-- Decision refs:
--   D-01 (triage workflow) — three terminal status transitions for community_reports:
--     open → triaged (admin claims for review)
--     open|triaged → dismissed (admin closes with reason; no enforcement action)
--     open|triaged → resolved (admin closed after enforcement)
--   D-16 (audit log) — every transition logs to moderation_audit_log via
--     public.log_moderation_action(action_type, target_type, target_id, before, after, reason).
--
-- Threat model:
--   T-48-10 (E, non-staff invokes triage RPC) — mitigated by SECDEF gate
--     `public.is_staff() or public.can_moderate_report_org(p_report_id)` at entry.
--   T-48-25 (I, cross-org disclosure via triage) — clinic admins gated by
--     can_moderate_report_org (target row must belong to a space scoped to an org
--     they are staff for). Platform staff (is_staff()) bypass org-scoping.
--
-- Memory refs:
--   reference_supabase_is_staff_helper — single canonical staff gate; no parallel table.
--   reference_supabase_migration_gotchas — SECDEF needs explicit
--     `set search_path = public, extensions` to prevent shadow-table injection.
--   feedback_rpc_auth_uid_vs_service_role_mismatch — all three RPCs reference
--     auth.uid() for actor capture (via log_moderation_action); GRANT EXECUTE
--     intentionally restricted to `authenticated` (no service_role caller path).
--   feedback_negation_grep_defeated_by_comment_string — no rejected-alternative
--     names mentioned in committed body / comments.
--
-- Pattern: forks the SECDEF function shell from Plan 48-02 report_content RPC
--   (supabase/migrations/20270901000003_p48_report_content_rpc.sql).
--
-- Status guards:
--   triage_report:   requires status='open' (raises P0002 'not_open' otherwise).
--   dismiss_report:  requires status IN ('open','triaged') (raises P0002 'not_actionable').
--   resolve_report:  requires status IN ('open','triaged') (raises P0002 'not_actionable').

begin;

-- ── triage_report ────────────────────────────────────────────────────────────

create or replace function public.triage_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_actor  uuid := auth.uid();
  v_before jsonb;
begin
  if not (public.is_staff() or public.can_moderate_report_org(p_report_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select to_jsonb(cr.*) into v_before
    from public.community_reports cr
   where cr.id = p_report_id;

  if v_before is null then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;

  update public.community_reports
     set status     = 'triaged',
         triaged_by = v_actor,
         triaged_at = now()
   where id = p_report_id
     and status = 'open';

  if not found then
    raise exception 'not_open' using errcode = 'P0002';
  end if;

  perform public.log_moderation_action(
    p_action_type => 'report_triaged',
    p_target_type => 'report',
    p_target_id   => p_report_id,
    p_before      => v_before,
    p_after       => jsonb_build_object('status','triaged','triaged_by', v_actor),
    p_reason      => null
  );
end;
$fn$;

revoke all on function public.triage_report(uuid) from public;
grant execute on function public.triage_report(uuid) to authenticated;

-- ── dismiss_report ───────────────────────────────────────────────────────────

create or replace function public.dismiss_report(p_report_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_actor  uuid := auth.uid();
  v_before jsonb;
begin
  if not (public.is_staff() or public.can_moderate_report_org(p_report_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select to_jsonb(cr.*) into v_before
    from public.community_reports cr
   where cr.id = p_report_id;

  if v_before is null then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;

  update public.community_reports
     set status           = 'dismissed',
         dismissed_reason = p_reason
   where id = p_report_id
     and status in ('open','triaged');

  if not found then
    raise exception 'not_actionable' using errcode = 'P0002';
  end if;

  perform public.log_moderation_action(
    p_action_type => 'report_dismissed',
    p_target_type => 'report',
    p_target_id   => p_report_id,
    p_before      => v_before,
    p_after       => jsonb_build_object('status','dismissed','dismissed_reason', p_reason),
    p_reason      => p_reason
  );
end;
$fn$;

revoke all on function public.dismiss_report(uuid, text) from public;
grant execute on function public.dismiss_report(uuid, text) to authenticated;

-- ── resolve_report ───────────────────────────────────────────────────────────

create or replace function public.resolve_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_actor  uuid := auth.uid();
  v_before jsonb;
begin
  if not (public.is_staff() or public.can_moderate_report_org(p_report_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select to_jsonb(cr.*) into v_before
    from public.community_reports cr
   where cr.id = p_report_id;

  if v_before is null then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;

  update public.community_reports
     set status = 'resolved'
   where id = p_report_id
     and status in ('open','triaged');

  if not found then
    raise exception 'not_actionable' using errcode = 'P0002';
  end if;

  perform public.log_moderation_action(
    p_action_type => 'report_resolved',
    p_target_type => 'report',
    p_target_id   => p_report_id,
    p_before      => v_before,
    p_after       => jsonb_build_object('status','resolved','resolved_by', v_actor),
    p_reason      => null
  );
end;
$fn$;

revoke all on function public.resolve_report(uuid) from public;
grant execute on function public.resolve_report(uuid) to authenticated;

-- ── list_user_moderation_roster ──────────────────────────────────────────────
-- Returns user_moderation_state JOINED to auth.users (email) and
-- public.profiles (display_name, handle). PostgREST cannot perform this JOIN
-- from the client because public.profiles has no email column (per memory
-- reference_profiles_email_vs_auth_users_email) and auth.users is not exposed
-- to PostgREST by default — a SECDEF RPC is the only safe path.
--
-- Gating: public.is_staff() — platform staff only. Clinic admins use the
-- per-report can_moderate_report_org gate via the reports queue; bans are a
-- platform-staff surface (no clinic-scoped variant in Phase 48).

create or replace function public.list_user_moderation_roster(p_search text default null)
returns table (
  user_id      uuid,
  status       text,
  applied_by   uuid,
  reason       text,
  expires_at   timestamptz,
  created_at   timestamptz,
  updated_at   timestamptz,
  email        text,
  display_name text,
  handle       text
)
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_search text;
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_search := nullif(btrim(coalesce(p_search, '')), '');

  return query
    select
      ums.user_id,
      ums.status,
      ums.applied_by,
      ums.reason,
      ums.expires_at,
      ums.created_at,
      ums.updated_at,
      au.email::text                              as email,
      (p.display_name)::text                      as display_name,
      (p.handle)::text                            as handle
    from public.user_moderation_state ums
    left join auth.users au on au.id = ums.user_id
    left join public.profiles p on p.id = ums.user_id
    where
      v_search is null
      or au.email ilike '%' || v_search || '%'
      or p.handle ilike '%' || v_search || '%'
      or p.display_name ilike '%' || v_search || '%'
    order by ums.updated_at desc
    limit 200;
end;
$fn$;

revoke all on function public.list_user_moderation_roster(text) from public;
grant execute on function public.list_user_moderation_roster(text) to authenticated;

commit;
