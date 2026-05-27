---
phase: 67-operational-runbooks-observability
plan: 3
subsystem: observability
tags: [sentry, ci-guard, edge-fn, cold-start, ops-04, ops-09]
requires:
  - .github/workflows/ (workflow runner)
  - supabase/functions/_shared/sentry.ts (real wrapper this gate protects)
provides:
  - .github/workflows/sentry-dsn-check.yml (push + PR gate)
  - scripts/ci/check-sentry-imports.ts (Deno classifier)
  - scripts/ci/check-sentry-imports.test.ts (8 Deno tests)
  - scripts/audit-cold-starts.ts (operator-run, NOT CI)
affects:
  - Edge Fn deploys (gate fires if a new Fn imports a Sentry stub)
tech-stack:
  added:
    - deno_std@0.224.0 (fs/walk, path) — already used elsewhere
  patterns:
    - dual-runtime CI (Deno-only job; mirrors deno-test job in ci.yml)
    - nearest-rank percentile (cold-start audit; favours conservative p95)
key-files:
  created:
    - .github/workflows/sentry-dsn-check.yml
    - scripts/ci/check-sentry-imports.ts
    - scripts/ci/check-sentry-imports.test.ts
    - scripts/audit-cold-starts.ts
  modified: []
decisions:
  - "Inline import classification (regex + body-marker heuristic) rather than full TypeScript AST parse — keeps the CI job free of npm deps and runs in <2s against 135 Fns."
  - "Allow-list via header comment '// SENTRY-DISABLED: <reason>' on the Fn's index.ts (per known_lessons #4). Reason is informational, surfaces in the CI log."
  - "Cold-start audit is operator-run NOT CI — 10×60s defaults take ~4hr full sweep; cold-start is a runtime property not gated by PR diff."
  - "Cold-start --threshold-ms default 1500ms per CONTEXT.md D-08 / OPS-09 spec."
metrics:
  duration_minutes: ~25
  tasks_completed: 2
  files_created: 4
  files_modified: 0
  tests_added: 8
  tests_green: 8
completed: 2026-05-27
---

# Phase 67 Plan 67-03: SENTRY_DSN Edge Fn CI guard + cold-start audit Summary

One-liner: Ship CI gate that fails when any Edge Fn imports a no-op `@sentry/*` shim, plus an operator-run script that samples cold-start p50/p95/p99 per Fn and renders a Markdown report.

## What Shipped

### Task 1 — OPS-04 SENTRY_DSN Edge Fn CI guard (commit 825a06d1)

- `.github/workflows/sentry-dsn-check.yml` — Deno v2.x job triggered on `push` + `pull_request` to `main`. Concurrency-grouped so duplicate pushes cancel. Working dir overridden to repo root (matches the `deno-test` pattern in `ci.yml`) because `supabase/functions/` is NOT under `leanshot/`.
- `scripts/ci/check-sentry-imports.ts` — pure-Deno classifier. Walks every immediate sub-dir under `supabase/functions/`, skipping `_shared`, `__tests__`, `tests`. For each Fn:
  1. If `index.ts` starts with `// SENTRY-DISABLED: <reason>` → allow-list, skip scan.
  2. Walk every `.ts` (depth ≤5, excluding `*.test.ts` + `__tests__/`).
  3. Find direct `@sentry/*` imports (trusted — upstream npm registry resolves to real SDKs).
  4. Find imports matching `_shared/sentry(?:\.ts)?` — resolve target on disk and run `classifyModuleSource()` against its text.
  5. A module is REAL if it imports `@sentry/{node,react,deno}` OR calls `Sentry.(init|captureException|captureMessage|addBreadcrumb)`. Otherwise it's a stub (covers `export default {}`, empty-body exports, arrow-fn no-ops, and the defensive case of "no Sentry markers anywhere").
- `scripts/ci/check-sentry-imports.test.ts` — 8 Deno tests against a tmp-dir fixture: real direct import, real wrapper, stub wrapper, allow-listed Fn, no-sentry Fn, plus 3 unit tests on `classifyModuleSource`. All green via `deno test --no-check --allow-read --allow-write --allow-env`.
- Verified against real repo: **135 Fns scanned, 14 verified real `_shared/sentry.ts` imports, 0 stubs, 0 allow-listed**. Includes `cancellation-{accept,decide}-offer`, `clinic-patient-invite`, `clinician-alert-deliver-cron`, `embed-content-nightly`, `helpdesk-ai-assist`, `org-metered-billing-cron`, `rag-{scrape-runner,summarize-and-chunk}`, `stripe-webhook`, `weekly-digest`, `winback-scorer`.

### Task 2 — OPS-09 cold-start audit (commit b1400d6c)

