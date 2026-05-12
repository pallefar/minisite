-- Phase 7 D-03 T+0 RPC. Plan 07-07 / COMPL-06.
--
-- public.initiate_account_deletion() — SECURITY DEFINER, ZERO parameters.
-- Caller identity comes EXCLUSIVELY from auth.uid() (JWT-validated). This is
-- the headline mitigation for T-07-07-S2: there is no user_id parameter the
-- caller could spoof.
--
-- Side effects on success (single transaction):
--   1. Insert public.pending_account_deletions row (T+0 stamp).
--   2. Insert public.audit_logs skeleton row action='account_deleted_initiated'
--      (the audit trigger from 07-08 does NOT attach to pending_account_deletions
--      — it only attaches to the 10 sync tables — so we insert the skeleton row
--      inline here. 07-08 SUMMARY §Handoff → 07-07 documents this call shape.).
--   3. Move all storage.objects under `<uid>/photos/` to
--      `photos-pending-shred/<uid>/` (T-07-07-I1 — the new prefix is gated by
--      the deny-read policy in 20260601000014).
--   4. Stamp pending_account_deletions.photos_moved_at = now().
--   5. Delete all auth.sessions for the user (force sign-out across devices).
--
-- STRIDE register:
--   T-07-07-S1 Spoofing (stolen session): re-auth gate requires
--     auth.users.last_sign_in_at >= now() - interval '5 minutes'. Otherwise
--     raises sqlstate P0007 (recent_auth_required). SettingsPage maps this to
--     an inline "Sign out and sign back in within the last 5 minutes" error.
--   T-07-07-S2 Spoofing (parameter tampering): ZERO parameters. auth.uid()
--     only. Postgres-validated, JWT-derived, non-spoofable inside the
--     SECURITY DEFINER context.
--   T-07-07-T2 Tampering (direct table writes): authenticated role has no
--     INSERT/UPDATE/DELETE policies on pending_account_deletions or
--     audit_logs; only this RPC + service_role can write.
--   T-07-07-I1 Information disclosure (post-move readability): moving the
--     storage.objects rows under the photos-pending-shred/ prefix triggers
--     the deny-read RLS from 20260601000014 — the original owner can no
--     longer read their own photos after this RPC returns.
--   T-07-07-R1 Repudiation: audit_logs row written here preserves a
--     user_id_hash trace that survives the eventual auth.users delete (the
--     audit_logs.user_id column is `on delete set null` per 07-08).

create or replace function public.initiate_account_deletion()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_catalog
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

  -- Audit-skeleton row (T-07-07-R1). The 07-08 audit_trigger does NOT attach
  -- to pending_account_deletions, so we write the skeleton row inline using
  -- the same call shape documented in 07-08-SUMMARY §Handoff → 07-07.
  -- table_name='auth.users' + row_id=<uid> preserves the link between the
  -- skeleton event and the user identity that triggered it.
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

  -- T-07-07-I1: move photos to the deny-read prefix. The substring extracts
  -- the filename after the `/photos/` segment so we end up at
  -- `photos-pending-shred/<uid>/<filename>` (one segment, not nested).
  update storage.objects
     set name = 'photos-pending-shred/' || v_uid::text || '/' ||
                substring(name from position('/photos/' in name) + length('/photos/'))
   where bucket_id = 'photos'
     and name like v_uid::text || '/photos/%';

  update public.pending_account_deletions
     set photos_moved_at = now()
   where user_id = v_uid;

  -- Force sign-out across all devices. The SPA's SIGNED_OUT handler
  -- (App.tsx) clears the local session; this delete ensures no other live
  -- session can call any RPC again as this user.
  delete from auth.sessions where user_id = v_uid;
end;
$$;

revoke all on function public.initiate_account_deletion() from public;
grant execute on function public.initiate_account_deletion() to authenticated;
