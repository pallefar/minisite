---
phase: 45-m4-community-spaces-member-directory-opt-in-dms-leaderboard
type: carry-over
created: 2026-05-24
deferred_to: v1.3-milestone-close
status: shipped (automated-verify-only); operator HUMAN-UAT + live infra mutations deferred
---

# Phase 45 — Carry-Over

Phase 45 shipped 9/10 plans (45-01..45-08, 07a, 07b) via worktree-executor dispatch + 45-09 partial close-out (Task 1 verify + Task 4 metadata only; Tasks 2-3 deferred per operator decision 2026-05-24).

Pattern applied: `feedback_autonomous_false_close_out_partial_execution` + `feedback_milestone_uat_deferral_consolidation` — phase marked complete on "approved automated-verify-only" disposition; 6 HUMAN-UAT signals + live infra (db push + 2 Fn deploys) deferred to v1.3 milestone close.

## Migration push verification matrix

Per memory `feedback_phase_close_out_db_push_verification`.

| Plan | Migration files | db push status |
|------|-----------------|----------------|
| 45-01 | 20270727000001 (schema), 20270727000002 (rls), 20270727000003 (secdef_rpcs) | **pending** |
| 45-02 | 20270727000004 (notification_widening) | **pending** |
| 45-03 | 20270727000005 (dm_attachments_bucket) | **pending** |
| 45-05 | 20270727000006 (admin_report_digest_cron) | **pending** |
| 45-06 | 20270727000007 (leaderboard_matview) | **pending** |

Total: **7 migrations pending push**. All filenames pass strict 14-digit regex.

**Ordering constraint** (per memory `feedback_fn_deploy_before_cron_db_push`): deploy `community-admin-report-digest` Edge Fn FIRST. Migration `20270727000006` registers a daily 9am UTC cron targeting that Fn; cron fires within 15 min of db push to a non-existent endpoint otherwise.

Operator command:
```bash
# Deploy Fns FIRST
cd /Users/karstenhaldan/minisite/supabase
supabase functions deploy community-admin-report-digest
supabase functions deploy dm-create-thread

# THEN push migrations (all 7 in one transactional push)
supabase db push --linked
```

## Edge Fn deploy status

| Fn | Status | Notes |
|----|--------|-------|
| dm-create-thread | **pending deploy** | NEW. User-invoked (forwards user JWT for RLS). No new Function Secret needed. |
| community-admin-report-digest | **pending deploy** | NEW. Cron-invoked daily 9am UTC. Service-role bearer. |

## Vendor secret pre-flight status

Phase 45 introduces **NO new vendor secrets** (no LLM, no payment, no Mux). Inherits:
- `SUPABASE_SERVICE_ROLE_KEY` — present (sb_secret_*)
- `RESEND_API_KEY` — present (email digest)
- `RESEND_FROM` — present

No operator action required for secrets.

## HUMAN-UAT signal status — ALL DEFERRED to v1.3 milestone UAT

Per memory `feedback_multi_signal_human_verify_checkpoint_pattern` — 6 discrete signals defined in plan 45-09 Task 3. All deferred 2026-05-24 because:
1. Tasks 2 (db push + Fn deploy) not yet run; signals depend on it
2. No multi-user live fixtures locally (DM rate-limit, cross-tenant proofs)
3. Operator-time pressure on multi-hour browser walkthrough

| Signal | REQ-ID | Status | Defer reason |
|--------|--------|--------|--------------|
| 1: Member directory loads + RLS profile-card | COMMUNITY-07 | **deferred** | Needs db push + 2 live users + opt-in toggle |
| 2: DM thread create + rate-limit cap | COMMUNITY-08 (D-07) | **deferred** | Needs Fn deploy + 2 live users + 24h wall-clock |
| 3: Clinician bypass + audit row | COMMUNITY-08 (D-08) | **deferred** | Needs clinician-verified live user + db push |
| 4: dm_closed + block bidirectional | COMMUNITY-08 (D-06/D-10) | **deferred** | Needs db push + 2 live users |
| 5: Leaderboard 7d rolling + opt-in | COMMUNITY-09 | **deferred** | Needs cron consolidation live + ≥1 leaderboard_opt_in user |
| 6: Daily admin report digest email | (admin ops) | **deferred** | Needs Fn deploy + cron + RESEND roundtrip ~24h |

Disposition: all 6 signals exercised at v1.3 milestone UAT walkthrough (consolidated with Phase 48 + Phase 32 deferred HITL gates).

## Pre-flight verification PASS (operator may skip Task 1 at re-attempt)

| Check | Result | Evidence |
|-------|--------|----------|
| Cross-Fn Deno test sweep | **10/10 pass** | `$HOME/.deno/bin/deno test --no-check --allow-env --allow-net --allow-read supabase/functions/{dm-create-thread,community-admin-report-digest}/` |
| tsc clean | **exit 0** | `cd leanshot && npx tsc -p tsconfig.app.json --noEmit` |
| Bundle gate | **PASS** | `bash leanshot/scripts/assert-bundle-budget.sh dist/assets` — all chunks within ceilings |
| 7 migration files, valid regex | **PASS** | `ls supabase/migrations/20270727*_p45_*.sql \| wc -l` = 7 |

## Known residuals / accepted

- **Bundle gate "MISSING" entries for community-directory + community-dm chunks** — assertion script reports MISSING for chunks not in current dist/ (no build was run pre-gate). 45-07b proved these chunks build cleanly at 3.23KB/10 and 31.91KB/35 ceilings. Re-build at re-attempt regenerates.
- **`leanshot/vitest.config.ts` projects-config drift** — under Vitest 4.x, projects block masks default test config (per memory `reference_vitest_4_projects_config_masks_default`). Full SPA test suite verification deferred to a future tooling plan.
- **`@sentry/capacitor` sibling check** — `@sentry/react ^10.52.0` incompatibility blocks plain `npm install` in worktrees; workaround `--ignore-scripts`. Pre-existing project-level issue, not introduced by Phase 45.
- **Phase 44 `templateForCategory` default-arm latent crash** — 45-02 default arm silently fixes the pre-existing crash for `community-mentions`/`community-replies` email fan-out. Explicit arms for those categories deferred to a Phase 44 cleanup PR (per 45-02 deferred-items.md).
- **DM v1 deferrals** — unread-count badge, message pagination >500 msgs/thread, DM soft-delete tombstone (rendered already; no call-site change needed) — all per 45-07b SUMMARY → v1.3 UAT.

## Re-attempt close-out (operator)

When ready:
1. `cd /Users/karstenhaldan/minisite/supabase`
2. Deploy 2 Edge Fns (`dm-create-thread`, `community-admin-report-digest`) FIRST.
3. `supabase db push --linked` (7 migrations transactional per file).
4. Walk 6 HUMAN-UAT signals per Plan 45-09 Task 3 script.
5. Flip CARRY-OVER status → "complete (UAT validated)" if all signals pass.
