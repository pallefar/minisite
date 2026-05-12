-- Phase 7 D-03 T+30 finalize worker. Plan 07-07 / COMPL-06.
--
-- public.finalize_account_deletion(p_user_id uuid) — SECURITY DEFINER, NO
-- grants to authenticated/anon. Invoked exclusively by:
--   1. The cron job lambda in 20260601000013 (postgres-role context).
--   2. public.run_finalize_account_deletions_cron_now() (e2e test hook,
--      service-role-only).
--   3. Direct service_role calls (ops break-glass).
--
-- Per-row finalize sequence (single transaction):
--   1. Validate pending row exists (raise P0006 otherwise).
--   2. Validate `initiated_at + interval '30 days' <= now()` (raise P0009 if
--      window not elapsed — defensive; the cron's selector should never feed
--      a non-elapsed row, but we treat the function as standalone-safe).
--   3. Write `account_deleted_finalized` audit-skeleton row BEFORE the
--      cascade fires (so user_id is still resolvable for the row). The audit
--      trigger from 07-08 does NOT attach to auth.users, so we write the
--      skeleton row directly (same shape as initiate). audit_logs.user_id is
--      `on delete set null` (per 07-08) so the row survives the cascade with
--      user_id_hash intact.
--   4. Hard-delete storage.objects under `photos-pending-shred/<uid>/` —
--      true byte-level shred (AES-256-at-rest invariant). The free-tier
--      "crypto-shred" guarantee from D-03 is that the bytes are gone.
--   5. DELETE FROM auth.users WHERE id = p_user_id — cascades via FK to all
--      12 child tables: injections, weights, meals, workouts, supplements,
--      mood, sleep, symptoms, vials, settings, ai_messages,
--      rate_limit_counters, photos, pending_account_deletions (self).
--
-- Idempotency: on exception, increments finalize_attempts on the pending row
-- and re-raises. The cron's outer loop catches `when others` and continues
-- to the next user_id, so a single failure does not block the batch.
--
-- STRIDE register:
--   T-07-07-T1 Tampering (malformed pending row): explicit `select * into v_row`
--     + `if not found` + window validation. Function is standalone-safe.
--   T-07-07-E2 Elevation of privilege: `revoke all from public` + no grants.
--     Only service_role / cron postgres-role context can invoke.

create or replace function public.finalize_account_deletion(p_user_id uuid)
returns void
language plpgsql
security definer
-- `extensions` is included so `digest()` (pgcrypto, installed in the
-- extensions schema on managed Supabase) resolves inside the SECURITY
-- DEFINER context. See 20260601000004_audit_trigger_fix_search_path.sql
-- — same bug + same fix shape from 07-08.
set search_path = public, auth, extensions, pg_catalog
as $$
declare
  v_row public.pending_account_deletions;
begin
  -- T-07-07-T1: malformed pending row.
  select * into v_row from public.pending_account_deletions where user_id = p_user_id;
  if not found then
    raise exception 'no pending row for %', p_user_id using errcode = 'P0006';
  end if;

  if v_row.initiated_at + interval '30 days' > now() then
    raise exception 'shred window not elapsed (initiated_at=%)', v_row.initiated_at
      using errcode = 'P0009';
  end if;

  -- Skeleton row BEFORE the cascade. After `delete from auth.users` fires,
  -- the FK `on delete set null` on audit_logs.user_id zeros the user_id
  -- column on this row, but user_id_hash (which is not-null) preserves the
  -- attribution trace forever.
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

  -- Hard-delete Storage objects under the pending-shred prefix. Supabase
  -- Storage has a `protect_objects_delete` trigger that rejects direct
  -- DELETE FROM storage.objects unless the session variable
  -- `storage.allow_delete_query` is set to 'true' (admin-bypass — local to
  -- the transaction so it cannot leak). Bytes are gone after this DELETE
  -- returns; the row in storage.objects pointing at the bucket object is
  -- what makes it accessible. Discovered during 07-07 Task 5 e2e —
  -- documented in 20260601000015_account_delete_fix_search_path.sql.
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects
   where bucket_id = 'photos'
     and name like 'photos-pending-shred/' || p_user_id::text || '/%';

  -- Cascade-purge everything else via the auth.users FK chain. This single
  -- DELETE purges 13 child tables in one transaction:
  --   injections, weights, meals, workouts, supplements, mood, sleep,
  --   symptoms, vials, settings, ai_messages, rate_limit_counters, photos,
  --   pending_account_deletions (self).
  delete from auth.users where id = p_user_id;

exception
  when others then
    -- Increment retry counter; cron will pick up on next tick (idempotent).
    -- Use a separate sub-transaction so the increment commits even though
    -- the outer transaction is rolling back.
    update public.pending_account_deletions
       set finalize_attempts = finalize_attempts + 1
     where user_id = p_user_id;
    raise;  -- surface to cron log
end;
$$;

revoke all on function public.finalize_account_deletion(uuid) from public;
-- No grants — only service-role + the cron job's SECURITY DEFINER context can call.
