---
phase: 02-visible-compliance-public-deploy
plan: 3
subsystem: ci-and-instrumentation-prep
tags: [ci, compliance, analytics, env-config, cmia-ab-2089]
requires:
  - .github/workflows/ci.yml (existing 5 Phase 1 jobs)
  - src/lib/analytics.ts (Phase 1 EventName starter union)
  - leanshot/.env.example (Phase 1 4-var matrix)
provides:
  - .github/workflows/ci.yml `compliance-copy` job (6th job, CMIA AB 2089 grep gate)
  - `EventName` union extended with `disclaimer_acknowledged` + `disclaimer_required`
  - `.env.example` documents the full Phase 2 build-time env-var matrix (7 vars)
affects:
  - 02-04 (consumes `disclaimer_acknowledged` event)
  - 02-05 (consumes `disclaimer_required` event)
  - 02-06 (relies on SENTRY_AUTH_TOKEN/ORG/PROJECT being declared)
  - All Phase 2 PRs (must pass `compliance-copy` before merge)
tech-stack:
  added: []
  patterns:
    - "Inverted-exit grep idiom (`if grep …; then exit 1`) — RESEARCH gotcha #5"
    - "GitHub Actions `::error::` annotation for PR Files-changed view"
    - "Compile-time TS literal-union assertion in test file (PATTERNS row 9)"
    - "TDD RED → GREEN with standalone `tsc` proving the type error before union extension"
key-files:
  created:
    - leanshot/.planning/phases/02-visible-compliance-public-deploy/02-03-SUMMARY.md
  modified:
    - .github/workflows/ci.yml (appended `compliance-copy` job, lines 119–142)
    - leanshot/src/lib/analytics.ts (EventName union: 5 → 7 members)
    - leanshot/src/lib/analytics.test.ts (compile-time assertion: 5 → 7 events)
    - leanshot/.env.example (Phase 2 build-time vars + Vercel-injected note)
decisions:
  - "Pure-shell compliance-copy job (no setup-node/npm ci) — faster, cheaper, sufficient for grep"
  - "Search root `src` (resolves to leanshot/src/ via repo-root `defaults.run.working-directory`); test files excluded; e2e/ naturally outside src/"
  - "RED phase verified via standalone tsc on the test file (project-config typecheck excludes *.test.ts) — TS2322 confirmed before EventName extension"
  - "`.env.example` extended in place; Phase 1 entries preserved verbatim and re-sectioned for clarity"
  - "Build-time secrets (SENTRY_AUTH_TOKEN/ORG/PROJECT) explicitly NOT prefixed with VITE_ to avoid leaking into the browser bundle"
metrics:
  duration_minutes: ~10
  tasks_completed: 3
  commits: 4 # ci + RED + GREEN + docs
  completed_date: 2026-05-11
---

# Phase 02 Plan 03: CI Compliance Gate, EventName Taxonomy Prep, Phase 2 Env Matrix — Summary

Three independent additions that unblock downstream Phase 2 work without coupling to it: a 6th CI job that grep-blocks CMIA AB 2089 mental-health framing, an extension of the analytics `EventName` union with two disclaimer events that 02-04/02-05 will fire, and a structured `.env.example` documenting the full Phase 2 build-time env-var contract.

## What Shipped

### Task 1 — `compliance-copy` CI job (commit `c8ba66d`)

- **Pre-check confirmed clean:** local `grep -rniE '\b(depression|anxiety|therapy|mental health treatment)\b' src --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx'` returned **exit code 1 (no matches)** in current `leanshot/src/`. The very first PR run will pass.
- **Job location:** lines **119–142** of `.github/workflows/ci.yml`. Appended after the existing `test-e2e` job; placed as the 6th and final job.
- **Pure-shell**, no setup-node, no npm ci — fast (<10s wall) and cheap.
- Inverted exit (`if grep …; then exit 1`) is documented inline in the job comment so future maintainers don't naively flip it.
- GitHub Actions `::error::` annotation surfaces in the PR Files-changed view alongside the offending line.
- Inherits the workflow-level `defaults.run.working-directory: leanshot`, so the search root `src` resolves to `leanshot/src/` (no per-job override needed).

### Task 2 — `EventName` union extension (commits `e438de4` RED, `c2a89c3` GREEN)

