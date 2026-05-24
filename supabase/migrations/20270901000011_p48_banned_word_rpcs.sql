-- Phase 48 Plan 48-05 Task 2 — SECDEF RPCs for banned_words admin writes.
--
-- Functions:
--   banned_word_upsert(p_word, p_severity) -> uuid
--     INSERT or UPDATE (idempotent via functional UNIQUE on lower(word)).
--     Audit log: action_type='banned_word_upsert', target_type='banned_word'.
--   banned_word_remove(p_id) -> void
--     Standalone DELETE (per reference_postgres_no_insert_on_conflict_do_delete:
--     toggle/delete via SECDEF RPC, not an ON CONFLICT clause-hack).
--     Audit log: action_type='banned_word_remove', target_type='banned_word'.
--
-- Both gate at entry on public.is_staff(); raise 42501 'forbidden' otherwise.
-- Upsert also validates p_severity is one of the closed set; raises 22023
-- 'invalid_severity' (table CHECK also enforces it, but the RPC short-circuits
-- before the audit log call).
--
-- GRANT EXECUTE to `authenticated` only — NOT service_role (per
-- feedback_rpc_auth_uid_vs_service_role_mismatch: this is an admin-context RPC
-- relying on auth.uid(); service-role callers would have a NULL actor and
-- bypass is_staff() entirely).

begin;

create or replace function public.banned_word_upsert(p_word text, p_severity text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_id uuid;
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_severity not in ('warn','flag','escalate') then
    raise exception 'invalid_severity' using errcode = '22023';
  end if;

  insert into public.banned_words (word, severity, created_by)
  values (lower(p_word), p_severity, auth.uid())
  on conflict (lower(word)) do update
    set severity   = excluded.severity,
        updated_at = now()
  returning id into v_id;

  perform public.log_moderation_action(
    p_action_type => 'banned_word_upsert',
    p_target_type => 'banned_word',
    p_target_id   => v_id,
    p_after       => jsonb_build_object('word', lower(p_word), 'severity', p_severity),
    p_reason      => null
  );

  return v_id;
end;
$fn$;

revoke all on function public.banned_word_upsert(text, text) from public;
grant execute on function public.banned_word_upsert(text, text) to authenticated;

create or replace function public.banned_word_remove(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_before jsonb;
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select to_jsonb(bw.*) into v_before
  from public.banned_words bw
  where bw.id = p_id;

  delete from public.banned_words where id = p_id;

  perform public.log_moderation_action(
    p_action_type => 'banned_word_remove',
    p_target_type => 'banned_word',
    p_target_id   => p_id,
    p_before      => v_before,
    p_after       => null,
    p_reason      => null
  );
end;
$fn$;

revoke all on function public.banned_word_remove(uuid) from public;
grant execute on function public.banned_word_remove(uuid) to authenticated;

commit;
