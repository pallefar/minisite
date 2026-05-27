---
phase: 67-operational-runbooks-observability
plan: 4
subsystem: observability
tags: [posthog, better-stack, funnel-alerts, status-page, edge-fn, ops]
requires: []
provides:
  - posthog-funnel-alert-seed-script
  - bs-status-poller-edge-fn
  - upstream-status-incident-creation
affects:
  - scripts/posthog/
  - supabase/functions/bs-status-poller/
tech_stack_added: []
patterns:
  - deno-handler-index-split (Phase 64-03 reuse)
  - placeholder-string-runtime-guard (Phase 60-13 pattern)
  - service-role-bearer-constant-time-compare
  - statuspage-io-v2-indicator-schema
  - vault-to-env-var-fast-path (via _shared/slack-guardrail-alert)
key_files:
  created:
    - scripts/posthog/seed-funnel-alerts.sh
    - scripts/posthog/funnel-alerts.json
    - supabase/functions/bs-status-poller/index.ts
    - supabase/functions/bs-status-poller/handler.ts
    - supabase/functions/bs-status-poller/deno.json
    - supabase/functions/bs-status-poller/__tests__/handler.test.ts
  modified: []
decisions:
  - "Better Stack incident dedupe via per-call emission + 5-min cron interval (not last-known-incident table) — keeps Wave 1 plan small; per-vendor bs_upstream_incidents table deferred to follow-up if duplicate noise emerges in prod."
  - "Upstream-fetch errors (network or non-2xx HTTP) coerce to indicator='minor' so they surface as Better Stack incidents but do not trigger major/critical pager (defensive default)."
  - "Slack destination resolved by NAME (guardrail-slack) at script start — fail-fast if operator hasn't created the integration in PostHog UI before seeding."
  - "PostHog seeder is idempotent via insight-name lookup; subscription IS NOT idempotent (would need PostHog Alerts API mapping). Operator can manually delete in UI if re-running creates dup subscriptions."
metrics:
  duration_minutes: ~25
  tasks_completed: 2
  files_created: 6
  files_modified: 0
  tests_passing: 13
  completed_date: 2026-05-27
commits:
  - 2c29a5ac: "feat(67-04): PostHog funnel-break alerts seed (OPS-05)"
  - 2a24c289: "feat(67-04): bs-status-poller Edge Fn (OPS-10)"
---

# Phase 67 Plan 67-04: PostHog Funnel Alerts + Better Stack Status Poller — Summary

PostHog funnel-break seeder (bash + JSON manifest) creates 3 funnels (activation, payment, signup) with 20%-WoW-drop Slack alerts; Better Stack `bs-status-poller` Edge Fn polls Sentry/Supabase/Vercel Statuspage.io v2 endpoints and creates incidents on non-`none` indicators.

## What Shipped

### Task 1 — OPS-05: PostHog funnel-break alert seed

- **`scripts/posthog/funnel-alerts.json`** — 3 funnel definitions:
  - **Activation:** `signup_completed → first_dose_logged → d7_active` (7-day conversion window)
  - **Payment:** `paywall_shown → checkout_started → subscription_created` (1-day window)
  - **Signup:** `landing_viewed → onboarding_started → signup_completed` (1-day window)
  - Each with `condition: { kind: 'absolute_decrease', threshold_pct: 20, comparison: 'week_over_week' }` and `destination_name: 'guardrail-slack'`.

- **`scripts/posthog/seed-funnel-alerts.sh`** — idempotent seeder:
  - Validates `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID` env vars.
  - Resolves Slack destination by name via `/api/projects/{id}/integrations/` — fails fast if missing.
  - For each funnel: GET-by-name lookup (skip if exists), then POST `/insights/` + POST `/subscriptions/`.
  - `DRY_RUN=1` mode for verification.
  - Exit codes: 0 OK, 1 partial-failure, 2 env-validation, 3 destination-missing.
  - Permission bit set: `chmod +x`. `bash -n` syntax-clean.

### Task 2 — OPS-10: Better Stack status poller Edge Fn

