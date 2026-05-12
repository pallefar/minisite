-- Phase 7 Plan 07-07 deviation fix #4 — Re-emit finalize_account_deletion
-- with the audit-suppression GUC integrated (the source-of-truth migration
-- 20260601000016 was already pushed before the audit_trigger GUC hook
-- landed in 20260601000017, so the live version is missing the
-- `set_config('app.suppress_audit', ...)` calls).

create or replace function public.finalize_account_deletion(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions, pg_catalog
as $$
declare
  v_row public.pending_account_deletions;
begin
  select * into v_row from public.pending_account_deletions where user_id = p_user_id;
  if not found then
    raise exception 'no pending row for %', p_user_id using errcode = 'P0006';
  end if;

  if v_row.initiated_at + interval '30 days' > now() then
    raise exception 'shred window not elapsed (initiated_at=%)', v_row.initiated_at
      using errcode = 'P0009';
  end if;

  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action,
     before_hash, after_hash, ip_hash)
  values (
    p_user_id,
    encode(digest(p_user_id::text, 'sha256'), 'hex'),
    'auth.users',
    p_user_id::text,
    'account_deleted_finalized',
    null, null, null
  );

  -- Supabase Storage protect_objects_delete trigger bypass — local to txn.
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects
   where bucket_id = 'photos'
     and name like 'photos-pending-shred/' || p_user_id::text || '/%';

  -- Suppress audit_trigger writes during cascade DELETE — see
  -- 20260601000017 for the full rationale. Local to the transaction.
  perform set_config('app.suppress_audit', 'true', true);
  delete from auth.users where id = p_user_id;
  perform set_config('app.suppress_audit', 'false', true);

exception
  when others then
    update public.pending_account_deletions
       set finalize_attempts = finalize_attempts + 1
     where user_id = p_user_id;
    raise;
end;
$$;

revoke all on function public.finalize_account_deletion(uuid) from public;
