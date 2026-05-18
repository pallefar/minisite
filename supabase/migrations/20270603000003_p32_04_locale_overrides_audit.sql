-- Phase 32 Plan 32-04 — I18N-08 audit trigger.
--
-- Every INSERT/UPDATE/DELETE on public.locale_overrides writes one row to
-- audit_logs via Phase 24's log_admin_action() helper (6-arg canonical
-- signature; NO p_org_id — that arg does not exist on the helper).
--
-- Important caller-context constraint:
--   log_admin_action gates on (auth.uid() is not null AND
--   is_admin_at_least('staff'::admin_role)). Row-level audit triggers fire
--   under the writing admin's session context, so this passes naturally.
--   service_role-context writes would FAIL with errcode 42501 — keep the
--   write path through the admin browser (RLS-gated upsert) so the trigger
--   inherits the admin's auth.uid().
--
-- SECURITY DEFINER requires `set search_path = extensions, public, pg_temp`
-- per reference_supabase_migration_gotchas (extensions namespace dependency
-- for gen_random_uuid / jsonb operations).

create or replace function public.audit_locale_overrides()
  returns trigger
  language plpgsql
  security definer
  set search_path = extensions, public, pg_temp
as $$
declare
  v_action text;
begin
  if TG_OP = 'INSERT' then
    v_action := 'locale_override_create';
  elsif TG_OP = 'UPDATE' then
    -- Treat the draft -> published flip as a distinct action for the audit
    -- timeline; every other UPDATE (value edit, unpublish, scope change) is
    -- generic 'locale_override_edit'.
    if NEW.published and not OLD.published then
      v_action := 'locale_override_publish';
    else
      v_action := 'locale_override_edit';
    end if;
  elsif TG_OP = 'DELETE' then
    v_action := 'locale_override_delete';
  end if;

  -- 6-arg log_admin_action — canonical Phase 24 signature.
  --   (p_action_name, p_target_user_id, p_table_name, p_row_pk, p_before, p_after)
  -- No p_org_id parameter exists on this helper. Org scope is captured in the
  -- row data jsonb (org_id column) for downstream consumers.
  perform public.log_admin_action(
    v_action,                                                              -- p_action_name
    coalesce(NEW.created_by, OLD.created_by),                              -- p_target_user_id
    'locale_overrides',                                                    -- p_table_name
    (coalesce(NEW.id, OLD.id))::text,                                      -- p_row_pk
    case when TG_OP = 'INSERT' then null else row_to_json(OLD)::jsonb end, -- p_before
    case when TG_OP = 'DELETE' then null else row_to_json(NEW)::jsonb end  -- p_after
  );

  return coalesce(NEW, OLD);
end;
$$;

comment on function public.audit_locale_overrides() is
  'Row-level audit trigger for public.locale_overrides. Fires under the writing admin''s session context so log_admin_action()''s is_admin_at_least(''staff'') gate passes. service_role-context writes would 42501 — that is intentional; production writes flow through the admin browser via RLS, not bypass.';

create trigger audit_locale_overrides_trigger
  after insert or update or delete on public.locale_overrides
  for each row execute function public.audit_locale_overrides();
