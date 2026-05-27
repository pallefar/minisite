---
phase: 67
status: human_needed
verified: 2026-05-27
mode: automated-verify-only (operator-run + deploy items rolled to Phase 70)
---

# Phase 67: Operational Runbooks + Observability — VERIFICATION

## Automated Verification (PASS)

| Check | Method | Result |
|-------|--------|--------|
| 4 runbooks shipped | `ls leanshot/.planning/runbooks/{secrets-rotation,incident-response,backup-restore,on-call-rotation}.md` | ✅ |
| Runbook depth ≥100 LOC each | `wc -l leanshot/.planning/runbooks/*.md` | ✅ 266-363 LOC each |
| 3 k6 scripts shipped | `ls scripts/k6/ddos-{baseline,10x,100x}.js` | ✅ |
| load-test-baseline.md template | `ls leanshot/.planning/runbooks/load-test-baseline.md` | ✅ |
| middleware.ts extended | `git diff main~5 leanshot/middleware.ts` shows rate-limit concern added | ✅ |
| SENTRY_DSN CI workflow | `ls .github/workflows/sentry-dsn-check.yml` | ✅ |
| SENTRY_DSN script + tests | `deno test scripts/ci/check-sentry-imports.test.ts` | ✅ 8/8 |
| Cold-start audit script | `ls scripts/audit-cold-starts.ts` | ✅ |
| PostHog seed + JSON | `ls scripts/posthog/{seed-funnel-alerts.sh,funnel-alerts.json}` | ✅ |
| bs-status-poller Fn | `ls supabase/functions/bs-status-poller/{handler,index,deno.json}` | ✅ |
| bs-status-poller tests | `deno test supabase/functions/bs-status-poller/__tests__/` | ✅ 13/13 |
| tsc | `npx tsc --noEmit` | ✅ exit 0 |

## Human-Verify Signals (DEFERRED TO PHASE 70)

| Signal | Status | Description |
|--------|--------|-------------|
| S1: Run k6 baseline against staging | ⏭ | `k6 run scripts/k6/ddos-baseline.js --env BASE_URL=...`; fill `load-test-baseline.md` |
| S2: Run k6 100× scenario to find breaking point | ⏭ | High-risk; off-hours |
| S3: Deploy bs-status-poller Fn | ⏭ | `npx supabase functions deploy bs-status-poller --project-ref ytnsipxxmzgaebkqmokp` |
| S4: Register 5min pg_cron for bs-status-poller | ⏭ | Per `[[feedback_fn_deploy_before_cron_db_push]]` — Fn deploy first |
| S5: Run posthog/seed-funnel-alerts.sh against prod | ⏭ | Operator must create PostHog Slack integration `guardrail-slack` first |
| S6: Set BETTER_STACK_API_KEY secret | ⏭ | `npx supabase secrets set BETTER_STACK_API_KEY=...` |
| S7: Run cold-start audit | ⏭ | `deno run -A scripts/audit-cold-starts.ts` after deploy |
| S8: SENTRY_DSN CI guard fires on next PR | ⏭ | Verifies the new workflow activates |
| S9: Execute backup-restore PITR drill | ⏭ | HIPAA §164.308(a)(7) contingency testing |
| S10: Operator reviews + accepts all 4 runbooks | ⏭ | Walks through secrets/incident/backup/on-call procedures end-to-end |
