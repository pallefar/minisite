---
phase: 67
status: code-complete (remote-deploy + operator-run deferred)
audience: Phase 70 milestone UAT operator + Phase 69.5 tech debt
---

# Phase 67: Operational Runbooks + Observability — CARRY-OVER

## 1. Inherited (Phase 65 + 66 + 66.5)

`org_subscriptions` schema-tracking drift still blocking. Until operator runs psql + resolves it, Phase 65 + 66 + 66.5 + (eventually) bs-status-poller's optional schema requirements all defer.

## 2. Operator-Run Items (Phase 70)

| Item | Command/Action | Owner |
|------|---------------|-------|
| Run k6 baseline | `k6 run scripts/k6/ddos-baseline.js --env BASE_URL=https://staging.leanshot.app` | Operator + load-test infra |
| Run k6 10× + 100× | Same with `ddos-10x.js` / `ddos-100x.js`; off-hours | Operator |
| Fill `load-test-baseline.md` with results | Manual data entry | Operator |
| Deploy bs-status-poller Fn | `npx supabase functions deploy bs-status-poller` | CI or operator |
| Set BETTER_STACK_API_KEY | `npx supabase secrets set ...` | Operator |
| Register pg_cron for bs-status-poller | Migration (deferred — separate cron-schedule migration) | Phase 70 close-out |
| Create PostHog `guardrail-slack` integration | Manual in PostHog UI | Operator |
| Run posthog/seed-funnel-alerts.sh | `POSTHOG_PERSONAL_API_KEY=... POSTHOG_PROJECT_ID=140479 bash scripts/posthog/seed-funnel-alerts.sh` | Operator |
| Run audit-cold-starts.ts post-deploy | `deno run -A scripts/audit-cold-starts.ts` (~10min per Fn × ~25 Fns) | Operator |
| Execute backup-restore PITR drill | Per `backup-restore.md` annual drill section | Operator + dev backup |

## 3. Deferred Enhancements (v1.5)

- **Upstash Redis token bucket** — middleware.ts in-memory state is per-instance; cross-region traffic doesn't share counters. v1.5 swap for Redis.
- **Vercel Firewall (paid tier)** — for true platform-level rate-limiting; current middleware.ts is best-effort fallback.
- **Edge Fn cold-start refactor** — defer until OPS-09 audit results identify specific outliers (>1500ms p95).
- **PagerDuty / Splunk integration** — Better Stack covers MVP; upgrade post-launch if needed.
- **Per-Fn EXECUTE-grant audit** — see 66.5-CARRY-OVER § 3a (494 SECDEF function findings).

## 4. Phase 60 Carry-Over Closed Here

Per Phase 60 SUMMARY's "Phase 67 carry-overs":

| Item | Status |
|------|--------|
| Admin-action-token mechanism for 60-09 Pull-history button | ⏭ DEFERRED — out of Phase 67 scope; carry to Phase 69.5 |
| Vendor-string emission audit across upstream Fns | ⏭ DEFERRED — covered by SENTRY_DSN CI guard's two-layer classifier pattern (can be extended for vendor-string consistency in v1.5) |
| `slack_guardrail_webhook` vault entry (currently env-var fast-path) | ⏭ DEFERRED — env-var fast-path works; vault canonicalization is v1.5 polish |

## 5. Lessons This Phase

1. **Project-specific runtime detection beats template-following** — 67-02 executor correctly identified `@vercel/edge` over Next.js per existing Phase 41/51 middleware. Plan sketch had Next.js syntax that wouldn't have worked.
2. **Two-layer classifier** for "real vs stub" detection (67-03) — REAL_BODY_MARKERS first, STUB_BODY_PATTERNS only on absence. Avoids false-pass (arrow-fn no-ops) AND false-fail (Deno npm specifiers).
3. **Cross-reference existing docs** instead of duplicating — 67-01's runbooks defer to vendor-secrets.md + hbnr-incident-response.md for canonical inventories. No two-sources-of-truth drift.