- **Final 7-member union** in `src/lib/analytics.ts`:
  1. `onboarding_started`
  2. `onboarding_step_completed`
  3. `onboarding_completed`
  4. `onboarding_abandoned`
  5. `tab_viewed`
  6. `disclaimer_acknowledged` *(NEW — Phase 2 D-08, fires on "I understand")*
  7. `disclaimer_required` *(NEW — Phase 2 D-11, fires on dashboard render when ack !== 'v1')*
- **TDD compliance:**
  - RED commit (`e438de4`) ships only the test file change. Project-level `tsc -b` excludes `*.test.ts` per `tsconfig.app.json:25`, so to actually prove RED I ran a standalone `tsc` against the test file directly. It emitted:
    ```
    src/lib/analytics.test.ts(15,13): error TS2322: Type '"disclaimer_acknowledged"' is not assignable to type 'EventName'.
    src/lib/analytics.test.ts(16,13): error TS2322: Type '"disclaimer_required"'    is not assignable to type 'EventName'.
    ```
  - GREEN commit (`c2a89c3`) extends the union; `npm run typecheck` exits 0; `npm run test:unit -- src/lib/analytics.test.ts` reports **7 passed (7)**.
- **No call sites wired** — that is intentionally deferred to 02-04 (Step 0 disclaimer modal) and 02-05 (dashboard fallback). This plan ships the taxonomy only.
- `track()`, `initAnalytics()`, `isEnabled()`, `getOrCreateDistinctId()` are untouched; the generic `track<E extends EventName>` accepts the new members automatically.

### Task 3 — `.env.example` Phase 2 build-time env-var matrix (commit `13d743f`)

`.env.example` exists from Phase 1; this commit appends two new sections **without modifying the Phase 1 entries**. Final file (verbatim):

```dotenv
# LeanShot environment variables — Vite injects all VITE_-prefixed vars at build time.
# Copy to .env.local for local dev (.env.local is gitignored).
# In production: set these in your hosting provider's env config.

# =============================================================================
# Phase 1 — runtime telemetry (Sentry + PostHog)
# Source: 01-CONTEXT.md D-09 (Sentry redaction), D-13 (PostHog cookieless),
#         D-15 (dormant until prod)
# =============================================================================

# Sentry — error tracking (PROD-02). Leave empty in dev to silence Sentry init (no-op).
VITE_SENTRY_DSN=

# PostHog — cookieless product analytics (PROD-03)
VITE_POSTHOG_KEY=
VITE_POSTHOG_HOST=https://us.i.posthog.com

# PRODUCTION: leave VITE_ANALYTICS_ENABLED=false until Phase 7 legal-counsel sign-off
# (WMHMDA / FTC HBNR review per Pitfall 5). Setting to 'true' in production starts
# the WMHMDA compliance clock.
# In dev/QA, set to 'true' so the founder can verify the PostHog dashboard wiring.
VITE_ANALYTICS_ENABLED=false

# =============================================================================
# Phase 2 — build-time Sentry source-map upload (Vercel Production ONLY)
# Source: 02-CONTEXT.md D-20 (blocking upload), D-22 (Preview skips)
# These are READ AT BUILD TIME by @sentry/vite-plugin. NEVER prefix with VITE_ —
# build-time secrets must not be exposed to the browser bundle.
# Set only in Vercel "Production" env. Preview + Development leave unset.
# =============================================================================

# Sentry org auth token with `project:releases` + `project:read` + `org:read` scopes.
# See: https://docs.sentry.io/account/auth-tokens/
SENTRY_AUTH_TOKEN=

# Sentry org slug (the URL fragment, e.g. 'leanshot').
SENTRY_ORG=

# Sentry project slug (e.g. 'javascript-react').
SENTRY_PROJECT=

# =============================================================================
# Phase 2 — Vercel-injected (DO NOT SET MANUALLY; provided automatically by Vercel)
# =============================================================================
# VERCEL_GIT_COMMIT_SHA — used as the Sentry release tag (D-21). Vercel auto-populates.
```

- All **7 env vars** declared (4 Phase 1 + 3 Phase 2) plus the documented Vercel-injected `VERCEL_GIT_COMMIT_SHA`.
- `git check-ignore .env.example` returns empty → file is NOT gitignored (as intended; only `.env` and `.env.local` are gitignored per Phase 1).
- Build-time tokens explicitly **not** prefixed with `VITE_` — Vite would inline them into the browser bundle, leaking the auth token. Comment in the file calls this out.

## Verification (post-execution, all PASS)