- `scripts/audit-cold-starts.ts` — operator-run Deno script.
  - Auto-discovers Fns: every dir under `supabase/functions/` with an `index.ts` (excludes `_shared`, `__tests__`, `tests`). Overridable via `--fns a,b,c`.
  - Per Fn: hits `https://<project-ref>.supabase.co/functions/v1/<fn>/healthz` `samples` times with `wait` seconds between, drains body each time, counts non-{2xx,401} as errors. (401 is acceptable for protected `/healthz` endpoints — still measures cold container init.)
  - Percentiles: nearest-rank (conservative — biases toward higher p95 vs interpolation).
  - Writes Markdown table to `leanshot/.planning/runbooks/edge-fn-cold-starts.md`, sorted descending by p95, with a SLOW flag for `p95 > threshold`.
  - `--help` documents every flag and explains why this is operator-run.
  - Defaults: `--project-ref ytnsipxxmzgaebkqmokp --samples 10 --wait 60 --threshold-ms 1500`. Estimated ~10min/Fn at defaults; the help text warns about ~4hr full sweep.
  - `deno check scripts/audit-cold-starts.ts` passes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Block] CONTEXT.md said "Node script", PLAN.md said "Deno or Node — pick whichever is closer to existing scripts dir convention".**
- **Found during:** Task 1 design.
- **Issue:** Existing `scripts/` mixes bash + Node mjs + tsx; only `supabase/functions/` standardises on Deno. The closest analog (deno-test job + `.deno-test.yml` workflow) is Deno.
- **Fix:** Picked Deno for both scripts — matches `npm:@sentry/node@8` runtime convention of the modules being audited, runs without `npm ci`, faster CI cold-start than Node-with-tsx.
- **Files modified:** `.github/workflows/sentry-dsn-check.yml`, `scripts/ci/check-sentry-imports.ts`, `scripts/audit-cold-starts.ts`
- **Commit:** 825a06d1, b1400d6c

**2. [Rule 2 - Missing critical] Plan said "stub = empty exports or `{}` const". Reality: the only existing wrapper (`supabase/functions/_shared/sentry.ts`) is genuine but uses `npm:@sentry/node@8` via Deno's npm specifier — neither a literal empty export nor `{}`.**
- **Found during:** Task 1 verification against real repo (would have false-failed CI on first run).
- **Issue:** A naive empty-export check would not catch a stub that exports an arrow-fn no-op (`export const captureException = () => {}`), and a strict empty-only check would still miss the defensive case where someone exports a string constant called `sentry`.
- **Fix:** Two-layer classifier — first check for REAL_BODY_MARKERS (matches `from 'npm:@sentry/'` / `from '@sentry/'` / `Sentry.captureException(...)` etc.). Only if NO marker is present do we look at stub patterns. Default to "stub" if neither set matches (forces every Sentry wrapper to make a real upstream call).
- **Files modified:** `scripts/ci/check-sentry-imports.ts`
- **Commit:** 825a06d1

**3. [Rule 2 - Missing critical] Plan code-sketch hard-coded a 10-Fn list; CONTEXT.md says "~25 Edge Fns".**
- **Found during:** Task 2 design.
- **Issue:** Hard-coded list silently misses any new Fn shipped in future phases.
- **Fix:** `discoverFns()` walks `supabase/functions/` dynamically; `--fns` overrides only when operator wants a subset. Real repo discovery: 135 Fn dirs with `index.ts` (broader than the 25 "production" Fns — includes dev/test/legacy paths the audit still benefits from sampling).
- **Files modified:** `scripts/audit-cold-starts.ts`
- **Commit:** b1400d6c

## Auth Gates

None — all work is local file authoring + Deno test runner. The cold-start audit script needs operator-supplied network access at run time (not commit time).

## Verification

| Check | Command | Result |
| --- | --- | --- |
| Sentry-import classifier tests | `$HOME/.deno/bin/deno test --no-check --allow-read --allow-write --allow-env scripts/ci/check-sentry-imports.test.ts` | 8 passed, 0 failed (14ms) |
| Sentry-import CLI live run | `$HOME/.deno/bin/deno run --no-check -A scripts/ci/check-sentry-imports.ts` | 135 Fns scanned, 14 real, 0 stubs, exit 0 |
| Cold-start --help | `$HOME/.deno/bin/deno run --no-check --allow-net --allow-read --allow-write --allow-env scripts/audit-cold-starts.ts --help` | usage text printed, exit 0 |
| Cold-start typecheck | `$HOME/.deno/bin/deno check scripts/audit-cold-starts.ts` | clean |

## Known Stubs

None. Both scripts ship with full implementations; no placeholder code paths.

## Threat Flags

None — the CI gate REDUCES surface (catches no-op Sentry shims that would silently swallow Edge Fn errors). The cold-start audit only reads `/healthz` (already public health-check endpoints).

## Files

- `.github/workflows/sentry-dsn-check.yml`
- `scripts/ci/check-sentry-imports.ts`
- `scripts/ci/check-sentry-imports.test.ts`
- `scripts/audit-cold-starts.ts`

## Commits

- 825a06d1 — feat(67-03): OPS-04 SENTRY_DSN Edge Fn CI guard
- b1400d6c — feat(67-03): OPS-09 cold-start audit script (operator-run)

## Self-Check

| Claim | Status |
| --- | --- |
| `.github/workflows/sentry-dsn-check.yml` exists | FOUND |
| `scripts/ci/check-sentry-imports.ts` exists | FOUND |
| `scripts/ci/check-sentry-imports.test.ts` exists | FOUND |
| `scripts/audit-cold-starts.ts` exists | FOUND |
| Commit 825a06d1 in log | FOUND |
| Commit b1400d6c in log | FOUND |

## Self-Check: PASSED
