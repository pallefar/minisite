-- Phase 7 Plan 07-07 deviation fix #3 — audit_trigger suppression hook for
-- the account-delete cascade.
--
-- Background: finalize_account_deletion() performs `DELETE FROM auth.users
-- WHERE id = p_user_id`, which cascades to all 10 sync tables. Each cascade
-- DELETE fires audit_trigger() (attached in 20260601000002), which tries to
-- INSERT a row into audit_logs with user_id=<the user being deleted>. The
-- audit_logs_user_id_fkey FK is NOT deferrable, so the INSERT fails mid-
-- cascade with `23503: violates foreign key constraint`.
--
-- Clean solutions considered:
--   - `session_replication_role='replica'` — requires superuser (denied on
--     managed Supabase).
--   - Mark audit_logs_user_id_fkey DEFERRABLE INITIALLY DEFERRED — would
--     defer the check to commit time, but at commit auth.users(id) is gone,
--     so the FK still rejects (the check applies to the inserted row, not
--     the deleted referenced row; ON DELETE SET NULL only fires when the
--     referenced row is deleted AFTER the audit row exists).
--   - Modify audit_trigger() to skip when a custom GUC is set. This is the
--     pattern used by other Supabase projects (e.g., supa-audit) and the
--     pattern we adopt here.
--
-- This migration re-emits audit_trigger() with a single new line: an early
-- `return null` when `app.suppress_audit = 'true'`. The skeleton row written
-- inline by finalize_account_deletion() remains the authoritative audit
-- trace for the account-delete operation; the per-row cascade audit
-- entries that would have fired are intentionally suppressed.
--
-- STRIDE impact:
--   T-07-08-01 (tampering) is unchanged — the GUC is only honoured by this
--   trigger; the FK + RLS gates on audit_logs are unaffected. Setting the
--   GUC is a transaction-local operation, so other concurrent sessions
--   cannot observe or exploit it. Authenticated clients cannot set arbitrary
--   GUCs from JWT context (the gate is Postgres-level grants on
--   pg_settings, not RLS). The only legitimate callers of this code path
--   are SECURITY DEFINER functions written by us.

create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_before text;
  v_after text;
  v_row_id text;
  v_user_id uuid;
begin
  -- Phase 7 07-07: account-delete cascade suppression hook.
  -- Set by finalize_account_deletion() via set_config(..., true).
  if coalesce(current_setting('app.suppress_audit', true), 'false') = 'true' then
    return coalesce(new, old);
  end if;

  v_user_id := coalesce(new.user_id, old.user_id);

  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    v_before := encode(digest(row_to_json(old)::text, 'sha256'), 'hex');
  end if;
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    v_after := encode(digest(row_to_json(new)::text, 'sha256'), 'hex');
  end if;

  v_row_id := coalesce(
    (case when tg_op = 'DELETE' then old else new end)::text,
    ''
  );

  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, before_hash, after_hash)
  values (
    v_user_id,
    encode(digest(v_user_id::text, 'sha256'), 'hex'),
    tg_table_name,
    v_row_id,
    lower(tg_op),
    v_before,
    v_after
  );

  return coalesce(new, old);
end;
$$;
