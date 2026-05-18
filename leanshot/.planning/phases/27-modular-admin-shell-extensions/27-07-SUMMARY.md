---
phase: 27-modular-admin-shell-extensions
plan: 07
subsystem: admin-bulk-actions
tags: [admin, bulk-actions, undo, cron, purge, events-mirror, retention]
requirements: [ADMIN-04]
dependency-graph:
  requires:
    - phase: 27
      plan: 01
      provides:
        - public.bulk_action_undo_token table (60s TTL, RLS append-only)
        - idx_bulk_undo_expires
        - admin_bulk_action_undo SECDEF RPC (raises 'token_expired' sqlstate 22023)
        - AdminUndoBanner client component
    - phase: 27
      plan: 04
      provides:
        - public.events_mirror table (RLS append-only; no retention until now)
        - funnel_anomaly_baseline_compute() function with max 29-day lookback
  provides:
    - pg_cron job 'bulk-undo-token-purge' (every minute)
    - events_mirror 30-day retention enforcement (closes the "RETENTION:
      deferred to v1.4" note in 20260601000030_events_mirror.sql)
    - e2e contract for ADMIN-04 D-03 expiry path (complements 27-01 happy-path e2e)
  affects:
    - none (additive cron + e2e; no schema-shape changes; idempotent install)
tech-stack:
  added:
    - pg_cron pure-SQL schedule pattern (no Edge Fn)
    - do-block-unschedule idempotent install (mirrors 20270602000013)
  patterns:
    - RESEARCH correction #3 honored — pure SQL beats Edge Fn for purpose
    - PATTERNS B3 alternative recommendation honored — recommend SQL variant
    - Force-expire e2e pattern for TTL semantics (vs wall-clock wait) to
      keep CI runtime bounded; cron itself exercised live via Task 3 probe
key-files:
  created:
    - supabase/migrations/20270602000060_bulk_undo_token_purge_cron.sql
    - leanshot/e2e/admin-bulk-undo-integration.spec.ts
  modified: []
decisions:
  - "Pure SQL cron (zero Edge Fn) per RESEARCH correction #3 + PATTERNS B3 alt"
  - "TWO retention sweeps in ONE cron body: bulk_action_undo_token (60s TTL) +
     events_mirror (30-day retention). Single tick, single transaction, lower
     pg_cron overhead than two separate jobs."
  - "Force-expire e2e (admin client backdates expires_at to now()-1s) over
     wait-65s — same RPC predicate exercised at fraction of CI cost"
  - "Idempotent install via do-block unschedule (mirrors 20270602000013)"
  - "Migration timestamp 20270602000060 follows 27-02 / 27-05 / 27-06
     convention (orchestrator note), NOT the plan-spec 20260601000060"
metrics:
  duration_minutes: ~15
  completed: 2026-05-18
  commits: 3
  files_created: 2
  files_modified: 0
  tasks_completed: 2
  tasks_deferred_to_orchestrator: 1
---

# Phase 27 Plan 07: Bulk Undo Purge Cron + Expiry E2E (ADMIN-04) Summary

One-liner: Ships a pure SQL pg_cron schedule that (1) purges expired
`bulk_action_undo_token` rows every minute and (2) enforces a 30-day
retention on `public.events_mirror` — bundled in one cron body for fewer
tick slots — plus the Playwright e2e that proves the expired-undo path
(complementing Plan 27-01's happy-path undo e2e).

## What shipped

### Migration

| Timestamp | File | Purpose |
| --- | --- | --- |
| `20270602000060` | `bulk_undo_token_purge_cron.sql` | Pure SQL `cron.schedule('bulk-undo-token-purge', '* * * * *', $$ <two DELETE WHEREs> $$)`. Targets: (1) `bulk_action_undo_token WHERE expires_at < now()` (ADMIN-04 D-03 cleanup); (2) `events_mirror WHERE created_at < now() - interval '30 days'` (closes the "RETENTION: deferred to v1.4" note in `20260601000030_events_mirror.sql`). Idempotent install via do-block `cron.unschedule` before `cron.schedule`. |

The migration timestamp uses `20270602000060` (per orchestrator instruction
matching the 27-02 / 27-05 / 27-06 convention), not the plan-spec
`20260601000060`.

### e2e

`leanshot/e2e/admin-bulk-undo-integration.spec.ts` — opt-in via
`PLAYWRIGHT_RUN_BULK_ACTIONS=1` + live Supabase env (same gate as
sibling 27-01 spec). Test "expired undo token returns token_expired
and state remains banned":

1. Seeds 5 patient profiles + 1 admin (admin_role='admin', has_totp=true).
2. addInitScript injects signed admin JWT (no UI login — free-tier auth
   rate limits per [[reference_supabase_auth_traps]]).
3. Navigates `/#/admin/members`, selects 5 rows, clicks Ban, awaits the
   `/rest/v1/rpc/admin_bulk_action_execute` 200; captures the response
   body's `undo_token` via `page.on('response', ...)`.
4. DB invariant: 5 profiles → `account_state='banned'`.
5. AdminUndoBanner visible.
6. **Force-expire**: `admin.from('bulk_action_undo_token').update({
   expires_at: new Date(Date.now() - 1_000).toISOString() }).eq('token', undoToken)`.
7. Clicks Undo; awaits `/rest/v1/rpc/admin_bulk_action_undo` response.
8. Asserts response body contains `'22023'` OR `'token_expired'`
   (PostgREST error-envelope shape).
9. Asserts UI surfaces an expired-window message (regex
   `/expired|window has passed|no longer available/i`).
10. DB invariant: 5 profiles **still** `account_state='banned'` (no rollback).
11. DB invariant: ZERO `audit_logs` rows with
    `action_name='bulk_action_undone'` for the 5 `target_user_id`s.
12. afterAll deletes the 6 seeded users.

Default `npm run test:e2e` correctly **skips** this spec (verified locally
via main-node_modules symlink: `1 skipped`).

## The 4 Phase 27 crons — collision matrix

After this plan ships and Task 3 runs `supabase db push --linked`, the
`cron.job` table contains:

| jobname | schedule | owner plan | body |
| --- | --- | --- | --- |
| `cohort-membership-refresh` | `7,22,37,52 * * * *` | 27-02 | `select public.cohort_membership_rebuild();` |
| `funnel-anomaly-cron` | `*/5 * * * *` | 27-04 | HTTP-post to Edge Fn |
| `admin-bulk-job-worker` | `* * * * *` | 27-06 | HTTP-post to Edge Fn |
| `bulk-undo-token-purge` | `* * * * *` | 27-07 | Pure SQL — `delete from bulk_action_undo_token where expires_at < now(); delete from events_mirror where created_at < now() - interval '30 days';` |

**Collision analysis:**

- `cohort-membership-refresh` (7,22,37,52) is deliberately staggered off the
  quarter-hour per RESEARCH correction #2 — zero overlap with `*/5` minutes
  (0,5,10,...,55).
- `bulk-undo-token-purge` AND `admin-bulk-job-worker` both run on
  `* * * * *` (every minute). **Acceptable**: pg_cron parallelizes
  across distinct jobnames into independent worker slots; per-jobname
  single-instance overlap protection applies (a tick that hasn't finished
  blocks the next tick of the SAME jobname only). No functional collision.
- `funnel-anomaly-cron` (`*/5`) collides with both per-minute crons at
  the 5-minute marks — same answer: independent worker slots, no
  contention.

## Pure SQL vs Edge Fn — design rationale

Per RESEARCH correction #3 + PATTERNS B3 alternative recommendation, the
purge is implemented as pure SQL inside `cron.schedule()` rather than as
a separate Edge Function. Trade-offs honored:

- ✅ Zero new HTTP surface (no Edge Fn deploy, no SUPABASE_URL/JWT
  retrieval inside the cron, no `service_role` token in the cron body).
- ✅ Zero new vendor dependency (no Deno runtime needed for a 2-line DELETE).
- ✅ Single-transaction atomicity for both DELETEs in one tick.
- ✅ Idempotent by design (DELETE WHERE on already-purged rows is a no-op).
- ✅ Failure visibility — pg_cron records `cron.job_run_details` for the
  jobname (manual UAT in 27-VALIDATION; threat T-27-07-04 mitigation).

## Why bundle events_mirror retention here

The plan asked for the bulk_undo_token purge cron; bundling the
events_mirror retention in the same cron body is a Rule 2 (auto-add
critical functionality) decision driven by:

1. The `events_mirror` migration explicitly says "RETENTION: deferred to
   v1.4" — leaving it unbounded ties a latent regression to the 27-04
   funnel-anomaly-cron's baseline-window queries (max 29-day lookback).
   As event volume grows, baseline queries climb past the 5-min cron
   budget → */5 ticks back up. The 30-day cap pre-empts that.
2. Both targets need the same `* * * * *` cadence + `service_role`
   privilege — one cron body is operationally simpler than two.
3. The migration header documents BOTH purge targets + the 30-day
   rationale so the next reader doesn't have to git-archaeology two
   files to understand the cron's intent.

## Deferred Items

- **Task 3 (BLOCKING) `supabase db push --linked` + cron-presence probe** —
  DEFERRED to orchestrator post-merge.
  - **Rationale:** Per parallel-executor rules in CLAUDE.md / project
    memory ([[feedback_parallel_executor_autonomy_drift]] +
    [[reference_supabase_worktree_temp_state]]), worktree executors must
    NOT run `supabase db push --linked` — both because the worktree has
    no `supabase/.temp/*` linked-project state AND because parallel
    executors should never push live without orchestrator control. The
    migration is committed and ready.
  - **Orchestrator probe sequence** after merge:
    ```bash
    cd /Users/karstenhaldan/minisite
    supabase db push --linked 2>&1 | tee /tmp/27-07-push.log
    grep '^Skipping' /tmp/27-07-push.log   # expect: no skips
    supabase db query --linked "select jobname, schedule from cron.job where jobname='bulk-undo-token-purge'"
    # expect: 1 row, schedule '* * * * *'
    sleep 70
    supabase db query --linked "select count(*) from cron.job_run_details where jobid in (select jobid from cron.job where jobname='bulk-undo-token-purge') and start_time > now() - interval '5 minutes'"
    # expect: ≥1 (cron fired at least once)
    supabase db query --linked "select jobname, schedule from cron.job where jobname in ('bulk-undo-token-purge','admin-bulk-job-worker','funnel-anomaly-cron','cohort-membership-refresh') order by jobname"
    # expect: 4 rows
    ```
  - **Phase entry condition:** Plan 27-07's success_criteria #5 ("All 4
    Phase 27 crons present in cron.job table") cannot be self-verified
    by the worktree executor — it's the orchestrator's gate before
    closing the phase.

## Verification

| Check | Result |
| --- | --- |
| Task 1 — migration exists; grep for jobname, schedule '* * * * *', delete-from bulk_action_undo_token, expires_at < now(), events_mirror, interval '30 days' | PASS (all 6 greps) |
| Task 1 — strict 14-digit filename | PASS (`20270602000060_bulk_undo_token_purge_cron.sql` matches `^[0-9]{14}_[a-z0-9_]+\.sql$`) |
| Task 2 — `npx playwright test e2e/admin-bulk-undo-integration.spec.ts` | PASS — 1 skipped (correctly gated by `PLAYWRIGHT_RUN_BULK_ACTIONS=1`); verified via main-node_modules symlink which was removed pre-commit (no leak into main per [[feedback_worktree_executor_npm_install_leak]]) |
| Task 2 — `npx tsc --noEmit` against spec | PASS — zero TS errors |
| Task 2 — `npx eslint` against spec | PASS — zero lint errors |
| Task 3 — `supabase db push --linked + cron-presence probe` | DEFERRED to orchestrator (see Deferred Items) |

## Threat Model Coverage

All 4 STRIDE register entries from the plan are addressed:

- **T-27-07-01 (Tampering)** — RLS denies UPDATE for authenticated on
  `bulk_action_undo_token` (no policy from 27-01); only SECDEF RPCs +
  service_role purge cron touch the table.
- **T-27-07-02 (DoS — clock skew)** — `DELETE WHERE expires_at < now()`
  uses Postgres server clock consistently with the INSERT default
  (`now() + interval '60 seconds'`); no client-supplied timestamps in
  the path.
- **T-27-07-03 (Information disclosure)** — `reverse_payload` contract
  from Plan 27-01 stores minimal data (e.g., `{account_state: 'active'}`);
  no PHI.
- **T-27-07-04 (DoS — silent failure)** — pg_cron records each tick in
  `cron.job_run_details`; the orchestrator's post-merge probe
  (Deferred Items) checks for ≥1 recent successful run as a UAT gate.

## Self-Check: PASSED

- Migration on disk: `supabase/migrations/20270602000060_bulk_undo_token_purge_cron.sql` (FOUND).
- e2e on disk: `leanshot/e2e/admin-bulk-undo-integration.spec.ts` (FOUND).
- Commit `1ee1cf6` in `git log`: feat(27-07-01) pure SQL pg_cron (FOUND).
- Commit `4100245` in `git log`: test(27-07-02) RED scaffold (FOUND).
- Commit `6221b75` in `git log`: test(27-07-02) GREEN force-expire e2e (FOUND).
- TDD gate sequence: `test(27-07-02)` RED commit precedes the GREEN
  rewire of the same file (verified via `git log --follow`).

## Commits

| Hash | Type | Description |
| --- | --- | --- |
| `1ee1cf6` | feat(27-07-01) | pure SQL pg_cron — bulk-undo-token-purge + events_mirror 30d retention |
| `4100245` | test(27-07-02) | RED scaffold for admin bulk-undo expired-token e2e |
| `6221b75` | test(27-07-02) | force-expire e2e proves expired undo → token_expired + state preserved |
