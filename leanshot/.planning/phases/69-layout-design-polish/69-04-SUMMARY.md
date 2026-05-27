---
phase: 69-layout-design-polish
plan: 4
subsystem: testing/visual-regression
tags: [playwright, vr, snapshots, v1.4, layout-polish]
requires:
  - leanshot/e2e/visual/helpers/seed.ts (Phase 13 — seedUnauth/seedOnboarded/seedThemeDark/waitForReady)
  - leanshot/src/App.tsx (route matchers for 7 v1.4 surfaces)
  - @playwright/test ^1.59.1 (pre-existing devDep)
provides:
  - leanshot/playwright.config.vr.ts (standalone VR config — does NOT merge into playwright.config.ts)
  - leanshot/tests/vr/v1.4/baseline.spec.ts (28-snapshot regression suite)
  - leanshot/tests/vr/v1.4/README.md (operator runbook)
affects: []
tech-stack:
  added: []
  patterns:
    - Reuse `e2e/visual/helpers/seed.ts` instead of `emulateMedia({colorScheme})` — the app drives theme from `localStorage` pre-paint (`src/main.tsx`), so OS color-scheme is ignored.
    - 2 viewport projects × 2 theme variants (in-spec) = 4 variants per surface. Snapshot filename composes `<slug>-<theme>-<project>.png`.
    - Separate `playwright.config.vr.ts` to isolate VR runs from the existing `e2e/` + `e2e/visual/` suites (no shared testDir).
key-files:
  created:
    - leanshot/playwright.config.vr.ts
    - leanshot/tests/vr/v1.4/baseline.spec.ts
    - leanshot/tests/vr/v1.4/README.md
  modified: []
decisions:
  - "Used seed-helper pattern (data-theme via localStorage) instead of plan's `emulateMedia({colorScheme: 'dark'})` because the app applies theme pre-paint from `localStorage['leanshot_theme_v4']` and IGNORES OS color-scheme. The plan's approach would have produced light-themed snapshots in the dark variant."
  - "Did NOT add @playwright/test or run npm install — pre-existing devDep ^1.59.1 already satisfies. Operator setup (`npx playwright install chromium`) documented in README."
  - "Did NOT commit any PNG baselines — operator captures against staging via `--update-snapshots` (per plan + known_lesson #4). README documents 3 baseline-commit policy options (raw / LFS / external bucket) for operator selection."
  - "Auth-gated surfaces seeded with `seedOnboarded()` to bypass marketing bounce. Real admin JWT + role grant is NOT in scope — deferred to Phase 70 per plan known_lessons. Empty/error states ARE the documented baseline."
metrics:
  duration_minutes: 3
  completed_date: 2026-05-27
  tasks_completed: 1
  files_created: 3
  files_modified: 0
---

# Phase 69 Plan 69-04: Playwright VR Snapshot Suite (v1.4) Summary

**One-liner:** 28-snapshot Playwright VR suite (7 v1.4 surfaces × light/dark × desktop-1280/mobile-375) shipped behind a standalone `playwright.config.vr.ts` for operator-driven staging-deploy regression detection.

## What Shipped

**`leanshot/playwright.config.vr.ts`** — Standalone Playwright config scoped to `tests/vr/v1.4/`:
- Projects: `chromium-desktop` (1280×720) + `chromium-mobile` (375×667 via Pixel 5 device).
- Snapshot config: `maxDiffPixelRatio: 0.005` (0.5%), `animations: 'disabled'`, `caret: 'hide'`, `scale: 'css'`.
- `snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}-{arg}{ext}'` — mirrors existing `playwright.config.ts:420` convention.
- `baseURL` from `PLAYWRIGHT_BASE_URL` env (defaults to `http://localhost:5173`).
- `reducedMotion: 'reduce'`, `trace: 'retain-on-failure'`, no `webServer` (operator targets staging).

**`leanshot/tests/vr/v1.4/baseline.spec.ts`** — 14 tests (7 routes × 2 themes), runs against both projects → 28 snapshots total:

| Phase | Route                       | Auth-gated |
| ----- | --------------------------- | ---------- |
| 66    | `/settings/security`        | Yes        |
| 66    | `/admin/users/security`     | Yes        |
| 68    | `/for-doctors`              | No         |
| 68    | `/for-clinics`              | No         |
| 68    | `/for-coaches`              | No         |
| 65    | `/admin/tax`                | Yes        |
| 65    | `/settings/billing/refund`  | Yes        |

Each test:
1. Seeds Zustand store (`seedUnauth` for public / `seedOnboarded` for auth-gated).
2. Seeds dark theme via `seedThemeDark` AFTER the auth seeder (theme key is part of the auth blob; must override last).
3. Navigates, awaits `waitForReady` + tolerant `networkidle` (8s, swallowed — empty state is the documented baseline).
4. `expect(page).toHaveScreenshot('<slug>-<theme>.png', { fullPage: true })`.

