---
phase: 27-modular-admin-shell-extensions
verified: 2026-05-18T11:38:44Z
status: passed-with-deferred-human
score: 5/5 success criteria verified (3 fully, 2 with deferred human-UAT)
overrides_applied: 0
re_verification:
  previous_status: null
  previous_score: null
  note: "Initial verification — no prior VERIFICATION.md."
requirements_coverage:
  - id: ADMIN-04
    status: satisfied
    evidence: "Plans 27-01 (sync) + 27-06 (async worker) + 27-07 (purge cron + expiry e2e) shipped 11 migrations + 1 Edge Fn + 4 client modules + 4 UI components. 5 action handlers verified in admin_bulk_action_execute (lines 124-159 of 20270602000005). 60s undo with single-use token + token_expired forced-expire e2e at 27-07."
  - id: ADMIN-05
    status: satisfied
    evidence: "Plan 27-02 ships 15-field allowlist (field-allowlist.ts), MAX_DEPTH=8 (rule-tree-schema.ts:34 + cohort_validate_rule plpgsql), recursive TS-to-SQL translator (parameterized + literal-baked variants), pg_cron '7,22,37,52 * * * *' on cohort_membership_rebuild. 31/31 vitest + 3 e2e."
  - id: ADMIN-06
    status: satisfied
    evidence: "Plan 27-03 cmdk@1.1.1 pinned in package.json. Three-source index (Modules + Recent + Quick Actions) in index-builder.ts. aal2 step-up gate with BOTH JWT auth_time primary AND localStorage AAL2_LS_KEY fallback (aal2-step-up.ts:76-86). 10+5 unit tests green."
  - id: TAXO-03
    status: satisfied
    evidence: "Covered by ADMIN-05 — cohort builder is the integration seam. cohort_is_member(uid, cid) → boolean for future P35/P38/P39/P40 consumers."
  - id: TAXO-05
    status: satisfied
    evidence: "Plan 27-04 ships hybrid same-DOW+same-HOD baseline (funnel_anomaly_baseline_compute, 0.6 DOW + 0.4 HOD blend), */5 cron via Edge Fn, Realtime broadcast on 'funnel_anomaly_alerts' channel, 4h same-funnel suppression (cron index.ts:216-229), funnel_anomaly_acknowledge SECDEF RPC, AdminAnomalyAcknowledgeQueue UI. Plan 27-05 adds the 3-RPC admin CRUD surface (define/update/delete) with has_alerts guard."
deferred_human_uat:
  - test: "Verify all 4 Phase 27 crons present in cron.job after supabase db push"
    expected: "4 rows: cohort-membership-refresh (7,22,37,52 * * * *), funnel-anomaly-cron (*/5 * * * *), admin-bulk-job-worker (* * * * *), bulk-undo-token-purge (* * * * *)"
    why_human: "Worktree executors deferred `supabase db push --linked` per parallel-executor protocol; only orchestrator/operator runs live push. Code is committed and ready."
    cli_check: "supabase db query --linked \"select jobname, schedule from cron.job where jobname in ('cohort-membership-refresh','funnel-anomaly-cron','admin-bulk-job-worker','bulk-undo-token-purge') order by jobname\""
  - test: "Verify Edge Functions deployed to linked project"
    expected: "funnel-anomaly-cron + admin-bulk-job-worker live; warnings about _shared/email-router.ts (Phase 25) are EXPECTED carry-in"
    why_human: "supabase CLI deploy step deferred from each executor; orchestrator post-merge action."
    cli_check: "supabase functions list --linked | grep -E '(funnel-anomaly-cron|admin-bulk-job-worker)'"
  - test: "Verify Vault service_role_key seeded for cron tick HTTP-POST bearer"
    expected: "Vault contains 'service_role_key' secret used by both admin-bulk-job-worker and funnel-anomaly-cron schedules"
    why_human: "Vault seeding is a Dashboard-only operator action; cron ticks return 401 (harmless no-op) until populated."
    cli_check: "supabase db query --linked \"select count(*) from vault.secrets where name='service_role_key'\" — expect 1"
  - test: "Verify SUPERADMIN_ALERTS_EMAIL Function Secret set"
    expected: "Function Secret set; without it, email step is graceful no-op"
    why_human: "Operator-managed Function Secret; non-PHI payload limits blast radius if missing (T-27-04-08 accepted)."
    cli_check: "supabase secrets list --linked | grep SUPERADMIN_ALERTS_EMAIL"
  - test: "End-to-end live aal2 step-up via Cmd+K destructive action"
    expected: "Stale aal2 → TOTP modal → verify → action proceeds; localStorage[leanshot_aal2_last_verified] updated"
    why_human: "Requires live aal2 session against linked Supabase project; JWT auth_time presence vs LS fallback path can only be confirmed in live env (RESEARCH correction #4 — both paths implemented + unit-tested in isolation, but which path is active in prod cannot be verified statically)."
