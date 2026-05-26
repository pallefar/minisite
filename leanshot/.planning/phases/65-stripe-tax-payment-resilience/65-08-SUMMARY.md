---
phase: 65-stripe-tax-payment-resilience
plan: 08
subsystem: stripe-tax-nexus-monitor
tags: [tax, nexus, edge-fn, cron, slack-alert, pay-04]
requires:
  - tax_nexus_thresholds (65-01)
  - tax_nexus_state_revenue matview (65-01)
  - tax_collection_log (65-01)
  - public.is_staff() (project-wide)
  - sendSlackGuardrailAlert helper context (Phase 60.5 vendor pre-flight set SLACK_GUARDRAIL_WEBHOOK_URL)
provides:
  - supabase/functions/nexus-monitor (Edge Fn — handler/index split)
  - public.nexus_alert_log (audit + de-dup log, RLS-gated)
  - public.refresh_nexus_revenue() RPC (SECDEF, service_role only)
  - public.get_nexus_proximity() RPC (SECDEF, service_role + authenticated)
affects:
  - Plan 65-09 (admin /tax dashboard reads get_nexus_proximity + nexus_alert_log)
  - Plan 65-10 (close-out registers daily pg_cron for nexus-monitor)
tech-stack:
  added: []
  patterns:
    - "Handler/index split with `import.meta.main` guard (avoids [[reference_deno_test_top_level_serve_trap]])"
    - "Service-role bearer + constant-time compare"
    - "23h de-dup gate via per-(state, alert_tier) log table"
    - "SECDEF RPC wrapper for REFRESH MATERIALIZED VIEW CONCURRENTLY"
    - "DI deps for Slack webhook URL + fetchImpl + supabaseServiceClient"
key-files:
  created:
    - supabase/migrations/20290104000009_nexus_alert_log.sql
    - supabase/migrations/20290104000010_refresh_nexus_revenue_rpc.sql
    - supabase/functions/nexus-monitor/handler.ts
    - supabase/functions/nexus-monitor/index.ts
    - supabase/functions/nexus-monitor/deno.json
    - supabase/functions/nexus-monitor/__tests__/handler.test.ts
  modified: []
decisions:
  - "RPC pair (refresh_nexus_revenue + get_nexus_proximity) shipped as a SEPARATE migration (000010) — not back-amended into 65-01's 000008 — to keep this plan's blast radius contained per the plan's stated `Choose: ship as a SECOND migration in THIS plan`."
  - "Did NOT reuse _shared/slack-guardrail-alert.ts: its channel routing (pharma02/regulatory/rag/cost/research) does not include a 'tax' channel. The plan's must_have specifies `SLACK_GUARDRAIL_WEBHOOK_URL` (Phase 60.5 secret) injected via deps. Inlined fetch POST is simpler + the test contract was webhook-URL-as-dep."
  - "23h de-dup gate is a query-then-insert, not strictly atomic. Cron cadence is daily so race window is negligible. Alert log row written EVEN ON Slack failure — so retry-within-24h still gated."
  - "alerts_fired counter counts Slack-failed sends too (they consumed the 23h gate). Operator sees them in `errors[]`."
  - "Tier thresholds (60/80/100) are deps-overridable but default-locked to plan spec."
metrics:
  duration: "~25 minutes"
  completed: 2026-05-26
---

# Phase 65 Plan 08: nexus-monitor Edge Fn (PAY-04 backend) Summary

Daily-cron Edge Fn that refreshes the `tax_nexus_state_revenue` matview, joins it against `tax_nexus_thresholds`, classifies each US state into a tier (safe / monitoring / at_risk / nexus_established), and fires tiered Slack alerts via `SLACK_GUARDRAIL_WEBHOOK_URL` with a 23-hour per-(state, tier) de-dup gate backed by a new `nexus_alert_log` audit table.

## What Was Built

### Task 1 — `nexus_alert_log` table migration `20290104000009`
Commit `27a10193`.

- Surrogate `id uuid PK` + `(state, alert_tier, alerted_at desc)` index supports the 23h de-dup query path.
- `alert_tier` CHECK constraint pins values to `('monitoring','at_risk','nexus_established')`.
- RLS enabled with two policies: `service_role_all_nexus_alert_log` (Fn writes) + `staff_select_nexus_alert_log` via `public.is_staff()` (admin `/tax` dashboard reads).
- Migration header cross-references PAY-04 + threats T-65-08-02 (audit trail) and T-65-08-03 (Slack-spam DoS).

