---
phase: 67-operational-runbooks-observability
plan: 2
subsystem: operations
tags: [load-test, k6, rate-limit, edge-middleware, ddos, ops]
requires: []
provides:
  - scripts/k6/ddos-baseline.js
  - scripts/k6/ddos-10x.js
  - scripts/k6/ddos-100x.js
  - leanshot/.planning/runbooks/load-test-baseline.md
  - leanshot/vercel.json :: informational X-RateLimit-Policy headers
  - leanshot/middleware.ts :: enforceRateLimit() in-memory token bucket
affects:
  - leanshot/middleware.ts (extends existing Phase 41 + 51 file)
  - leanshot/vercel.json (adds 3 header blocks)
tech-stack:
  added: [k6]
  patterns:
    - In-memory per-Edge-instance token bucket (v1.4 baseline)
    - Vercel Edge Middleware `@vercel/edge` (NOT Next.js NextRequest)
    - k6 multi-scenario constant-vus + per-endpoint thresholds + tags
key-files:
  created:
    - scripts/k6/ddos-baseline.js
    - scripts/k6/ddos-10x.js
    - scripts/k6/ddos-100x.js
    - leanshot/.planning/runbooks/load-test-baseline.md
  modified:
    - leanshot/vercel.json
    - leanshot/middleware.ts
