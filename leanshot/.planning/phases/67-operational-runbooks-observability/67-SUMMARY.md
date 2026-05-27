---
phase: 67
title: Operational Runbooks + Observability
status: code-complete (remote-deploy-deferred)
shipped: 2026-05-27
mode: autonomous --from 65 --to 69 (compressed-planner)
plans_completed: 5-of-5
requirements: [OPS-01, OPS-02, OPS-03, OPS-04, OPS-05, OPS-06, OPS-07, OPS-08, OPS-09, OPS-10]
---

# Phase 67: Operational Runbooks + Observability — SUMMARY

**Goal:** Ship 10 operational runbook + observability items grouped from research HD3+HD4+HD5+HD14+HD15+HD16.

**Status:** **CODE-COMPLETE — REMOTE-DEPLOY + OPERATOR-RUN DEFERRED.** All 5 plans shipped to main. Runbooks ready to use; k6 scripts ready to run against staging; PostHog seed ready to invoke; bs-status-poller Fn ready to deploy.

## REQ-ID Coverage

| REQ-ID | Plan | Code-Complete | Operator-Run / Deploy |
|--------|------|---------------|----------------------|
| OPS-01 (Secrets-rotation runbook) | 67-01 | ✅ secrets-rotation.md (337 LOC, 20 secrets) | n/a (operator reference doc) |
| OPS-02 (k6 DDoS baseline + 10× + 100×) | 67-02 | ✅ 3 k6 scripts + baseline.md template | ⏭ Phase 70 (operator runs against staging) |
| OPS-03 (Vercel rate-limit) | 67-02 | ✅ vercel.json + middleware.ts extension | ⏭ Phase 70 (deploy to Vercel) |
| OPS-04 (SENTRY_DSN Edge Fn CI guard) | 67-03 | ✅ workflow + script + 8 Deno tests | ⏭ activates on next PR |
| OPS-05 (PostHog funnel-break alerts) | 67-04 | ✅ seed script + funnel JSON | ⏭ Phase 70 (operator runs against prod PostHog) |
| OPS-06 (Incident-response runbook) | 67-01 | ✅ incident-response.md (269 LOC, P1-P4 + HIPAA breach) | n/a |
| OPS-07 (Backup PITR restore drill) | 67-01 | ✅ backup-restore.md (363 LOC) | ⏭ Phase 70 (drill execution) |
| OPS-08 (On-call rotation) | 67-01 | ✅ on-call-rotation.md (266 LOC) | n/a |
| OPS-09 (Edge Fn cold-start audit) | 67-03 | ✅ audit-cold-starts.ts (auto-discovers Fns) | ⏭ Phase 70 (operator runs post-deploy) |
| OPS-10 (Better Stack status-page automation) | 67-04 | ✅ bs-status-poller Edge Fn (13 Deno tests) | ⏭ Phase 70 (deploy + pg_cron register) |

## Plans Shipped

| Plan | Outcome |
|------|---------|
| 67-01 | 4 runbooks at `leanshot/.planning/runbooks/` — secrets-rotation (337 LOC, 20 secrets inventory + per-secret procedures A-L), incident-response (269 LOC, P1-P4 + 11 log locations + 6 rollback playbooks + HIPAA §164.404 trigger), backup-restore (363 LOC, PITR + pg_dump fallback + annual drill), on-call-rotation (266 LOC). Total 1235 LOC. Defers to existing `vendor-secrets.md` + `hbnr-incident-response.md` for canonical inventories. |
| 67-02 | 3 k6 scripts (`scripts/k6/ddos-baseline.js` 5VU/60s, ddos-10x 50VU, ddos-100x 500VU) + `load-test-baseline.md` template + `vercel.json` informational X-RateLimit-Policy headers + `middleware.ts` extended with rate-limit concern (Phases 41+51 precedent — already 344 LOC; added concern D). |
| 67-03 | `.github/workflows/sentry-dsn-check.yml` + `scripts/ci/check-sentry-imports.ts` (135 Edge Fns scanned, 14 verified-real Sentry imports, 0 stubs) + 8 Deno tests + `scripts/audit-cold-starts.ts` (auto-discovers Fns, p50/p95/p99 samples). |
| 67-04 | `scripts/posthog/seed-funnel-alerts.sh` + `funnel-alerts.json` (3 funnels: activation/payment/signup) + `supabase/functions/bs-status-poller/` Edge Fn (handler/index split + Slack guardrail + placeholder guard) + 13 Deno tests. |
| 67-05 | Close-out (this SUMMARY + VERIFICATION + CARRY-OVER + ROADMAP/STATE/REQUIREMENTS flips). Inline. |

## Patterns Established / Reinforced

1. **Runbook style** — Operationally usable checklists, NOT prose playbooks. Tables + numbered steps + cross-references. Defer to existing single-source-of-truth docs (`vendor-secrets.md`, `hbnr-incident-response.md`) instead of duplicating.

2. **PG15+ middleware extension over greenfield** — When a project file already exists (Phases 41+51's 344-LOC middleware.ts), executor extended it with a self-contained concern block instead of overwriting. Per `[[reference_minisite_monorepo_layout]]` + Phase 51 precedent.

3. **CI-guard discovery patterns** — `check-sentry-imports.ts` is a reusable template for "verify every X imports real Y, not stub" CI gates. Two-layer classifier (REAL_BODY_MARKERS first, STUB_BODY_PATTERNS fallback) avoids both false-pass (arrow-fn no-ops) and false-fail (Deno npm specifier).

4. **`@vercel/edge` runtime over Next.js syntax** — Vite SPA project. PLAN had Next.js sketch; executor correctly identified `@vercel/edge` as the actual runtime per existing Phase 41/51 middleware.

5. **Self-recovered worktree pwd-drift** — 67-04 executor encountered the drift, recovered via `git -C "$WT" cherry-pick` + filesystem `mv`. Documented in SUMMARY. Same pattern as 66-02 + 66-05 + 66.5-01 (Task 2 inline-rescue).

## What Didn't Land (See CARRY-OVER)

- 0 new Edge Fns deployed to remote.
- 0 k6 scenarios executed.
- 0 PostHog alerts seeded.
- 0 cold-start audits run.
- 1 pg_cron job (bs-status-poller every 5min) un-registered.
- 1 PITR drill not executed.