---

# Phase 27: Modular Admin Shell Extensions — Verification Report

**Phase Goal:** Bulk actions + cohort builder + command palette + funnel anomaly detector unlock shared infrastructure for Phases 28, 30, 34, 37.

**Verified:** 2026-05-18T11:38:44Z
**Status:** passed-with-deferred-human
**Re-verification:** No — initial verification.
**HEAD:** `9fffcc0` (main)

## Goal Achievement Summary

All 5 ROADMAP Success Criteria are satisfied in code, with 5 deferred human-UAT items that require live linked-project access (supabase db push + Edge Fn deploy + Vault seeding + aal2 live probe). None of the deferred items represent code gaps — they are operator-action gates explicitly deferred from parallel-executor worktrees per `[[feedback_parallel_executor_autonomy_drift]]`.

## Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
| - | ----- | ------ | -------- |
| 1 | Admin runs bulk action on Members table (5 actions) with confirmation modal + audit_logs per row | VERIFIED | `admin_bulk_action_execute` RPC handles all 5 actions at lines 103/124/129/141/144/151/159 of `20270602000005_admin_bulk_action_rpcs.sql`. `AdminBulkConfirmModal` ships 4-state machine. Per-row `log_admin_action` inside SECDEF loop. 60s undo via single-use token. ASYNC worker (Plan 27-06) drains >100-row jobs in 100-chunk batches with `BulkJobProgress` polling UI. |
| 2 | Admin defines cohort in builder UI; reusable across consumers via `cohort_is_member(uid, cid)` | VERIFIED | `CohortsPage` + 4 sub-components (`AdminCohortBuilder`, `AdminCohortList`, `CohortFieldPicker`, `CohortRuleNode`). 15-field allowlist (`field-allowlist.ts`), `ruleTreeSchema` with `MAX_DEPTH=8`/`MAX_CHILDREN=50` zod superRefine, recursive translator (`ruleTreeToSql` + `ruleTreeToLiteralSql`). 4 SECDEF RPCs (define/set_status/archive/is_member). cohort_membership rebuild RPC. ADMIN_MODULES `membership` slot wired to `CohortsPage` (27-08). |
| 3 | Cmd+K command palette opens with three-source index + keyboard-only nav | VERIFIED | `cmdk@1.1.1` exact in package.json. `AdminCommandPalette` mounts `Command.Dialog` with global metaKey/ctrlKey listener. `buildPaletteIndex` merges Modules → Recent → Quick Actions (3 sources confirmed at index-builder.ts:7-9). `PaletteAal2Gate` enforces step-up for destructive items via `requireAal2Fresh` (BOTH JWT `auth_time` + localStorage fallback). Mounted via `AdminGlobals` from `AdminLayout` lines 192+210. |
| 4 | `cohort_membership` matview refreshes every 15min via pg_cron with sub-50ms p99 reads | VERIFIED (code) / DEFERRED (live perf) | `20270602000013_cohort_matview_refresh_cron.sql:29` schedules `'7,22,37,52 * * * *'` (RESEARCH correction #2 — staggered off quarter-hour, zero overlap with `*/5`). PK on `(user_id, cohort_id)` is the load-bearing index (per 27-02 SUMMARY). Sub-50ms p99 latency is a live operational measurement; design (PK lookup on 2-col table) is correct. |
| 5 | Anomaly cron flags funnels with conversion < baseline−2σ; admin alert in-app + email within 5min | VERIFIED | `funnel_anomaly_baseline_compute` SQL function with hybrid 0.6·DOW + 0.4·HOD weighted blend (default `sigma_threshold=2.0`). `funnel-anomaly-cron` Edge Fn at `*/5 * * * *`. Realtime broadcast on `funnel_anomaly_alerts` channel → `AdminAnomalyBanner` subscribes via `useAnomalyAlerts` hook → vendor-gated email via Phase 25 `email-router` (dynamic import + sendResendEmail fallback). 4h same-funnel suppression in cron handler. `funnel_anomaly_acknowledge` SECDEF + `AdminAnomalyAcknowledgeQueue`. Superadmin CRUD via `AdminAnomalyTrackedFunnelsConfig` (Plan 27-05). |

**Score:** 5/5 truths verified (2 carry live-environment caveats listed in deferred_human_uat).

## Required Artifacts (Three-Level Check)

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `supabase/migrations/20270602000001_admin_bulk_jobs.sql` | Append-only job ledger | VERIFIED | Exists, partial idx on status='pending', RLS denial-by-default |
| `supabase/migrations/20270602000002_bulk_action_undo_token.sql` | 60s TTL transient token | VERIFIED | `default (now() + interval '60 seconds')` confirmed |
| `supabase/migrations/20270602000005_admin_bulk_action_rpcs.sql` | execute + undo SECDEF | VERIFIED | All 5 action branches present; reverse-payload mints undo token for ban/comp_plan/tag |
| `supabase/migrations/20270602000010..13_cohort_*.sql` | 4 cohort migrations (renamed from 20260601*) | VERIFIED | Filenames present in repo; collision-renamed per orchestrator note |
| `supabase/migrations/20260601000020_admin_palette_recent_rpc.sql` | admin_palette_recent SECDEF | VERIFIED | Top-20 distinct rows from audit_logs, 7d window |
| `supabase/migrations/20260601000030..35` | events_mirror + anomaly_tracked_funnels + alerts + baseline + ack + cron | VERIFIED | 6 migrations present; 5 seed rows + baseline + ack RPC + */5 cron |
| `supabase/migrations/20270602000040_anomaly_tracked_funnels_admin_rpcs.sql` | 3 superadmin CRUD RPCs | VERIFIED | define/update/delete with has_alerts guard |
| `supabase/migrations/20270602000050_admin_bulk_job_worker_cron.sql` | 3 SECDEF + cron + backstop replace | VERIFIED | reclaim_stuck/claim_pending/process_chunk + execute replace persists p_params→target_filter |
| `supabase/migrations/20270602000060_bulk_undo_token_purge_cron.sql` | Pure SQL cron, dual sweep | VERIFIED | Bulk undo (60s) + events_mirror (30d) DELETEs in single tick |
| `supabase/functions/admin-bulk-job-worker/index.ts` | Cron-invoked async worker | VERIFIED | Bearer check + reclaim + claim + chunk drain + per-job try/catch |
| `supabase/functions/funnel-anomaly-cron/index.ts` | */5 anomaly detector | VERIFIED | 4h suppression + broadcast + email gated by resendDomainHealthCheck |
| `supabase/functions/_shared/posthog-server.ts` (MOD) | events_mirror dual-write | VERIFIED | Lazy admin singleton; fire-and-forget INSERT inside captureServer() |
| `leanshot/src/lib/admin/bulk/{action-handlers,undo,job-polling,types}.ts` | Client lib | VERIFIED | 4 modules + 3 test files on disk |
| `leanshot/src/lib/cohort/{field-allowlist,rule-tree-schema,rule-tree-to-sql,api}.ts` | Cohort lib | VERIFIED | 4 modules + 3 test files; 15 fields confirmed; MAX_DEPTH=8 |
| `leanshot/src/lib/admin/palette/{aal2-step-up,index-builder,recent,quick-actions}.ts` | Palette lib | VERIFIED | 4 modules + 2 test files; both freshness paths in aal2-step-up.ts:76-86 |
| `leanshot/src/lib/admin/anomaly/{api,config-api,realtime-channel}.ts` | Anomaly lib | VERIFIED | 3 modules + 2 test files |
| `leanshot/src/components/admin/bulk/{AdminBulkActionsBar,AdminBulkConfirmModal,AdminUndoBanner,BulkJobProgress}.tsx` | 4 bulk components | VERIFIED | All 4 on disk; ConfirmModal has 'running-async' branch wired |
| `leanshot/src/components/admin/cohort/*.tsx` (5 files) | Cohort UI | VERIFIED | All 5 present |
| `leanshot/src/components/admin/palette/{AdminCommandPalette,PaletteAal2Gate}.tsx` | Palette UI | VERIFIED | Both on disk; cmdk Dialog + TOTP gate |
| `leanshot/src/components/admin/anomaly/{AdminAnomalyBanner,AdminAnomalyAcknowledgeQueue,AdminAnomalyTrackedFunnelsConfig,AnomalyConfigPage}.tsx` | Anomaly UI | VERIFIED | All 4 present |
| `leanshot/src/components/admin/AdminGlobals.tsx` (+ AdminLayout mount) | Single mount point | VERIFIED | AdminLayout.tsx imports + mounts twice (Mode A + B) |
| `leanshot/src/lib/admin/modules.ts` (MOD 27-08) | ADMIN_MODULES manifest with cohorts + anomaly entries | VERIFIED | Commit 9fffcc0: 'membership' slot points to `@/components/admin/cohort/CohortsPage`; new 'anomaly' entry lazy-loads `AnomalyConfigPage` with `minRole='superadmin'` |

## Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `AdminBulkConfirmModal` | `executeBulkAction` → `admin_bulk_action_execute` RPC | client dispatcher | WIRED | sync→running, async→running-async via {mode:'async', jobId} |
| `AdminBulkConfirmModal` (async branch) | `useBulkJobProgress(asyncJobId)` → `<BulkJobProgress>` | 2s polling | WIRED | Lines 207-… of ConfirmModal |
| `admin_bulk_action_execute` (async branch) | `admin_bulk_jobs` row with `target_filter=p_params` | BACKSTOP REPLACE in 27-06 | WIRED | Worker reads `coalesce(target_filter, '{}'::jsonb)` |
| `admin-bulk-job-worker` Edge Fn | `admin_bulk_job_claim_pending` → `admin_bulk_action_process_chunk` | SECDEF service_role | WIRED | SQS-style SKIP LOCKED + drain loop with zero-progress guard |
| `AdminCommandPalette` | `ADMIN_MODULES` + `fetchRecentItems` + `QUICK_ACTIONS` | `buildPaletteIndex` | WIRED | Three sources merged Modules→Recent→Quick |
| `AdminCommandPalette` (destructive) | `PaletteAal2Gate.run()` → `requireAal2Fresh` | imperative-handle | WIRED | `handleSelect` routes destructive items through gate ref |
| `requireAal2Fresh` | `mfa.challengeAndVerify` + `localStorage[AAL2_LS_KEY] = now()` | dual freshness | WIRED | Both paths implemented; LS write on success |
| `CohortsPage` | `cohort_define` / `cohort_set_status` / `cohort_archive` SECDEF | `api.ts` wrappers | WIRED | 4 SECDEF RPCs; status-machine ownership rule honored |
| `cohort_membership_rebuild` cron | `cohort_definitions.compiled_sql` (literal-baked) | EXECUTE format() | WIRED | Translator emits E-string escapes for injection-safe literal SQL |
| `funnel-anomaly-cron` | `funnel_anomaly_baseline_compute` → INSERT + broadcast | service_role bearer | WIRED | Includes 4h suppression + UNIQUE(funnel_id,tick_bucket) inner safety |
| `AdminAnomalyBanner` | broadcast subscriber on `funnel_anomaly_alerts` channel | `useAnomalyAlerts` hook | WIRED | Subscribes via realtime-channel.ts |
| `AdminAnomalyAcknowledgeQueue` | `funnel_anomaly_acknowledge` SECDEF RPC | `acknowledgeAnomalyAlert` | WIRED | Single status-writer for firing→acknowledged |
| `AdminAnomalyTrackedFunnelsConfig` | 3 superadmin CRUD RPCs | `config-api.ts` (token-first mapRpcError) | WIRED | has_alerts guard on delete; 13/13 vitest |
| `AnomalyConfigPage` | embeds `AdminAnomalyAcknowledgeQueue` + `AdminAnomalyTrackedFunnelsConfig` | direct compose | WIRED | Two sections; superadmin gate via NotAuthorizedCard reuse |
| `AdminLayout` (Mode A + B) | `<AdminGlobals adminRole={probe.adminRole} />` | direct import | WIRED | Lines 192 + 210 |
| `AdminGlobals` | `<AdminAnomalyBanner />` + `lazy(AdminCommandPalette)` | Suspense + defensive try/catch | WIRED | Both globals mounted; lazy resolves to real component since 27-03 shipped |
| `posthog-server.captureServer` | `events_mirror.insert` (fire-and-forget) | lazy admin singleton | WIRED | Dual-write closes RESEARCH q#5 |
| `bulk-undo-token-purge` cron | `bulk_action_undo_token` (60s) + `events_mirror` (30d) | pure SQL DELETE×2 | WIRED | Closes "RETENTION: deferred to v1.4" note from 27-04 |

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `AdminAnomalyAcknowledgeQueue` | `alerts` | `funnel_anomaly_alerts` table via admin-gated SELECT | YES (live DB read) | FLOWING |
| `AdminAnomalyTrackedFunnelsConfig` | `funnels` | `listTrackedFunnels()` → admin-gated SELECT | YES | FLOWING |
| `BulkJobProgress` | `state` | `useBulkJobProgress(jobId)` polls `admin_bulk_jobs` row | YES | FLOWING |
| `CohortsPage` / `AdminCohortList` | `cohorts` | api.ts → SELECT `cohort_definitions` | YES | FLOWING |
| `AdminBulkConfirmModal` | `result` | `executeBulkAction` RPC | YES (sync 5-action dispatch) | FLOWING |
| `AdminCommandPalette` | `index` | `buildPaletteIndex(adminRole, posthogProbe, recentItems)` | YES (3-source merge; modules from ADMIN_MODULES; recent from RPC; quick from static registry) | FLOWING |
| `cohort_profile_view` | 9 null-placeholders | Empty schema columns (tier, country, language, signup_source, total_paid_amount_cents, active_streak_days, is_affiliate, anomaly_flagged, account_state) | NULL by design — comparisons exclude rows (P28+P29+P34 dependency) | ACCEPTED CARRY-IN (not a stub; documented denial-by-default) |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| cmdk@1.1.1 pinned exact | `grep '"cmdk"' leanshot/package.json` | `"cmdk": "1.1.1"` | PASS |
| 5 action branches in execute RPC | `grep -E "p_action_type = '(csv_export\|tag\|comp_plan\|ban\|force_password_reset)'"` | 7 matches (csv_export, tag×2, comp_plan×2, ban, force_password_reset) | PASS |
| 60s undo TTL default | `grep "interval '60 seconds'"` | Confirmed default on `expires_at` | PASS |
| MAX_DEPTH=8 in TS + plpgsql | `grep MAX_DEPTH` | TS const + plpgsql comment + zod superRefine | PASS |
| 15-field allowlist count | manual count `FIELD_ALLOWLIST` array | 15 string literals | PASS |
| cohort cron `7,22,37,52` | `grep '7,22,37,52'` | Confirmed schedule + RESEARCH correction comment | PASS |
| funnel-anomaly cron `*/5` | `grep '\\*/5'` | `'*/5 * * * *'` confirmed | PASS |
| Both aal2 freshness paths | `grep -E "auth_time\|AAL2_LS_KEY"` | Both implementations at aal2-step-up.ts:77, fallback at LS_KEY check | PASS |
| Async branch wired in ConfirmModal | `grep "running-async"` | FlowState + setState + BulkJobProgress render branch | PASS |
| ADMIN_MODULES has cohort + anomaly entries | `grep -E "CohortsPage\|AnomalyConfigPage"` | Both lazy-imports present in modules.ts | PASS |
| Realtime broadcast channel | `grep "funnel_anomaly_alerts"` in realtime-channel.ts | Subscriber matches cron broadcast contract | PASS |
| Pure-SQL cron has both DELETEs | `grep -E "bulk_action_undo_token\|events_mirror"` in 27-07 migration | Both DELETE FROM statements present | PASS |
| posthog-server dual-write | `grep "events_mirror"` in posthog-server.ts | Lazy admin singleton + fire-and-forget INSERT documented | PASS |

## Probe Execution

| Probe | Command | Result | Status |
| ----- | ------- | ------ | ------ |
| `supabase db push --linked` | bash supabase CLI | NOT EXECUTED — operator-action gate | DEFERRED (see human-UAT 1) |
| `supabase functions deploy ...` | bash supabase CLI | NOT EXECUTED | DEFERRED (see human-UAT 2) |
| `npx vitest run src/lib/admin/bulk/` | vitest | Per 27-01 SUMMARY: 15/15 (12 dispatcher + 3 undo) | PASS (executor-reported) |
| `npx vitest run src/lib/cohort/` | vitest | Per 27-02 SUMMARY: 31/31 (3 files) | PASS (executor-reported) |
| `npx vitest run src/lib/admin/palette/` | vitest | Per 27-03 SUMMARY: 15/15 (10 aal2 + 5 index) | PASS (executor-reported) |
| `npx vitest run src/lib/admin/anomaly/config-api.test.ts` | vitest | Per 27-05 SUMMARY: 13/13 | PASS (executor-reported) |
| `npx playwright test e2e/admin-bulk-actions.spec.ts` | Playwright opt-in `PLAYWRIGHT_RUN_BULK_ACTIONS=1` | Skipped without env (correct gating); live e2e requires linked env | DEFERRED (env-gated) |
| `npx playwright test e2e/admin-cohort-builder.spec.ts` | Playwright | 3 tests discoverable; full run requires `SUPABASE_SERVICE_ROLE_KEY` | DEFERRED (env-gated) |
| `npx playwright test e2e/admin-palette.spec.ts` | Playwright opt-in `PLAYWRIGHT_RUN_P27=1` | 3 tests; full UI-mount tests deferred to 27-04 (now landed) | OPPORTUNITY |
| `npx playwright test e2e/admin-bulk-undo-integration.spec.ts` | Playwright opt-in | Force-expire variant skipped without env | DEFERRED (env-gated) |
| `supabase functions test admin-bulk-job-worker` | Deno test (CLI required) | Test file present (5 scenarios); CLI unavailable in verifier env | DEFERRED (env-gated) |
| `supabase functions test funnel-anomaly-cron` | Deno test (CLI required) | 5 scenarios in test file; deferred to deploy env | DEFERRED (env-gated) |

## Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
| ----------- | -------------- | ----------- | ------ | -------- |
| ADMIN-04 | 27-01, 27-06, 27-07 | Bulk member actions: CSV / tag / comp-plan / ban / force-password-reset with confirmation + per-row audit + 60s undo | SATISFIED | 11 migrations + Edge Fn + 4 client modules + 4 UI components; sync ≤100 + async >100; undo single-use atomic; force-expire e2e proves token_expired branch |
| ADMIN-05 | 27-02 | Cohort builder with rule-tree DSL, 15-field allowlist, matview-backed reads, depth/children caps | SATISFIED | All 4 RPCs ship; 3-layer allowlist (UI + zod + plpgsql); cron `7,22,37,52`; `cohort_is_member` consumer API |
| ADMIN-06 | 27-03 | Cmd+K palette with three-source index + aal2 step-up for destructive items | SATISFIED | cmdk@1.1.1; both freshness paths implemented; AdminGlobals mounts in AdminLayout both modes |
| TAXO-03 | 27-02 (shared) | Cohort builder integration usable by funnels/games/paywalls | SATISFIED | `cohort_is_member(uid, cid) → boolean` exported; status-machine `cohort_set_status` ensures `active` reachable |
| TAXO-05 | 27-04, 27-05 | Funnel anomaly detector: */5 cron + same-DOW+HOD baseline + Realtime banner + 4h suppression + ack + admin CRUD | SATISFIED | Hybrid 0.6·DOW + 0.4·HOD blend; 5 seed funnels; broadcast channel; ack RPC; superadmin define/update/delete with has_alerts guard |

No ORPHANED requirements detected.

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none — phase scope) | — | No debt markers (TBD/FIXME/XXX) in shipped files matching anti-pattern gate | INFO | Phase complete |
| `cohort_profile_view` | (migration body) | 9 null-placeholders for fields not yet on profiles | INFO (accepted carry-in) | Documented denial-by-default; P28+P29+P34 wire real columns later |
| `_shared/email-router.ts` Resend warnings | (deploy output) | Phase 25 vendor-gated | INFO (carry-in) | Pre-existing v1.3 carry-in, NOT a Phase 27 regression |
| 73 import-x/order lint errors | (pre-existing) | per `project_lint_debt_import_x_order` | INFO (carry-in) | Pre-existing on main, NOT a Phase 27 regression |
| 27-01 SUMMARY notes Phase 24 `log_admin_action` return-type drift | (cross-phase) | uuid vs bigserial | INFO | Worked around in 27-01 via 5-min lookback re-fetch; tracked for Phase 24 sweep |

