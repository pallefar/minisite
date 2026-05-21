-- Phase 37 Plan 37-02 Task 1 — search_kb_articles SECDEF RPC.
--
-- REPLACES the stub created by Plan 37-01 Task 3 (migration 20270707000003) with
-- the real locale-aware ranked search body. The signature is pinned in plan
-- 37-01's interface contract; this migration only swaps in the body via
-- CREATE OR REPLACE FUNCTION (no signature change → no consumer break).
--
-- Behavior:
--   - websearch_to_tsquery sanitizes user input (quoted phrases, AND/OR, etc.)
--   - ts_rank_cd (cover-density) ranks short queries better than ts_rank.
--   - Locale is validated against ('en','es'); default 'en'.
--   - Limit is defense-in-depth clamped to [1, 50].
--   - SECURITY DEFINER + explicit search_path satisfy the linter
--     (extensions is needed for any extension functions called transitively).
--   - Visibility rules:
--       * Global KB (org_id IS NULL) — visible to every authenticated caller.
--       * Org-private KB (caller passed p_org_id) — visible only when caller
--         is a member of the org (enforced via auth.uid() ∈ org_members).
--       * Cross-org agent search (p_org_id IS NULL but row.org_id IS NOT NULL)
--         — visible only for orgs the caller is a member of.
--   - Grants: revoked from public, granted to authenticated.

create or replace function public.search_kb_articles(
  p_query   text,
  p_locale  text default 'en',
  p_org_id  uuid default null,
  p_limit   int  default 10
)
returns table (
  id     uuid,
  slug   text,
  title  text,
  locale text,
  rank   real
)
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_query tsquery;
  v_dict  regconfig;
begin
  if p_locale not in ('en', 'es') then
    raise exception 'unsupported locale: %', p_locale using errcode = '22023';
  end if;

  v_dict := case when p_locale = 'es' then 'spanish'::regconfig else 'english'::regconfig end;
  v_query := websearch_to_tsquery(v_dict, coalesce(p_query, ''));

  return query
  select
    a.id,
    a.slug,
    case when p_locale = 'es' then coalesce(a.title_es, a.title) else a.title end as title,
    p_locale,
    case
      when p_locale = 'es' then ts_rank_cd(a.search_vector_es, v_query)
      else ts_rank_cd(a.search_vector_en, v_query)
    end as rank
  from public.kb_articles a
  where a.published_at is not null
    and (
      (p_org_id is null and a.org_id is null)                                            -- global KB
      or (p_org_id is not null and a.org_id = p_org_id                                    -- explicit org-private
          and exists (select 1 from public.org_members m
                       where m.org_id = a.org_id and m.user_id = auth.uid()))
      or (p_org_id is null and a.org_id is not null                                       -- agent cross-org search
          and exists (select 1 from public.org_members m
                       where m.org_id = a.org_id and m.user_id = auth.uid()))
    )
    and (
      case when p_locale = 'es' then a.search_vector_es else a.search_vector_en end @@ v_query
    )
  order by rank desc
  limit greatest(1, least(p_limit, 50));
end
$fn$;

revoke execute on function public.search_kb_articles(text, text, uuid, int) from public;
grant  execute on function public.search_kb_articles(text, text, uuid, int) to authenticated;
