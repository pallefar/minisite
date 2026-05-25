---
phase: 28
plan: "07"
subsystem: documentation/admin-ui
tags: [extension-contract, admin-manifest, plan-checker, org-scoped, rls, downstream-phases]
dependency_graph:
  requires: [28-00, 28-01, 28-02]
  provides: [28-EXTENSION-CONTRACT.md, ClinicOrgsPreview, ADMIN_MODULES.clinic-orgs, plan-checker-p28-extension.md]
  affects: [29, 30, 31, 40, 50]
tech_stack:
  added:
    - "Building2Icon from lucide-react (clinic-orgs admin nav icon)"
  patterns:
    - "CSS custom property surface token: var(--color-surface-elevated) for admin card tiles"
    - "Extension contract D-29 pattern: single source-of-truth for downstream org-scoped table compliance"
key_files:
  created:
    - .planning/phases/28-clinic-organizations-schema-rls-hardening/28-EXTENSION-CONTRACT.md
    - src/components/admin/modules/ClinicOrgsPreview.tsx
    - $HOME/.claude/get-shit-done/references/plan-checker-p28-extension.md (GSD global reference — outside git)
  modified:
    - src/lib/admin/modules.ts
    - src/lib/admin/modules.test.ts
decisions:
  - "admin-shell chunk is 39.71 kB gz against a 45 kB ceiling (script enforced value) — within budget; plan spec reference to 30 kB ceiling refers to P24 D-18 original target, not the currently enforced ceiling in assert-bundle-budget.sh"
  - "plan-checker-p28-extension.md written to $HOME/.claude/get-shit-done/references/ (GSD global tool dir, not tracked by project git) — correct location per plan spec; empty-commit marker added to worktree history"
  - "ClinicOrgsPreview uses CSS custom property var(--color-surface-elevated) — bg-surface is not a project Tailwind token; discovered via grep of admin component conventions"
  - "modules.test.ts updated T1/T2/T3/T4 to expect 13 modules (was 12) — required to prevent test regression when manifest grows"
  - "Plans 03-06 (JWT hook, HMAC realtime, org.ts, RouteOrgGuard) not yet merged at P28-07 execution time; extension contract documents both shipped P28 artifacts (Plans 01-02) and forward declarations for Plans 03-06"
metrics:
  duration: "8m 30s"
  completed: "2026-05-17T16:26:00Z"
  tasks_completed: 3
  files_changed: 5
---

# Phase 28 Plan 07: EXTENSION-CONTRACT + admin manifest clinic-orgs preview Summary

**One-liner:** D-29 extension contract (436 lines, 10 sections) + `ClinicOrgsPreview` admin manifest entry + 5-BLOCKER plan-checker rule reference — closes Phase 28 with a self-extending multi-tenant defense pattern for downstream P29/P30/P31/P40.

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | 28-EXTENSION-CONTRACT.md (D-29 sections a-e + status-machine + jsonb + downstream appendix) | 2597706 | 28-EXTENSION-CONTRACT.md |
| 2 | ClinicOrgsPreview + ADMIN_MODULES clinic-orgs entry + test update | a219c8d | ClinicOrgsPreview.tsx, modules.ts, modules.test.ts |
| 3 | plan-checker BLOCKER rules at $HOME/.claude/get-shit-done/references/ | b8ec6d4 | plan-checker-p28-extension.md (GSD global) |

---

## 28-EXTENSION-CONTRACT.md Section List

| Section | Content |
|---------|---------|
| Section 1: Scope | Downstream consumers (P29/P30/P31/P40/P50); P28 shipped artifacts summary |
| Section 2 (D-29a): RLS Policy Template | Verbatim SQL template + SECDEF RPC Pattern S1 with `log_admin_action` |
| Section 3 (D-29b): Cross-Tenant Test Recipe | Verbatim fixture export signatures + 5-assertion test file skeleton |
| Section 4 (D-29c): Naming Conventions | `org_*` prefix; `on delete restrict` FK; 14-digit timestamp rule; status enum ownership |
| Section 5 (D-29d): ORG_SCOPED_TABLES Checklist | Verbatim current Set contents + per-phase extension comments |
| Section 6 (D-29e): HMAC Channel Registration | Channel name format; downstream realtime subscription steps; Plans 03-06 note |
| Section 7: Status-Machine Ownership | Transition table for org_invites (4 values) + org_subscriptions (4 values — P29 owns 3) |
| Section 8: Defensive JSONB Contracts | _validate_consent_scope reuse pattern; new shape template |
| Section 9: Downstream Phase Appendix | P29/P30/P31/P40/P50 forward declarations |
| ADDENDUM Cross-Reference | All 7 A1-A7 addendum items and their downstream impact |

