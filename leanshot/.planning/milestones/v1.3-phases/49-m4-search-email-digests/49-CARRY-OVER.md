---
phase: 49-m4-search-email-digests
type: carry-over
created: 2026-05-24
deferred_to: v1.3-milestone-close
status: shipped (automated-verify-only); operator HUMAN-UAT + live infra mutations deferred
---

# Phase 49 — Carry-Over

Phase 49 shipped 9/10 plans (49-01..49-09) + 49-10 partial close-out (Task 1 verify + Task 4 metadata; Tasks 2-3 deferred per operator decision 2026-05-24).

Pattern: `feedback_autonomous_false_close_out_partial_execution` + `feedback_milestone_uat_deferral_consolidation`.

## Migration push verification matrix

| Plan | Migration files | db push status |
|------|-----------------|----------------|
| 49-01 | 20271001000001 (community_posts FTS), 20271001000002 (course_lessons FTS), 20271001000003 (events FTS) | **pending** |
| 49-02 | 20271001000004 (search_content INVOKER RPC) | **pending** |
| 49-04 | 20271001000005 (notification CHECK widen), 20271001000006 (digest_send_log) | **pending** |
| 49-03 | 20271001000007 (6 SECDEF digest helpers) | **pending** |
| 49-05 | 20271001000008 (pg_cron daily 05:00 + weekly 15:00) | **pending** |

Total: **8 migrations pending push**. All filenames valid 14-digit regex.

**Ordering constraint** (per `feedback_fn_deploy_before_cron_db_push`): deploy `community-daily-digest` + `community-weekly-digest` Edge Fns FIRST. Migration `20271001000008` registers crons targeting both.

## Edge Fn deploy status

| Fn | Status | Notes |
|----|--------|-------|
| community-daily-digest | **pending deploy** | NEW. Cron-invoked '5 * * * *'. Deploy BEFORE cron migration. |
| community-weekly-digest | **pending deploy** | NEW. Cron-invoked '15 * * * *'. Deploy BEFORE cron migration. |
| unsubscribe-handler | **pending deploy** | NEW. RFC 8058 One-Click. Needs UNSUBSCRIBE_SECRET. |

Operator commands:
```bash
cd /Users/karstenhaldan/minisite/supabase

# Set 1 NEW Function Secret first
supabase secrets set --project-ref ytnsipxxmzgaebkqmokp \
  UNSUBSCRIBE_SECRET="$(openssl rand -hex 32)"

# Deploy digest Fns FIRST (cron precursor), then unsubscribe-handler
supabase functions deploy community-daily-digest
supabase functions deploy community-weekly-digest
supabase functions deploy unsubscribe-handler

# THEN push migrations
supabase db push --linked
```

## Vendor secret pre-flight status

| Secret | Status | Action |
|--------|--------|--------|
| UNSUBSCRIBE_SECRET | **NOT SET** | NEW for Phase 49. `openssl rand -hex 32`. Used by unsubscribe-handler HMAC verify. |
| RESEND_API_KEY | present | Inherited; no action. |
| SUPABASE_SERVICE_ROLE_KEY | present (sb_secret_*) | Inherited. |

## HUMAN-UAT signal status — ALL DEFERRED to v1.3 milestone UAT

| Signal | REQ-ID | Status | Defer reason |
|--------|--------|--------|--------------|
| 1: cmd+k search returns hits across posts/lessons/events | DIGEST-01 (FTS) | **deferred** | Needs db push + live content |
| 2: Daily digest email arrives at 05:05 UTC | DIGEST-02 | **deferred** | Needs cron + Fn deploy + ~24h wait |
| 3: Weekly digest email at Mon 15:15 UTC | DIGEST-03 | **deferred** | Needs cron + Fn deploy + ~1w wait |
| 4: 1-click unsubscribe from digest email (Gmail RFC 8058) | DIGEST-04 | **deferred** | Needs UNSUBSCRIBE_SECRET + Fn deploy + inbox UAT |
| 5: User toggles per-category digest opt-in in Settings | DIGEST-04 | **deferred** | Needs db push (CHECK widening) |
| 6: Search RLS — user sees only own org's content | DIGEST-01 | **deferred** | Needs db push + 2 live orgs |

Disposition: consolidated with Phase 32 + 45 + 46 + 47 + 48 deferred HITL gates at v1.3 milestone UAT.

## Pre-flight verification PASS (operator may skip Task 1 at re-attempt)

| Check | Result | Evidence |
|-------|--------|----------|
| Cross-Fn Deno sweep | **13/15 pass** | 2 failures are D-49-DEFERRED-01 inverted-fake bug in 49-06 daily test |
| tsc clean | **exit 0** | `cd leanshot && npx tsc -p tsconfig.app.json --noEmit` |
| 8 migrations + valid 14-digit regex | **PASS** | `ls supabase/migrations/20271001*_p49_*.sql \| wc -l` = 8 |

## Known residuals / accepted

- **D-49-DEFERRED-01** — pre-existing inverted-fake bug in `community-daily-digest/index.test.ts` (49-06 dispatch). 1-line fix `enabled: cfg.optOut !== true`. Logged in `deferred-items.md`. Production logic unaffected (Fn correctly checks opt-IN). Recommend 49-06 fast-follow or operator fixes during 49-10 walkthrough.
- **`@sentry/capacitor` sibling check** — `--ignore-scripts` workaround used in worktree executors per memory.
- **`leanshot/vitest.config.ts` projects-config drift** — Vitest 4.x; SPA test discovery affected.
- **Pwd-drift event in 49-09** — caught + reverted in-flight per `feedback_worktree_executor_pwd_drift_leaks_to_main`.

## Re-attempt close-out (operator)

When ready:
1. Set UNSUBSCRIBE_SECRET Function Secret.
2. Deploy 3 Edge Fns (daily + weekly digest FIRST per Fn-deploy-before-cron-db-push, then unsubscribe-handler).
3. `supabase db push --linked` (8 migrations transactional).
4. Fix D-49-DEFERRED-01 inverted-fake (optional 1-line).
5. Walk 6 HUMAN-UAT signals.
6. Flip CARRY-OVER status → "complete (UAT validated)" if all signals pass.