### Task 2 — nexus-monitor Edge Fn (TDD RED → GREEN) + RPC migration `20290104000010`
RED commit `f015b2a1`; GREEN commit `db254379`.

**`handler.ts` (346 lines)** — handler/index split per [[reference_deno_test_top_level_serve_trap]]:

1. `GET /healthz` → 200 `{ ok:true, fn:'nexus-monitor' }`.
2. `POST /` requires `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` (inline constant-time compare).
3. Slack webhook guard: 503 + early-exit if `slackWebhookUrl` empty — no point running daily cron without an alert channel.
4. Refresh matview via `supabaseServiceClient.rpc('refresh_nexus_revenue')` (SECDEF, service_role only).
5. Query proximity via `supabaseServiceClient.rpc('get_nexus_proximity').select()` — returns per-state rows joining thresholds + matview.
6. Per-state classification (defaults overridable via `alertThresholds` dep):
   - `< 60`        → safe (no alert)
   - `60 — 79.99`  → monitoring (blue Slack info)
   - `80 — 99.99`  → at_risk (yellow Slack warning)
   - `≥ 100`       → nexus_established (red Slack CRITICAL with "REGISTRATION REQUIRED" + 30-day SLA copy)
7. 23h de-dup gate: `SELECT id FROM nexus_alert_log WHERE state=? AND alert_tier=? AND alerted_at > (now() - 23h) LIMIT 1`. If row found → skip.
8. Slack POST with tier-coloured attachment + structured fields (state, proximity %, revenue, threshold, tier).
9. INSERT into `nexus_alert_log` AFTER Slack POST regardless of Slack success — keeps retry-within-24h gated even when Slack is down.
10. Returns 200 `{ refreshed:true, states_checked, alerts_fired, alerts_skipped, errors:[] }`.

**`index.ts`** — `if (import.meta.main) Deno.serve(...)` wraps `handle()` with prod deps built from `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SLACK_GUARDRAIL_WEBHOOK_URL`.

**`deno.json`** — pins `@supabase/supabase-js@2.45.0` (matches grandfathered-policy-notice).

**`__tests__/handler.test.ts`** — 11 tests, all passing:

```
1.  GET /healthz returns 200
2.  POST / without bearer returns 401
3.  POST / refreshes matview via refresh_nexus_revenue RPC
4.  POST / classifies states across all tiers (safe + monitoring + at_risk + nexus_established)
5.  POST / fires Slack alert for at_risk state (CA 81%)
6.  POST / fires CRITICAL Slack alert for nexus_established state (TX 102%)
7.  POST / does NOT fire duplicate alert when 23h log entry exists
8.  POST / records nexus_alert_log row after firing Slack alert
9.  POST / returns refreshed/alerts_fired/alerts_skipped/states_checked
10. Slack failure: still records alert_log row (23h gate works)
11. POST / with SLACK_GUARDRAIL_WEBHOOK_URL unset → 503 early-exit
```

**Migration `20290104000010_refresh_nexus_revenue_rpc.sql`** ships TWO SECDEF SQL functions:

- `public.refresh_nexus_revenue()` — `plpgsql` SECDEF wraps `REFRESH MATERIALIZED VIEW CONCURRENTLY public.tax_nexus_state_revenue`. EXECUTE granted to `service_role` only; revoked from `public`, `anon`, `authenticated` (T-65-08-01).
- `public.get_nexus_proximity()` — `sql` SECDEF stable; returns per-state proximity rollup with `LEFT JOIN` so zero-revenue states still surface at 0%. EXECUTE granted to `service_role` + `authenticated` (admin `/tax` dashboard, Plan 65-09, reads via the same RPC).

## Slack Alert Copy

```
monitoring        — "Nexus monitoring: {State} ({XX}) at {N}%"
at_risk           — "Nexus AT RISK: {State} ({XX}) at {N}%"   (revenue $ / threshold $)
nexus_established — "🚨 NEXUS ESTABLISHED: {State} ({XX}) at {N}% — REGISTRATION REQUIRED. Stripe Tax registration in {State} must be completed within 30 days. Review at /admin/tax."
```

