# Phase 42 Deferred Items

## Pre-existing admin-shell bundle overage (out-of-scope for 42-04)

**Discovered during:** Plan 42-04 Task 1 bundle-budget check after VitePWA wiring.

**Issue:** `npm run check-bundle-budget` reports `admin-shell` chunk at 105.50 kB gz, ceiling 45 kB (OVER by 60.50 kB). Pre-existing on `main` before this plan's changes — verified by `git stash` → check → `git stash pop`.

**Why deferred:** Outside Plan 42-04's scope (POLISH-07 / PWA). The overage stems from the Phase 15 page-builder editor + Phase 24 AdminShell merged into one chunk; D-18 / Plan 24 owns the remediation track. Plan 42-04 only added PWA glue, which sits outside admin-shell (index ceiling stays at 21.06 kB gz, well under the 50 kB cap that Pitfall 9 protects).

**Owner:** Phase 24 admin-shell ceiling-track (or a dedicated debt-burn plan in a future polish phase).