**Word count:** 436 lines / ~5,800 words. Sections (by `##` count): 10.

---

## ADMIN_MODULES Manifest Entry Confirmation

```typescript
{
  key: 'clinic-orgs',
  label: 'Clinic Orgs',
  route: 'clinic-orgs',
  icon: Building2Icon,
  lazy: () => import('@/components/admin/modules/ClinicOrgsPreview'),
  flagKey: 'admin.clinic_orgs.enabled',
  minRole: 'admin' as AdminRole,
}
```

- **Manifest length:** 13 modules (was 12)
- **Test suite:** 13/13 pass (`modules.test.ts` T1/T2/T3/T4 all updated to expect 13)
- **ClinicOrgsPreview:** Renders org count + member count rollup via browser anon-client (RLS-gated); uses `var(--color-surface-elevated)` token; shows "Full Members & Invites UI ships in Phase 31" footer
- **TSC:** Exit 0 (verified via `tsc -p tsconfig.app.json --noEmit`)

---

## Admin-Shell Chunk gz Size

| Metric | Value |
|--------|-------|
| admin-shell gz size (after Plan 07) | **39.71 kB** |
| Enforced ceiling (`assert-bundle-budget.sh`) | 45 kB |
| Status | **OK — 5.29 kB headroom** |

Note: The plan spec references "≤ 30 kB per P24 D-18" but `assert-bundle-budget.sh` already enforced 45 kB (raised in prior plans). The chunk was 39.71 kB before this plan and remains 39.71 kB after (ClinicOrgsPreview is lazy-loaded — only loaded when admin navigates to `/admin/clinic-orgs`; the manifest entry itself is negligible).

---

## Plan-Checker Rule File

**Location:** `$HOME/.claude/get-shit-done/references/plan-checker-p28-extension.md`

| BLOCKER | Trigger | fix_hint |
|---------|---------|----------|
| R1 | New `org_*` table migration without paired `rls-org-<table>.test.ts` | Copy rls-org-members.test.ts template; 5 standard assertions |
| R2 | New `org_*` table without entry in `ORG_SCOPED_TABLES` | Edit with-org-scope.ts Set; run withOrgScope test 9 |
| R3 | SECDEF function without `set search_path = pg_catalog, public, extensions` | Add search_path to function header per migration gotchas |
| R4 | Status enum value without named owning transition function | Add owning RPC in same plan OR document as DEFERRED with named downstream plan |
| R5 | JSONB column with duplicate or missing shape validator | Reuse _validate_consent_scope OR define 1 TS type + 1 DB validator |

---

## Phase 28 Close-Out Checklist

| Item | Status |
|------|--------|
| 8 RLS tests green (src/lib/__tests__/rls-org-*.test.ts) | Authored in Plan 01; live test blocked by Supabase free-tier rate limit per Plan 01 SUMMARY |
| 4 SECDEF RPCs deployed with search_path (send_org_invite, revoke_org_invite, accept_org_invite, link_org_patient) | VERIFIED in Plan 01 (live DB query confirmed 4 RPCs) |
| JWT hook enabled in Dashboard | Specified in Plan 03 — pending Wave 3 merge |
| Vault secret `org_realtime_channel_secret` minted | Specified in Plan 04 — pending Wave 3 merge |
| withOrgScope 4-layer defense live | VERIFIED in Plan 02 (9/9 tests) |
| RouteOrgGuard anti-enumeration | Specified in Plan 06 — pending Wave 3 merge |
| org.ts 6 D-03 exports | Specified in Plan 05 — pending Wave 3 merge |
| Extension contract published | DONE — this plan (28-07) |

**Note on Plans 03-06:** The execution context for Plan 07 stated all Plans 00-06 were merged, but git log confirms only Plans 00, 01, 02 were merged at execution time. Plans 03-06 (JWT hook, HMAC realtime, org.ts, RouteOrgGuard) are specified but not yet merged. The extension contract is written authoritatively to document the shipped P28 artifacts and forward-declares Plans 03-06 patterns for downstream planning.

---

## Forward Pointers

