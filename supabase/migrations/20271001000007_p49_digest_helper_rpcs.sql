-- Phase 49 Plan 03 — Digest helper SECURITY DEFINER RPCs.
--
-- Implements:
--   DIGEST-02: 3 daily-digest content RPCs (top_posts_in_spaces, new_comments_on_my_posts, recent_mentions)
--   DIGEST-03: 3 weekly-digest content RPCs (course_progress_delta_7d, upcoming_events_7d_rsvpd, community_top3_7d)
--   D-10 / D-11: daily + weekly content bucket definitions.
--   D-18: mention 24h window JOINs parent (community_posts / community_comments) created_at,
--         because mention join tables (community_post_mentions / community_comment_mentions)
--         have NO timestamp column. Live-DB confirmed.
--
-- Per reference_supabase_migration_gotchas:
--   SECURITY DEFINER + SET search_path = public, extensions on every function.
--
-- Caller context (per feedback_rpc_auth_uid_vs_service_role_mismatch):
--   These RPCs are called from service-role Edge Functions (49-06 community-daily-digest,
--   49-07 community-weekly-digest) on a fire-and-forget cron schedule. Because the caller
--   is service-role, the per-user identity MUST be passed explicitly as p_user_id.
--   No function body in this migration references the session user predicate; rationale
--   intentionally omits the predicate name to avoid grep false-positives
--   (per feedback_negation_grep_defeated_by_comment_string).
--
-- Grants:
--   revoke execute from public + grant execute to service_role on all 6 functions.
--   Not granted to authenticated — these RPCs bypass per-user RLS and trust the caller.
--
-- Pattern: SECDEF function structure forked from 20270720000005_p44_community_secdef_rpcs.sql.

begin;

-- ============================================================================
-- RPC 1: digest_top_posts_in_spaces
-- D-10 daily bucket: top N posts in spaces the user is a member of, last N hours.
-- Score = reactions_count + comments_count (simple engagement signal).
-- ============================================================================
create or replace function public.digest_top_posts_in_spaces(
  p_user_id uuid,
  p_since_hours int default 24,
  p_limit int default 5
)
returns table (post_id uuid, space_id uuid, space_name text, body text, score int)
language sql
security definer
set search_path = public, extensions
stable
as $fn$
  select p.id, p.space_id, s.name, p.body,
         coalesce(p.reactions_count, 0) + coalesce(p.comments_count, 0) as score
    from public.community_posts p
    join public.community_spaces s on s.id = p.space_id
    join public.community_space_members m on m.space_id = s.id
   where m.user_id = p_user_id
     and p.created_at >= now() - make_interval(hours => p_since_hours)
     and p.deleted_at is null
   order by score desc, p.created_at desc
   limit p_limit;
$fn$;

-- ============================================================================
-- RPC 2: digest_new_comments_on_my_posts
-- D-10 daily bucket: new comments on the user's own posts in the last N hours,
-- excluding the user's own comments on their own posts.
-- ============================================================================
create or replace function public.digest_new_comments_on_my_posts(
  p_user_id uuid,
  p_since_hours int default 24,
  p_limit int default 10
)
returns table (comment_id uuid, post_id uuid, body text, author_id uuid, created_at timestamptz)
language sql
security definer
set search_path = public, extensions
stable
as $fn$
  select c.id, c.post_id, c.body, c.author_id, c.created_at
    from public.community_comments c
    join public.community_posts p on p.id = c.post_id
   where p.author_id = p_user_id
     and c.author_id <> p_user_id
     and c.created_at >= now() - make_interval(hours => p_since_hours)
   order by c.created_at desc
   limit p_limit;
$fn$;

-- ============================================================================
-- RPC 3: digest_recent_mentions
-- D-10 daily bucket + D-18 correction: mention join tables have NO created_at,
-- so the 24h window comes from parent.created_at via JOIN.
-- Returns mentions of the user across posts + comments (union all).
-- ============================================================================
create or replace function public.digest_recent_mentions(
  p_user_id uuid,
  p_since_hours int default 24,
  p_limit int default 10
)
returns table (post_id uuid, post_body text, mentioner_id uuid, mention_kind text)
language sql
security definer
set search_path = public, extensions
stable
as $fn$
  (select p.id, p.body, p.author_id, 'post'::text
     from public.community_post_mentions m
     join public.community_posts p on p.id = m.post_id
    where m.user_id = p_user_id
      and p.created_at >= now() - make_interval(hours => p_since_hours)
      and p.deleted_at is null
    order by p.created_at desc
    limit p_limit)
  union all
  (select c.post_id, c.body, c.author_id, 'comment'::text
     from public.community_comment_mentions m
     join public.community_comments c on c.id = m.comment_id
    where m.user_id = p_user_id
      and c.created_at >= now() - make_interval(hours => p_since_hours)
    order by c.created_at desc
    limit p_limit);
