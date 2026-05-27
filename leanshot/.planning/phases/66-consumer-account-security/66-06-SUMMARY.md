---
phase: 66-consumer-account-security
plan: 6
subsystem: admin/users-security
tags: [admin, mfa, security, AUTH-17]
dependency_graph:
  requires: [66-01]
  provides:
    - "ADMIN_MODULES['users-security'] (route /admin/users/security)"
    - "<RoleMfaRequirementTable> (5-row editor)"
    - "<MfaStatusBadge> (3-state badge primitive)"
    - "<UserDetailPage> placeholder hosting the badge"
    - "lib: listRoleMfaRequirements() + setRoleMfaRequirement()"
  affects:
    - "leanshot/src/lib/admin/modules.ts (manifest grew 34→35 entries)"
tech_stack:
  added: []
  patterns:
    - "Pattern S1 dual-layer auth (minRole 'admin' UI gate + superadmin SECDEF DB gate)"
    - "Optimistic update + rollback on RPC error"
    - "Admin module manifest entry only (URL-prefix routing in AdminShell — no App.tsx switch branch per [[feedback_admin_module_manifest_vs_router_branch_drift]])"
    - "Reuse existing <Badge> primitive — verified @theme tokens via toneClasses lookup (avoids Phase 60 undefined-token-renders-invisible trap)"
key_files:
  created:
    - leanshot/src/lib/admin/role-mfa-config.ts
    - leanshot/src/lib/admin/role-mfa-config.test.ts
    - leanshot/src/components/admin/users/RoleMfaRequirementTable.tsx
    - leanshot/src/components/admin/users/RoleMfaRequirementTable.test.tsx
    - leanshot/src/components/admin/users/MfaStatusBadge.tsx
    - leanshot/src/components/admin/users/MfaStatusBadge.test.tsx
    - leanshot/src/components/admin/users/UserDetailPage.tsx
  modified:
    - leanshot/src/lib/admin/modules.ts
decisions:
  - "<MfaStatusBadge> uses the existing <Badge> primitive (success/warning/neutral tones) rather than raw token classes — avoids the Phase 60 undefined-token trap and centralises tone semantics."
  - "<UserDetailPage> ships as a standalone scaffold (no /admin/users/<id> route exists in the project today). Future phase will wire it into the real user-detail surface."
  - "Routing: registered ADMIN_MODULES entry only — AdminShell URL-prefix matching handles /admin/users/security automatically; no App.tsx switch branch needed per [[feedback_admin_module_manifest_vs_router_branch_drift]]."
  - "modules.test.ts NOT updated (claims 18 modules vs reality 35) — pre-existing tech debt owned by Phase 69.5 per known_lessons #5."
metrics:
  duration: "~25min"
  completed_date: 2026-05-27
  tasks_completed: 2
  files_created: 7
  files_modified: 1
  tests_added: 20
---

# Phase 66 Plan 66-06: Admin Surfaces for MFA Summary

Per-role MFA requirement editor at `/admin/users/security` and a reusable `<MfaStatusBadge>` 3-state component, both wired to the Phase 66-01 `mfa_role_requirements` table + `set_mfa_role_requirement` SECDEF RPC.

## Deliverables

| Surface | Path | Purpose |
| --- | --- | --- |
| Lib: role-mfa-config | `src/lib/admin/role-mfa-config.ts` | `listRoleMfaRequirements()` (RLS-gated read of 5 seeded rows) + `setRoleMfaRequirement(role, required)` (superadmin-only SECDEF RPC). Typed `RoleMfaConfigError` mirrors Phase 26-05 affiliate-tier pattern. |
| Component: RoleMfaRequirementTable | `src/components/admin/users/RoleMfaRequirementTable.tsx` | Surface `/admin/users/security`. Table with Role / Required (checkbox) / Since columns. Optimistic toggle + rollback on RPC error. Greys checkbox out for non-superadmin viewers (UI half of Pattern S1; RPC re-checks server-side). |
| Component: MfaStatusBadge | `src/components/admin/users/MfaStatusBadge.tsx` | Pure presentational. 3 states (`on`/`required-not-enrolled`/`off`) → success/warning/neutral tones on the existing `<Badge>` primitive. Exports a `resolveMfaStatus()` helper for unit use. |
| Component: UserDetailPage (placeholder) | `src/components/admin/users/UserDetailPage.tsx` | Scaffold hosting `<MfaStatusBadge>` next to a user's name. Loads role requirements once on mount via `listRoleMfaRequirements`. Not yet routed — see "Wiring Required" below. |
| Manifest: ADMIN_MODULES['users-security'] | `src/lib/admin/modules.ts` | Sibling entry next to 'users'. `route: 'users/security'`, `icon: ShieldIcon`, `minRole: 'admin'`, `flagKey: 'admin.users_security.enabled'`. AdminShell URL-prefix routing handles `/admin/users/security` automatically — no App.tsx switch branch needed. |

## Verification

