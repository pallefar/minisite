-- Phase 7 D-04 hotfix — pgcrypto lives in the `extensions` schema on Supabase.
--
-- Migration 20260601000002 declared `set search_path = public, pg_catalog` on
-- public.audit_trigger(). At execution time this fails with 42883
-- "function digest(text, unknown) does not exist" because Supabase installs
-- pgcrypto into the `extensions` schema (mirroring the pattern from
-- 20260513000000_injections.sql which writes `create extension if not exists
-- moddatetime schema extensions`).
--
-- The fix is one line: add `extensions` to the function's search_path. Hash
-- semantics are unchanged; this is a search-path resolution fix only.
--
-- STRIDE T-07-08-02 (search_path hijack) is STILL mitigated — `extensions` is
-- a Supabase-managed schema; authenticated callers cannot CREATE objects in
-- it by default Supabase grants. The hardening invariant ("don't resolve from
-- attacker-controllable schemas") still holds.

create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_before text;
  v_after text;
  v_row_id text;
  v_user_id uuid;
begin
  v_user_id := coalesce(new.user_id, old.user_id);

  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    v_before := encode(digest(row_to_json(old)::text, 'sha256'), 'hex');
  end if;
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    v_after := encode(digest(row_to_json(new)::text, 'sha256'), 'hex');
  end if;

  v_row_id := coalesce(
    (case when tg_op = 'DELETE' then old else new end)::text,
    ''
  );

  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, before_hash, after_hash)
  values (
    v_user_id,
    encode(digest(v_user_id::text, 'sha256'), 'hex'),
    tg_table_name,
    v_row_id,
    lower(tg_op),
    v_before,
    v_after
  );

  return coalesce(new, old);
end;
$$;
