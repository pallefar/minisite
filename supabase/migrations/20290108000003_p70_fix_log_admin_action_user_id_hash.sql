-- Plan 70-07 cascade-39 — remote-DB reconciliation (R3).
--
-- Root cause R3 (see 70-07-UNIT-DRIFT-ROOTCAUSE.md):
--   public.audit_logs.user_id_hash is `text not null` (since
--   20260601000001_audit_logs.sql:62). 20270601200005 fixed fn_audit_phi_trigger
--   to populate it, but 20270601000029_log_admin_action_function.sql — written a
--   year later — still INSERTs into audit_logs WITHOUT user_id_hash. So every
--   log_admin_action() call fails with `23502 null value in column
--   "user_id_hash"`; it has been DOA since it shipped (masked by the rate-limit
--   cluster until cascade-32 unmasked it).
--
--   Breaks the direct audit-logs-rls test AND every RPC that records an admin
--   action via log_admin_action (rag topic create/update/soft-delete/restore,
--   rag_topic_audit).
--
-- Fix: create-or-replace log_admin_action with user_id_hash added to the INSERT,
-- using the SAME canonical value as the trigger fix (20270601200005):
--   encode(digest(coalesce(auth.uid()::text, 'service_role'), 'sha256'), 'hex')
-- Signature, role gate, search_path, and grant are unchanged.
--
-- Affected tests (live remote DB):
--   src/lib/admin/__tests__/audit-logs-rls.test.ts T3
--   src/lib/admin/__tests__/audit-trigger.test.ts T3/T4/T5
--   src/lib/rag/__tests__/topic-crud.test.ts (create/update/soft-delete/restore)
--   src/lib/rag/__tests__/topic-audit.test.ts (create/update/delete/restore)
--   src/lib/rag/__tests__/topic-crud-rls.test.ts, soft-delete.test.ts, rls-matrix.test.ts

create or replace function public.log_admin_action(
  p_action_name    text,
  p_target_user_id uuid,
  p_table_name     text   default null,
  p_row_pk         text   default null,
  p_before         jsonb  default null,
  p_after          jsonb  default null
)
returns uuid
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  v_id uuid;
begin
  -- Caller must be authenticated and at least staff
  if auth.uid() is null or not public.is_admin_at_least('staff'::public.admin_role) then
    raise exception 'log_admin_action: caller is not admin'
      using errcode = '42501';
  end if;

  insert into public.audit_logs (
    actor_user_id,
    target_user_id,
    user_id_hash,
    action_name,
    table_name,
    row_pk,
    before_data,
    after_data,
    source
  ) values (
    auth.uid(),
    p_target_user_id,
    -- Phase 70-07 R3 fix: audit_logs.user_id_hash is NOT NULL. Same canonical
    -- value used by fn_audit_phi_trigger (20270601200005): sha256 of the actor
    -- uuid (or 'service_role' when no JWT), hex-encoded.
    encode(digest(coalesce(auth.uid()::text, 'service_role'), 'sha256'), 'hex'),
    p_action_name,
    p_table_name,
    p_row_pk,
    p_before,
    p_after,
    'rpc'
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Re-grant execute (idempotent; create-or-replace preserves grants, but explicit
-- for clarity and to match 20270601000029).
grant execute on function public.log_admin_action(text, uuid, text, text, jsonb, jsonb)
  to authenticated;
