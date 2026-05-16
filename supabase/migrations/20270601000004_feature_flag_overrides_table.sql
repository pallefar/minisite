-- Phase 22 plan 01 — D-08: per-user PostHog feature-flag override table + admin RPC writer.
-- Analog: supabase/migrations/20260601000010_pending_account_deletions.sql:41-58 (RLS-locked tampering-mitigation pattern)
-- Pitfalls applied: Pitfall 1 (plain index on expires_at — NOT partial-with-now() which is non-IMMUTABLE),
--                   Pitfall 3 (uses feature_flag_override_set value from File 02 in separate migration),
--                   Pitfall 4 (app.suppress_audit GUC set inside admin RPC).
--
-- Writer ownership per feedback_status_machine_transition_owner.md: ONLY this admin RPC writes.
-- Application reads via supabase-js with auth.uid()=user_id RLS scope. No authenticated INSERT/UPDATE/DELETE.

create table if not exists public.feature_flag_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  flag_key text not null,
  value boolean not null,
  set_by uuid references auth.users(id) on delete set null,
  set_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (user_id, flag_key)
);

-- Plain index on expires_at (Pitfall 1: partial-with-now() rejected as non-IMMUTABLE).
-- Cleanup cron in 20270601000016 deletes rows with expires_at < now() - interval '7 days'.
create index if not exists feature_flag_overrides_expires_idx
  on public.feature_flag_overrides (expires_at);

alter table public.feature_flag_overrides enable row level security;

-- T-22-04 mitigation: select-own only; cross-user reads impossible.
create policy "feature_flag_overrides_select_own"
  on public.feature_flag_overrides
  for select to authenticated
  using (auth.uid() = user_id);

-- TAMPERING MITIGATION: NO INSERT/UPDATE/DELETE policy for authenticated.
-- Only public.admin_set_feature_flag_override (SECURITY DEFINER, is_staff-gated) writes.
-- Direct authenticated writes return 42501 / "violates row-level security".

-- =============================================================================
-- admin_set_feature_flag_override — is_staff-gated UPSERT writer
-- =============================================================================
-- T-22-01 mitigation: is_staff() gate at top of function body.
-- T-22-03 mitigation: app.suppress_audit GUC prevents per-row trigger double-firing
--                     when the inline audit row is written.
create or replace function public.admin_set_feature_flag_override(
  p_user_id uuid,
  p_flag_key text,
  p_value boolean,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_caller_uid uuid := auth.uid();
begin
  if v_caller_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Suppress per-row audit trigger fires while we write the inline audit row.
  perform set_config('app.suppress_audit', 'true', true);

  insert into public.audit_logs (
    user_id,
    user_id_hash,
    table_name,
    row_id,
    action,
    target_user_id
  ) values (
    v_caller_uid,
    encode(digest(v_caller_uid::text, 'sha256'), 'hex'),
    'feature_flag_overrides',
    p_user_id::text || '/' || p_flag_key,
    'feature_flag_override_set',
    p_user_id
  );

  insert into public.feature_flag_overrides (user_id, flag_key, value, set_by, expires_at)
  values (p_user_id, p_flag_key, p_value, v_caller_uid, p_expires_at)
  on conflict (user_id, flag_key)
    do update set
      value = excluded.value,
      set_by = excluded.set_by,
      set_at = now(),
      expires_at = excluded.expires_at;
end;
$$;

revoke all on function public.admin_set_feature_flag_override(uuid, text, boolean, timestamptz) from public;
grant execute on function public.admin_set_feature_flag_override(uuid, text, boolean, timestamptz) to authenticated;
