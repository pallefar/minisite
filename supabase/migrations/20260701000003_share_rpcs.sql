-- Phase 8 Plan 08-01 — 6 SECURITY DEFINER RPCs for doctor read-share.
--
-- All 6 functions carry the canonical Phase 7 hardening invariant:
--   set search_path = public, extensions, pg_catalog
-- (per memory `reference_supabase_migration_gotchas.md` Pitfall 1; same fix
-- pattern as Phase 7 plan 07-07 migration 20260601000015 which had to add
-- `extensions` so pgcrypto's digest()/crypt()/gen_random_bytes() resolve on
-- managed Supabase). The `extensions` schema is Supabase-managed; default
-- grants prevent authenticated users from CREATEing shim functions there,
-- so the search_path can be trusted inside the SECURITY DEFINER context.
--
-- Permission shape — load-bearing for threat model:
--   create_share, revoke_share        → granted to authenticated  (patient context)
--   redeem_share, verify_share_code,
--     log_share_view,
--     increment_share_attempt          → granted to service_role only (Edge Function)
-- Per T-08-E1 (elevation of privilege): the service_role-only RPCs are how
-- we restrict the share-recipient mutation surface to the Edge Function's
-- ambient service-role JWT — authenticated callers cannot reach them.

-- pgcrypto is already enabled by 20260601000001_audit_logs.sql. Idempotent
-- safety net for re-runs of supabase db push.
create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. create_share(label, expires_at) → (share_id, raw_token, raw_code)
--
-- Patient-context RPC. Reads auth.uid() (never trusts a user_id parameter;
-- T-08-S1 mitigation). Generates a CSPRNG token + 6-digit code, hashes both
-- before storage, returns the raw values ONCE. The caller (Settings UI) must
-- display them to the patient and never re-fetch from the server (a re-fetch
-- would imply we kept the raw values somewhere — we don't).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.create_share(
  p_label text,
  p_expires_at timestamptz
)
returns table (share_id uuid, raw_token text, raw_code text)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_token text;
  v_code text;
  v_id uuid := gen_random_uuid();
begin
  -- T-08-S1: caller identity comes from JWT, not parameters.
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Input validation. invalid_parameter_value = 22023.
  if p_expires_at <= now() then
    raise exception 'expires_at must be in the future' using errcode = '22023';
  end if;
  if p_label is null or char_length(p_label) not between 1 and 80 then
    raise exception 'label must be 1..80 chars' using errcode = '22023';
  end if;

  -- CSPRNG URL token: 16 bytes → base64 → URL-safe alphabet → strip `=`.
  -- Result is ~22 chars of A-Z, a-z, 0-9, -, _.
  v_token := rtrim(
    replace(replace(encode(gen_random_bytes(16), 'base64'), '+', '-'), '/', '_'),
    '='
  );

  -- CSPRNG 6-digit code. We use 4 CSPRNG bytes, cast to int32 via bit(32),
  -- normalize to a non-negative six-digit string. Per RESEARCH A5 we MUST
  -- avoid the non-CSPRNG numeric generator — it's seeded from session start,
  -- not cryptographically secure, and is predictable across sessions sharing
  -- a backend instance. The `+ 1000000` then `% 1000000` dance handles
  -- negative int casts uniformly so the final lpad always produces a
  -- 6-digit string.
  v_code := lpad(
    (((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::int % 1000000) + 1000000) % 1000000)::text,
    6,
    '0'
  );

  -- Insert. token_hash = sha256(hex); access_code_hash = bcrypt(10 rounds).
  insert into public.shares (
    id, user_id, label,
    token_hash, access_code_hash,
    expires_at
  ) values (
    v_id, v_uid, p_label,
    encode(digest(v_token, 'sha256'), 'hex'),
    crypt(v_code, gen_salt('bf', 10)),
    p_expires_at
  );

  -- Return raw values ONCE.
  return query select v_id, v_token, v_code;
end;
$$;

