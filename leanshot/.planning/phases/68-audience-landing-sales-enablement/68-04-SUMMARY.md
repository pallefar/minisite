---
phase: 68-audience-landing-sales-enablement
plan: 4
subsystem: marketing-attribution
tags: [posthog, vercel-edge-middleware, utm, attribution, supabase-rest, landing-pages]
requires: [68-01]
provides: [LAND-07, LAND-08]
affects:
  - supabase/functions/_shared/traffic-attribution.ts
  - supabase/functions/traffic-attribution-recorder/traffic-attribution-recorder.test.ts
  - leanshot/middleware.ts
  - leanshot/tests/integration/middleware-utm-landing.test.ts
tech-stack:
  added: []
  patterns:
    - test-seam-mirror (setCaptureServerForTest mirrors setAdminForTest pattern)
    - middleware-resolver-first-stage (resolver short-circuits before rate-limit/cookie/CSP)
    - posthog-set-once-dimension (first_touch_landing_page pinned once per anonId)
key-files:
  created:
    - leanshot/tests/integration/middleware-utm-landing.test.ts
  modified:
    - supabase/functions/_shared/traffic-attribution.ts
    - supabase/functions/traffic-attribution-recorder/traffic-attribution-recorder.test.ts
    - leanshot/middleware.ts
decisions:
  - "LAND-08 resolver lives in middleware.ts (NOT the recorder Edge Fn) — recorder fires post-React-mount and is too late to prevent wrong audience landing from painting"
  - "landing_page added as event property AND pinned via $set_once for first-touch / $set for last-touch — funnel-break alerts in Phase 67 pivot on first_touch_landing_page"
  - "60s-TTL in-memory cache for utm_landing_defaults (mirrors iframe_allowlist + ad_csp_allowlist pattern in same middleware)"
  - "Resolver runs FIRST in middleware() — matched redirects short-circuit rate-limit + cookie mint + CSP augmentation (saves work for the bot/spam case)"
metrics:
  duration: "~25min"
  tasks_completed: 2
  files_modified: 4
  commits: 2
  tests_added: 10  # 2 Deno + 8 vitest integration
  date_completed: 2026-05-27
---

# Phase 68 Plan 04: traffic-attribution-recorder landing_page + UTM resolver Summary

Extended Phase 51 attribution surface with audience-aware funnel dimension (`landing_page`) and added a server-side UTM-default-landing resolver that 307-redirects root `/` landings with matching `utm_source` to per-audience pages.

## Tasks Completed

### Task 1: `landing_page` PostHog dimension (LAND-07) — commit `4b8b75fc`

Added `landing_page` to the `traffic_visit` event payload in `_shared/traffic-attribution.ts`:

- **Event property** — `landing_page: args.landingPath` mirrors `landing_path` so dashboards / SQL can query either name (legacy `landing_path` preserved per Phase 51 contract).
- **First-touch person property** — `first_touch_landing_page` pinned via `$set_once`. Once an anonId's first `traffic_visit` fires, the audience identity is preserved across every downstream event in that user's lifetime. This is the dimension Phase 67 funnel-break alerts pivot on for per-audience conversion slicing.
- **Last-touch person property** — `last_touch_landing_page` overwritten via `$set` on every visit so re-visit re-attribution stays current.

Added `setCaptureServerForTest` seam (mirrors `setAdminForTest`) — local wrapper around the module-level `captureServer` in `_shared/posthog-server.ts`. Production behavior unchanged; the override is null by default.

