-- Phase 28 Plan 04 Task 2 — SECDEF helper + browser-facing SECDEF RPC.
--
-- (A) `public.realtime_topic_authorized(topic text, claims jsonb) → boolean`
--     Per addendum A4 — helper called by the realtime.messages RLS policy.
--
--     Defense-in-depth per Pitfall 2 (32-bit HMAC truncation collision):
--       Even if an attacker guesses an 8-hex prefix, their JWT claim MUST
--       contain the matching org_id. The loop construct guarantees both:
--         1. The HMAC matches (cryptographic requirement).
--         2. The org_id is in the caller's app_metadata.org_ids claim.
--     CONTEXT D-23 originally sketched `claim()` helper — that helper does
--     NOT exist in Supabase Realtime. Addendum A4 explicitly corrects this;
--     use `current_setting('request.jwt.claims', true)::jsonb`.
--
-- (B) `public.get_realtime_channel_keying() → text`
--     Browser-facing SECDEF RPC. Authenticated users call this once per
--     session to fetch the raw secret for client-side HMAC computation.
--     Per CONTEXT D-24 (researcher discretion): returning the raw secret
--     for simplicity; derived per-session token deferred to operational
--     rotation runbook.

-- ── (A) realtime_topic_authorized ──────────────────────────────────────────

create or replace function public.realtime_topic_authorized(
  topic  text,
  claims jsonb
)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = pg_catalog, public, extensions
as $$
declare
  v_secret        text;
  v_org_id        text;
  v_table         text;
  v_expected_hash text;
begin
  -- Topic MUST match the pattern `org-{8 lowercase hex}-{lowercase_table_name}`.
  -- Fail fast on malformed topics (Case 4 + Case 5 in test suite).
  if topic !~ '^org-[0-9a-f]{8}-[a-z_]+$' then
    return false;
  end if;

  -- Guard: claims must be a JSON object (Case 6 — empty / null claims).
  if claims is null or jsonb_typeof(claims) <> 'object' then
    return false;
  end if;

  -- Guard: app_metadata.org_ids must be a non-empty array.
  -- `#>` path-operator returns null for missing keys without raising.
  if jsonb_typeof(claims #> '{app_metadata,org_ids}') is distinct from 'array' then
    return false;
  end if;

  -- Extract the table suffix from the topic (field 3 of `-`-delimited string).
  -- topic shape: org-{8hex}-{table}  →  split_part gives: 1=org, 2={8hex}, 3={table}
  v_table  := split_part(topic, '-', 3);

  -- Fetch the Vault secret via the dedicated SECDEF reader.
  v_secret := public.get_realtime_secret();

  -- If the Vault secret is missing (deployment not configured), fail closed.
  if v_secret is null then
    return false;
  end if;

  -- Iterate every org_id in the caller's JWT claim list.
  -- Returning true REQUIRES BOTH:
  --   1. The HMAC of `<org_id>:<table>` truncates to the 8-hex prefix in the topic.
  --   2. The org_id whose HMAC matches IS IN the caller's claim list (via the loop).
  for v_org_id in
    select jsonb_array_elements_text(claims #> '{app_metadata,org_ids}')
  loop
    v_expected_hash := left(
      encode(extensions.hmac(v_org_id || ':' || v_table, v_secret, 'sha256'), 'hex'),
      8
    );
    if topic = 'org-' || v_expected_hash || '-' || v_table then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

-- No broad EXECUTE needed on the helper itself — it is called from the
-- realtime.messages RLS policy which runs as the Realtime internal role.
-- Revoke defaults to be explicit (belt-and-suspenders).
revoke execute on function public.realtime_topic_authorized(text, jsonb) from public;
revoke execute on function public.realtime_topic_authorized(text, jsonb) from anon;
-- `authenticated` is intentionally NOT revoked: the helper may also be
-- called from application SQL in tests. Restrict net-new callers via the
-- RLS policy's `to authenticated` clause rather than grant management here.

-- ── (B) get_realtime_channel_keying ────────────────────────────────────────

create or replace function public.get_realtime_channel_keying()
  returns text
  language sql
  stable
  security definer
  set search_path = pg_catalog, vault, public, extensions
as $$
  -- Returns the raw 64-char hex Vault secret so the browser can compute
  -- HMAC-SHA-256 via crypto.subtle natively.
  -- Per CONTEXT D-24: deriving a per-session token is deferred; rotation
  -- runbook handles compromise (rotate Vault secret → redeploy migration 100015).
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'org_realtime_channel_secret'
  limit 1;
$$;

-- Revoke public (never expose to unauthenticated callers).
revoke execute on function public.get_realtime_channel_keying() from public;
revoke execute on function public.get_realtime_channel_keying() from anon;

-- Grant to authenticated — browser clients call this once per session.
grant execute on function public.get_realtime_channel_keying() to authenticated;
grant execute on function public.get_realtime_channel_keying() to service_role;
