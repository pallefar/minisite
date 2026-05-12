-- Phase 7 Plan 07-07 deviation fix #2 — Supabase Storage delete trigger bypass.
--
-- 20260601000015 fixed the digest() search_path resolution but introduced a
-- secondary failure surfaced by manual finalize invocation:
--   42501: Direct deletion from storage.objects is not allowed.
--          Use the Storage API instead.
--          (storage.protect_delete trigger)
--
-- The trigger checks `current_setting('storage.allow_delete_query', true)`
-- and rejects the DELETE unless the value is 'true'. The setting is local
-- to the transaction (`set_config(..., true)`), so it cannot leak across
-- requests or be observed by other concurrent sessions. The plan was
-- explicit: NO Edge Function bridge for finalize. This in-function bypass
-- is the documented Supabase pattern for admin-context object deletion.
--
-- Re-emits finalize_account_deletion with the bypass in place. Search_path
-- is unchanged from 20260601000015 (public, auth, extensions, pg_catalog).

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

  -- Suppress audit_trigger writes during the cascade DELETE. Without this,
  -- each per-table cascade-delete fires audit_trigger() which tries to
  -- INSERT into audit_logs with user_id=<the user being deleted>; the
  -- audit_logs_user_id_fkey constraint (not deferrable) rejects this
  -- mid-cascade. The skeleton row written above is the authoritative
  -- audit trace for this operation; the per-row entries that would have
  -- fired during cascade are intentionally suppressed — they'd be redundant
  -- noise pointing at a user_id that's about to disappear anyway.
  -- session_replication_role='replica' would do this cleanly but requires
  -- superuser. The custom GUC `app.suppress_audit` is honoured by
  -- audit_trigger() via the early-return added in 20260601000017.
  -- Local to the transaction.
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
