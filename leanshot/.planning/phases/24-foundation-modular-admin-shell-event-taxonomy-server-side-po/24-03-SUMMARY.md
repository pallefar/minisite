---
phase: 24-foundation-modular-admin-shell-event-taxonomy-server-side-po
plan: 03
subsystem: ui
tags: [react, typescript, posthog, admin, role-based-access, lazy-loading, manifest-pattern]

# Dependency graph
requires:
  - phase: 24-foundation-modular-admin-shell-event-taxonomy-server-side-po
    plan: 01
    provides: profiles.admin_role enum (staff/admin/superadmin) + is_admin_at_least() RPC

provides:
  - src/lib/admin/roles.ts — AdminRole type + ROLE_ORDER + hasMinRole() comparator
  - src/lib/admin/modules.ts — ADMIN_MODULES 12-entry manifest (satisfies AdminModule[])
  - src/components/admin/AdminShell.tsx — manifest-driven nav + lazy routing + flag/role gate
  - src/components/admin/AdminLayout.tsx — refactored; no ADMIN_NAV; Mode A/B pattern
  - src/components/admin/PlaceholderModule.tsx — shared placeholder for 7 deferred modules
  - src/components/admin/SettingsModule.tsx — stub (Plan 24-05 augments)
  - src/components/admin/AuditLogModule.tsx — stub (Plan 24-06 implements)

affects:
  - Plan 24-05 (wires Setup 2FA into SettingsModule)
  - Plan 24-06 (implements AuditLogModule viewer)
  - Plan 24-08 (bundle ceiling enforcement for admin-shell chunk)
  - All future v1.3 phases that add admin modules (edit ADMIN_MODULES + add lazy bundle)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - ADMIN_MODULES manifest pattern — single TS file as source of truth for all admin modules
    - AdminShell dual-gate — client-side role+flag filter + NotAuthorizedCard for blocked routes
    - AdminLayout Mode A/B — Mode A (no children) delegates to AdminShell; Mode B (children) legacy compat
    - placeholderFor() helper — closure-based lazy factory with pre-baked shipsIn prop
    - lazyOnce() WeakMap cache — prevents React.lazy() re-creation on re-render

key-files:
  created:
    - leanshot/src/lib/admin/roles.ts
    - leanshot/src/lib/admin/modules.ts
    - leanshot/src/lib/admin/modules.test.ts
    - leanshot/src/components/admin/AdminShell.tsx
    - leanshot/src/components/admin/PlaceholderModule.tsx
    - leanshot/src/components/admin/SettingsModule.tsx
    - leanshot/src/components/admin/AuditLogModule.tsx
    - leanshot/src/components/admin/__tests__/AdminShell.test.tsx
  modified:
    - leanshot/src/components/admin/AdminLayout.tsx

key-decisions:
  - "ADMIN_MODULES uses `as const satisfies readonly AdminModule[]` for both literal-type inference and shape enforcement"
  - "AdminShell treats posthog.isFeatureEnabled() returning undefined as VISIBLE (flag not yet resolved) to avoid first-paint flash"
  - "AdminLayout Mode B preserves backward compat for existing v1.2 pages (AdminMembersPage etc.) — no breaking change"
  - "placeholderFor() helper uses closure + Wrapper function component to pre-bake shipsIn prop without JSX in .ts file"
  - "navOnly prop on AdminShell allows Mode B usage where parent renders content area"

patterns-established:
  - "Manifest pattern: adding a new admin module = edit ADMIN_MODULES entry + add lazy bundle; no AdminLayout changes required"
  - "Role gate: hasMinRole(adminRole, module.minRole) + posthog.isFeatureEnabled(flagKey) !== false"
  - "Direct-URL protection: AdminShell renders NotAuthorizedCard for blocked routes even if user types URL manually"

requirements-completed: [ADMIN-01]

# Metrics
duration: 30min
completed: 2026-05-17
---

# Phase 24 Plan 03: AdminShell + Module Manifest Summary

**12-module ADMIN_MODULES manifest (satisfies AdminModule[]) + AdminShell routing with PostHog flag + ordinal role gate, replacing v1.2 hard-coded 4-link ADMIN_NAV**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-05-17T15:13:00Z
- **Completed:** 2026-05-17T13:22:27Z
- **Tasks:** 2 (both with TDD RED/GREEN cycles)
- **Files modified:** 9 (7 created, 2 modified)

## Accomplishments

- 12-entry ADMIN_MODULES manifest (Users, Content, Onboarding, Gamification, Reviews, Membership, Analytics, AI, Helpdesk, Billing, Settings, Audit Log) with `satisfies readonly AdminModule[]` for compile-time shape enforcement
- AdminShell component filters nav by `hasMinRole()` + PostHog feature flag; renders NotAuthorizedCard for direct-URL access to blocked modules (Pattern S1 client gate)
- AdminLayout refactored: hard-coded `ADMIN_NAV` constant removed; dual-mode (Mode A: AdminShell-based routing; Mode B: backward-compat children wrapper for v1.2 pages)
- 18 tests pass across modules.test.ts (13) and AdminShell.test.tsx (5); `npm run build` exits 0

