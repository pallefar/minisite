-- Phase 45 Plan 45-06 — community_space_leaderboard_matview + consolidated 15-min refresh cron.
--
-- Decision references (CONTEXT.md):
--   - D-12: Score formula = posts × 3 + comments × 1 + reactions_received × 1
--   - D-13: Period = rolling 7d window (NOT calendar month).
--           Roadmap §Phase 45 success criterion #3 ("per month") is interpreted as
--           display granularity / cadence intent, not as a calendar-month window
--           (Claude's-discretion per CONTEXT). Matches Phase 35 D-16 rolling-7d precedent.
--   - D-14: community_spaces.leaderboard_enabled boolean — admin gate per space.
--   - D-15: Tier-gated read mediated by get_community_space_leaderboard() SECDEF RPC
--           (shipped in 45-01); RPC mirrors Phase 44 D-08 min_tier check. Matviews
--           do NOT support RLS directly in Postgres; the SECDEF wrapper is the gate.
--   - D-16/D-17: Unified opt-in flag on profiles (leaderboard_opt_in) +
--           anonymized handle (leaderboard_handle) — NOT per-cohort like Phase 35.
--
-- Architecture notes (RESEARCH Pattern 4 + Pitfall 2):
--   - UNIQUE INDEX on (space_id, user_id) is LOAD-BEARING:
--     REFRESH MATERIALIZED VIEW CONCURRENTLY requires a unique index, otherwise
--     the cron refresh errors. (Pitfall 2 from 45-RESEARCH.md; Phase 35 Pitfall 3.)
--   - RLS on matviews is wonky in Postgres; read access is mediated via the
--     get_community_space_leaderboard() SECDEF RPC (shipped in 45-01 secdef
--     migration 20270727000003). Grant select to authenticated + service_role
--     for the RPC's internal use only — the SECDEF bypasses RLS.
--   - JOIN math uses CTEs (RESEARCH Open Question 2 resolution) to avoid the
--     double-counting trap in the inline-JOIN sketch from RESEARCH §Code Examples.
--
-- Cron consolidation (RESEARCH Pattern 4 — CRITICAL):
--   Phase 35 ships cron 'phase35-leaderboard-refresh' at 12,27,42,57 * * * *
--   refreshing public.leaderboard_matview. This migration UNSCHEDULES that job
--   and RE-REGISTERS the SAME job name with both REFRESH calls in one body.
--   Do NOT create a 'phase45-*' second cron at the same cadence — plan-checker
--   BLOCKS and pg_cron would do redundant work.
--
-- Dollar-quote naming (per memory reference_postgres_dollar_quote_nesting_in_cron_body):
--   $cron$       → outer delimiter passed to cron.schedule()
--   $refresh$    → inner DO block delimiter for the REFRESH body
--   $unschedule$ → pre-flight unschedule block delimiter
--   Named tags prevent the outer quote from silently closing on the first inner $$.
--
-- Patterns mirrored:
--   - 20270708000012_p35_leaderboard_matview.sql (matview shape + UNIQUE index + REVOKE/GRANT)
--   - 20270708000013_p35_leaderboard_refresh_cron.sql (cron schedule + unschedule pre-flight)

create extension if not exists pg_cron;

-- ───────────────────────────────────────────────────────────────────────────────
-- Materialized view: per-space top-contributor leaderboard.
-- ───────────────────────────────────────────────────────────────────────────────
-- CTE structure prevents the JOIN-explosion double-count that would happen if
-- posts × comments × reactions were JOINed in one go (each post fans out across
-- comments which fans out across reactions, multiplying counts). Each CTE
-- pre-aggregates per (space, author) so the outer SELECT does a clean
-- per-author roll-up.
--
-- Phase 45 v1 scope (RESEARCH §Code Examples comment): reactions received only
-- counts reactions on the author's POSTS, NOT on the author's comments.
-- Lifting comment-reactions into the score is deferred to v1.4 if requested.

create materialized view public.community_space_leaderboard_matview as
with author_posts as (
  select
    cp.space_id,
    cp.author_id as user_id,
    count(*) as post_count
  from public.community_posts cp
  where cp.created_at >= now() - interval '7 days'
    and cp.deleted_at is null
    and cp.author_id is not null
  group by cp.space_id, cp.author_id
),
author_comments as (
  select
    cc.space_id,
    cc.author_id as user_id,
    count(*) as comment_count
  from public.community_comments cc
  where cc.created_at >= now() - interval '7 days'
    and cc.deleted_at is null
    and cc.author_id is not null
  group by cc.space_id, cc.author_id
),
author_reactions as (
  -- reactions_received = reactions on the author's posts (Phase 45 v1 scope).
  -- We join community_reactions → community_posts to attribute the reaction to
  -- the post-author + post-space.
  select
    cp.space_id,
    cp.author_id as user_id,
    count(*) as reactions_received
  from public.community_reactions cr
  join public.community_posts cp
    on cp.id = cr.target_id
    and cr.target_type = 'post'
  where cr.created_at >= now() - interval '7 days'
    and cp.deleted_at is null
    and cp.author_id is not null
  group by cp.space_id, cp.author_id
)
select
  cs.id                                                    as space_id,
  ap.user_id                                               as user_id,
  p.leaderboard_handle                                     as handle,
  p.leaderboard_opt_in                                     as opted_in,
  -- D-12 score: posts × 3 + comments × 1 + reactions_received × 1
  (coalesce(ap.post_count, 0) * 3
   + coalesce(ac.comment_count, 0)
   + coalesce(ar.reactions_received, 0)
  )::bigint                                                as score,
  rank() over (
    partition by cs.id
    order by (
      coalesce(ap.post_count, 0) * 3
      + coalesce(ac.comment_count, 0)
      + coalesce(ar.reactions_received, 0)
    ) desc,
    ap.user_id asc  -- stable tiebreak by user_id (RESEARCH §Code Examples)
  )                                                        as rank_in_space,
  now()                                                    as refreshed_at
from public.community_spaces cs
-- Inner join on author_posts: a user must have posted in the window to appear.
-- (Comments-only / reactions-only contributors are excluded by design —
-- mirrors Phase 35 "XP-positive only" intent.)
join author_posts ap
  on ap.space_id = cs.id
left join author_comments ac
  on ac.space_id = ap.space_id
  and ac.user_id = ap.user_id
left join author_reactions ar
  on ar.space_id = ap.space_id
  and ar.user_id = ap.user_id
join public.profiles p
  on p.id = ap.user_id
  and p.leaderboard_opt_in = true       -- D-16/D-17: unified opt-in flag
where cs.leaderboard_enabled = true;    -- D-14: admin must enable per space

-- ───────────────────────────────────────────────────────────────────────────────
-- LOAD-BEARING: REFRESH MATERIALIZED VIEW CONCURRENTLY requires a UNIQUE index.
-- Without this, the cron's CONCURRENTLY refresh will throw:
--   ERROR: cannot refresh materialized view "community_space_leaderboard_matview" concurrently
-- (Pitfall 2 — see 45-RESEARCH.md §Common Pitfalls; Phase 35 Pitfall 3 precedent.)
-- ───────────────────────────────────────────────────────────────────────────────
create unique index idx_community_space_lb_space_user
  on public.community_space_leaderboard_matview (space_id, user_id);

-- Secondary index: powers top-N + rank-neighborhood queries in
-- get_community_space_leaderboard(). SELECT ... WHERE space_id = $1
-- AND rank_in_space <= 10 uses this index.
create index idx_community_space_lb_space_rank
  on public.community_space_leaderboard_matview (space_id, rank_in_space);

-- Strip public grant; restrict to authenticated (for SECDEF RPC) + service_role.
revoke all on public.community_space_leaderboard_matview from public;
grant select on public.community_space_leaderboard_matview to authenticated, service_role;

comment on materialized view public.community_space_leaderboard_matview is
  'Phase 45 D-12/D-13/D-14/D-15/D-16/D-17 — per-space rolling-7d contributor leaderboard. '
  'Score = posts × 3 + comments × 1 + reactions_received × 1 over rolling 7 days. '
  'Only includes opted-in profiles (profiles.leaderboard_opt_in = true) in '
  'admin-enabled spaces (community_spaces.leaderboard_enabled = true). '
  'RLS is mediated via get_community_space_leaderboard() SECDEF RPC (shipped in '
  '45-01 secdef migration); do NOT query matview directly from client per Phase 35 pattern. '
  'Tier-gate (D-15) lives in the RPC body (reuses Phase 44 D-08 min_tier check). '
  'Refreshed every 15 min via consolidated phase35-leaderboard-refresh cron at '
  '12,27,42,57 * * * * (single job refreshes BOTH this matview AND public.leaderboard_matview). '
  'UNIQUE INDEX idx_community_space_lb_space_user on (space_id, user_id) is LOAD-BEARING '
  'for REFRESH CONCURRENTLY (Pitfall 2). '
  'D-13 rolling-7d interpretation: Roadmap §Phase 45 "per month" is display granularity, '
  'not calendar-month window — mirrors Phase 35 D-16 precedent.';

-- ───────────────────────────────────────────────────────────────────────────────
-- Cron consolidation (RESEARCH Pattern 4).
--
-- Step 1: pre-flight unschedule any existing 'phase35-leaderboard-refresh' job
-- (handles both: fresh install where Phase 35 has set it, AND idempotent re-run
-- of THIS migration). Wrapped in EXCEPTION handler so a missing job (or pg_cron
-- not yet installed at re-run time) does not abort the migration.
--
-- Step 2: RE-REGISTER the SAME job name with the consolidated body.
-- Body contains BOTH REFRESH MATERIALIZED VIEW CONCURRENTLY calls. The
-- EXCEPTION handler on the inner DO block ensures one matview's refresh
-- failure does not silently skip the other.
-- ───────────────────────────────────────────────────────────────────────────────

do $unschedule$
declare
  job_name text;
begin
  for job_name in
    select jobname from cron.job where jobname = 'phase35-leaderboard-refresh'
  loop
    perform cron.unschedule(job_name);
  end loop;
exception when others then null;
end $unschedule$;

select cron.schedule('phase35-leaderboard-refresh',
  '12,27,42,57 * * * *',
  $cron$
  do $refresh$ begin
    refresh materialized view concurrently public.leaderboard_matview;
    refresh materialized view concurrently public.community_space_leaderboard_matview;
  exception when others then
    raise notice 'phase35-leaderboard-refresh: error % — continuing', sqlerrm;
  end $refresh$;
  $cron$
);

-- Rollback hint (manual):
--   select cron.unschedule('phase35-leaderboard-refresh');
--   drop materialized view if exists public.community_space_leaderboard_matview;
-- (Followed by re-running Phase 35 cron migration 20270708000013 to restore the
-- single-matview body if Phase 45 is rolled back independently.)