2 new Deno tests:
1. `recordTouch` emits all three landing-page fields with correct values for a `/for-clinics` landing.
2. PHI-redacted path (`/[redacted]` from the recorder Fn's `redactPath`) flows through unchanged.

### Task 2: UTM-default-landing 307 resolver (LAND-08) — commit `187bd2ba`

**Architectural decision documented in middleware.ts:** the resolver lives in Vercel Edge Middleware (`leanshot/middleware.ts`), NOT in the `traffic-attribution-recorder` Edge Fn as the plan first proposed. The plan explicitly authorized this fork at Task 2: *"this Fn may not actually be hit on `/` landing — landing-page routing is client-side in Vite SPA. The redirect mechanism may need to live in `leanshot/middleware.ts` instead… ADD the resolver to middleware.ts instead."*

The recorder Fn fires from the SPA AFTER React mounts — a 307 from the Fn would arrive long after the wrong audience landing already painted. Middleware is the only true server-side request interceptor for SPA root landings, executing on the initial HTML response before any JS runs.

New `maybeRedirectUtmLanding` helper:

- **Gate 1:** `pathname === '/'` — root landing only. Internal links to `/for-clinics`, `/for-coaches`, `/for-doctors` MUST NOT be re-redirected (would cause infinite loop / double-redirect penalty).
- **Gate 2:** `utm_source` query param present.
- **Gate 3:** `utm_source` value maps to a row in `utm_landing_defaults` (cached 60s in-memory, mirrors `iframe_allowlist` + `ad_csp_allowlist` cache pattern in same middleware).
- **Match → 307** + `Location: <origin><landing_path>?<all original query params>` + `Cache-Control: no-store`.
- **Fail-safe:** env vars unset OR Supabase fetch error → resolver no-ops (user sees generic root landing rather than an error).

Runs FIRST in `middleware()` — before rate-limit / cookie mint / CSP augmentation — so matched redirects short-circuit the entire downstream pipeline. The destination page (e.g. `/for-clinics`) executes middleware() fresh on the client's follow-up request and picks up cookies / CSP / rate-limit there.

`setUtmLandingCacheForTest` seam exposed for vitest integration tests.

8 new vitest integration tests in `leanshot/tests/integration/middleware-utm-landing.test.ts`:
1. `/?utm_source=clinic_outreach` → 307 to `/for-clinics?utm_source=clinic_outreach`
2. `/?utm_source=unknown_source` → pass-through (200; next() called)
3. `/for-clinics?utm_source=clinic_outreach` (non-root path) → pass-through
4. `/` with no `utm_source` query param → pass-through
5. Preserves ALL query params (utm_source + utm_medium + utm_campaign + arbitrary `foo=bar`)
6. `coach_referral` → `/for-coaches`
7. `doctor_referral` → `/for-doctors`
8. Env unset → resolver no-ops (fail-safe pass-through)

## Verification

```bash
$HOME/.deno/bin/deno test --no-check --allow-env --allow-net \
  supabase/functions/traffic-attribution-recorder/
# 11 passed | 0 failed (9 baseline preserved + 2 LAND-07)
```

Vitest integration tests for the middleware redirect could not run in the worktree — `npm install` fails on `vite-plugin-pwa` resolution (pre-existing worktree-main `node_modules` drift per project memory `reference_npm_install_worktree_main_drift` + `reference_sentry_capacitor_npm_install_blocker`). Post-merge sweep in main checkout runs the full vitest suite.

The 5 existing `middleware-cookie.test.ts` cases remain logically intact: they exercise paths like `/pricing`, `/share/clinic-acme-clinic`, `/share/garlic-tofu-melt` — none match `pathname === '/'`, so the new resolver returns null for all of them and falls through to the cookie-mint block as before. Cookie test env stubs `SUPABASE_URL=''` which also routes the resolver through its fail-safe no-op branch.

## Deviations from Plan

### Architectural — middleware.ts holds the resolver (explicitly authorized by Task 2 prose)

**Why:** SPA root landings are intercepted server-side ONLY at the Vercel Edge Middleware layer. The recorder Edge Fn fires from the SPA AFTER React mounts (fire-and-forget POST from `src/lib/traffic/fire-touch.ts`), which is too late to prevent the wrong audience landing from painting.

**What changed vs. `files_modified`:** plan declared only `supabase/functions/traffic-attribution-recorder/{index,handler}.ts` + tests. Actual modification: `leanshot/middleware.ts` + new `leanshot/tests/integration/middleware-utm-landing.test.ts`. The Edge Fn was modified only at `_shared/traffic-attribution.ts` (for Task 1 `landing_page`) and its existing test file (no separate `handler.ts` exists; the actual file is `traffic-attribution-recorder.test.ts`).

This is **not** a Rule 4 architectural deviation requiring user approval — the plan's Task 2 `<action>` block explicitly contemplated this path and instructed the executor to ADD the resolver to middleware.ts if the audit found landing routing was client-side. The audit confirmed it is (Vite SPA, no SSR, no Vercel rewrites for root).

### Auto-fixed — none

No Rule 1/2/3 auto-fixes triggered. The existing Phase 51 surface was clean; both tasks were pure additive extensions.

## Threat Flags

None new. The resolver:

- Reads `utm_landing_defaults` via anon-key Supabase REST (same surface as existing `iframe_allowlist` / `ad_csp_allowlist` fetches — already in the threat model).
- 307 destination is constructed from a server-trusted `landing_path` column (CHECK constraint in 68-01 migration: `^/[a-z0-9/_-]+$`); no user-controlled redirect target.
- Preserves user-provided query params verbatim — no PII/PHI exposure surface since the redirect lives entirely within the leanshot.app origin (same-origin GET).
- 60s cache TTL bounds attacker influence: even if an admin SECDEF RPC adds a malicious row, it propagates within 1 minute and the next CDN visitor sees the change.

## Self-Check: PASSED

```bash
# Files exist
$ test -f supabase/functions/_shared/traffic-attribution.ts && echo FOUND
FOUND
$ test -f supabase/functions/traffic-attribution-recorder/traffic-attribution-recorder.test.ts && echo FOUND
FOUND
$ test -f leanshot/middleware.ts && echo FOUND
FOUND
$ test -f leanshot/tests/integration/middleware-utm-landing.test.ts && echo FOUND
FOUND
$ test -f leanshot/.planning/phases/68-audience-landing-sales-enablement/68-04-SUMMARY.md && echo FOUND
FOUND

# Commits exist
$ git log --oneline | grep -E "(4b8b75fc|187bd2ba)"
187bd2ba feat(68-04): UTM-default-landing 307 resolver in Vercel Edge Middleware (LAND-08)
4b8b75fc feat(68-04): add landing_page dimension to PostHog payload (LAND-07)
```