revoke all on function public.create_share(text, timestamptz) from public;
grant execute on function public.create_share(text, timestamptz) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. revoke_share(share_id) → void
--
-- Patient-context RPC. Only the share owner can revoke (auth.uid() filter).
-- Per CONTEXT.md Open Question 3: also null the recipient_session_hash so a
-- doctor's HttpOnly cookie cannot be re-used even in the (impossible per RLS)
-- scenario where revoked_at gets cleared upstream — defense in depth.
-- Cannot extend expires_at (T-08-T1 mitigation) — this RPC only writes
-- revoked_at + recipient_session_hash.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.revoke_share(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  update public.shares
     set revoked_at = now(),
         recipient_session_hash = null
   where id = p_share_id
     and user_id = v_uid
     and revoked_at is null;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'share not found, not owned, or already revoked'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.revoke_share(uuid) from public;
grant execute on function public.revoke_share(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. redeem_share(share_id, recipient_session_hash, ua_family, ip_family) → void
--
-- Service-role-only RPC. The share Edge Function calls this on a successful
-- 6-digit code compare. Single-use enforcement is at the SQL layer: the
-- UPDATE filter `code_consumed_at IS NULL` plus `revoked_at IS NULL` plus
-- `expires_at > now()` — a second redeem on the same share_id will affect
-- zero rows and raise P0002.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.redeem_share(
  p_share_id uuid,
  p_recipient_session_hash text,
  p_ua_family text,
  p_ip_family text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_count integer;
begin
  update public.shares
     set code_consumed_at = now(),
         recipient_session_hash = p_recipient_session_hash
   where id = p_share_id
     and code_consumed_at is null
     and revoked_at is null
     and expires_at > now();

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'share unredeemable (not found, already consumed, revoked, or expired)'
      using errcode = 'P0002';
  end if;

  -- ua_family / ip_family are accepted as parameters for future binding
  -- enrichment (e.g. fingerprint-style anomaly checks). Not stored on the
  -- shares row in v1 — recipient binding is purely cookie-based per D-03.
  -- The Edge Function logs the same values via log_share_view.
  perform p_ua_family, p_ip_family;
end;
$$;

revoke all on function public.redeem_share(uuid, text, text, text) from public;
grant execute on function public.redeem_share(uuid, text, text, text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. verify_share_code(share_id, code) → boolean   (BL-2 from 08-01-PLAN)
--
-- Service-role-only. The Edge Function calls this to compare a candidate
-- 6-digit code against the bcrypt-hashed access_code_hash. Returns true on
-- match, false on mismatch or row-not-found. crypt() is the bcrypt-compare
-- primitive when the salt+hash form matches what gen_salt('bf', N) produced;
-- the comparison is constant-time within bcrypt's guarantees.
--
-- The Edge Function is responsible for calling increment_share_attempt on
-- every false response (rate-limit gate) and only invoking redeem_share when
-- this returns true.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.verify_share_code(
  p_share_id uuid,
  p_code text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_ok boolean;
begin
  select (access_code_hash = crypt(p_code, access_code_hash))
    into v_ok
  from public.shares
   where id = p_share_id;

  -- Row not found → v_ok stays null → coerce to false (don't reveal
  -- existence vs mismatch to the caller; both fail identically).
  return coalesce(v_ok, false);
end;
$$;

revoke all on function public.verify_share_code(uuid, text) from public;
grant execute on function public.verify_share_code(uuid, text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. log_share_view(share_id, ua_family, ip_family) → void
--
-- Service-role-only. The Edge Function calls this BEFORE returning a
-- snapshot — if the audit insert fails, the Edge Function MUST respond 500
-- and never serve the snapshot (T-08-R1 — repudiation mitigation; the audit
-- row must exist by the time the doctor has the data). Plan 08-02 enforces
-- this ordering in the Edge Function source.
--
-- Resolves the share owner from the shares row, hashes it (consistent with
-- the Phase 7 audit_logs.user_id_hash pattern — see 20260601000001 column
-- comment), and writes a single audit row. The recipient_ip_family CHECK
-- (migration 20260701000001) enforces the bucketed form; callers MUST
-- pre-bucket their ip_family values.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.log_share_view(
  p_share_id uuid,
  p_ua_family text,
  p_ip_family text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_owner uuid;
begin
  select user_id into v_owner from public.shares where id = p_share_id;
  if v_owner is null then
    raise exception 'share not found' using errcode = 'P0002';
  end if;

  -- The Phase 7 audit_logs column name is `user_id_hash` (per
  -- 20260601000001_audit_logs.sql column definition). Hash is sha256(uid::text)
  -- — same shape as the audit_trigger() function. table_name='shares' anchors
  -- this audit row to the shares surface; row_id = the share id (text form).
  insert into public.audit_logs (
    user_id, user_id_hash, table_name, row_id, action,
    actor_type, share_id, recipient_ua_family, recipient_ip_family
  ) values (
    v_owner,
    encode(digest(v_owner::text, 'sha256'), 'hex'),
    'shares',
    p_share_id::text,
    'share_view',
    'share_recipient',
    p_share_id,
    p_ua_family,
    p_ip_family
  );
end;
$$;

revoke all on function public.log_share_view(uuid, text, text) from public;
grant execute on function public.log_share_view(uuid, text, text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. increment_share_attempt(share_id) → int   (per-share rate-limit; Pitfall 5)
--
-- Service-role-only. The Edge Function calls this on every failed
-- verify_share_code response. Returns the new attempt count so the Edge
-- Function can apply the rate-limit gate (e.g. reject further redeems once
-- count >= 5 within a sliding window — windowing is enforced upstream).
-- Per-share rather than per-user so a high-traffic patient with many active
-- shares isn't globally locked out by one targeted share.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.increment_share_attempt(p_share_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_new_count integer;
begin
  update public.shares
     set failed_attempts_count = failed_attempts_count + 1,
         last_attempt_at = now()
   where id = p_share_id
  returning failed_attempts_count into v_new_count;

  if v_new_count is null then
    raise exception 'share not found' using errcode = 'P0002';
  end if;

  return v_new_count;
end;
$$;

revoke all on function public.increment_share_attempt(uuid) from public;
grant execute on function public.increment_share_attempt(uuid) to service_role;