| Check                                                                             | Result      |
| --------------------------------------------------------------------------------- | ----------- |
| `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`      | OK          |
| `grep -c "compliance-copy:" .github/workflows/ci.yml`                             | 1           |
| Pre-check denylist grep over `leanshot/src/`                                      | exit 1 (no matches) |
| `npm run typecheck` (`tsc -b --noEmit`)                                           | exit 0      |
| `npm run test:unit -- src/lib/analytics.test.ts`                                  | 7 passed (7) |
| `grep -c "disclaimer_" leanshot/src/lib/analytics.ts`                             | 2           |
| `test -f leanshot/.env.example && grep -c "SENTRY_AUTH_TOKEN" leanshot/.env.example` | 1        |

## Deviations from Plan

**One process deviation, no scope deviation.**

- **Tooling friction during pre-check:** the worktree had no `node_modules/`, so the first attempt at `npx vitest run src/lib/analytics.test.ts` failed with `ERR_MODULE_NOT_FOUND` for `vitest` itself. Resolved by running `npm ci --prefer-offline` once (~5s, 501 packages). Not a plan defect — worktrees are ephemeral checkouts and don't carry installed deps.
- **Path-safety incident, self-corrected:** the plan's `<files>` field listed the absolute path `/Users/karstenhaldan/minisite/.github/workflows/ci.yml` (the main repo). The first Edit landed there. Per the worktree absolute-path safety rule (#3099), I reverted the main-repo edit (`git checkout` in the main repo) and re-applied the change to the worktree's own `.github/workflows/ci.yml`. The worktree's ci.yml is identical-content to main's pre-edit, so the re-application produced the intended diff with no content drift. This is not flagged as a Rule 1/2/3 deviation — it's a path-disambiguation correction caught and remediated before commit.

No Rules-1/2/3 deviations triggered. No checkpoints hit. No auth gates encountered.

## Known Stubs

None. All three tasks ship fully wired artifacts:

- `compliance-copy` job is the gate itself — no stubbed values.
- `EventName` union members are real; their `track()` call sites land in 02-04/02-05 (intentional, plan-scoped split, not a stub).
- `.env.example` values are intentionally blank (this is the documented contract for `.env.example` files); real values are provisioned in Vercel env config per phase plan.

## Threat Flags

None. This plan adds:

- a CI grep gate (defensive; reduces threat surface for SC#5 / CMIA AB 2089),
- two string literals to a TypeScript union (no runtime surface),
- documentation entries in `.env.example` (no executable code, no secrets).

No new network endpoints, auth paths, file-access patterns, or schema changes at trust boundaries.

## Commits

| # | Hash      | Type     | Subject                                                                    |
| - | --------- | -------- | -------------------------------------------------------------------------- |
| 1 | `c8ba66d` | ci       | add compliance-copy grep job for CMIA AB 2089 denylist                     |
| 2 | `e438de4` | test     | add failing compile-time assertions for disclaimer events (RED)            |
| 3 | `c2a89c3` | feat     | extend EventName union with disclaimer events (GREEN)                      |
| 4 | `13d743f` | docs     | document Phase 2 build-time env-var matrix in .env.example                 |

## TDD Gate Compliance

Plan is `type: execute`, not `type: tdd`, but Task 2 carries `tdd="true"`. RED → GREEN gate sequence is present in the git log:

- RED gate: `e438de4` (`test(02-03): add failing compile-time assertions for disclaimer events`)
- GREEN gate: `c2a89c3` (`feat(02-03): extend EventName union with disclaimer events`) — immediately follows RED
- REFACTOR: not needed; the union extension is two literal additions with no cleanup opportunity.

## Self-Check: PASSED

Files claimed to be created/modified — all confirmed on disk:

- FOUND: `.github/workflows/ci.yml` (worktree copy, modified)
- FOUND: `leanshot/src/lib/analytics.ts` (modified)
- FOUND: `leanshot/src/lib/analytics.test.ts` (modified)
- FOUND: `leanshot/.env.example` (modified)
- FOUND: `leanshot/.planning/phases/02-visible-compliance-public-deploy/02-03-SUMMARY.md` (this file)

Commit hashes claimed — all confirmed via `git log`:

- FOUND: `c8ba66d` (ci compliance-copy)
- FOUND: `e438de4` (test RED)
- FOUND: `c2a89c3` (feat GREEN)
- FOUND: `13d743f` (docs .env.example)
