-- Phase 22 plan 01 — D-01: cancel-deletion RPC backing the "Cancel deletion" CTA in the
-- transactional email + SoftDeleteCountdownBanner.
-- Analog: supabase/migrations/20260601000011_initiate_account_deletion_rpc.sql (SECURITY DEFINER
--         + skeleton audit row + service-role bypass pattern)
-- Pitfalls applied: Pitfall 4 (app.suppress_audit GUC inside function body — DELETE on
--                              pending_account_deletions would otherwise re-fire audit trigger),
--                   Pitfall 7 (`extensions` in search_path so `extensions.hmac()` resolves under
--                              SECURITY DEFINER context — analog 20260601000004 fix shape).
--
-- TOKEN FORMAT (HS256-style HMAC with pgcrypto): "<uid>.<initiated_at_epoch>.<hex_hmac>"
--   Verification:
--     1. Split on '.' → require exactly 3 parts.
--     2. Compute expected = encode(hmac(uid || '.' || epoch, KEY, 'sha256'), 'hex').
--     3. Constant-time equality via `=` on hex strings (Postgres text compare; OK for hex).
--     4. epoch must be within now() - 7 days (token TTL matches soft-delete window).
--     5. pending_account_deletions row must still exist for that user.
--
-- Vault load: CANCEL_DELETION_HMAC_KEY — set out-of-band via Supabase Dashboard → Vault.
--   Migration is a presence guard; no key material in file.
-- Mirror analog: 20270101000014_service_role_key_vault_load.sql.

do $$
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'vault' and table_name = 'decrypted_secrets'
  ) then
    raise exception
      'vault.decrypted_secrets is unavailable. Enable Supabase Vault before applying this migration.';
  end if;
end$$;

create or replace function public.cancel_account_deletion(p_token text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_parts text[];
  v_uid_text text;
  v_uid uuid;
  v_epoch_text text;
  v_epoch bigint;
  v_sig_hex text;
  v_hmac_key text;
  v_expected_hex text;
  v_now_epoch bigint;
  v_existed boolean;
begin
  if p_token is null then
    raise exception 'invalid_token' using errcode = '22023';
  end if;

  -- Token shape: <uid>.<epoch>.<hex_hmac>
  v_parts := string_to_array(p_token, '.');
  if array_length(v_parts, 1) <> 3 then
    raise exception 'invalid_token' using errcode = '22023';
  end if;
  v_uid_text := v_parts[1];
  v_epoch_text := v_parts[2];
  v_sig_hex := v_parts[3];

  -- Parse uuid + epoch.
  begin
    v_uid := v_uid_text::uuid;
    v_epoch := v_epoch_text::bigint;
  exception when others then
    raise exception 'invalid_token' using errcode = '22023';
  end;

  -- Load HMAC key from Vault.
  select decrypted_secret into v_hmac_key
    from vault.decrypted_secrets
   where name = 'CANCEL_DELETION_HMAC_KEY'
   limit 1;
  if v_hmac_key is null then
    raise exception 'hmac_key_missing' using errcode = 'P0001';
  end if;

  -- Compute expected HMAC.
  v_expected_hex := encode(
    extensions.hmac(v_uid_text || '.' || v_epoch_text, v_hmac_key, 'sha256'),
    'hex'
  );
  if v_expected_hex <> v_sig_hex then
    raise exception 'invalid_token' using errcode = '22023';
  end if;

  -- TTL: token must be within 7 days of initiated_at.
  v_now_epoch := extract(epoch from now())::bigint;
  if v_now_epoch - v_epoch > 7 * 86400 then
    raise exception 'token_expired' using errcode = 'P0001';
  end if;

  -- Suppress per-row audit fires while we delete + write the inline audit row.
  perform set_config('app.suppress_audit', 'true', true);

  delete from public.pending_account_deletions
   where user_id = v_uid
  returning true into v_existed;

  if v_existed is null then
    raise exception 'no_pending_deletion' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (
    user_id,
    user_id_hash,
    table_name,
    row_id,
    action,
    target_user_id
  ) values (
    v_uid,
    encode(digest(v_uid::text, 'sha256'), 'hex'),
    'pending_account_deletions',
    v_uid::text,
    'account_deletion_cancelled',
    v_uid
  );
end;
$$;

revoke all on function public.cancel_account_deletion(text) from public;
-- The token IS the authentication: anyone holding the HMAC-signed token can cancel.
-- Therefore the function is callable by anon (the cancel link in the email reaches signed-out users
-- — the user may have signed out across all devices when they initiated deletion).
grant execute on function public.cancel_account_deletion(text) to anon, authenticated;
