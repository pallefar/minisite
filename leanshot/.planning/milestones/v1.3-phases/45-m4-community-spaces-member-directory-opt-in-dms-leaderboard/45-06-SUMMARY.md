---
phase: 45
plan: 06
subsystem: community-leaderboard
tags: [supabase, postgres, materialized-view, pg-cron, community, leaderboard]
requires: [45-01]
provides:
  - public.community_space_leaderboard_matview
  - idx_community_space_lb_space_user (UNIQUE)
  - idx_community_space_lb_space_rank
  - cron job 'phase35-leaderboard-refresh' re-registered with consolidated body
affects:
  - public.leaderboard_matview (still refreshed by SAME cron — body extended)
  - cron job 'phase35-leaderboard-refresh' (UNSCHEDULED then RE-REGISTERED)
tech-stack:
  added: []
  patterns:
    - "CTE-based pre-aggregation to avoid JOIN-explosion double-count in matview"
    - "Consolidated pg_cron body with multiple REFRESH MATERIALIZED VIEW CONCURRENTLY calls"
    - "Named dollar-quote tags ($unschedule$, $cron$, $refresh$) per memory reference_postgres_dollar_quote_nesting_in_cron_body"
    - "REVOKE public + GRANT SELECT to authenticated, service_role (mediated by SECDEF RPC)"
key-files:
  created:
    - supabase/migrations/20270727000007_p45_leaderboard_matview.sql
  modified: []
decisions:
  - "Reused Phase 35 cron job name 'phase35-leaderboard-refresh' (NOT a new 'phase45-*' job) per RESEARCH Pattern 4 + plan-checker constraint."
  - "Score formula CTEs (author_posts, author_comments, author_reactions) chosen over inline JOINs — RESEARCH Open Question 2 trap."
  - "Phase 45 v1 reactions_received counts ONLY post reactions, NOT comment reactions — deferred to v1.4."
  - "RLS on matview emulated via get_community_space_leaderboard() SECDEF RPC (shipped 45-01), per Phase 35 precedent — Postgres matviews do not support RLS directly."
  - "D-13 rolling-7d interpretation of Roadmap §Phase 45 'per month' documented in top-of-file comment + matview COMMENT clause."
metrics:
  duration_minutes: 8
  completed_date: 2026-05-24
---

# Phase 45 Plan 06: Community Leaderboard Materialized View + Consolidated 15-min Refresh Cron Summary

One-liner: Ships `public.community_space_leaderboard_matview` (CTE-based, rolling-7d, posts×3 + comments×1 + reactions×1 score, per-space rank) plus consolidates the 15-min refresh cron with Phase 35's existing job — UNSCHEDULE + RE-REGISTER `phase35-leaderboard-refresh` with both REFRESH calls in one body.

## What Shipped

**One migration:** `supabase/migrations/20270727000007_p45_leaderboard_matview.sql` (212 lines).

### Matview columns

```
public.community_space_leaderboard_matview (
  space_id        uuid,
  user_id         uuid,
  handle          text,       -- profiles.leaderboard_handle (D-16 anonymized)
  opted_in        boolean,    -- always true (matview filter)
  score           bigint,     -- posts × 3 + comments × 1 + reactions_received × 1
  rank_in_space   integer,    -- RANK() OVER (PARTITION BY space_id ORDER BY score DESC, user_id ASC)
  refreshed_at    timestamptz
)
```

### Indexes

| Index                              | Columns                       | Purpose                                          |
| ---------------------------------- | ----------------------------- | ------------------------------------------------ |
| `idx_community_space_lb_space_user`| (space_id, user_id) **UNIQUE**| LOAD-BEARING for REFRESH MATERIALIZED VIEW CONCURRENTLY (Pitfall 2) |
| `idx_community_space_lb_space_rank`| (space_id, rank_in_space)     | Top-N + ±neighborhood queries from SECDEF RPC    |

### Grants

- `REVOKE ALL ... FROM public`
- `GRANT SELECT ... TO authenticated, service_role`

(Read access mediated by `get_community_space_leaderboard()` SECDEF RPC shipped in 45-01 secdef migration — SECDEF bypasses RLS so the matview's authenticated grant is only for the RPC's internal use.)

### Cron consolidation