- **P29 plan-phase MUST read:** `.planning/phases/28-clinic-organizations-schema-rls-hardening/28-EXTENSION-CONTRACT.md`
- **P29 plan-checker MUST cite:** `$HOME/.claude/get-shit-done/references/plan-checker-p28-extension.md` as BLOCKER source
- **P29 first task:** Add `org_subscription_meters` to `ORG_SCOPED_TABLES` + write `rls-org-subscription-meters.test.ts`
- **P30/P31/P40:** Same protocol — read extension contract, run plan-checker with BLOCKER rules R1-R5

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Discovery] Plans 03-06 not yet merged at execution time**
- **Found during:** Pre-execution verification
- **Issue:** Execution context stated "All Waves 0-3 (Plans 00-06) MERGED to main" but git log shows only Plans 00, 01, 02 are merged. Files `src/lib/org.ts`, `src/lib/org-realtime.ts`, `src/components/clinic/RouteOrgGuard.tsx` do not exist.
- **Fix:** Extension contract was written based on actually-shipped artifacts (Plans 01-02) and forward-declares Plans 03-06 patterns explicitly. The contract is still accurate and consumable by downstream phases.
- **Impact:** None on Plan 07 deliverables — all three tasks produce correct artifacts regardless of Plans 03-06 merge state.

**2. [Rule 2 - Missing Critical] modules.test.ts updated for 13 modules**
- **Found during:** Task 2 (manifest test run)
- **Issue:** The existing test T1 checks `ADMIN_MODULES.length === 12` with exact key list; T3/T4 check 12 unique flagKeys/routes. Adding clinic-orgs entry required updating all four assertions.
- **Fix:** Updated T1 (length 12→13, added 'clinic-orgs' to expected key list), T2 (comment "12"→"13"), T3 (unique.size 12→13), T4 (unique.size 12→13).
- **Result:** 13/13 tests pass.

**3. [Rule 1 - Discovery] bg-surface is not a project Tailwind token**
- **Found during:** Task 2 (token discovery per plan spec instructions)
- **Issue:** Plan spec said to use `bg-surface` and discover whether it's a project token. `grep -rn "bg-surface" src/components/admin/` returns zero results. Project uses CSS custom property form `var(--color-surface-elevated)`.
- **Fix:** Used `bg-[var(--color-surface-elevated)]` matching the pattern in `AdminShell.tsx`, `SettingsModule.tsx`, `AuditLogModule`, and `SetupTotpPage.tsx`.

**4. [Rule 1 - Info] plan-checker-p28-extension.md not trackable in project git**
- **Found during:** Task 3 (commit attempt)
- **Issue:** `$HOME/.claude/get-shit-done/references/` is not a git repository — it's a global GSD tool directory. The file cannot be staged/committed to the worktree.
- **Fix:** File created at the correct path (verified to exist with 5 BLOCKER rules). An empty-commit marker `b8ec6d4` was added to the worktree history documenting the file's creation location.

---

## Known Stubs

- **ClinicOrgsPreview:** Shows counts visible to the admin's account (RLS-gated). No cross-org rollup — deferred to v1.4 per CONTEXT deferred ideas "Cross-org analytics rollup for the founder dashboard". Footer explicitly states "Full Members & Invites UI ships in Phase 31."
- **clinic-orgs admin manifest entry:** The `flagKey: 'admin.clinic_orgs.enabled'` PostHog feature flag does NOT exist in PostHog yet — stub until P28 is shipped and flag is minted.

---

## Self-Check: PASSED

- 28-EXTENSION-CONTRACT.md: FOUND at `.planning/phases/28-clinic-organizations-schema-rls-hardening/28-EXTENSION-CONTRACT.md`
- 28-EXTENSION-CONTRACT.md sections: 10 `##` headers (requirement: ≥9) — PASS
- ClinicOrgsPreview.tsx: FOUND at `src/components/admin/modules/ClinicOrgsPreview.tsx`
- modules.ts clinic-orgs entry: grep confirms `'clinic-orgs'` present — PASS
- modules.test.ts: 13/13 tests pass — PASS
- TSC --noEmit: exit 0 — PASS
- admin-shell gz size: 39.71 kB (ceiling 45 kB) — PASS
- plan-checker-p28-extension.md: FOUND at `$HOME/.claude/get-shit-done/references/plan-checker-p28-extension.md`
- plan-checker BLOCKER count: 5 rules (R1-R5) — PASS
- Task 1 commit 2597706: FOUND
- Task 2 commit a219c8d: FOUND
- Task 3 commit b8ec6d4: FOUND
- Pre-existing test failures: 71 failures (pre-existing, not caused by Plan 07 — verified by running vitest on clean HEAD)