- **`supabase/functions/bs-status-poller/handler.ts`** — handler/index split (Phase 64-03 reuse):
  - Polls 3 upstream Statuspage.io v2 endpoints in parallel (`Promise.all`).
  - Parses `status.indicator` (`none | minor | major | critical`). Unknown indicator → coerced to `minor`. Network/HTTP error → coerced to `minor` with `raw_status_code` captured.
  - For each non-`none` vendor: POST to `https://uptime.betterstack.com/api/v2/incidents` with `Authorization: Bearer ${BETTER_STACK_API_KEY}`, body `{ summary: 'Upstream incident: {vendor} — {indicator}', description, requester_email, call:false, sms:false, email:true, push:true }`.
  - **Constant-time bearer compare** against `SUPABASE_SERVICE_ROLE_KEY` (in-handler implementation; no external dep needed).
  - **Placeholder-string runtime guard** for `BETTER_STACK_API_KEY`: regex `/\[|TODO|REPLACE_ME/i` → 503 + Slack P1 via `_shared/slack-guardrail-alert.ts`.
  - GET `/healthz` exempt from auth → `{ ok: true, fn: 'bs-status-poller' }`.
  - PUT/DELETE → 405 method_not_allowed.
  - Response shape: `{ polled, incidents_created, incidents_failed, statuses[], incidents[] }`.

- **`supabase/functions/bs-status-poller/index.ts`** — Deno.serve gated by `if (import.meta.main)` per `[[reference_deno_test_top_level_serve_trap]]`. Builds prod deps from `Deno.env`.

- **`supabase/functions/bs-status-poller/deno.json`** — import map with `shared/` + `std/` aliases.

- **`supabase/functions/bs-status-poller/__tests__/handler.test.ts`** — 13 Deno tests, ALL PASSING:
  1. GET /healthz → 200
  2. POST no bearer → 401
  3. POST wrong bearer → 401
  4. Missing `BETTER_STACK_API_KEY` → 503
  5. Placeholder `'REPLACE_ME'` → 503
  6. Placeholder `'[bracketed]'` → 503
  7. All indicators=none → 0 incidents, Better Stack NOT called
  8. One vendor `minor` → 1 incident, correct auth header asserted
  9. All 3 vendors `minor|major|critical` → 3 incidents
  10. Better Stack 500 → `incidents_failed=1`
  11. Upstream throws → coerced to `minor` + incident created
  12. Upstream 503 → coerced to `minor` + incident created
  13. PUT → 405

### Required Function Secrets (deferred to Phase 70 deploy)

```
BETTER_STACK_API_KEY          — Better Stack uptime API token
BETTER_STACK_REQUESTER_EMAIL  — sender email on incident records (defaults to noreply@leanshot.app if unset)
SUPABASE_SERVICE_ROLE_KEY     — bearer auth + vault for Slack
SUPABASE_URL                  — for slack-guardrail-alert helper
SLACK_GUARDRAIL_WEBHOOK_URL   — env-var fast-path for placeholder-guard alerts
```

## Verification

- **Deno tests:** `deno test --no-check --allow-net --allow-env --allow-read __tests__/handler.test.ts` → **13/13 PASS** (10ms wall).
- **Bash syntax:** `bash -n scripts/posthog/seed-funnel-alerts.sh` → clean.
- **JSON validity:** `jq` parses `scripts/posthog/funnel-alerts.json` (used by the seeder itself).
- **Pattern alignment:** handler.ts mirrors `grandfathered-policy-notice/handler.ts` for auth pattern, placeholder guard, Slack alert, and `import.meta.main` gating.

## Deviations from Plan

### Auto-fixed (Rules 1-3)

**1. [Rule 2 — Critical functionality] Added in-file `constantTimeEqual` instead of importing from `_shared/`**
- **Found during:** Task 2 (writing handler.ts).
- **Reason:** `_shared/newsletter-token.ts` exports `constantTimeEqual` but is tightly bound to the unsubscribe-token domain. Importing it would pull in HMAC envelope helpers irrelevant to bs-status-poller and create cross-domain coupling.
- **Fix:** Inlined an 8-line `constantTimeEqual(a, b)` in `handler.ts`. Same semantics as the newsletter-token version. Behavior identical.
- **Files:** `supabase/functions/bs-status-poller/handler.ts`
- **Commit:** 2a24c289