| Property          | Value                                                          |
| ----------------- | -------------------------------------------------------------- |
| Job name          | `phase35-leaderboard-refresh` (SAME as Phase 35 — ops continuity) |
| Schedule          | `12,27,42,57 * * * *` (unchanged)                              |
| Body              | TWO `REFRESH MATERIALIZED VIEW CONCURRENTLY` calls in one `DO $refresh$` block with `EXCEPTION WHEN others THEN RAISE NOTICE` handler |
| Pre-flight        | `DO $unschedule$` block: `cron.unschedule(jobname)` for any existing job of that name (idempotent re-run + handles Phase 35→45 upgrade in one push) |
| Dollar-quote tags | `$unschedule$`, `$cron$`, `$refresh$` (named per memory reference_postgres_dollar_quote_nesting_in_cron_body) |

**Cron body refreshes BOTH:**
1. `public.leaderboard_matview` (Phase 35 surface)
2. `public.community_space_leaderboard_matview` (Phase 45 — this plan)

**No** `phase45-*` cron created. Plan-checker guard `grep -cE "cron\.schedule\('phase45"` returns 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Inlined `cron.schedule(` call to satisfy acceptance grep**
- **Found during:** Task 1 acceptance verification
- **Issue:** Initial formatting split `select cron.schedule(\n  'phase35-leaderboard-refresh',` across two lines, causing acceptance check `grep -c "cron.schedule('phase35-leaderboard-refresh'"` to return 0 (expected 1).
- **Fix:** Collapsed the opening `cron.schedule(` and `'phase35-leaderboard-refresh',` onto the same line. Body remains multi-line.
- **Files modified:** `supabase/migrations/20270727000007_p45_leaderboard_matview.sql`
- **Commit:** `e06eb0b7` (single commit; fix made before commit)

No other deviations. Plan executed as written with verbatim adoption of RESEARCH Pattern 4 cron block and the planner's CTE structure.

## Acceptance Criteria — All Pass

| Check                                                                                   | Result |
| --------------------------------------------------------------------------------------- | ------ |
| `create materialized view public.community_space_leaderboard_matview` count = 1         | PASS   |
| `create unique index idx_community_space_lb_space_user` count = 1                       | PASS   |
| `interval '7 days'` count ≥ 3 (posts, comments, reactions CTEs)                         | PASS (3) |
| `leaderboard_enabled = true` count ≥ 1                                                  | PASS (2) |
| `leaderboard_opt_in = true` count ≥ 1                                                   | PASS (2) |
| `refresh materialized view concurrently` count ≥ 2 (both matviews)                      | PASS (5 total, of which 2 in cron body + 3 in commentary) |
| `cron.schedule('phase35-leaderboard-refresh'` count = 1                                 | PASS   |
| `cron.schedule('phase45` count = 0 (no new cron name)                                   | PASS   |
| `cron.unschedule` count ≥ 1 (pre-flight)                                                | PASS (1) |
| Named dollar tags `$unschedule$\|$cron$\|$refresh$` count ≥ 3                           | PASS (5) |

## Verification Deferred

Per plan `<verification>` and `<output>`:

> Any verification of "single cron at 12,27,42,57" must wait until 45-09 db push lands.

This migration ships only; `supabase db push --linked` happens in plan 45-09. After push, `supabase db query --linked "select jobname, schedule from cron.job where schedule = '12,27,42,57 * * * *'"` should return EXACTLY ONE row with `jobname = 'phase35-leaderboard-refresh'`.

## Threat Flags

None. Threat register entries T-45-15 (Information Disclosure on handle; Tampering on tier bypass) are both mitigated as planned — handle uses `profiles.leaderboard_handle` (anonymized D-16), tier-gate lives in SECDEF RPC shipped in 45-01.

## Known Stubs

None. Matview SELECT body is fully wired to existing Phase 44 tables (community_posts, community_comments, community_reactions, community_spaces) and Phase 45 profile columns (leaderboard_handle, leaderboard_opt_in).

## Commits

- `e06eb0b7` — feat(45-06): community_space_leaderboard_matview + consolidated 15-min refresh cron

## Self-Check: PASSED

- FOUND: supabase/migrations/20270727000007_p45_leaderboard_matview.sql
- FOUND: commit e06eb0b7
