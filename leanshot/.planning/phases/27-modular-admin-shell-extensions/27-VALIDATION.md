---
phase: 27
slug: modular-admin-shell-extensions
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-17
---

# Phase 27 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Planner populates Per-Task Verification Map after PLAN.md files exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (unit + RLS integration + cohort rule-tree translator) + Playwright 1.x (palette + bulk action e2e) + deno test (Edge Fns) |
| **Config file** | `vitest.config.ts`, `vitest-e2e.config.ts`, `playwright.config.ts`, `supabase/functions/*/deno.json` |
| **Quick run command** | `npm run test -- --run --bail src/lib/cohort src/lib/admin/bulk src/lib/admin/palette` |
| **Full suite command** | `npm run test && npm run lint && npm run typecheck && deno test supabase/functions/admin-bulk-job-worker supabase/functions/funnel-anomaly-cron supabase/functions/bulk-undo-token-purge && npx playwright test --grep 'admin|cohort|palette'` |
| **Estimated runtime** | ~150s quick · ~700s full |

Notes
- RLS integration tests use [[reference_rls_fixture_gotruechient_flake]] fix.
- Per-file slug prefix per [[feedback_rls_per_file_slug_prefix]].
- Deno tests use `<name>.test.ts` filename per [[reference_deno_test_discovery]].
- Realtime channel verification per [[feedback_realtime_layer_e2e_pattern]] (DB-level invariant for `funnel_anomaly_alerts`).

---

## Sampling Rate

