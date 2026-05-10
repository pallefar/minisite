---
phase: 1
plan: 6
subsystem: testing-ci
tags: [playwright, github-actions, e2e, ci-pipeline, chromium, walking-skeleton]
dependency_graph:
  requires: [01-05]
  provides: [playwright-config, e2e-smoke, ci-pipeline]
  affects: [playwright.config.ts, e2e/onboarding.spec.ts, .github/workflows/ci.yml, .gitignore, package.json]
tech_stack:
  added:
    - "@playwright/test@1.59.1"
  patterns:
    - "Chromium-only Playwright (D-06; cross-browser deferred to Phase 2)"
    - "webServer reuse: CI uses npm run preview (port 4173), local reuses npm run dev (port 5173)"
    - "getByRole/getByLabel/getByText accessible locators (PATTERNS.md; CSS-class-free)"
    - "5-job GitHub Actions CI (lint, format-check, typecheck, test-unit, test-e2e)"
    - "T-1-05 defense: grep-based production-bundle security check for dev-only Sentry trigger"
key_files:
  created:
    - playwright.config.ts
    - e2e/onboarding.spec.ts
    - .github/workflows/ci.yml
  modified:
    - .gitignore
    - package.json
    - package-lock.json
decisions:
  - "Playwright Chromium-only per D-06; retries:1 on CI, 0 locally"
  - "CI webServer in playwright.config.ts switches to npm run preview when CI=true; this means CI runs e2e against the production build, not dev server"
  - "ci.yml uses defaults.run.working-directory: leanshot so all run steps target the project subdir even though the workflow file is at repo root"
  - "No Playwright browser caching per RESEARCH.md rationale (restore time ≈ download time)"
  - "T-1-04: Phase 1 CI injects no secrets; fork-PR guard documented as forward constraint for Phase 2"
metrics:
  duration: "~12 minutes (install + test run)"
  completed: "2026-05-10"
  tasks_completed: 2
  files_created: 3
  files_modified: 3
---

# Phase 1 Plan 6: Playwright + CI Pipeline Summary

Playwright config + full onboarding e2e smoke test + 5-job GitHub Actions CI pipeline. Walking Skeleton gates S-06 (local e2e) and S-10 (production-build security) are auto-verified. S-07 (CI green on PR), S-08 (Sentry receives test error), and S-09 (PostHog receives tab_viewed) await human verification.

## What Was Built

### Task 1: Playwright config + e2e smoke (S-06)

**`playwright.config.ts`** — Chromium-only (D-06), 30s timeout, retries:1 on CI/0 locally, sequential workers in CI, dev/preview server auto-switching via `process.env.CI`.

**`e2e/onboarding.spec.ts`** — Full 7-step onboarding happy path (57 lines, well above the 30-line minimum):
1. Navigate to `/` (marketing)
2. Click "Get started" nav button
3. Step 1: Fill "Your name" (`Alex`), continue
4. Step 2: Select `ozempic`, fill dose `0.5`, continue
5. Step 3: Fill weight `90`, height `175`, age `35`, continue
6. Step 4: Fill target weight `75`, continue (Fat loss default active)
7. Step 5: Select injection day Monday, continue (Light activity default)
8. Step 6: Snapshot review — assert `Alex` visible, continue
9. Step 7: Assert "all set" heading, click "Open dashboard"
10. Assert `Good {morning|afternoon|evening}` text visible (GreetingStrip)

**Selector strategy adjustment (documented deviation):** The plan template used `getByRole('heading', { name: /good (morning|afternoon|evening)/i })` for the final assertion, but GreetingStrip renders the greeting in a `<p>` tag (not an h1/h2/h3). Adjusted to `getByText(/good (morning|afternoon|evening)/i)` which matches the actual DOM — still an accessible, CSS-class-free locator per PATTERNS.md. All other selectors matched exactly as planned.

### Task 2: CI pipeline + production-build security check (S-07 setup, S-10)

**`.github/workflows/ci.yml`** — 5 jobs at repo root with `defaults.run.working-directory: leanshot`:
- `lint` — `npm run lint`
- `format-check` — `npm run format:check`
- `typecheck` — `npm run typecheck`
- `test-unit` — `npm run test:unit`
- `test-e2e` — build (empty env) → security grep → `npm run test:e2e`

Key CI design decisions:
- Node 22 LTS (matches dev machine v22.18.0)
- `concurrency.cancel-in-progress: true` (prevents racing CI runs)
- `cache-dependency-path: leanshot/package-lock.json` (correct path for subdir layout)
- `VITE_SENTRY_DSN: ''` + `VITE_ANALYTICS_ENABLED: 'false'` on the production build step
- Security grep: `grep -r "phase-1-sentry-smoke" dist/` blocks any PR that leaks the dev-only trigger string into the production bundle (T-1-05 defense-in-depth)
- Playwright artifact upload on failure (7-day retention for diagnosis)