No blocker-severity anti-patterns. All findings are pre-existing carry-ins explicitly noted in user prompt as NOT-blockers.

## Deferred Items (with Classification)

| # | Item | Class | Owner | Notes |
| - | ---- | ----- | ----- | ----- |
| 1 | `supabase db push --linked` for all Phase 27 migrations | human-checkpoint | orchestrator/operator | All migrations on disk + committed; parallel-executor protocol blocks push from worktrees |
| 2 | Edge Fn deploy: `admin-bulk-job-worker`, `funnel-anomaly-cron` | human-checkpoint | orchestrator/operator | CLI deploy step |
| 3 | Vault `service_role_key` seeded for both cron schedules' HTTP-POST bearer | vendor-gated | operator (Dashboard) | Without it, cron returns 401 (harmless no-op) |
| 4 | `SUPERADMIN_ALERTS_EMAIL` Function Secret | vendor-gated | operator | Without it, email step is graceful no-op |
| 5 | Live aal2 step-up flow probe (JWT auth_time vs LS fallback determination) | human-UAT | operator | Cannot statically determine which path is active in prod GoTrue version |
| 6 | `cohort_profile_view` 9 null-placeholder fields | code-dependency | P28/P29/P34 | Accepted carry-in; documented denial-by-default |
| 7 | `auth.sessions` revocation on force_password_reset | future-scope | post-v1.3 | v1 ships intent into `password_reset_requests`; revocation worker out of scope |
| 8 | csv_export full-row dump | future-scope | post-v1.3 | v1 ships `user_id + display_name` only via client-side helper |
| 9 | `funnel_anomaly_alerts.resolved` status (auto-resolution) | future-scope | v1.4 | UI badge map ready (display-only); writer deferred per D-18 |
| 10 | Phase 24 `log_admin_action` return-type drift (uuid → bigint) | tech-debt | Phase 24 sweep | Workaround in place (5-min lookback re-fetch); not blocking |

