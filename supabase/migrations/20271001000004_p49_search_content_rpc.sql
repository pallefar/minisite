-- Phase 49 Plan 02: search_content cross-table RPC
--
-- D-04: SECURITY INVOKER contract — caller's RLS predicates apply per-row across
--   community_posts, course_lessons, events. No cross-tenant leakage; clinic-org
--   isolation, tier-gating, mute-RLS from Phase 48 D-14 ALL inherited transparently.
-- D-08: Return shape (type, id, title, snippet, rank, space_id, course_id,
--   module_id, start_at) — 9 columns; nullable columns vary per content type.
-- D-21: CTE-per-type LIMIT 5 BEFORE ts_headline. ts_headline does not use GIN
--   indexes; ranking + LIMIT must run first to bound ts_headline call count to
--   at most 15 (5 per type × 3 types).
--
-- Threat mitigations:
--   T-49-03 (I): SECURITY INVOKER + per-table RLS apply; no bypass possible.
--   T-49-04 (T): the tsquery construction sink is parameterized; bad syntax
--                yields empty result, not crash.
--   T-49-05 (D): per-CTE LIMIT 5 bounds ts_headline invocations.

begin;

create or replace function public.search_content(
  p_query text,
  p_lang  text default 'english'
)
returns table (
  type      text,
  id        uuid,
  title     text,
  snippet   text,
  rank      real,
  space_id  uuid,
  course_id uuid,
  module_id uuid,
  start_at  timestamptz
)
language sql
security invoker
set search_path = public
as $fn$
  with q as (
    select case when p_lang = 'spanish' then 'spanish'::regconfig else 'english'::regconfig end as cfg
  ),
  posts as (
    select p.id, p.space_id, p.body,
           case when p_lang = 'spanish'
                then ts_rank_cd(p.search_es, websearch_to_tsquery('spanish'::regconfig, coalesce(p_query, '')))
                else ts_rank_cd(p.search_en, websearch_to_tsquery('english'::regconfig, coalesce(p_query, '')))
           end as rank
    from public.community_posts p
    where p.deleted_at is null
      and (case when p_lang = 'spanish' then p.search_es else p.search_en end)
          @@ websearch_to_tsquery(
               case when p_lang = 'spanish' then 'spanish'::regconfig else 'english'::regconfig end,
               coalesce(p_query, '')
             )
    order by rank desc
    limit 5
  ),
  lessons as (
    select l.id, l.module_id, l.course_id, l.title, l.content_md,
           case when p_lang = 'spanish'
                then ts_rank_cd(l.search_es, websearch_to_tsquery('spanish'::regconfig, coalesce(p_query, '')))
                else ts_rank_cd(l.search_en, websearch_to_tsquery('english'::regconfig, coalesce(p_query, '')))
           end as rank
    from public.course_lessons l
    where (case when p_lang = 'spanish' then l.search_es else l.search_en end)
          @@ websearch_to_tsquery(
               case when p_lang = 'spanish' then 'spanish'::regconfig else 'english'::regconfig end,
               coalesce(p_query, '')
             )
    order by rank desc
    limit 5
  ),
  upcoming_events as (
    select e.id, e.title, e.description, e.start_at,
           case when p_lang = 'spanish'
                then ts_rank_cd(e.search_es, websearch_to_tsquery('spanish'::regconfig, coalesce(p_query, '')))
                else ts_rank_cd(e.search_en, websearch_to_tsquery('english'::regconfig, coalesce(p_query, '')))
           end as rank
    from public.events e
    where (case when p_lang = 'spanish' then e.search_es else e.search_en end)
          @@ websearch_to_tsquery(
               case when p_lang = 'spanish' then 'spanish'::regconfig else 'english'::regconfig end,
               coalesce(p_query, '')
             )
    order by rank desc
    limit 5
  )
  select 'post'::text as type, p.id, left(p.body, 60) as title,
         ts_headline(
           (select cfg from q),
           p.body,
           websearch_to_tsquery(
             case when p_lang = 'spanish' then 'spanish'::regconfig else 'english'::regconfig end,
             coalesce(p_query, '')
           ),
           'StartSel=<b>, StopSel=</b>, MaxWords=20, MinWords=5, ShortWord=3, HighlightAll=false'
         ) as snippet,
         p.rank, p.space_id, null::uuid as course_id, null::uuid as module_id, null::timestamptz as start_at
  from posts p
  union all
  select 'lesson'::text, l.id, l.title,
         ts_headline(
           (select cfg from q),
           l.content_md,
           websearch_to_tsquery(
             case when p_lang = 'spanish' then 'spanish'::regconfig else 'english'::regconfig end,
             coalesce(p_query, '')
           ),
           'StartSel=<b>, StopSel=</b>, MaxWords=20, MinWords=5, ShortWord=3, HighlightAll=false'
         ),
         l.rank, null::uuid, l.course_id, l.module_id, null::timestamptz
  from lessons l
  union all
  select 'event'::text, e.id, e.title,
         ts_headline(
           (select cfg from q),
           e.description,
           websearch_to_tsquery(
             case when p_lang = 'spanish' then 'spanish'::regconfig else 'english'::regconfig end,
             coalesce(p_query, '')
           ),
           'StartSel=<b>, StopSel=</b>, MaxWords=20, MinWords=5, ShortWord=3, HighlightAll=false'
         ),
         e.rank, null::uuid, null::uuid, null::uuid, e.start_at
  from upcoming_events e
  order by type, rank desc;
$fn$;

revoke execute on function public.search_content(text, text) from public;
grant  execute on function public.search_content(text, text) to authenticated;

commit;
