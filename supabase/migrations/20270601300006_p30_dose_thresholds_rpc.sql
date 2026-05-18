-- Phase 30 Plan 02 — Task 1 Step 0 (migration 6 of Phase 30 series)
-- SECDEF: update_org_dose_trend_thresholds(p_org_id uuid, p_thresholds jsonb)
--
-- Admin-only function that updates org_settings.dose_trend_thresholds.
-- Pattern mirrors update_org_ranking_weights from Plan 30-00 Task 2 exactly:
--   security definer + search_path guard
--   unauthenticated guard
--   DB-level admin role re-check via org_members
--   UPDATE public.org_settings SET dose_trend_thresholds = p_thresholds WHERE org_id = p_org_id
--   direct INSERT INTO audit_logs preceded by app.suppress_audit GUC
-- Raised codes: 28000 (unauthenticated), 42501 (non-admin)
--
-- NOTE: update_org_ranking_weights ships 4 SECDEFs in migration 20270601300003.
-- THIS migration ships the 5th SECDEF (B3 plan-checker fix confirmed it was missing).

begin;

-- =============================================================================
-- SECDEF: update_org_dose_trend_thresholds
-- =============================================================================
-- Admin-only: updates org_settings.dose_trend_thresholds for the given org.
-- Thresholds shape: { missed_doses_n: int, window_days_m: int, variance_pct_x: int }
-- Shape validation (range constraints) is enforced server-side by ClinicianAlert
-- trigger in migration 20270601300004 (_trg_validate_dose_trend_thresholds if
-- present) or left to the application form layer for v1.3.
-- =============================================================================
create or replace function public.update_org_dose_trend_thresholds(
  p_org_id     uuid,
  p_thresholds jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_caller_uid   uuid := auth.uid();
  v_role         public.org_member_role;
  v_user_id_hash text;
begin
  -- Unauthenticated guard
  if v_caller_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Pattern S1: DB-level admin role re-check
  select role into v_role
  from public.org_members
  where org_id = p_org_id and user_id = v_caller_uid;

  if v_role is null or v_role <> 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  -- Update org_settings — sets dose_trend_thresholds for the org
  update public.org_settings
  set dose_trend_thresholds = p_thresholds
  where org_id = p_org_id;

  -- Audit log (direct INSERT — bypasses log_admin_action platform-admin check)
  -- GUC prevents audit trigger recursion (Phase 24 pattern)
  perform set_config('app.suppress_audit', 'on', true);

  v_user_id_hash := encode(
    extensions.digest(v_caller_uid::text, 'sha256'), 'hex'
  );

  insert into public.audit_logs(
    user_id_hash, table_name, action,
    user_id, actor_user_id, action_name, row_pk, after_data, source
  ) values (
    v_user_id_hash, 'org_settings', 'update',
    v_caller_uid, v_caller_uid,
    'update_org_dose_trend_thresholds', p_org_id::text,
    jsonb_build_object('org_id', p_org_id, 'dose_trend_thresholds', p_thresholds),
    'rpc'
  );
end;
$$;

revoke all on function public.update_org_dose_trend_thresholds(uuid, jsonb) from public;
grant execute on function public.update_org_dose_trend_thresholds(uuid, jsonb) to authenticated;

commit;
