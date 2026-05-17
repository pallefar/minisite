-- Phase 24 Plan 24-05 — TOTP RPCs: issue_backup_codes, consume_backup_code,
--                                   set_has_totp_true, reset_totp
-- Decision refs: D-07, D-08, D-09
--
-- All 4 functions are SECURITY DEFINER with:
--   set search_path = extensions, public, pg_temp
-- per [[reference_supabase_migration_gotchas]].
--
-- Backup-code HMAC:
--   Uses BACKUP_CODE_PEPPER from vault.decrypted_secrets.
--   Raises loudly if the secret is absent — operations cannot proceed
--   without the pepper (fail-secure, not fail-open).
--
-- Schema: all functions are in the `public` schema so supabase.rpc('<name>')
--   calls work with the default schema lookup.
--
-- reset_totp uses direct DELETE from auth.mfa_factors (the Supabase Auth
--   internal table) via service_role ownership of the SECURITY DEFINER function.
--   The Supabase Auth admin API (pg side) does not expose a pg-callable
--   mfa_remove_factor() helper in all tiers, so we delete directly.

-- ============================================================================
-- 1. admin.issue_backup_codes()
--    Generates + HMAC-hashes 10 backup codes for the calling user.
--    Called immediately after TOTP enrollment (session is aal2 at that point).
--    Returns the PLAINTEXT codes for one-time display.
-- ============================================================================

create or replace function public.issue_backup_codes()
returns text[]
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  v_uid         uuid;
  v_aal         text;
  v_pepper      text;
  v_codes       text[] := array[]::text[];
  v_alphabet    text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- 32 chars, omit 0/1/I/L/O
  v_code        text;
  v_hash        text;
  i             int;
  j             int;
  v_rnd_bytes   bytea;
begin
  -- Auth check: caller must be authenticated
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'issue_backup_codes: not authenticated' using errcode = '42501';
  end if;

  -- AAL check: caller must be at aal2 (just completed TOTP enrollment)
  v_aal := auth.jwt() ->> 'aal';
  if v_aal <> 'aal2' then
    raise exception 'issue_backup_codes: aal2 required' using errcode = '42501';
  end if;

  -- Load BACKUP_CODE_PEPPER from vault
  select decrypted_secret
  into v_pepper
  from vault.decrypted_secrets
  where name = 'BACKUP_CODE_PEPPER'
  limit 1;

  if v_pepper is null then
    raise exception 'issue_backup_codes: BACKUP_CODE_PEPPER vault secret not found'
      using errcode = '42704';
  end if;

  -- Delete prior unconsumed codes for this user (regenerate = reset unconsumed)
  -- Consumed codes (used_at IS NOT NULL) are kept for audit history.
  delete from public.admin_backup_codes
  where user_id = v_uid
    and used_at is null;

  -- Generate 10 unique codes
  for i in 1..10 loop
    -- Generate 12 random bytes → map each to alphabet (mod 32)
    v_rnd_bytes := gen_random_bytes(12);
    v_code := '';
    for j in 0..11 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_rnd_bytes, j) % 32) + 1, 1);
    end loop;
    v_code := substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4);

    -- HMAC-SHA256: encode(hmac(code, pepper, 'sha256'), 'hex')
    v_hash := encode(hmac(v_code, v_pepper, 'sha256'), 'hex');

    -- Insert hashed code (plaintext is NOT stored)
    insert into public.admin_backup_codes (user_id, code_hash)
    values (v_uid, v_hash)
    on conflict (user_id, code_hash) do nothing;  -- collision: will just get fewer codes

    v_codes := array_append(v_codes, v_code);
  end loop;

  return v_codes;
end;
$$;

-- Grant execute to authenticated — SECURITY DEFINER body enforces aal2 + auth.uid() check
grant execute on function public.issue_backup_codes() to authenticated;

-- ============================================================================
-- 2. admin.consume_backup_code(p_code text)
--    Single-use backup code validation. Returns true on success, false on fail.
--    Marks the code as used atomically.
-- ============================================================================

