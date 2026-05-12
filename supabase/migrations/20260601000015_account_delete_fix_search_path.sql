-- Phase 7 Plan 07-07 deviation fix — search_path resolution for digest().
--
-- Migrations 20260601000011 + 20260601000012 declared
--   set search_path = public, auth, pg_catalog
-- on initiate_account_deletion() + finalize_account_deletion(uid). At
-- execution time they fail with 42883
-- "function digest(text, unknown) does not exist" because Supabase installs
-- pgcrypto into the `extensions` schema (not `public`). Discovered during
-- 07-07 Task 5 e2e — captured RPC response body:
--   {"code":"42883","message":"function digest(text, unknown) does not exist"}
--
-- Same bug + same fix shape as 20260601000004_audit_trigger_fix_search_path.sql
-- from Plan 07-08. The hardening invariant (T-07-07-S2) is preserved:
-- `extensions` is Supabase-managed; authenticated callers cannot CREATE
-- objects in it by default Supabase grants, so a `digest()` shim
-- can't be planted to subvert the SECURITY DEFINER context.
--
-- This is a SEARCH_PATH RESOLUTION FIX ONLY. Function bodies are identical
-- to the source migrations; the only change is appending `extensions` to
-- the search_path list.

create or replace function public.initiate_account_deletion()
returns void
language plpgsql
security definer
set search_path = public, auth, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_last_sign_in timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- T-07-07-S1: require recent re-auth.
  select last_sign_in_at
    into v_last_sign_in
  from auth.users where id = v_uid;

  if v_last_sign_in is null or v_last_sign_in < now() - interval '5 minutes' then
    raise exception 'recent_auth_required' using errcode = 'P0007';
  end if;

  -- Idempotent double-click guard.
  if exists (select 1 from public.pending_account_deletions where user_id = v_uid) then
    raise exception 'already_pending' using errcode = 'P0008';
  end if;

  -- T+0 row.
  insert into public.pending_account_deletions (user_id) values (v_uid);

  -- Audit-skeleton row (T-07-07-R1).
  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action,
     before_hash, after_hash, ip_hash)
  values (
    v_uid,
    encode(digest(v_uid::text, 'sha256'), 'hex'),
    'auth.users',
    v_uid::text,
    'account_deleted_initiated',
    null, null, null
  );

  -- T-07-07-I1: move photos to the deny-read prefix.
  update storage.objects
     set name = 'photos-pending-shred/' || v_uid::text || '/' ||
                substring(name from position('/photos/' in name) + length('/photos/'))
   where bucket_id = 'photos'
     and name like v_uid::text || '/photos/%';

  update public.pending_account_deletions
     set photos_moved_at = now()
   where user_id = v_uid;

  -- Force sign-out across all devices.
  delete from auth.sessions where user_id = v_uid;
end;
$$;

revoke all on function public.initiate_account_deletion() from public;
grant execute on function public.initiate_account_deletion() to authenticated;

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

  -- Supabase Storage has a `protect_objects_delete` trigger that rejects
  -- direct DELETE FROM storage.objects unless the session variable
  -- `storage.allow_delete_query` is set to 'true'. This is a documented
  -- bypass for admin operations (account-deletion is exactly that case).
  -- The setting is local to the current transaction, so it cannot leak to
  -- other queries.
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects
   where bucket_id = 'photos'
     and name like 'photos-pending-shred/' || p_user_id::text || '/%';

  delete from auth.users where id = p_user_id;

exception
  when others then
    update public.pending_account_deletions
       set finalize_attempts = finalize_attempts + 1
     where user_id = p_user_id;
    raise;
end;
$$;

revoke all on function public.finalize_account_deletion(uuid) from public;