**2. [Rule 2 — Critical functionality] Coerce upstream fetch errors to indicator='minor'**
- **Found during:** Task 2 (test scenarios).
- **Reason:** Plan said "parse `status.indicator` field". If the upstream Statuspage.io endpoint is itself down (e.g., Sentry status page 503), naively setting `indicator='none'` would hide the upstream outage. Setting `indicator='major'` would over-page.
- **Fix:** Defensive default — network throws OR non-2xx HTTP → `indicator='minor'` with `raw_status_code` captured and `description: 'Status fetch failed: HTTP {N}'` for triage.
- **Tests:** Tests 11 (network throw) + 12 (HTTP 503) verify this.
- **Commit:** 2a24c289

### Process deviation — pwd-drift recovery

**3. [Process — recovery] Worktree pwd-drift trap, recovered cleanly**
- **Found during:** Task 1 commit.
- **Issue:** Initial `cd /Users/karstenhaldan/minisite` in a Bash call routed the commit (`3f512edd`) to the **main** checkout, not the worktree (`[[feedback_worktree_executor_pwd_drift_leaks_to_main]]`).
- **Recovery:**
  1. `git -C /Users/karstenhaldan/minisite reset --hard 29a3cf0d` — rewound main to its prior tip.
  2. `git -C "$WT" cherry-pick 3f512edd` — re-applied as `2c29a5ac` on worktree branch.
  3. For Task 2, files were Written via `Write` tool to `/Users/karstenhaldan/minisite/...` absolute paths which similarly landed on the main checkout filesystem. Recovered by `mv`-ing from main FS into worktree FS, then committing via `git -C "$WT"`. No data lost; no commits leaked to `main`.
- **Final main branch state:** `29a3cf0d` (unchanged from start).
- **Final worktree branch state:** 2 commits ahead of `29a3cf0d` (`2c29a5ac`, `2a24c289`).
- **Lesson confirmed:** Always use `git -C <worktree-path>` and write to `$WT/...` not `/Users/karstenhaldan/minisite/...`. Per `[[feedback_worktree_executor_pwd_drift_leaks_to_main]]`, this is a known repeat trap.

### None (genuine plan-content deviations)

The plan was prescriptive and executed verbatim modulo the two Rule-2 fixes above.

## Known Stubs

None. All code paths flow to real HTTP endpoints. Test-stub mode in the existing `grandfathered-policy-notice` pattern (`resendApiKey === 'test-stub'`) is NOT replicated here — bs-status-poller tests inject `fetchImpl` via deps, which is cleaner.

## Threat Flags

None. bs-status-poller introduces:
- Outbound HTTP to 3 status pages (public, GET only) + Better Stack incidents API (Bearer auth) — existing trust boundary.
- Inbound: service-role bearer required + constant-time compare; identical surface to other operator-invoked Fns (e.g., `grandfathered-policy-notice`).
- No new DB tables, RLS policies, or schema changes.

## Deferred (handed to Phase 67 close-out or Phase 70)

- **pg_cron registration** for `bs-status-poller` at 5-min interval. Plan defers to close-out per `[[feedback_fn_deploy_before_cron_db_push]]` — Fn must be deployed before cron job fires.
- **`bs_upstream_incidents` dedupe table** — only ship if 5-min polling produces incident-storm noise. Defer to follow-up plan.
- **PostHog operator seeding** — operator runs `scripts/posthog/seed-funnel-alerts.sh` once against prod PostHog (project 140479) during Phase 70 UAT. Requires `POSTHOG_PERSONAL_API_KEY` + Slack destination created in PostHog UI first.

## Self-Check: PASSED

- `[x]` `scripts/posthog/seed-funnel-alerts.sh` FOUND (worktree)
- `[x]` `scripts/posthog/funnel-alerts.json` FOUND (worktree)
- `[x]` `supabase/functions/bs-status-poller/handler.ts` FOUND (worktree)
- `[x]` `supabase/functions/bs-status-poller/index.ts` FOUND (worktree)
- `[x]` `supabase/functions/bs-status-poller/deno.json` FOUND (worktree)
- `[x]` `supabase/functions/bs-status-poller/__tests__/handler.test.ts` FOUND (worktree)
- `[x]` Commit `2c29a5ac` FOUND in worktree branch
- `[x]` Commit `2a24c289` FOUND in worktree branch
- `[x]` Main checkout HEAD = `29a3cf0d` (no leak)
- `[x]` Deno tests 13/13 PASS