$fn$;

-- ============================================================================
-- RPC 4: digest_course_progress_delta_7d
-- D-11 weekly bucket: per enrolled course where user completed >=1 lesson this
-- week, report (this_week_completed, total_lessons, overall_percent).
-- ============================================================================
create or replace function public.digest_course_progress_delta_7d(
  p_user_id uuid
)
returns table (course_id uuid, course_title text, completed_this_week int, total_lessons int, percent_complete int)
language sql
security definer
set search_path = public, extensions
stable
as $fn$
  with this_week as (
    select cl.course_id, count(*)::int as cnt
      from public.course_lessons cl
      join public.course_lesson_completions clc on clc.lesson_id = cl.id
     where clc.user_id = p_user_id
       and clc.completed_at >= now() - interval '7 days'
     group by cl.course_id
  ),
  totals as (
    select cl.course_id, count(*)::int as total
      from public.course_lessons cl
     group by cl.course_id
  ),
  all_completed as (
    select cl.course_id, count(*)::int as cnt
      from public.course_lessons cl
      join public.course_lesson_completions clc on clc.lesson_id = cl.id
     where clc.user_id = p_user_id
     group by cl.course_id
  )
  select c.id, c.title,
         coalesce(tw.cnt, 0),
         coalesce(t.total, 0),
         case when coalesce(t.total, 0) = 0 then 0
              else (coalesce(ac.cnt, 0) * 100 / t.total) end
    from public.courses c
    join public.course_enrollments ce on ce.course_id = c.id
    left join this_week tw on tw.course_id = c.id
    left join totals t on t.course_id = c.id
    left join all_completed ac on ac.course_id = c.id
   where ce.user_id = p_user_id
     and coalesce(tw.cnt, 0) > 0;
$fn$;

-- ============================================================================
-- RPC 5: digest_upcoming_events_7d_rsvpd
-- D-11 weekly bucket: events the user has RSVP'd "going" to that start within
-- the next 7 days.
-- ============================================================================
create or replace function public.digest_upcoming_events_7d_rsvpd(
  p_user_id uuid
)
returns table (event_id uuid, title text, start_at timestamptz)
language sql
security definer
set search_path = public, extensions
stable
as $fn$
  select e.id, e.title, e.start_at
    from public.events e
    join public.event_rsvps r on r.event_id = e.id
   where r.user_id = p_user_id
     and r.status = 'going'
     and e.start_at >= now()
     and e.start_at < now() + interval '7 days'
   order by e.start_at asc;
$fn$;

-- ============================================================================
-- RPC 6: digest_community_top3_7d
-- D-11 weekly bucket: top-3 posts of the rolling 7-day window in the user's
-- spaces, using the Phase 45 leaderboard score formula:
--   score = posts*3 + (reactions + comments)*1
-- Since this returns one row per post, the "posts*3" base contribution is 3.
-- ============================================================================
create or replace function public.digest_community_top3_7d(
  p_user_id uuid
)
returns table (post_id uuid, space_id uuid, space_name text, body text, score int, author_id uuid)
language sql
security definer
set search_path = public, extensions
stable
as $fn$
  select p.id, p.space_id, s.name, p.body,
         (3 + coalesce(p.reactions_count, 0) + coalesce(p.comments_count, 0)) as score,
         p.author_id
    from public.community_posts p
    join public.community_spaces s on s.id = p.space_id
    join public.community_space_members m on m.space_id = s.id
   where m.user_id = p_user_id
     and p.created_at >= now() - interval '7 days'
     and p.deleted_at is null
   order by score desc, p.created_at desc
   limit 3;
$fn$;

-- ============================================================================
-- Grants: service_role only.
-- ============================================================================
revoke execute on function public.digest_top_posts_in_spaces(uuid, int, int) from public;
grant  execute on function public.digest_top_posts_in_spaces(uuid, int, int) to service_role;

revoke execute on function public.digest_new_comments_on_my_posts(uuid, int, int) from public;
grant  execute on function public.digest_new_comments_on_my_posts(uuid, int, int) to service_role;

revoke execute on function public.digest_recent_mentions(uuid, int, int) from public;
grant  execute on function public.digest_recent_mentions(uuid, int, int) to service_role;

revoke execute on function public.digest_course_progress_delta_7d(uuid) from public;
grant  execute on function public.digest_course_progress_delta_7d(uuid) to service_role;

revoke execute on function public.digest_upcoming_events_7d_rsvpd(uuid) from public;
grant  execute on function public.digest_upcoming_events_7d_rsvpd(uuid) to service_role;

revoke execute on function public.digest_community_top3_7d(uuid) from public;
grant  execute on function public.digest_community_top3_7d(uuid) to service_role;

commit;