- **After every task commit:** Run quick command.
- **After every plan wave:** Run full command.
- **Before `/gsd:verify-work`:** Full suite + `supabase db query --linked` cron presence + manual realtime channel probe + Playwright palette e2e + cohort matview sub-50ms p99 query check.
- **Max feedback latency:** ~150 seconds per task.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 27-01-01 | 01 | 1 | ADMIN-04 | T-27-01-02 | Append-only RLS on admin_bulk_jobs + bulk_action_undo_token | migration | `ls supabase/migrations/*_admin_bulk_jobs.sql && grep -q 'enable row level security' supabase/migrations/*_admin_bulk_jobs.sql` | ❌ W0 | ⬜ pending |
| 27-01-02 | 01 | 1 | ADMIN-04 | T-27-01-01,05 | SECDEF execute/undo RPCs with admin gate + 10k cap | migration+deno-test | `grep -q 'security definer' supabase/migrations/*_admin_bulk_action_rpcs.sql && grep -q '10000' supabase/migrations/*_admin_bulk_action_rpcs.sql` | ❌ W0 | ⬜ pending |
| 27-01-03 | 01 | 1 | ADMIN-04 | T-27-01-03 | 5-action dispatcher with discriminated error | unit | `npm test -- --run src/lib/admin/bulk/` | ❌ W0 | ⬜ pending |
| 27-01-04 | 01 | 1 | ADMIN-04 | — | UI bar/modal/undo-banner with role=status | unit+typecheck | `npm run typecheck && npm run lint -- src/components/admin/bulk/` | ❌ W0 | ⬜ pending |
| 27-01-05 | 01 | 1 | ADMIN-04 | T-27-01-03 | e2e ban-5+undo round-trip | e2e | `npx playwright test e2e/admin-bulk-actions.spec.ts` | ❌ W0 | ⬜ pending |
| 27-01-06 | 01 | 1 | ADMIN-04 | — | supabase db push live | live-probe | `supabase db query --linked "select count(*) from pg_tables where tablename in ('admin_bulk_jobs','bulk_action_undo_token')"` | ✅ | ⬜ pending |
| 27-02-01 | 02 | 1 | ADMIN-05,TAXO-03 | T-27-02-01,02,03 | zod schema + 15-field allowlist + recursive translator | unit | `npm test -- --run src/lib/cohort/rule-tree-schema.test.ts src/lib/cohort/rule-tree-to-sql.test.ts` | ❌ W0 | ⬜ pending |
| 27-02-02 | 02 | 1 | TAXO-03 | T-27-02-07 | cohort_definitions+compiled_sql+materialized table+rebuild fn+cron | migration | `grep -q 'compiled_sql' supabase/migrations/*_cohort_definitions.sql && grep -q 'cohort_membership_rebuild' supabase/migrations/*_cohort_membership_matview.sql` | ❌ W0 | ⬜ pending |
| 27-02-03 | 02 | 1 | ADMIN-05 | T-27-02-02,04,05 | SECDEF cohort RPCs (define/set_status/archive) + defensive validator | migration | `grep -q 'p_compiled_sql' supabase/migrations/*_cohort_rpcs.sql && grep -q 'cohort_validate_rule' supabase/migrations/*_cohort_rpcs.sql` | ❌ W0 | ⬜ pending |
| 27-02-04 | 02 | 1 | ADMIN-05 | — | cohort api wrapper with discriminated error + translator call | unit | `npm test -- --run src/lib/cohort/api.test.ts` | ❌ W0 | ⬜ pending |
| 27-02-05 | 02 | 1 | ADMIN-05 | — | builder UI + promote button + list | typecheck+lint | `npm run typecheck && npm run lint -- src/components/admin/cohort/` | ❌ W0 | ⬜ pending |
| 27-02-06 | 02 | 1 | ADMIN-05 | — | e2e define+promote+archive cohort | e2e | `npx playwright test e2e/admin-cohort-builder.spec.ts` | ❌ W0 | ⬜ pending |
| 27-02-07 | 02 | 1 | TAXO-03 | T-27-02-07 | matview/table live + cron `7,22,37,52` + UNIQUE PK | live-probe | `supabase db query --linked "select count(*) from cron.job where jobname='cohort-membership-refresh'"` | ✅ | ⬜ pending |
| 27-03-01 | 03 | 1 | ADMIN-06 | T-27-03-03 | admin_palette_recent SECDEF + admin gate + 20-row limit | migration | `grep -q 'limit 20' supabase/migrations/*_admin_palette_recent_rpc.sql && grep -q 'is_admin_at_least' supabase/migrations/*_admin_palette_recent_rpc.sql` | ❌ W0 | ⬜ pending |
| 27-03-02 | 03 | 1 | ADMIN-06 | T-27-03-01 | cmdk@1.1.1 + aal2-step-up + index-builder unit-tested | unit | `npm test -- --run src/lib/admin/palette/` | ❌ W0 | ⬜ pending |
| 27-03-03 | 03 | 1 | ADMIN-06 | T-27-03-02 | AdminCommandPalette + PaletteAal2Gate (no AdminLayout edit) | typecheck+lint | `npm run typecheck && npm run lint -- src/components/admin/palette/` | ❌ W0 | ⬜ pending |
| 27-03-04 | 03 | 1 | ADMIN-06 | — | bundle ≤30 kB gz + 3 palette e2e (open/nav/aal2) | bundle+e2e | `find dist -name 'admin*.js' -exec gzip -c {} \; \| wc -c && npx playwright test e2e/admin-palette.spec.ts` | ❌ W0 | ⬜ pending |
| 27-03-05 | 03 | 1 | ADMIN-06 | — | supabase db push live + RPC probe | live-probe | `supabase db query --linked "select count(*) from pg_proc where proname='admin_palette_recent'"` | ✅ | ⬜ pending |
| 27-04-01 | 04 | 1 | TAXO-05 | T-27-04-02,04 | events_mirror + anomaly_tracked_funnels (5 seeds) + funnel_anomaly_alerts append-only | migration | `grep -q 'unique (funnel_id, tick_bucket)' supabase/migrations/*_funnel_anomaly_alerts.sql` | ❌ W0 | ⬜ pending |
| 27-04-02 | 04 | 1 | TAXO-05 | T-27-04-09 | baseline_compute (hybrid 0.4/0.6 blend) + acknowledge SECDEF | migration | `grep -q 'public.events_mirror' supabase/migrations/*_funnel_anomaly_baseline_compute.sql && grep -q 'is_admin_at_least' supabase/migrations/*_funnel_anomaly_acknowledge_rpc.sql` | ❌ W0 | ⬜ pending |
| 27-04-03 | 04 | 1 | TAXO-05 | T-27-04-01,03,06 | funnel-anomaly-cron Edge Fn + dual-write events_mirror + Deno test | deno-test | `cd leanshot && supabase functions test 2>&1 \| grep funnel-anomaly-cron.test.ts` | ❌ W0 | ⬜ pending |
| 27-04-04 | 04 | 1 | TAXO-05 | — | pg_cron */5 schedule + Vault bearer | migration | `grep -q '\*/5 \* \* \* \*' supabase/migrations/*_funnel_anomaly_cron_schedule.sql && grep -q 'vault.decrypted_secrets' supabase/migrations/*_funnel_anomaly_cron_schedule.sql` | ❌ W0 | ⬜ pending |
| 27-04-05 | 04 | 1 | TAXO-05 | T-27-04-05 | client lib + UI banner/queue + AdminGlobals wrapper (owns AdminLayout edit) | unit+typecheck | `npm test -- --run src/lib/admin/anomaly/ && npm run typecheck` | ❌ W0 | ⬜ pending |
| 27-04-06 | 04 | 1 | TAXO-05 | T-27-04-06 | integration tests detection + suppression (batch-insert seed) | integration | `npm test -- --run tests/integration/funnel-anomaly-detection.test.ts tests/integration/anomaly-suppression.test.ts` | ❌ W0 | ⬜ pending |
| 27-04-07 | 04 | 1 | TAXO-05 | — | live db+fn deploy + cron sanity | live-probe | `supabase db query --linked "select count(*) from cron.job where jobname='funnel-anomaly-cron'"` | ✅ | ⬜ pending |
| 27-05-01 | 05 | 2 | TAXO-05 | T-27-05-01,02,03 | 3 SECDEF RPCs (define/update/delete) with superadmin gate + has_alerts guard | migration | `grep -q 'has_alerts' supabase/migrations/*_anomaly_tracked_funnels_admin_rpcs.sql && grep -q 'is_admin_at_least..superadmin' supabase/migrations/*_anomaly_tracked_funnels_admin_rpcs.sql` | ❌ W0 | ⬜ pending |
| 27-05-02 | 05 | 2 | TAXO-05 | — | config-api wrapper with 5-error discriminated union | unit | `npm test -- --run src/lib/admin/anomaly/config-api.test.ts` | ❌ W0 | ⬜ pending |
| 27-05-03 | 05 | 2 | TAXO-05 | — | AdminAnomalyTrackedFunnelsConfig + AnomalyConfigPage UI | typecheck+lint | `npm run typecheck && npm run lint -- src/components/admin/anomaly/` | ❌ W0 | ⬜ pending |
| 27-05-04 | 05 | 2 | TAXO-05 | — | supabase db push live + RPC probe | live-probe | `supabase db query --linked "select count(*) from pg_proc where proname in ('anomaly_funnel_define','anomaly_funnel_update','anomaly_funnel_delete')"` | ✅ | ⬜ pending |
| 27-06-01 | 06 | 2 | ADMIN-04 | T-27-06-03,04 | process_chunk + reclaim_stuck + claim_pending SECDEF RPCs + cron `* * * * *` | migration | `grep -q 'for update skip locked' supabase/migrations/*_admin_bulk_job_worker_cron.sql && grep -q 'interval .5 minutes' supabase/migrations/*_admin_bulk_job_worker_cron.sql` | ❌ W0 | ⬜ pending |
| 27-06-02 | 06 | 2 | ADMIN-04 | T-27-06-01,05 | admin-bulk-job-worker Edge Fn + Deno test (claim/drain/reclaim) | deno-test | `cd leanshot && supabase functions test 2>&1 \| grep admin-bulk-job-worker.test.ts` | ❌ W0 | ⬜ pending |
| 27-06-03 | 06 | 2 | ADMIN-04 | — | client polling hook + BulkJobProgress UI + async modal branch | unit+typecheck | `npm test -- --run src/lib/admin/bulk/job-polling.test.ts && npm run typecheck` | ❌ W0 | ⬜ pending |
| 27-06-04 | 06 | 2 | ADMIN-04 | T-27-06-05 | integration 250-user async job drain + audit_logs landed | integration | `npm test -- --run tests/integration/admin-bulk-job-worker.test.ts` | ❌ W0 | ⬜ pending |
| 27-06-05 | 06 | 2 | ADMIN-04 | — | live db+fn deploy + cron sanity | live-probe | `supabase db query --linked "select count(*) from cron.job where jobname='admin-bulk-job-worker'"` | ✅ | ⬜ pending |
| 27-07-01 | 07 | 2 | ADMIN-04 | T-27-07-01,02 | pure-SQL cron purges bulk_action_undo_token AND events_mirror | migration | `grep -q 'bulk_action_undo_token' supabase/migrations/*_bulk_undo_token_purge_cron.sql && grep -q 'events_mirror' supabase/migrations/*_bulk_undo_token_purge_cron.sql && grep -q 'interval .30 days' supabase/migrations/*_bulk_undo_token_purge_cron.sql` | ❌ W0 | ⬜ pending |
| 27-07-02 | 07 | 2 | ADMIN-04 | — | e2e expired-token undo flow returns token_expired | e2e | `npx playwright test e2e/admin-bulk-undo-integration.spec.ts` | ❌ W0 | ⬜ pending |
| 27-07-03 | 07 | 2 | ADMIN-04 | — | 4 Phase 27 crons live + presence probe | live-probe | `supabase db query --linked "select count(*) from cron.job where jobname in ('bulk-undo-token-purge','admin-bulk-job-worker','funnel-anomaly-cron','cohort-membership-refresh')"` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> **Nyquist Dimension 8:** every task has an automated command + test type. Wave-0 stubs (❌ W0) created during execution. nyquist_compliant set true after BLOCKER B8 closure 2026-05-17.