create or replace function public.consume_backup_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  v_uid     uuid;
  v_pepper  text;
  v_hash    text;
  v_id      uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'consume_backup_code: not authenticated' using errcode = '42501';
  end if;

  if p_code is null or p_code = '' then
    return false;
  end if;

  -- Load BACKUP_CODE_PEPPER from vault
  select decrypted_secret
  into v_pepper
  from vault.decrypted_secrets
  where name = 'BACKUP_CODE_PEPPER'
  limit 1;

  if v_pepper is null then
    raise exception 'consume_backup_code: BACKUP_CODE_PEPPER vault secret not found'
      using errcode = '42704';
  end if;

  -- Hash the provided code
  v_hash := encode(hmac(p_code, v_pepper, 'sha256'), 'hex');

  -- Atomically mark as used (only if not already used and belongs to caller)
  update public.admin_backup_codes
  set used_at = now()
  where user_id = v_uid
    and code_hash = v_hash
    and used_at is null
  returning id into v_id;

  -- Return true if a row was updated (code was valid + unused)
  return v_id is not null;
end;
$$;

grant execute on function public.consume_backup_code(text) to authenticated;

-- ============================================================================
-- 3. set_has_totp_true()
--    Sets profiles.has_totp = true for the calling user.
--    Called immediately after successful enrollment + backup codes saved.
--    Requires aal2 (D-09 — user just verified their TOTP factor).
-- ============================================================================

create or replace function public.set_has_totp_true()
returns void
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  v_uid  uuid;
  v_aal  text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'set_has_totp_true: not authenticated' using errcode = '42501';
  end if;

  v_aal := auth.jwt() ->> 'aal';
  if v_aal <> 'aal2' then
    raise exception 'set_has_totp_true: aal2 required' using errcode = '42501';
  end if;

  update public.profiles
  set has_totp = true
  where id = v_uid;
end;
$$;

grant execute on function public.set_has_totp_true() to authenticated;

-- ============================================================================
-- 4. reset_totp(p_target_user_id uuid)
--    Superadmin-only: clears the target user's MFA factor + sets has_totp=false
--    + writes audit_log. The admin-reset-totp Edge Function (Plan 24-05 Task 4)
--    calls this RPC and then sends an email with a new enrollment link.
--
--    MFA factor removal: deletes directly from auth.mfa_factors (the internal
--    Supabase Auth table). SECURITY DEFINER with postgres search_path allows this.
-- ============================================================================

create or replace function public.reset_totp(p_target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  v_caller uuid;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'reset_totp: not authenticated' using errcode = '42501';
  end if;

  -- Caller must be superadmin (D-08)
  if not public.is_admin_at_least('superadmin'::public.admin_role) then
    raise exception 'reset_totp: superadmin role required' using errcode = '42501';
  end if;

  if p_target_user_id is null then
    raise exception 'reset_totp: p_target_user_id required' using errcode = '22023';
  end if;

  -- Remove all TOTP factors for target user
  -- auth.mfa_factors is the internal Supabase Auth table; accessible from SECURITY DEFINER
  -- function that has been granted via the postgres role + extensions search_path.
  delete from auth.mfa_factors
  where user_id = p_target_user_id
    and factor_type = 'totp';

  -- Also remove any unverified TOTP challenges
  delete from auth.mfa_challenges
  where factor_id in (
    select id from auth.mfa_factors
    where user_id = p_target_user_id
      and factor_type = 'totp'
  );

  -- Set has_totp = false so next AdminLayout render triggers SetupTotpPage
  update public.profiles
  set has_totp = false
  where id = p_target_user_id;

  -- Write audit log (D-16 append-only via log_admin_action)
  perform public.log_admin_action(
    'reset_totp',
    p_target_user_id,
    'profiles',
    p_target_user_id::text,
    jsonb_build_object('has_totp', true),
    jsonb_build_object('has_totp', false)
  );
end;
$$;

grant execute on function public.reset_totp(uuid) to authenticated;
