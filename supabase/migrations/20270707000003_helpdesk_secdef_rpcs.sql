-- Phase 37 Plan 01 Task 3 — Helpdesk SECDEF RPCs
-- Per [[reference_supabase_migration_gotchas]]: every SECDEF function sets search_path = public, extensions.
-- Per [[feedback_planner_iter1_anti_patterns]]: revoke execute from public, then grant to authenticated/service_role.
-- Per [[reference_supabase_pg_cron_vault_service_role_pattern]]: vault read via vault.decrypted_secrets view.
--
-- Functions:
--   1. generate_helpdesk_reply_token(ticket_id, user_id) returns text     — HMAC base64url; authenticated + service_role
--   2. verify_helpdesk_reply_token(token, ticket_id, user_id) returns boolean — constant-time; service_role only
--   3. close_ticket(ticket_id, resolution_note) returns void              — agent-only
--   4. reopen_ticket(ticket_id, reason) returns void                      — owner OR agent
--   5. apply_ai_suggestion(suggestion_id) returns void                    — agent-only
--   6. search_kb_articles(query, locale, org_id, limit) returns table     — stub; replaced in Plan 02

begin;

create extension if not exists pgcrypto with schema extensions;

-- ============================================================
-- 1. generate_helpdesk_reply_token
-- ============================================================
create or replace function public.generate_helpdesk_reply_token(
  p_ticket_id uuid,
  p_user_id uuid
) returns text
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_secret text;
  v_hmac_b64 text;
  v_token text;
begin
  if p_ticket_id is null or p_user_id is null then
    raise exception 'invalid_args' using errcode = '22023';
  end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'helpdesk_hmac_secret'
    limit 1;

  if v_secret is null then
    raise exception 'helpdesk_hmac_secret_missing' using errcode = '42704';
  end if;

  v_hmac_b64 := encode(
    extensions.hmac(p_ticket_id::text || ':' || p_user_id::text, v_secret, 'sha256'),
    'base64'
  );

  -- base64url: strip padding, '+' -> '-', '/' -> '_'
  v_token := replace(replace(replace(v_hmac_b64, '=', ''), '+', '-'), '/', '_');

  return v_token;
end;
$fn$;

revoke execute on function public.generate_helpdesk_reply_token(uuid, uuid) from public;
grant  execute on function public.generate_helpdesk_reply_token(uuid, uuid) to authenticated, service_role;