---

## Wave 0 Requirements

- [ ] `src/lib/cohort/rule-tree-schema.test.ts` — zod schema unit tests (max-depth 8, 15-field allowlist enforcement, malformed-tree rejection) — ADMIN-05
- [ ] `src/lib/cohort/rule-tree-to-sql.test.ts` — JSONB→SQL translator unit tests (recursive AND/OR/NOT; field-level operator allowlist; SQL injection rejection) — ADMIN-05
- [ ] `src/lib/admin/bulk/action-handlers.test.ts` — 5 action types unit tests (csv_export / tag / comp_plan / ban / force_password_reset) — ADMIN-04
- [ ] `src/lib/admin/bulk/undo.test.ts` — 60s undo token issue + redeem + expiry — ADMIN-04
- [ ] `src/lib/admin/palette/index-builder.test.ts` — palette index aggregation (modules + recent items + quick actions) — ADMIN-06
- [ ] `tests/integration/cohort-matview-refresh.test.ts` — `refresh materialized view concurrently` succeeds; sub-50ms p99 cohort_membership read — TAXO-03
- [ ] `tests/integration/admin-bulk-job-worker.test.ts` — async path: queue >100-row job; worker drains; per-row audit_logs landed — ADMIN-04
- [ ] `tests/integration/funnel-anomaly-detection.test.ts` — seed funnel events; trigger cron; verify alert row + Realtime broadcast + email send — TAXO-05
- [ ] `tests/integration/anomaly-suppression.test.ts` — second alert within 4h same funnel suppressed — D-18
- [ ] `tests/e2e/admin-bulk-actions.spec.ts` — Playwright: select 5 members, click Ban, button-click confirm, 60s undo banner appears, click Undo, state reverts — ADMIN-04 + D-03
- [ ] `tests/e2e/admin-cohort-builder.spec.ts` — Playwright: define "free users >7d" cohort via builder UI; archive cohort — ADMIN-05
- [ ] `tests/e2e/admin-palette.spec.ts` — Playwright: Cmd+K opens; type "audit"; ↑↓⏎ navigates to audit log module; destructive action triggers aal2 step-up — ADMIN-06 + D-12