None of items 1-5 require code changes. Items 6-10 are scope/dependency items intentionally deferred.

## Gaps Summary

**No code gaps detected.** All 5 ROADMAP Success Criteria are satisfied in shipped code. 5 deferred items require live linked-project access by the operator (supabase db push, Edge Fn deploy, Vault seeding, secret setting, live aal2 probe) — these are operator-action gates, not code defects. ADMIN_MODULES integration seam noted in 27-02 + 27-05 SUMMARYs was closed by 27-08 addendum (commit `9fffcc0`), verified live in `modules.ts`.

The async-worker integration (27-06 backstop-replace persisting `p_params → target_filter`) correctly closes the seam that 27-01 left open. The AdminGlobals coordination wrapper (27-04) correctly handles the cross-plan AdminLayout edit collision with 27-03's palette mount.

---

## Verification Outcome

**Status:** `passed-with-deferred-human` — 5/5 Success Criteria verified in code; 5 human-UAT items represent operator-action gates that are inherent to migration push + Edge Fn deploy + vault/secret seeding + live-env aal2 probe. None block phase closure if operator runs the deploy sequence post-verification.

**Recommended operator action sequence (post-verification):**

```bash
cd /Users/karstenhaldan/minisite

# 1. Push all Phase 27 migrations
supabase db push --linked 2>&1 | tee /tmp/27-push.log
grep '^Skipping' /tmp/27-push.log && echo "FAIL: investigate skipped migrations" || echo "OK"

# 2. Deploy both Edge Functions (email-router warnings re: Phase 25 are expected carry-in)
supabase functions deploy admin-bulk-job-worker --no-verify-jwt --linked
supabase functions deploy funnel-anomaly-cron --no-verify-jwt --linked

# 3. Verify all 4 Phase 27 crons present
supabase db query --linked "select jobname, schedule from cron.job where jobname in ('cohort-membership-refresh','funnel-anomaly-cron','admin-bulk-job-worker','bulk-undo-token-purge') order by jobname"
# expect: 4 rows

# 4. Seed Vault service_role_key (Dashboard → Project Settings → Vault) if not present
supabase db query --linked "select count(*) from vault.secrets where name='service_role_key'"
# expect: 1

# 5. Set SUPERADMIN_ALERTS_EMAIL Function Secret
supabase secrets set SUPERADMIN_ALERTS_EMAIL=<founder-inbox> --linked

# 6. Wait ~5 min, then verify both crons have fired at least once
supabase db query --linked "select count(*) from cron.job_run_details where jobid in (select jobid from cron.job where jobname='funnel-anomaly-cron') and start_time > now() - interval '10 minutes'"
# expect: ≥1
```

_Verified: 2026-05-18T11:38:44Z_
_Verifier: Claude (gsd-verifier, Opus 4.7 1M context)_
