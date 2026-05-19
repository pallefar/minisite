# Phase 42 Deferred Items

## Pre-existing admin-shell bundle overage (out-of-scope for 42-04)

**Discovered during:** Plan 42-04 Task 1 bundle-budget check after VitePWA wiring.

**Issue:** `npm run check-bundle-budget` reports `admin-shell` chunk at 105.50 kB gz, ceiling 45 kB (OVER by 60.50 kB). Pre-existing on `main` before this plan's changes — verified by `git stash` → check → `git stash pop`.

**Why deferred:** Outside Plan 42-04's scope (POLISH-07 / PWA). The overage stems from the Phase 15 page-builder editor + Phase 24 AdminShell merged into one chunk; D-18 / Plan 24 owns the remediation track. Plan 42-04 only added PWA glue, which sits outside admin-shell (index ceiling stays at 21.06 kB gz, well under the 50 kB cap that Pitfall 9 protects).

**Owner:** Phase 24 admin-shell ceiling-track (or a dedicated debt-burn plan in a future polish phase).

---

## Plan 42-03 Task 3 — Playwright VR snapshots (12 baselines) deferred

**Discovered during:** Plan 42-03 inline scoping 2026-05-19.

**Issue:** Plan 42-03 Task 3 enumerates Playwright VR snapshots for 6 v1.3 surfaces × 2 themes = 12 baselines. Three of the six routes don't exist on `main` yet:
- `/helpdesk` — owned by Phase 37 (NOT executed; plan halted in earlier background dispatch)
- `/community/feed` — owned by Phase 44 (NOT discussed)
- `/courses/getting-started` — owned by Phase 46 (NOT discussed)

Task 3 would fail at navigate on those 3 routes. Additionally, Playwright MCP `browser_evaluate` was operator-rejected earlier this session.

**Why deferred:** No way to capture 12 baselines today. Operator chose Tasks 1+2 only (Tailwind pin + dark-mode tokens for all 6 surfaces) and explicit VR follow-up after the missing surfaces ship.

**What landed instead:** Tokens for the 3 deferred surfaces are scaffolded NOW in both `@theme` and `[data-theme='dark']` blocks per [[scaffolding-for-deferred-mobile-pattern]]. M4 phases (44 community, 46 courses) and Phase 37 (helpdesk) consume the tokens by name when they ship — they don't redefine the dark-mode contract.

**Owner:** A follow-up plan (`42-03-VR-ADDENDUM` or a polish phase in v1.4) once Phase 37 + Phase 44 + Phase 46 routes are reachable. The plan body in `42-03-PLAN.md` Task 3 captures the exact snapshot-generation recipe; addendum just runs it.

**Status of 42-03 closure:** PARTIAL — 2/4 tasks shipped (Task 1 Tailwind pin commit `<task1>`, Task 2 dark-mode tokens commit `<task2>`). Task 3 + 4 deferred per above.


## Pre-existing TS error in QuarterlyNPSModal.tsx (out of 42-08 scope)

**Discovered during:** Plan 42-08 Task 1 typecheck (2026-05-19).

**Issue:** `src/components/nps/QuarterlyNPSModal.tsx:119` calls `track('nps_quarterly_responded', ...)` but `nps_quarterly_responded` is NOT declared in `src/lib/analytics/events.ts` EVENTS map. tsc fails:
```
error TS2345: Argument of type '"nps_quarterly_responded"' is not assignable to parameter of type ...
```

**Why deferred:** This error pre-dates 42-08 (verified via `git stash` round-trip — tsc fails on `main` HEAD `6d8c351` BEFORE any 42-08 changes). Owned by Phase 42 Plan 42-11 (Quarterly NPS — the plan that should declare these events) or by whichever plan introduced `QuarterlyNPSModal.tsx`. 42-08 is the notifications UI plan, NOT the NPS plan.

**Owner:** 42-11 plan-checker should catch this when it lands.
