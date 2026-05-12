-- Phase 7 D-03 Storage deny-read on photos-pending-shred/ prefix.
-- Plan 07-07 / COMPL-06.
--
-- The free-tier "crypto-shred" guarantee from D-03 is delivered as two
-- co-equal mechanisms:
--   1. Move bytes into a deny-read prefix at T+0 (this policy).
--   2. Hard-delete bytes at T+30 (finalize_account_deletion +
--      finalize-account-deletions cron).
--
-- The defense-in-depth observation: the existing `photos_select_own` policy
-- from 20260514000010 already denies reads under the `photos-pending-shred/`
-- prefix as a side effect — `(storage.foldername(name))[1]` returns
-- `'photos-pending-shred'` for those paths, which never matches
-- `auth.uid()::text`. The policies below provide *explicit* + *RESTRICTIVE*
-- enforcement so the deny survives any future change to `photos_select_own`
-- (e.g., a hypothetical "share with another user" feature that broadens the
-- existing select).
--
-- RESTRICTIVE policies AND with all PERMISSIVE policies (Postgres RLS
-- semantics: row passes iff every RESTRICTIVE policy returns true AND at
-- least one PERMISSIVE policy returns true). Using RESTRICTIVE here means a
-- request that satisfies `photos_select_own` (via the broadened share path,
-- hypothetically) still cannot bypass the pending-shred deny.
--
-- STRIDE register:
--   T-07-07-I1 Information disclosure: photos visible to the original owner
--     during the 30-day pending window. RESTRICTIVE deny on SELECT keeps
--     even the owner blind; only service-role bypasses. Verified live in
--     e2e/rls-pending-account-deletions.test.ts (assertions 5-6).

create policy "photos_pending_shred_deny_authenticated_read"
  on storage.objects
  as restrictive
  for select to authenticated
  using (
    not (bucket_id = 'photos' and name like 'photos-pending-shred/%')
  );

-- Symmetrical deny for writes: an authenticated user must not be able to
-- craft an INSERT/UPDATE/DELETE that touches the pending-shred prefix
-- (e.g., to undo a soft-delete by renaming an object back, or to plant a
-- fake "evidence" object under another user's pending-shred prefix). The
-- pre-existing `photos_insert_own`/`photos_update_own`/`photos_delete_own`
-- already gate on `(storage.foldername(name))[1] = auth.uid()::text`, but
-- this RESTRICTIVE layer hardens that against future PERMISSIVE relaxations.
create policy "photos_pending_shred_deny_authenticated_writes"
  on storage.objects
  as restrictive
  for all to authenticated
  using (
    not (bucket_id = 'photos' and name like 'photos-pending-shred/%')
  )
  with check (
    not (bucket_id = 'photos' and name like 'photos-pending-shred/%')
  );
