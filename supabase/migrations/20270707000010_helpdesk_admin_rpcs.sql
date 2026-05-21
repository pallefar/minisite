-- Phase 37 Plan 08 Task 1 — Helpdesk admin SECDEF RPCs + tag-volume view (HELP-07/08/12/13).
--
-- 3 SECDEF RPCs + 1 view:
--   1. publish_kb_article   — atomic version snapshot + live UPDATE
--   2. clear_sentiment_alert — acknowledge sentiment_alert_fired_at
--   3. reorder_routing_rule  — admin priority swap
--   4. helpdesk_tag_volume_view — per-day per-tag ticket counts (last 30 days)
--
-- Per [[reference_supabase_migration_gotchas]]: SECDEF functions set
-- search_path = public, extensions. revoke execute from public then grant
-- to authenticated. Underlying tables RLS still enforces org isolation on
-- the view (helpdesk_tag_volume_view inherits tickets RLS).

begin;

-- ============================================================
-- 1. publish_kb_article (SECDEF) — atomic version snapshot + live update
-- ============================================================
create or replace function public.publish_kb_article(
  p_article_id uuid,
  p_title text,
  p_body text,
  p_title_es text default null,
  p_body_es text default null,
  p_locale_set text[] default array['en']
) returns int
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_user uuid := auth.uid();
  v_next_version int;
  v_org uuid;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select org_id, coalesce(published_version, 0) + 1
    into v_org, v_next_version
    from public.kb_articles
    where id = p_article_id;

  if v_next_version is null then
    raise exception 'article_not_found' using errcode = '23503';
  end if;

  -- Role gate. v_org may be NULL (global article); only superuser-ish roles
  -- should publish global articles — gate identically by requiring some org
  -- membership with the right role.
  if not exists (
    select 1 from public.org_members
    where (v_org is null or org_id = v_org)
      and user_id = v_user
      and role in ('owner','support_admin','support_lead')
  ) then
    raise exception 'insufficient_role' using errcode = '42501';
  end if;

  -- Insert version snapshot BEFORE updating live row so that on transaction
  -- success both writes are atomic; on failure neither lands.
  insert into public.kb_article_versions
    (article_id, version, title, body, title_es, body_es, published_by)
    values (p_article_id, v_next_version, p_title, p_body, p_title_es, p_body_es, v_user);

  update public.kb_articles set
    title = p_title,
    body = p_body,
    title_es = p_title_es,
    body_es = p_body_es,
    locale_set = p_locale_set,
    published_version = v_next_version,
    published_at = now(),
    updated_at = now()
  where id = p_article_id;

  return v_next_version;
end
$fn$;

revoke execute on function public.publish_kb_article(uuid, text, text, text, text, text[]) from public;
grant  execute on function public.publish_kb_article(uuid, text, text, text, text, text[]) to authenticated;

-- ============================================================
-- 2. clear_sentiment_alert (SECDEF) — agent ack of sentiment alert
-- ============================================================
create or replace function public.clear_sentiment_alert(p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  update public.tickets t
    set sentiment_alert_fired_at = null,
        updated_at = now()
    where t.id = p_ticket_id
      and exists (
        select 1 from public.org_members m
        where m.org_id = t.org_id
          and m.user_id = v_user
      );
end
$fn$;

revoke execute on function public.clear_sentiment_alert(uuid) from public;
grant  execute on function public.clear_sentiment_alert(uuid) to authenticated;

-- ============================================================
-- 3. reorder_routing_rule (SECDEF) — admin priority swap
-- ============================================================
create or replace function public.reorder_routing_rule(
  p_rule_id uuid,
  p_new_priority int
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_user uuid := auth.uid();
  v_org  uuid;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if p_new_priority is null or p_new_priority < 0 or p_new_priority > 9999 then
    raise exception 'invalid_priority' using errcode = '22023';
  end if;

  select org_id into v_org
    from public.helpdesk_routing_rules
    where id = p_rule_id;

  if v_org is null then
    raise exception 'rule_not_found' using errcode = '23503';
  end if;

  if not exists (
    select 1 from public.org_members
    where org_id = v_org
      and user_id = v_user
      and role in ('owner','support_admin','support_lead')
  ) then
    raise exception 'insufficient_role' using errcode = '42501';
  end if;

  update public.helpdesk_routing_rules
    set priority = p_new_priority,
        updated_at = now()
    where id = p_rule_id;
end
$fn$;

revoke execute on function public.reorder_routing_rule(uuid, int) from public;
grant  execute on function public.reorder_routing_rule(uuid, int) to authenticated;

-- ============================================================
-- 4. helpdesk_tag_volume_view — per-day, per-tag ticket volume (30d)
-- ============================================================
-- Underlying tables (tickets, ticket_tags) have RLS — view inherits since
-- it's a plain SELECT view, not security_invoker=false. Postgres defaults
-- to security_invoker=true semantics on views for RLS in recent versions;
-- explicitly set it for clarity (PG15+ supports the option).
create or replace view public.helpdesk_tag_volume_view
  with (security_invoker = true) as
select
  t.org_id,
  tt.tag_name,
  date_trunc('day', t.created_at)::date as bucket_day,
  count(distinct t.id)::int as ticket_count
from public.tickets t
join public.ticket_tags tt on tt.ticket_id = t.id
where t.created_at >= now() - interval '30 days'
group by t.org_id, tt.tag_name, date_trunc('day', t.created_at);

grant select on public.helpdesk_tag_volume_view to authenticated;

comment on view public.helpdesk_tag_volume_view is
  'Per-org per-tag-per-day ticket counts for the last 30 days. Inherits RLS '
  'from tickets + ticket_tags via security_invoker=true. Phase 37 Plan 08 (HELP-13).';

commit;