| Check | Result |
| --- | --- |
| `tsc -b` on Plan 66-06 files | Pass (no errors in `src/lib/admin/role-mfa-config.*` or `src/components/admin/users/*`). |
| `vitest run --project=src-lib-unit src/lib/admin/role-mfa-config.test.ts` | 7/7 pass. |
| `vitest run --project=src-ui-unit src/components/admin/users/` | 13/13 pass (5 RoleMfaRequirementTable + 8 MfaStatusBadge). |
| `vitest run --project=src-ui-unit src/components/admin/__tests__/AdminShell.test.tsx` | 7/7 pass (manifest entry doesn't break shell routing parity). |

Total new tests: **20** (7 lib + 5 table + 8 badge).

## Decisions

1. **Reuse `<Badge>` primitive over raw token classes.** The known-lessons #3 token list (`bg-success-soft text-success`, etc.) maps 1:1 to the existing `BadgeTone` lookup table in `src/components/ui/Badge.tsx`, which references the verified `--color-*-soft` / `--color-*` @theme tokens. Going through `<Badge tone="…">` centralises the tone→token mapping and inoculates against the Phase 60 "undefined-token renders invisible" failure mode.
2. **`text-text-muted` not defined; fall back to `text-text-tertiary`.** `src/index.css` defines `--color-text` / `-secondary` / `-tertiary` / `-on-hero` / `-on-hero-muted` but no `text-muted`. Off-state in the table uses `text-text-tertiary`; the badge uses the neutral tone which is `bg-surface-elevated text-text-secondary` (also defined).
3. **`<UserDetailPage>` shipped as a placeholder.** No `/admin/users/<id>` route or component exists in the project today (verified during execution: `find src -name "UserDetailPage*" -o -name "MemberDetail*"` returns no matches; `AdminMembersPage` is bulk-list only). Per known_lessons #6 the badge is ship-ready as a standalone unit-tested component, and `UserDetailPage.tsx` is a self-contained scaffold demonstrating the data wiring (props-driven `userMfaFactors`, async-loaded `roleRequirements` map). A future phase replaces the props with a real admin user-detail data source.
4. **Module manifest entry only, no App.tsx changes.** AdminShell.tsx URL-prefix routing (`pathname === '/admin/<route>' || pathname.startsWith('/admin/<route>/')`) handles arbitrary nested admin paths, so adding the `users-security` entry to `ADMIN_MODULES` is sufficient. The plan's "also add router branch in App.tsx" note from the Phase 65 lesson does NOT apply here because the new route lives entirely under `/admin/*`, not at the app top level. This matches every other admin module added since Phase 24 (see modules.ts comments on `gamification`, `reviews`, `protocols`, etc.).
5. **`modules.test.ts` left untouched.** The file asserts `expect(unique.size).toBe(18)` against a manifest that already had 34 entries before Phase 66-06. Per known_lessons #5 this is pre-existing tech debt owned by Phase 69.5 — updating it here would silently entangle Phase 66 with the cleanup phase.

## Wiring Required (Phase 70 or later)

- **`<UserDetailPage>` is not yet routed.** A future phase that ships a real `/admin/users/<id>` surface should:
  1. Replace the props-driven `userMfaFactors` with a live fetch (e.g. `supabase.auth.admin.getUserById(userId)` via service-role Edge Function, then `data.user.factors?.length ?? 0`).
  2. Add either a new ADMIN_MODULES entry or extend `AdminMembersPage` to navigate to `/admin/users/<id>` and render this component.
  3. Add a router branch in App.tsx OR rely on AdminShell URL-prefix routing once a stable parametric route is decided.
- **`flagKey: 'admin.users_security.enabled'`** is registered but not enabled in PostHog. Default behaviour without the flag should be: visible to anyone meeting `minRole='admin'` (matches every other admin module's flag posture).

## Deviations from Plan

None. Plan executed exactly as written. The known-lessons context (#3 token verification, #6 missing user-detail page) was applied as planned — both surfaced no surprises.

## Threat Surface

No new network endpoints, auth paths, or trust boundaries introduced beyond Phase 66-01 schema. The SECDEF RPC superadmin check is owned by `20290105000002_mfa_role_requirements.sql`; this plan only adds UI consumers.

## Self-Check

Confirmed all created files exist on disk:

```
leanshot/src/lib/admin/role-mfa-config.ts                                 FOUND
leanshot/src/lib/admin/role-mfa-config.test.ts                            FOUND
leanshot/src/components/admin/users/RoleMfaRequirementTable.tsx           FOUND
leanshot/src/components/admin/users/RoleMfaRequirementTable.test.tsx      FOUND
leanshot/src/components/admin/users/MfaStatusBadge.tsx                    FOUND
leanshot/src/components/admin/users/MfaStatusBadge.test.tsx               FOUND
leanshot/src/components/admin/users/UserDetailPage.tsx                    FOUND
leanshot/src/lib/admin/modules.ts                                         MODIFIED
```

Confirmed commits exist on `worktree-agent-abdf573ac8753710d`:

```
b5f108be feat(66-06): role MFA requirement table + lib + admin manifest entry
929129b2 feat(66-06): MfaStatusBadge 3-state + UserDetailPage placeholder
```

## Self-Check: PASSED