-- ============================================================
-- 2. verify_helpdesk_reply_token (constant-time)
-- ============================================================
create or replace function public.verify_helpdesk_reply_token(
  p_token text,
  p_ticket_id uuid,
  p_user_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_secret text;
  v_hmac_b64 text;
  v_expected text;
  v_diff int := 0;
  v_len int;
  i int;
begin
  if p_token is null or p_ticket_id is null or p_user_id is null then
    return false;
  end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'helpdesk_hmac_secret'
    limit 1;

  if v_secret is null then
    return false;
  end if;

  v_hmac_b64 := encode(
    extensions.hmac(p_ticket_id::text || ':' || p_user_id::text, v_secret, 'sha256'),
    'base64'
  );
  v_expected := replace(replace(replace(v_hmac_b64, '=', ''), '+', '-'), '/', '_');

  -- Constant-time: equal-length precondition + XOR all bytes (no early return)
  if octet_length(p_token) <> octet_length(v_expected) then
    -- Still iterate over expected to keep timing flat against same-length attacks.
    v_len := octet_length(v_expected);
    i := 1;
    while i <= v_len loop
      v_diff := v_diff | (ascii(substr(v_expected, i, 1)) # ascii(substr(v_expected, i, 1)));
      i := i + 1;
    end loop;
    return false;
  end if;

  v_len := octet_length(v_expected);
  i := 1;
  while i <= v_len loop
    v_diff := v_diff | (ascii(substr(p_token, i, 1)) # ascii(substr(v_expected, i, 1)));
    i := i + 1;
  end loop;

  return v_diff = 0;
end;
$fn$;

revoke execute on function public.verify_helpdesk_reply_token(text, uuid, uuid) from public;
grant  execute on function public.verify_helpdesk_reply_token(text, uuid, uuid) to service_role;

-- ============================================================
-- 3. close_ticket (agent-only)
-- ============================================================
create or replace function public.close_ticket(
  p_ticket_id uuid,
  p_resolution_note text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
begin
  if v_caller is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select org_id into v_org from public.tickets where id = p_ticket_id;
  if v_org is null then
    raise exception 'ticket_not_found' using errcode = '02000';
  end if;

  if not exists (
    select 1 from public.org_members
    where org_id = v_org and user_id = v_caller
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.tickets
     set status = 'closed',
         closed_at = now(),
         updated_at = now()
   where id = p_ticket_id;

  insert into public.ticket_messages (ticket_id, author_user_id, author_kind, body, via)
    values (p_ticket_id, v_caller, 'system', coalesce(p_resolution_note, 'Closed by agent'), 'admin');
end;
$fn$;

revoke execute on function public.close_ticket(uuid, text) from public;
grant  execute on function public.close_ticket(uuid, text) to authenticated;

-- ============================================================
-- 4. reopen_ticket (owner OR agent)
-- ============================================================
create or replace function public.reopen_ticket(
  p_ticket_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_owner uuid;
begin
  if v_caller is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select org_id, user_id into v_org, v_owner from public.tickets where id = p_ticket_id;
  if v_org is null then
    raise exception 'ticket_not_found' using errcode = '02000';
  end if;

  if v_caller <> v_owner and not exists (
    select 1 from public.org_members
    where org_id = v_org and user_id = v_caller
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.tickets
     set status = 'open',
         closed_at = null,
         updated_at = now()
   where id = p_ticket_id;

  insert into public.ticket_messages (ticket_id, author_user_id, author_kind, body, via)
    values (p_ticket_id, v_caller, 'system', coalesce(p_reason, 'Reopened'), 'admin');
end;
$fn$;

revoke execute on function public.reopen_ticket(uuid, text) from public;
grant  execute on function public.reopen_ticket(uuid, text) to authenticated;

-- ============================================================
-- 5. apply_ai_suggestion (agent-only)
-- ============================================================
create or replace function public.apply_ai_suggestion(
  p_suggestion_id uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_caller uuid := auth.uid();
  v_ticket_id uuid;
  v_org uuid;
  v_suggested_tags jsonb;
  v_route_user uuid;
  v_route_conf numeric(3,2);
  v_tag jsonb;
begin
  if v_caller is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select tas.ticket_id, t.org_id, tas.suggested_tags, tas.suggested_route_user_id, tas.suggested_route_confidence
    into v_ticket_id, v_org, v_suggested_tags, v_route_user, v_route_conf
    from public.ticket_ai_suggestions tas
    join public.tickets t on t.id = tas.ticket_id
    where tas.id = p_suggestion_id;

  if v_ticket_id is null then
    raise exception 'suggestion_not_found' using errcode = '02000';
  end if;

  if not exists (
    select 1 from public.org_members
    where org_id = v_org and user_id = v_caller
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- Insert tags with confidence >= 0.75
  if v_suggested_tags is not null then
    for v_tag in select * from jsonb_array_elements(v_suggested_tags) loop
      if (v_tag->>'confidence')::numeric >= 0.75
         and (v_tag->>'name') is not null then
        insert into public.ticket_tags (ticket_id, tag_name, confidence, applied_by)
          values (
            v_ticket_id,
            v_tag->>'name',
            (v_tag->>'confidence')::numeric,
            'ai'
          )
          on conflict (ticket_id, tag_name) do nothing;
      end if;
    end loop;
  end if;

  -- Route if confidence threshold met
  if v_route_user is not null and v_route_conf is not null and v_route_conf >= 0.75 then
    update public.tickets
       set assigned_to = v_route_user,
           updated_at = now()
     where id = v_ticket_id;
  end if;

  update public.ticket_ai_suggestions
     set applied_at = now()
   where id = p_suggestion_id;
end;
$fn$;

revoke execute on function public.apply_ai_suggestion(uuid) from public;
grant  execute on function public.apply_ai_suggestion(uuid) to authenticated;

-- ============================================================
-- 6. search_kb_articles (STUB — replaced in Plan 02 once FTS columns exist)
-- ============================================================
create or replace function public.search_kb_articles(
  p_query text,
  p_locale text default 'en',
  p_org_id uuid default null,
  p_limit int default 10
) returns table (
  id uuid,
  slug text,
  title text,
  locale text,
  rank real
)
language plpgsql
security definer
set search_path = public, extensions
as $fn$
begin
  -- Stub: returns no rows. Plan 02 replaces via create-or-replace with FTS body.
  -- Suppress unused-parameter warnings by referencing the args explicitly.
  perform p_query, p_locale, p_org_id, p_limit;
  return;
end;
$fn$;

revoke execute on function public.search_kb_articles(text, text, uuid, int) from public;
grant  execute on function public.search_kb_articles(text, text, uuid, int) to authenticated;

commit;
