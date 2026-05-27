# Phase 67: Operational Runbooks + Observability — Context

**Gathered:** 2026-05-27
**Mode:** Compressed-discuss (prescriptive requirements; operations + observability)

## Phase Boundary

Ship the 10 operational runbook + observability items grouped from research HD3+HD4+HD5+HD14+HD15+HD16. Covers secrets-rotation, DDoS k6 load-test, Vercel rate-limit, SENTRY_DSN Edge-Fn verify, funnel-break PostHog alerts, incident-response runbook, backup PITR restore drill, on-call rotation, Edge-Fn cold-start audit, status-page automation.

## Decisions

### D-01 — Runbook location
**Choice:** `.planning/runbooks/*.md` (project-relative, under `leanshot/`). Three new runbooks: `secrets-rotation.md`, `incident-response.md`, `backup-restore.md`. Cold-start audit results inline in `.planning/runbooks/edge-fn-cold-starts.md` (data file).

### D-02 — Runbook depth
**Choice:** Operational checklists, NOT in-depth playbooks. Each runbook ~150-300 lines: per-secret rotation procedure + blast-radius; per-incident-type detection signal + escalation path + log locations + rollback steps. Defer rich playbook content to v1.5; v1.4 is launch-readiness baseline.

### D-03 — k6 DDoS load-test
**Choice:** k6 script in `scripts/k6/` (project-root). 5 target endpoints per OPS-02. Baseline + 10× + 100× scenarios. Results captured in `.planning/runbooks/load-test-baseline.md`. **DO NOT actually run** the 100× scenario from this autonomous session — only ship the script + dry-run doc. Operator runs against staging.

### D-04 — Vercel rate-limit
**Choice:** Add `vercel.json` rate-limit headers per route (where Vercel platform supports — paid plans only) + Edge Middleware fallback at `leanshot/middleware.ts` for routes not natively covered. Limits: 60 req/min for `/api/og/*`, 30/min for `/api/lead-capture`, 10/min for `/api/affiliate-impression` (per-IP).

### D-05 — SENTRY_DSN Edge-Fn CI guard
**Choice:** New CI workflow `.github/workflows/sentry-dsn-check.yml` runs a Node script that imports each Edge Fn's `@sentry/*` reference. If any resolves to a no-op shim (e.g. `module.exports = {}` mock used in dev), CI fails. Phase 60.5 already set `SENTRY_DSN` Function Secret; this verifies it's actually consumed.

### D-06 — PostHog funnel-break alerts
**Choice:** PostHog Insights are created via the PostHog API. Ship a script `scripts/posthog/seed-funnel-alerts.sh` that POSTs the 3 funnel definitions (activation, payment, signup) + alert thresholds (20% WoW drop) + Slack webhook destination. Operator runs once against prod PostHog.

### D-07 — Better Stack status-page automation
**Choice:** Extend the existing Phase 41 Better Stack integration. Add 3 health-check endpoints — one each polling Sentry / Supabase / Vercel status APIs and posting incidents to Better Stack via webhook. Lives as a small Edge Fn `bs-status-poller` running on cron every 5min.

### D-08 — Cold-start audit
**Choice:** Build-time script `scripts/audit-cold-starts.ts` that triggers each Edge Fn `/healthz` after deploy, measures p95 cold-start latency over N samples, writes to `.planning/runbooks/edge-fn-cold-starts.md`. Tagged outliers (>1500ms p95) flagged for refactor. **Operator-run** during deploy, not autonomous.

### D-09 — Deploy gating
**Choice:** Same as Phases 65 + 66 — code-complete with operator + remote-deploy deferred to Phase 70 UAT. Per `[[feedback_autonomous_false_close_out_partial_execution]]`.

## Code Context

- Better Stack foundation: Phase 41 — `supabase/functions/better-stack-*` (check for existing endpoints)
- PostHog client: `leanshot/src/lib/posthog.ts` + server-side helper at `supabase/functions/_shared/posthog-server.ts`
- Slack alerts: `supabase/functions/_shared/slack-alert.ts` (Phase 60.5)
- Sentry SDK: Phase 42 — Sentry Capacitor install with potential no-op shims on Edge Fns
- Edge Fn count: ~25 across all phases; cold-start audit covers all of them
- Vercel config: `vercel.json` at repo root (likely under `leanshot/`)
- k6 not yet a dependency; the script will be a standalone .js file using `import http from 'k6/http'` (k6 runtime)

## Deferred

- Pagerduty / Splunk integration (overkill for launch)
- Synthetic monitoring (Better Stack's built-in checks cover MVP)
- Full SOC 2 control matrix (post-launch effort)
