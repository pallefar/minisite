-- Phase 35 Plan 07 — GAME-07 share-token mint (server-side HMAC; secret in vault)
--
-- SECDEF RPC `mint_share_token(p_level int)` signs a share token using HMAC-SHA256.
-- The secret is stored in the Supabase vault under the key `share_token_secret`.
--
-- REVIEW-F-3 (base64url reconciliation): Vercel verifyShareToken's base64url()
-- STRIPS '=' padding entirely (`.replace(/=+$/, '')`).
-- Postgres `translate('+/=\n', '-_')` would REPLACE '=' with '_' — producing a
-- DIFFERENT string and silently breaking HMAC verification. Use replace() chains
-- to DROP '=' (and '\n') entirely, mirroring the Vercel side exactly.
--
-- The resulting replace-chain:
--   replace(replace(replace(replace(encode(..., 'base64'), E'\n', ''), '=', ''), '+', '-'), '/', '_')
-- is byte-identical to the Vercel side's:
--   btoa(...).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
--
-- Operator deploy steps (run ONCE after migration apply — NOT in this file):
--   SELECT vault.create_secret('<HMAC-SHA256-key>', 'share_token_secret', 'Phase 35 share-token signing');
-- and on Vercel:
--   vercel env add SHARE_TOKEN_SECRET production   (same secret value)

create or replace function public.mint_share_token(p_level int)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog, extensions
as $body$
declare
  v_user uuid := auth.uid();
  v_secret text;
  v_ts int;
  v_user_anon text;
  v_body_json text;
  v_body_b64 text;
  v_sig text;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if p_level is null or p_level < 1 or p_level > 1000 then
    raise exception 'invalid_level' using errcode = '22023';
  end if;

  -- Read signing secret from vault
  -- (per memory reference_supabase_pg_cron_vault_service_role_pattern)
  select decrypted_secret
    into v_secret
    from vault.decrypted_secrets
   where name = 'share_token_secret'
   limit 1;

  if v_secret is null then
    raise exception 'share_token_secret_missing' using errcode = 'P0001';
  end if;

  v_ts := extract(epoch from now())::int;

  -- 16-char anonymized user id: first 16 hex chars of SHA-256(user_id || secret)
  -- Irreversible without knowing the secret; sufficient for analytics disambiguation.
  v_user_anon := substring(
    encode(digest(v_user::text || v_secret, 'sha256'), 'hex')
    for 16
  );

  v_body_json := json_build_object(
    'level', p_level,
    'ts', v_ts,
    'userIdAnon', v_user_anon
  )::text;

  -- REVIEW-F-3: use replace-chain (NOT translate) to produce base64url
  -- that byte-matches the Vercel verifier. Strip newlines and '=' padding,
  -- then map '+' -> '-' and '/' -> '_'.
  v_body_b64 := replace(
    replace(
      replace(
        replace(encode(v_body_json::bytea, 'base64'), E'\n', ''),
        '=', ''
      ),
      '+', '-'
    ),
    '/', '_'
  );

  v_sig := replace(
    replace(
      replace(
        replace(encode(hmac(v_body_b64, v_secret, 'sha256'), 'base64'), E'\n', ''),
        '=', ''
      ),
      '+', '-'
    ),
    '/', '_'
  );

  return v_body_b64 || '.' || v_sig;
end;
$body$;

revoke all on function public.mint_share_token(int) from public;
grant execute on function public.mint_share_token(int) to authenticated;