*Planner owns Wave-0 stub creation per the mapping above (recommend Plan 27-01 owns bulk + undo + e2e; Plan 27-02 owns cohort schema + translator + matview + e2e; Plan 27-03 owns palette + e2e; Plan 27-04 owns anomaly cron + Realtime + email + integration tests; Plan 27-06 owns async worker + integration; Plan 27-07 owns undo-purge cron).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `SUPERADMIN_ALERTS_EMAIL` env var set on Vercel + Supabase Function secrets | D-17 | Vendor config | `vercel env add SUPERADMIN_ALERTS_EMAIL production` + `supabase secrets set SUPERADMIN_ALERTS_EMAIL=<email>` |
| First non-concurrent matview refresh executed manually before cron enables | D-08 / RESEARCH 2-step pattern | One-time bootstrap | `supabase db query --linked "refresh materialized view public.cohort_membership"` then enable pg_cron job |
| Realtime channel `funnel_anomaly_alerts` enabled in Supabase Realtime settings | D-17 | Supabase dashboard config | Enable Realtime for `funnel_anomaly_alerts` table in Supabase dashboard → Realtime; verify with `supabase db query --linked "select * from realtime.subscription"` |
| cron schedule collision check post-Phase 26 deploy | D-16 / RESEARCH stagger recommendation | Live cron query | `supabase db query --linked "select jobname, schedule from cron.job order by schedule"` — verify no `:00/:15/:30/:45` triple-fire |
| aal2 step-up freshness window UX walkthrough | D-12 | Manual flow | Login fresh; wait 16 minutes; trigger destructive palette action; verify TOTP re-prompt; verify session continues post-verify |
| Bulk action CSV export integrity probe | D-04 csv_export | Spot-check CSV | Run bulk CSV export on 50 members; open in spreadsheet; verify column order + no PII leak beyond allowlist |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 150s per task
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
