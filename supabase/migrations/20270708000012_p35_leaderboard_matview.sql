-- Phase 35 Plan 35-04 — leaderboard_matview: rolling-7d XP rank per (cohort, user).
--
-- Decision references:
--   - D-14: Display = top-10 always + user's ±5 neighborhood. Refresh via 15-min pg_cron.
--   - D-15: Opt-out within one refresh cycle (active=false excluded from this matview).
--   - D-16: Leaderboard score = rolling 7d XP (NOT total XP). Recency-weighted prevents
--     long-time users from sitting at the top forever.
--
-- Architecture notes:
--   - JOIN target: public.cohort_membership (a regular TABLE rebuilt on schedule
--     by cohort_membership_rebuild() at 7,22,37,52). Per Research A4, this is
--     NOT a true matview — it is a plain table with TRUNCATE+rebuild semantics.
--     Using the table directly is correct; never substitute the cohort_profile_view.
--   - UNIQUE INDEX on (cohort_id, user_id) is LOAD-BEARING: REFRESH MATERIALIZED
--     VIEW CONCURRENTLY requires a unique index, otherwise the refresh errors.
--     (Pitfall 3 from 35-RESEARCH.md; same pattern as idx_click_baseline_affiliate
--     in 20270101000007_affiliate_click_baseline_mv.sql)
--   - RLS on matviews is wonky in Postgres; read access is mediated via the
--     get_leaderboard_for_user SECDEF RPC (20270708000014). Grant select to
--     authenticated + service_role for the RPC's internal use only — in practice
--     the SECDEF bypasses RLS.
--
-- Staleness contract (D-15):
--   Refresh cron at 12,27,42,57 * * * * (5 min AFTER cohort_membership_rebuild
--   at 7,22,37,52). Worst-case 15-min stale display window.
--   Opt-out (active=false) drops the user on the next refresh.

create materialized view public.leaderboard_matview as
select
  cm.cohort_id,
  lo.user_id,
  lo.handle,
  coalesce(sum(x.xp_delta), 0)::bigint as xp_7d,
  rank() over (
    partition by cm.cohort_id
    order by coalesce(sum(x.xp_delta), 0) desc, lo.opted_in_at asc  -- tiebreak: earlier opt-in ranks higher
  ) as rank_in_cohort,
  now() as refreshed_at
from public.cohort_membership cm
join public.leaderboard_optin lo
  on lo.user_id = cm.user_id
  and lo.cohort_id = cm.cohort_id
  and lo.active = true
join public.cohort_definitions cd
  on cd.id = cm.cohort_id
  and cd.leaderboard_enabled = true
left join public.xp_ledger x
  on x.user_id = lo.user_id
  and x.created_at >= now() - interval '7 days'
group by cm.cohort_id, lo.user_id, lo.handle, lo.opted_in_at;

-- LOAD-BEARING: REFRESH MATERIALIZED VIEW CONCURRENTLY requires a UNIQUE index.
-- Without this, the cron's CONCURRENTLY refresh will throw:
--   ERROR: cannot refresh materialized view "leaderboard_matview" concurrently
-- (Pitfall 3 — see 35-RESEARCH.md §Common Pitfalls).
create unique index idx_leaderboard_matview_cohort_user
  on public.leaderboard_matview (cohort_id, user_id);

-- Secondary index: powers top-N + rank-neighborhood queries in get_leaderboard_for_user.
-- SELECT ... WHERE cohort_id = $1 AND rank_in_cohort <= 10 uses this index.
create index idx_leaderboard_matview_cohort_rank
  on public.leaderboard_matview (cohort_id, rank_in_cohort);

-- Strip public grant; restrict to authenticated (for SECDEF RPC) + service_role.
revoke all on public.leaderboard_matview from public;
grant select on public.leaderboard_matview to authenticated, service_role;

comment on materialized view public.leaderboard_matview is
  'Phase 35 D-14/D-15/D-16 — rolling 7d XP rank per (cohort, user) for opted-in users '
  'in admin-enabled cohorts. '
  'JOIN source: public.cohort_membership (regular TABLE rebuilt at 7,22,37,52; NOT a true matview). '
  'Refreshed every 15 min via phase35-leaderboard-refresh cron at 12,27,42,57 * * * * '
  '(offset 5 min after cohort_membership_rebuild to ensure cohort data is fresh). '
  'D-15 staleness contract: opt-out (active=false) drops the user within one refresh cycle '
  '(worst-case 15-min stale display). '
  'Read access mediated by get_leaderboard_for_user SECDEF RPC; do NOT query matview directly from client. '
  'UNIQUE INDEX idx_leaderboard_matview_cohort_user on (cohort_id, user_id) is LOAD-BEARING '
  'for REFRESH CONCURRENTLY (Pitfall 3).';