## Versions Installed

| Package | Version |
|---------|---------|
| @playwright/test | 1.59.1 |
| Playwright Chromium binary | 147.0.7727.15 (chromium-headless-shell v1217) |

## Walking Skeleton Gate Status

| Gate | Status | Verified by |
|------|--------|-------------|
| S-06 | PASSED | `npm run test:e2e` exits 0 (1 test, 1 worker, 3.3s) |
| S-07 | AWAITING | Human must push branch, open PR, confirm 5 GitHub Actions jobs green |
| S-08 | AWAITING | Human must click Sentry smoke button in Settings → Dev Tools |
| S-09 | AWAITING | Human must configure PostHog + observe tab_viewed events |
| S-10 | PASSED | `VITE_SENTRY_DSN= VITE_ANALYTICS_ENABLED=false npm run build` exits 0; `grep -r "phase-1-sentry-smoke" dist/` returns no matches |

## Local Gate Verification

All pre-existing gates pass after this plan's changes:

```
npm run typecheck   → exit 0 (0 errors)
npm run lint        → exit 0 (4 warnings, 0 errors — pre-existing BaseChart + ShareCardModal + GuidedTour)
npm run format:check → exit 0 (all files Prettier-clean)
npm run test:unit   → exit 0 (7 test files, 63 tests)
npm run test:e2e    → exit 0 (1 test, chromium, 3.3s)
```

## Deviations from Plan

### Auto-fixed Issues

**[Rule 1 - Selector Adjustment] GreetingStrip heading assertion**
- **Found during:** Task 1, writing the final dashboard assertion
- **Issue:** Plan template used `getByRole('heading', { name: /good (morning|afternoon|evening)/i })` but GreetingStrip renders `Good {part},` in a `<p>` tag, not an h1-h6. The `heading` role would never match.
- **Fix:** Changed to `page.getByText(/good (morning|afternoon|evening)/i)` which correctly matches the rendered `<p>Good morning,</p>` text. Still an accessible, CSS-class-free locator consistent with PATTERNS.md.
- **Files modified:** `e2e/onboarding.spec.ts` (line 55)
- **Test result:** Test passes locally in 3.3s.

**[Rule 2 - CI path fix] cache-dependency-path for npm cache in subdir layout**
- **Found during:** Task 2, writing the CI workflow
- **Issue:** `actions/setup-node@v4` with `cache: 'npm'` defaults to finding `package-lock.json` at the repo root. Since the project lives in `leanshot/`, the lockfile is at `leanshot/package-lock.json`. Without `cache-dependency-path`, the npm cache key would be computed from the wrong path (or fail).
- **Fix:** Added `cache-dependency-path: leanshot/package-lock.json` to every `actions/setup-node@v4` step.
- **Files modified:** `.github/workflows/ci.yml`

## Known Stubs

None — this plan adds infrastructure only (config, spec, workflow). No UI stubs introduced.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: fork-pr-secret-exposure | .github/workflows/ci.yml | Phase 1 CI has no `${{ secrets.* }}` references so T-1-04 has no current exposure. Forward constraint: Phase 2 must add `if: github.event.pull_request.head.repo.full_name == github.repository` before any secrets injection step. Documented in ci.yml comments. |

## Notes for Human Checkpoint

### S-07 — CI green on a trivial PR
Push a branch containing these changes, open a PR against `main`, watch GitHub Actions. All 5 jobs must go green. Optionally configure "Require status checks to pass" branch protection with all 5 jobs as required checks.

### S-08 — Sentry receives test error with redacted fields
The "Throw test error → Sentry" button is in **Settings → Dev Tools** (visible only in development mode — `import.meta.env.DEV` guard from Plan 05). Steps:
1. Set `VITE_SENTRY_DSN=<your-dsn>` in `leanshot/.env.local`
2. Run `npm run dev` from `leanshot/`
3. Open the app → click the gear/settings icon → scroll to **Dev Tools** section → click "Throw test error → Sentry"
4. Check Sentry dashboard within 60s for `phase-1-sentry-smoke` event

### S-09 — PostHog receives tab_viewed with no health content
Note: Plan 05 wired the `track()` helper and `analytics.ts` module, but **no caller yet invokes `track('tab_viewed', ...)`**. If PostHog shows zero `tab_viewed` events during S-09 verification, that is the expected gap — the helper exists but needs a call site in `App.tsx`/`store.ts` on tab switch. This is the known deferred item from the Plan 05 design. Surface as a Wave 4 micro-plan if needed.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| playwright.config.ts exists | FOUND |
| e2e/onboarding.spec.ts exists | FOUND |
| .github/workflows/ci.yml exists | FOUND |
| 01-06-SUMMARY.md exists | FOUND |
| Commit 93f9854 (Task 1) | FOUND |
| Commit 9d87fb6 (Task 2) | FOUND |