Each Slack attachment includes coloured swatch (blue/yellow/red) + structured fields (State, Proximity, Revenue, Threshold, Tier).

## Threat Model Coverage

| Threat ID    | Disposition | Mitigation as shipped |
| ------------ | ----------- | --------------------- |
| T-65-08-01   | mitigate    | `refresh_nexus_revenue` SECDEF; only `service_role` has EXECUTE; revoked from `public`/`anon`/`authenticated`. |
| T-65-08-02   | mitigate    | `nexus_alert_log` row written for every alert event (even Slack-failed) — staff-readable via `/admin/tax` (Plan 65-09). |
| T-65-08-03   | mitigate    | 23h de-dup gate + cron is daily → ≤1 Slack alert per (state, tier) per day even under cron retry storms. |
| T-65-08-04   | accept      | Slack channel operator-controlled (Phase 60.5 vendor pre-flight); revenue is internal metric. |

## Deviations from Plan

### Auto-fixed Issues
None. Plan executed as written.

### Implementation Choices Documented in Plan
1. **RPC migration vs. back-amend** — plan offered two options; picked option 2 (ship as separate `000010` migration in this plan) per the plan's explicit `Choose: ship as a SECOND migration in THIS plan` directive.
2. **`alerts_fired` accounting** — counts Slack-failed sends as "fired" (they consumed the 23h gate). Operator sees them via `errors[]` field in the response.

## Authentication Gates
None. No external secrets needed during execute.

## Verification

```
$ deno test --no-check --allow-env --allow-net supabase/functions/nexus-monitor/__tests__/handler.test.ts
ok | 11 passed | 0 failed (15ms)

$ wc -l supabase/functions/nexus-monitor/handler.ts
346

$ test -f supabase/migrations/20290104000009_nexus_alert_log.sql            # OK
$ test -f supabase/migrations/20290104000010_refresh_nexus_revenue_rpc.sql  # OK
```

All plan success criteria met:
- [x] 2 new migration files (000009 + 000010)
- [x] handler.ts ≥ 150 lines (346 actual) with documented DI seam
- [x] 11/11 tests pass via deno test
- [x] No cron registration in this plan (close-out 65-10 owns it)
- [x] Slack alert tiers match CONTEXT.md PAY-04 spec (80% → at_risk → Slack alert; 100% → "REGISTRATION REQUIRED")

## Known Stubs
None. Slack delivery is best-effort by design (cron retries daily; 23h gate prevents spam). Fn refuses to start without `SLACK_GUARDRAIL_WEBHOOK_URL` configured — no silent degradation.

## Commits

| # | Hash       | Type | Message |
| - | ---------- | ---- | ------- |
| 1 | `27a10193` | feat | add nexus_alert_log table migration (20290104000009) |
| 2 | `f015b2a1` | test | add RED scaffolds for nexus-monitor handler |
| 3 | `db254379` | feat | implement nexus-monitor handler + RPC migration |

## TDD Gate Compliance
- RED commit (`f015b2a1`, type `test`) — 11 failing tests against stub handler.
- GREEN commit (`db254379`, type `feat`) — 11/11 passing, handler.ts (346 lines) + RPC migration.
- No REFACTOR needed.

## Self-Check: PASSED

Files exist:
- FOUND: supabase/migrations/20290104000009_nexus_alert_log.sql
- FOUND: supabase/migrations/20290104000010_refresh_nexus_revenue_rpc.sql
- FOUND: supabase/functions/nexus-monitor/handler.ts
- FOUND: supabase/functions/nexus-monitor/index.ts
- FOUND: supabase/functions/nexus-monitor/deno.json
- FOUND: supabase/functions/nexus-monitor/__tests__/handler.test.ts

Commits exist:
- FOUND: 27a10193 feat(65-08): add nexus_alert_log table migration (20290104000009)
- FOUND: f015b2a1 test(65-08): add RED scaffolds for nexus-monitor handler
- FOUND: db254379 feat(65-08): implement nexus-monitor handler + RPC migration

Test gate: `deno test … handler.test.ts` → 11 passed, 0 failed.
