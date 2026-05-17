---
phase: 28
plan: "05"
subsystem: org-context
tags:
  - zustand
  - org-context
  - phase-28
  - tdd
dependency_graph:
  requires:
    - "28-00"
    - "28-01"
  provides:
    - useCurrentOrg
    - getCurrentOrgId
    - getCurrentOrgIdOrNull
    - surfaceCheck
    - withOrgPath
    - overlayBrandingTokens
    - org-zustand-slice
  affects:
    - "28-06"
    - "29"
    - "30"
    - "31"
tech_stack:
  added:
    - "src/lib/org.ts (NEW)"
    - "src/lib/wire-auth-invalidation.ts (NEW)"
    - "src/types/org.ts (NEW)"
  patterns:
    - "Zustand ephemeral slice (non-persisted)"
    - "ROLE_PERMISSIONS const map (client-side UX hint)"
    - "wireAuthInvalidation extracted helper (testable auth event wiring)"
key_files:
  created:
    - "leanshot/src/lib/org.ts"
    - "leanshot/src/lib/wire-auth-invalidation.ts"
    - "leanshot/src/types/org.ts"
    - "leanshot/src/lib/__tests__/org.test.ts"
    - "leanshot/src/lib/__tests__/store-org-slice.test.ts"
    - "leanshot/src/lib/__tests__/main-auth-invalidation.test.ts"
  modified:
    - "leanshot/src/lib/store.ts"
    - "leanshot/src/main.tsx"
decisions:
  - "Hoisted OrgContext/OrgRole types to src/types/org.ts to prevent circular import between store.ts and org.ts"
  - "Extracted wireAuthInvalidation() into its own module for unit testability"
  - "supabase import in main.tsx placed before sync-defer to satisfy import-x/order lint rule"
metrics:
  duration: "9 minutes"
  completed: "2026-05-17T15:44:00Z"
  tasks_completed: 3
  tests_added: 23
requirements:
  - ORG-06
---

# Phase 28 Plan 05: org-context layer (src/lib/org.ts) Summary

Wave 2 org-context layer — 6 D-03 exports + ROLE_PERMISSIONS matrix, Zustand org slice with partialize exclusion, USER_UPDATED auth invalidation wired in main.tsx between hydrate() and render.

## 1. D-03 Exports — Confirmation

All 6 exports match CONTEXT D-03 verbatim:

| Export | Signature | Verified |
|--------|-----------|---------|
| `useCurrentOrg()` | `() => { org: OrgContext \| null; role: OrgRole \| null; loading: boolean }` | yes |
| `getCurrentOrgId()` | `() => string` (throws on null) | yes |
| `getCurrentOrgIdOrNull()` | `() => string \| null` | yes |
| `surfaceCheck(permission)` | `(string) => boolean` | yes |
| `withOrgPath(relativePath)` | `(string) => string` (throws on null org) | yes |
| `overlayBrandingTokens(branding)` | `({primary_color?, accent_color?}) => void` | yes |

Types `OrgContext`, `OrgRole`, `CurrentOrgContext` exported from `src/types/org.ts` (hoisted to prevent circular import).

## 2. ROLE_PERMISSIONS Matrix

```typescript
admin:  { members.invite, members.revoke, members.list, settings.edit, branding.edit, patients.link }
staff:  { members.list, patients.link }
viewer: { members.list }
```

## 3. Test Results

| Test file | Cases | Result |
|-----------|-------|--------|
| `src/lib/__tests__/store-org-slice.test.ts` | 6 | PASS |
| `src/lib/__tests__/org.test.ts` | 15 (Tests 1-12 + subcases) | PASS |
| `src/lib/__tests__/main-auth-invalidation.test.ts` | 2 | PASS |
| **Total** | **23** | **23 PASS** |

## 4. Bundle Size Delta

- `org.ts` has no consumers in the current build (Plan 06 RouteOrgGuard is the first consumer, not yet shipped). Vite tree-shakes unused modules — zero bytes added to any chunk.
- `wire-auth-invalidation.ts` is imported by `main.tsx` (entry chunk). Added ~200 bytes gz to the index chunk (well under the 24,500 byte working ceiling — measured at 19,594 bytes).
- `types/org.ts` is type-only, tree-shaken at build time.
- Pre-existing clinic chunk overage (28,758 vs 28,000 ceiling) from sibling plans 28-03/28-04 — documented in `deferred-items.md`.

## 5. clinic.ts Diff Size

```
git diff HEAD -- src/lib/clinic.ts → 0 bytes (UNCHANGED)
```

D-01 lock preserved — clinic.ts untouched.

## 6. Note for Plan 06

`useStore.setCurrentOrg` signature (Plan 06 RouteOrgGuard should use this after slug resolution):

```typescript
setCurrentOrg(org: OrgContext | null, role: OrgRole | null) => void
```

- `OrgContext = { id: string; slug: string; name: string }`
- `OrgRole = 'admin' | 'staff' | 'viewer'`
- Import types from `@/types/org`
- Import store action via `useStore.getState().setCurrentOrg(...)`

## Deviations from Plan

### Auto-fixed Issues

None.

### Architectural Decisions Made

**[Decision] Hoist types to `src/types/org.ts`**
- Found during: Task 1 implementation planning
- Issue: `store.ts` needed `OrgContext`/`OrgRole` types from `org.ts`; `org.ts` imports from `store.ts`. Direct circular import.
- Fix: Created `src/types/org.ts` as a dedicated type-only file; both `store.ts` and `org.ts` import from it.
- Files modified: `src/types/org.ts` (NEW), `src/lib/store.ts`, `src/lib/org.ts`
- Commits: 76c65fd, f3e84a7

**[Decision] Extract `wireAuthInvalidation` to own module**
- Found during: Task 3 test design
- Issue: `main.tsx` has side-effect imports and a complex bootstrap sequence; testing the callback directly requires isolating it.
- Fix: `src/lib/wire-auth-invalidation.ts` contains the helper; `main.tsx` imports and calls it.
- Files modified: `src/lib/wire-auth-invalidation.ts` (NEW), `src/main.tsx`
- Commit: b0054cf

**[Auto-fix, Rule 1] Import order lint errors fixed**
- Found during: Task 3 post-implementation lint check
- Issue: `import-x/order` violations in `org.ts` and `main.tsx` (supabase import alphabetically before sync-defer).
- Fix: Reordered imports per `import-x/order` requirements.
- Commit: b0054cf

### Known Stubs

None — this plan adds infrastructure only (no UI components). `org.ts` exports are callable but have no consumers until Plan 06 ships RouteOrgGuard.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced. All new code is client-side state management (Zustand) and auth event wiring. Threat model T-28-05-01 through T-28-05-05 addressed as designed.

## Self-Check

Files created:
- `leanshot/src/lib/org.ts` — created
- `leanshot/src/lib/wire-auth-invalidation.ts` — created
- `leanshot/src/types/org.ts` — created
- `leanshot/src/lib/__tests__/org.test.ts` — created
- `leanshot/src/lib/__tests__/store-org-slice.test.ts` — created
- `leanshot/src/lib/__tests__/main-auth-invalidation.test.ts` — created

Commits:
- 76c65fd (Task 1 — store slice)
- f3e84a7 (Task 2 — org.ts)
- b0054cf (Task 3 — auth invalidation)