decisions:
  - In-memory bucket per-Edge-instance accepted for v1.4; Upstash Redis upgrade deferred to v1.5
  - Rate-limit runs BEFORE next() to avoid Edge-Fn cold-start cost on 429ed requests
  - /api/* requests early-return after rate-limit pass to skip CSP/cookie augmentation
  - ddos-100x.js refuses prod URLs without ALLOW_PROD=true (safety guard)
metrics:
  duration_min: 12
  completed: 2026-05-27
  task_count: 2
  file_count: 6
---

# Phase 67 Plan 67-02: Vercel Rate-Limit + k6 DDoS Scripts Summary

Ships 3 k6 DDoS load-test scenarios (baseline / 10× / 100×) parameterized
by env vars, a results-template runbook, and per-IP rate-limiting on three
hot public API routes (`/api/lead-capture`, `/api/og/*`,
`/api/affiliate-impression`) via the existing `leanshot/middleware.ts`.

## What changed

### Task 1 — k6 scripts + baseline runbook (OPS-02)

Three k6 scripts at project-root `scripts/k6/`:

- **`ddos-baseline.js`** — 6 total VUs across 5 endpoints for 60s. Strict
  thresholds: p95 < 500ms, error < 1%. Run first to establish steady-state
  numbers.
- **`ddos-10x.js`** — 50 total VUs for 60s. Loosened thresholds
  (p95 < 2s, error < 5%) and 429 responses are checked as acceptable
  (the rate-limiter doing its job).
- **`ddos-100x.js`** — 500 total VUs for 60s. Captured-but-allowed
  thresholds (`abortOnFail: false`); custom `handleSummary()` writes
  per-run JSON for offline analysis. Built-in safety: refuses to run
  against prod URLs unless `ALLOW_PROD=true` is set.

All three are parameterized via `--env`:
- `BASE_URL` — Vercel-fronted endpoints (`/api/og/*`, `/api/lead-capture`,
  `/api/affiliate-impression`)
- `SUPABASE_URL` + `SUPABASE_ANON_KEY` — Supabase Edge Fns
  (`/functions/v1/traffic-attribution-recorder`, `/functions/v1/page-render`)

Dry-runnable via `k6 inspect` (no traffic fired).

`leanshot/.planning/runbooks/load-test-baseline.md` is a 167-line runbook
template with: how-to-run for each scenario, empty results tables (p50/p95/p99
+ error rate per endpoint per scenario), a "If breaking point detected"
section linking to incident-response.md, cadence (pre-launch + monthly +
pre-release), and cross-references to sibling runbooks.

### Task 2 — Vercel rate-limit (OPS-03)

`leanshot/vercel.json` — added 3 informational `X-RateLimit-Policy` header
blocks. These are operator-visible policy declarations (curl -I, Vercel
logs) — real enforcement lives in middleware.ts.

`leanshot/middleware.ts` — extended the existing Phase 41 + 51 Vercel
`@vercel/edge` middleware with a new concern **(D) Per-IP rate-limit**:

- **Matcher broadened**: original `/((?!api|_next/static|assets|favicon).*)`
  catch-all preserved + explicit `/api/lead-capture`, `/api/og/:path*`,
  `/api/affiliate-impression` entries added.
- **Token-bucket store**: module-level `Map<string, {count, resetAt}>`,
  keyed by `<ip>:<route-prefix>`. Per-Edge-instance scope, lazy reset on
  next read after `resetAt`, no explicit eviction needed for 60s windows.
- **Policy table**: 30/min `/api/lead-capture`, 60/min `/api/og/`,
  10/min `/api/affiliate-impression`.
- **enforceRateLimit()** runs as the FIRST step in the handler — BEFORE
  `next()` — so 429ed requests never spawn an Edge Fn invocation. Returns
  `429 Too Many Requests` with `Retry-After`, `X-RateLimit-Limit`,
  `X-RateLimit-Remaining: 0`, `X-RateLimit-Reset` headers.
- **/api/* early-return**: under-limit `/api/*` requests fall through to
  `next()`, then early-return BEFORE the CSP/cookie augmentation (which
  is only meaningful on HTML responses, not JSON/images).
- **Client IP**: reads `x-forwarded-for` first hop, falls back to
  `x-real-ip`, then `"unknown"`.

## Key decisions

1. **In-memory bucket is the v1.4 baseline.** Per-Edge-instance state means
   buckets can drift across regional instances. For launch this is acceptable
   — Vercel typically pins hot paths to a small set of regional instances
   and the per-IP window holds well enough in practice. v1.5 (Phase 70+
   tech-debt) should swap to Upstash Redis for cross-instance correctness.
   Documented in the middleware module comment + this SUMMARY.

2. **Rate-limit fires BEFORE `next()`.** This avoids spending the
   Edge-Fn / Vercel-function cold-start cost on rate-limited traffic. The
   alternative (rate-limit after next()) would also count toward Edge Fn
   invocation quotas — wasteful and gives DDoS attackers a free billable
   amplification.

3. **`ddos-100x.js` refuses prod URLs.** Hard-coded safety: throws unless
   `BASE_URL` contains "staging" or `ALLOW_PROD=true` is explicitly set.
   Eliminates the most likely operator-error mode (firing 500 VUs at prod).

4. **No unit tests for `enforceRateLimit()` in this plan.** Middleware is
   not currently set up to be DI-friendly — bucket state lives in a
   module-level Map. Per the plan's note, smoke-test via k6 in Phase 70
   close-out is the validation path. The two existing middleware tests
   (`csp-middleware.test.ts`, `middleware-cookie.test.ts`) only exercise
   non-`/api/*` paths so this change doesn't affect them.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocker] PLAN.md prescribed Next.js syntax; project uses Vercel @vercel/edge**

- **Found during:** Task 2 inspection of existing `leanshot/middleware.ts`
- **Issue:** PLAN.md showed a `next/server` + `NextRequest` + `NextResponse`
  template, but `leanshot/middleware.ts` already exists (485 lines after
  this plan) using `@vercel/edge`'s `next()` import + plain `Request`/
  `Response`. The project is a Vite SPA, not Next.js (per `leanshot/CLAUDE.md`).
  Writing the Next.js template would have overwritten ~344 lines of
  Phase 41 + 51 CSP/cookie work.
- **Fix:** EXTENDED the existing middleware with a new "(D)" concern —
  the rate-limit gate — at the top of the handler. Preserved all four
  prior concerns (A: iframe CSP, A2: ad-network CSP, B: report-uri, C:
  lt_anon_id cookie). Used the Vercel-native `Request`/`Response` shapes
  + `@vercel/edge` `next()` already in place. The plan's `<known_lessons>`
  block flagged this as the expected handling — applied directly.
- **Files modified:** `leanshot/middleware.ts`
- **Commit:** `0aa24c0c`

**2. [Rule 2 — Critical safety] Added prod-URL refusal to ddos-100x.js**

- **Found during:** Task 1 ddos-100x.js authoring
- **Issue:** 500 VUs against prod = self-inflicted outage. PLAN.md did
  not specify a safety guard but the runbook makes clear this is
  staging-only.
- **Fix:** Hard-coded `throw new Error(...)` if `BASE_URL` contains
  "leanshot.app" without "staging" and `ALLOW_PROD` is not `"true"`.
  Operator must consciously opt-in to override.
- **Files modified:** `scripts/k6/ddos-100x.js`
- **Commit:** `89ea908f`

## Known limitations / follow-ups

- **In-memory bucket → Upstash Redis upgrade** is the v1.5 deliverable
  (Phase 70+ tech-debt). Document the migration path in the v1.5
  RESEARCH phase. Code-side, the swap should be a one-function-replace
  (`enforceRateLimit` body talks only to the bucket Map; isolate to a
  thin store interface).
- **No X-RateLimit-* headers on OK responses.** The current implementation
  only emits those headers on the 429 path. v1.5 should attach them on
  successful responses too for client-side observability.
- **Runbook results tables are empty.** Operator must fill in after the
  first staging run. This is the OPS-02 deliverable's intentional shape
  (template, not data).
- **k6 not pinned as a project devDependency.** `scripts/k6/*.js` files
  use k6's standalone runtime (`import http from 'k6/http'` resolves
  inside the k6 binary, not npm). Operator installs k6 via Homebrew or
  the official installer. Documented in the runbook.

## Self-Check: PASSED

- [x] `scripts/k6/ddos-baseline.js` — FOUND (169 lines)
- [x] `scripts/k6/ddos-10x.js` — FOUND (167 lines)
- [x] `scripts/k6/ddos-100x.js` — FOUND (203 lines)
- [x] `leanshot/.planning/runbooks/load-test-baseline.md` — FOUND (167 lines)
- [x] `leanshot/vercel.json` — FOUND (71 lines, +18 lines vs base)
- [x] `leanshot/middleware.ts` — FOUND (485 lines, +160 vs base)
- [x] Commit `89ea908f` — FOUND in `git log` (Task 1)
- [x] Commit `0aa24c0c` — FOUND in `git log` (Task 2)

## Commits

| # | Hash | Type | Message |
|---|---|---|---|
| 1 | `89ea908f` | feat | k6 DDoS load-test scripts + baseline runbook (OPS-02) |
| 2 | `0aa24c0c` | feat | Vercel rate-limit middleware + informational headers (OPS-03) |