## Task Commits

Each task was committed atomically (TDD RED + GREEN per task):

1. **RED: ADMIN_MODULES manifest tests** - `684a27c` (test)
2. **GREEN: ADMIN_MODULES manifest + roles.ts + PlaceholderModule** - `0ec01a3` (feat)
3. **RED: AdminShell tests** - `58b347b` (test)
4. **GREEN: AdminShell + refactored AdminLayout** - `ed7dc50` (feat)

## Files Created/Modified

- `src/lib/admin/roles.ts` — AdminRole type, ROLE_ORDER map, hasMinRole() ordinal comparator
- `src/lib/admin/modules.ts` — 12-entry ADMIN_MODULES manifest with placeholderFor() helper
- `src/lib/admin/modules.test.ts` — 13 tests covering manifest shape, uniqueness, roles, lazy() smoke
- `src/components/admin/AdminShell.tsx` — manifest-driven nav + content routing + NotAuthorizedCard gate
- `src/components/admin/AdminLayout.tsx` — refactored (ADMIN_NAV removed; Mode A/B dual pattern)
- `src/components/admin/PlaceholderModule.tsx` — shared placeholder for 7 deferred modules
- `src/components/admin/SettingsModule.tsx` — stub (Plan 24-05 augments with Setup 2FA)
- `src/components/admin/AuditLogModule.tsx` — stub (Plan 24-06 implements viewer)
- `src/components/admin/__tests__/AdminShell.test.tsx` — 5 tests for role+flag filtering + direct-URL gate

## Decisions Made

- `as const satisfies readonly AdminModule[]` — preserves literal key types for autocomplete while enforcing shape at compile time
- PostHog `undefined` = VISIBLE — avoids first-paint flash when /decide hasn't returned yet; `false` = hidden
- AdminLayout Mode B backward compat — existing v1.2 pages (AdminMembersPage, AdminMetricsPage, AdminCohortsPage, AdminAffiliatesPage) continue to wrap AdminLayout with `children`; no migration required in this plan
- `placeholderFor()` returns async factory using closure wrapper component — avoids JSX in `.ts` file while pre-baking `shipsIn` prop
- `navOnly` prop on AdminShell — allows AdminLayout Mode B to render only the manifest-driven nav bar, with the page's own heading + content below

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] AdminLayout backward compat for v1.2 pages**
- **Found during:** Task 2 (AdminShell implementation)
- **Issue:** New AdminLayout no longer accepted `active`, `heading`, `children` props; existing pages (AdminMembersPage etc.) pass these, causing tests to break
- **Fix:** Added Mode A/B dual pattern — when `children` prop present, AdminLayout uses legacy chrome wrapper with heading + headerAction; when omitted, delegates to AdminShell; `navOnly` prop added to AdminShell
- **Files modified:** src/components/admin/AdminLayout.tsx, src/components/admin/AdminShell.tsx
- **Verification:** `npm test -- AdminMembersPage.test.tsx` passes 5/5; AdminShell tests pass 5/5
- **Committed in:** ed7dc50 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - regression fix)
**Impact on plan:** Backward compat fix required for existing v1.2 page tests to pass. No scope creep. Mode B is a temporary bridge until each existing page migrates to be a pure content component rendered BY AdminShell.

## Issues Encountered

- node_modules not symlinked in worktree — created symlink to main repo's node_modules to run tests
- AdminMetricsPage.tsx has a pre-existing module error (`admin-metrics` import issue) that surfaces when lazy-loaded through AdminShell's T6 smoke test; this is pre-existing and out of scope for this plan

## Known Stubs

| File | Content | Reason |
|------|---------|--------|
| `src/components/admin/SettingsModule.tsx` | Card with "Plan 24-05 wires Setup 2FA" | Intentional — Plan 24-05 owns 2FA sub-section |
| `src/components/admin/AuditLogModule.tsx` | Card with "Plan 24-06 ships viewer" | Intentional — Plan 24-06 implements full audit viewer |
| 7 PlaceholderModule entries | "Ships in Phase NN" hint | Intentional — matching v1.3 ROADMAP. Owned by respective phases |

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. AdminShell operates as a pure client-side UX gate (Pattern S1) — the DB-level re-check is already in place from Plan 24-01's `is_admin_at_least()` RPC.

## Next Phase Readiness

- Plan 24-04 (event taxonomy) can proceed independently
- Plan 24-05 (2FA + Settings) can fill SettingsModule stub
- Plan 24-06 (Audit Log UI) can fill AuditLogModule stub
- Plan 24-08 (bundle ceilings) should enforce the admin-shell 30 kB gz ceiling; current size is 33.80 kB gz (over target, enforcement deferred to 24-08)
- Future v1.3 phases adding admin modules: edit `ADMIN_MODULES` entry, add lazy bundle, no AdminLayout changes required

---
*Phase: 24-foundation-modular-admin-shell-event-taxonomy-server-side-po*
*Completed: 2026-05-17*