**`leanshot/tests/vr/v1.4/README.md`** — Operator-facing runbook covering:
- One-time setup (`npm install` + `playwright install chromium`, with the `@sentry/capacitor --ignore-scripts` workaround documented per `reference_sentry_capacitor_npm_install_blocker`).
- Initial baseline-capture command (`PLAYWRIGHT_BASE_URL=https://staging.leanshot.app … --update-snapshots`).
- Regression-run command (no `--update-snapshots`).
- Local-dev mode (defaults to `:5173`).
- Baseline-commit policy: 3 options (raw / LFS / external bucket) for operator choice — defaults to none-committed-in-this-plan.
- CI integration sketch (deferred — not wired in Phase 69).
- 6-row troubleshooting matrix.
- Documents auth limitation (admin role + JWT deferred to Phase 70).

## Route Verification

All 7 v1.4 surfaces grep-confirmed against `src/App.tsx` route matchers on main before the spec was authored:

- `/for-doctors`, `/for-clinics`, `/for-coaches` — `src/App.tsx:794-796` (`pathname.startsWith(...)`).
- `/settings/security` — `src/App.tsx:902-903` (`pathname === ... || pathname === '.../'`).
- `/admin/users/security`, `/admin/tax` — auto-resolved via `src/lib/admin/modules.ts` manifest (`modules.ts:364, 641`).
- `/settings/billing/refund` — handled via the Phase 65 settings sub-router (verified via grep of `src/App.tsx` lines mentioning `/settings/billing`).

No missing routes. No routes excluded from the spec.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Replaced `emulateMedia({ colorScheme })` with the `seedThemeDark` helper**
- **Found during:** Task 1 implementation, after reading `e2e/visual/helpers/seed.ts` + `src/main.tsx` + `CLAUDE.md`.
- **Issue:** Plan specified `page.emulateMedia({ colorScheme: 'dark' })` to drive the dark variant. The LeanShot SPA applies `data-theme` to `<html>` BEFORE React mounts, reading from `localStorage['leanshot_theme_v4']` (`src/main.tsx`). OS color-scheme is never consulted — `emulateMedia` would have produced light-themed snapshots in the dark-variant slot, defeating the entire dark-mode VR objective.
- **Fix:** Used the existing `seedThemeDark()` helper from `e2e/visual/helpers/seed.ts` (Phase 13 hardened pattern per `reference_playwright_state_seeding.md` — `addInitScript` only, no goto+evaluate+reload race).
- **Files modified:** `leanshot/tests/vr/v1.4/baseline.spec.ts`.
- **Commit:** `570e3748`.

**2. [Rule 2 — Missing critical functionality] Documented + handled auth-gated surfaces via existing seeder**
- **Found during:** Task 1 implementation.
- **Issue:** Plan said "admin/settings surfaces need a fixture auth flow (TBD — stub via test.beforeEach session storage hydration; defer real auth to Phase 70)" but did not specify HOW to bypass the marketing bounce for auth-gated routes in this pass. Without seeding, the spec would have captured the marketing landing for ALL auth-gated surfaces — a useless baseline.
- **Fix:** Reused `seedOnboarded()` from `e2e/visual/helpers/seed.ts` to install a hydrated Zustand `user` object pre-paint. Auth-gated routes now render their first paint (possibly empty / error state when Supabase data is unavailable), which IS the documented baseline. Real admin JWT + role grant remains deferred to Phase 70.
- **Files modified:** `leanshot/tests/vr/v1.4/baseline.spec.ts`, `leanshot/tests/vr/v1.4/README.md` ("Auth limitation" section).
- **Commit:** `570e3748`.

### Scope additions (none)

No out-of-scope work performed.

### Scope deferrals (none)

All 3 declared `files_modified` in the plan were created. No tasks deferred.

## Operator Preflight Notes

These belong in the Phase 69 close-out / operator runbook, NOT a deferred task in this plan:

1. **`npm install` blocker:** Worktree had no `node_modules` (gitignored). Operator must run `npm install` from `leanshot/` (potentially with `--ignore-scripts` per `reference_sentry_capacitor_npm_install_blocker`) before the first VR pass. Documented in README "One-time setup".
2. **Chromium binary download:** `npx playwright install chromium` is required once per machine (~140 MB).
3. **Staging URL:** `PLAYWRIGHT_BASE_URL` must point at a deployed-and-stable staging build. Capturing baselines against a half-shipped staging produces baselines that lock in mid-deploy state.
4. **Baseline-commit policy:** Operator chooses LFS / raw / external bucket BEFORE the first `--update-snapshots` commit. 28 snapshots × ~500 KB average = ~14 MB per baseline pass; recurring captures will balloon the repo if not LFS'd.

## Self-Check: PASSED

**Files exist:**
- FOUND: `leanshot/playwright.config.vr.ts`
- FOUND: `leanshot/tests/vr/v1.4/baseline.spec.ts`
- FOUND: `leanshot/tests/vr/v1.4/README.md`

**Commit exists:**
- FOUND: `570e3748` — `feat(69-04): Playwright VR snapshot suite for v1.4 surfaces`

**Success criteria from prompt:**
- [x] `leanshot/tests/vr/v1.4/baseline.spec.ts` with test cases for each v1.4 route × 4 variants (14 tests × 2 projects = 28 snapshots).
- [x] `leanshot/playwright.config.vr.ts` (separate from main playwright config).
- [x] `leanshot/tests/vr/v1.4/README.md` with operator-run instructions + baseline-capture procedure.
- [x] Routes confirmed against `src/App.tsx`; no missing routes — none to document as missing.
- [ ] SUMMARY.md committed — pending final metadata commit (this file).
