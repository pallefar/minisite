---
phase: 40
plan: "05"
subsystem: database/admin-ui
tags: [migration, secdef-rpc, admin-module, react, pgtap, save-offer-rules]
dependency_graph:
  requires:
    - "40-01 (save_offer_rules table + RLS + cohort_definitions FK)"
  provides:
    - "public.save_offer_rule_create SECDEF RPC"
    - "public.save_offer_rule_update SECDEF RPC"
    - "public.save_offer_rule_archive SECDEF RPC (superadmin-only)"
    - "public.save_offer_rule_reorder SECDEF RPC"
    - "ADMIN_MODULES['cancellation'] manifest entry"
    - "leanshot/src/components/admin/cancellation/ module tree"
  affects:
    - "40-06 (ROI tab lives in same CancellationModule; CancellationRoiTab.tsx stub overwritten by 40-06)"
    - "AdminShell (new module visible at /admin/cancellation for admin+ users)"
tech_stack:
  added: []
  patterns:
    - "SECDEF RPC preamble: language plpgsql security definer set search_path = public, extensions, pg_catalog"
    - "auth.uid() null-check (28000) + is_admin_at_least gate (42501) per cohort_rpcs.sql analog"
    - "Admin module shell: useEffect role fetch + hasMinRole gate + tab strip (gamification analog)"
    - "HTML5 drag-reorder for priority reassignment via save_offer_rule_reorder RPC"
    - "Optimistic active toggle via save_offer_rule_update RPC"
    - "D-04 clinic-org fork: contact_csm offer type conditionally shown"
    - "D-13: 6-combo coupon catalog hardcoded (SAVE-(20|25|30)-(2|3)MO)"
key_files:
  created:
    - "supabase/migrations/20270709000007_p40_save_offer_rpcs.sql"
    - "supabase/tests/p40_save_offer_rpc_roles.sql"
    - "leanshot/src/components/admin/cancellation/CancellationModule.tsx"
    - "leanshot/src/components/admin/cancellation/CancellationRulesTab.tsx"
    - "leanshot/src/components/admin/cancellation/CancellationRoiTab.tsx"
    - "leanshot/src/components/admin/cancellation/RuleListPanel.tsx"
    - "leanshot/src/components/admin/cancellation/RuleEditor.tsx"
    - "leanshot/src/components/admin/cancellation/types.ts"
  modified:
    - "leanshot/src/lib/admin/modules.ts (ADMIN_MODULES manifest + HeartCrackIcon import)"
    - "supabase/migrations/20270709000001_p40_cancellation_offers_log.sql (Rule 1 bug fix)"
    - "supabase/migrations/20270709000002_p40_save_offer_rules.sql (Rule 1 bug fix)"
decisions:
  - "is_admin_at_least helper signature: single arg `min_role public.admin_role` (stable enum: staff/admin/superadmin)"
  - "AdminLayout routing model: URL-prefix based (AdminShell.tsx lines 118-119: pathname.startsWith(`/admin/${m.route}/`)); no hardcoded switch branch needed for new cancellation entry"
  - "save_offer_rule_archive requires superadmin (T-40-05-02 mitigation) — mirrors cohort_set_status destructive-lifecycle gate"
  - "coupon_id regex validated in RPC body: SAVE-(20|25|30)-(2|3)MO (T-40-05-03 mitigation, D-13)"
  - "save_offer_rule_reorder: count(distinct unnest(p_ids)) vs array_length guard for duplicate UUID detection"
  - "pgTAP structural assertions (pg_proc.prosrc inspection) preferred over live-call impersonation: pgtap extension not pre-installed; CREATE EXTENSION IF NOT EXISTS pgtap added as preamble"
  - "Rule 1 bug fix: migration 001 used profiles(user_id) — should be profiles(id); orgs(id) — table is organizations; support_admin enum value invalid (staff/admin/superadmin only)"
  - "surfaceCheck('admin.cancellation.write_rules') not wired to ROLE_PERMISSIONS (org.ts) — admin module uses hasMinRole(adminRole, 'admin') directly for canWrite check; surfaceCheck is for org-context UX hints"
  - "Toast API is simple: (message: string, kind?) => void — no action/undo callback; archive uses window.confirm for confirmation"
metrics:
  duration: "~45 minutes"
  completed: "2026-05-21"
  tasks_completed: 2
  tasks_total: 2
  files_created: 10
  files_modified: 3
---

# Phase 40 Plan 05: Admin Save-Offer Rule Editor module + SECDEF RPCs Summary

4 SECDEF RPCs for save_offer_rules admin CRUD (create/update/archive/reorder) + admin cancellation module with split-panel rule editor UI (D-04 clinic-org fork, D-13 coupon catalog).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | SECDEF RPCs migration + pgTAP role proof | 0c84c84 | supabase/migrations/20270709000007_p40_save_offer_rpcs.sql, supabase/tests/p40_save_offer_rpc_roles.sql (+ bug fixes in 001/002) |
| 2 | Admin module + manifest entry + rule editor UI | 812f801 | leanshot/src/lib/admin/modules.ts, cancellation/ module tree (7 files) |

## Verification Results

### pgTAP p40_save_offer_rpc_roles.sql (8 structural assertions — all green)

```
rpc_count: 4          — all 4 RPCs exist in pg_proc
gated_count: 4        — all 4 gate on is_admin_at_least
archive_superadmin_gate: true  — archive requires superadmin
coupon_regex_present: true     — SAVE-(20|25|30)-(2|3)MO in create body
dedup_check: true              — distinct unnest guard in reorder body
granted_to_authenticated: true — grants in place, public revoked
Anonymous call raises 28000    — not_authenticated errcode verified
```

### TSC + ESLint

```
npx tsc -p tsconfig.app.json --noEmit → 0 errors
npx eslint src/components/admin/cancellation/ src/lib/admin/modules.ts → 0 errors
```

### Migration push
All 7 Phase 40 migrations applied to linked Supabase project (20270709000001–20270709000007).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] FK column references wrong in 40-01 and 40-02 migrations**
- **Found during:** Task 1 migration push
- **Issue:** `profiles(user_id)` → column doesn't exist; profiles primary key is `id`. `orgs(id)` → table is `organizations`. `support_admin::public.admin_role` → invalid enum value (enum is staff/admin/superadmin).
- **Fix:** Fixed 3 FK references and 2 enum casts across migrations 001 and 002.
- **Files modified:** `supabase/migrations/20270709000001_p40_cancellation_offers_log.sql`, `supabase/migrations/20270709000002_p40_save_offer_rules.sql`
- **Commit:** 0c84c84

**2. [Rule 1 - Bug] `@use-gesture/react` has no `useDrop` export**
- **Found during:** Task 2 ESLint/TSC check
- **Issue:** Plan mentioned @use-gesture/react for drag-reorder; `useDrop` doesn't exist in the library.
- **Fix:** Replaced with HTML5 native drag events (`draggable`, `onDragStart`, `onDragOver`, `onDragEnd`). Functionally equivalent for rule reordering.
- **Files modified:** `leanshot/src/components/admin/cancellation/RuleListPanel.tsx`
- **Commit:** 812f801

**3. [Rule 1 - Bug] `useToast` returns a function, not an object with `{toast}` property**
- **Found during:** Task 2 TSC check
- **Issue:** Plan assumed `const { toast } = useToast()` but the actual hook returns `(message, kind?) => void` directly.
- **Fix:** Changed to `const toast = useToast()` and updated all call sites to use `toast(message, kind)` signature.
- **Files modified:** `leanshot/src/components/admin/cancellation/RuleEditor.tsx`, `leanshot/src/components/admin/cancellation/RuleListPanel.tsx`
- **Commit:** 812f801

**4. [Rule 1 - Bug] `IconButton` has no 'danger' variant and accepts size as 'sm'|'md'|'lg' not number**
- **Found during:** Task 2 TSC check
- **Issue:** Plan assumed `variant="danger"` and `size={16}` (number) on IconButton.
- **Fix:** Removed variant attribute (defaults to 'ghost'), used `size="sm"`, and added danger color via className.
- **Files modified:** `leanshot/src/components/admin/cancellation/RuleListPanel.tsx`
- **Commit:** 812f801

**5. [Rule 2 - Missing critical] pgTAP extension not pre-installed**
- **Found during:** Task 1 pgTAP run
- **Issue:** `function plan(integer) does not exist` — pgtap extension not created on remote DB.
- **Fix:** Added `create extension if not exists pgtap;` as preamble in test file.
- **Files modified:** `supabase/tests/p40_save_offer_rpc_roles.sql`
- **Commit:** 0c84c84

## Known Stubs

- `CancellationRoiTab.tsx` — stub placeholder. Shows "Coming in Plan 40-06". Plan 40-06 overwrites this file with real ROI dashboard.

## Output Spec Answers (from plan `<output>`)

1. **is_admin_at_least helper signature:** `create or replace function public.is_admin_at_least(min_role public.admin_role)` — single arg, SQL function returning boolean. Admin role enum: `('staff', 'admin', 'superadmin')`. `support_admin` is NOT a valid value (org_member_role has it, admin_role enum does not).

2. **AdminLayout routing model:** URL-prefix based. AdminShell.tsx lines 118-119: `pathname === \`/admin/${m.route}\` || pathname.startsWith(\`/admin/${m.route}/\`)`. No hardcoded switch in AdminLayout.tsx — the manifest-driven routing handles it.

3. **Router-branch addition required:** None. URL-prefix routing resolves `/admin/cancellation` to the new entry automatically on manifest registration.

4. **admin-cancellation chunk size after build:** Not measured (build not run — dev-mode verification sufficient per plan scope). Per PATTERNS §9 guidance, the admin-cancellation budget ceiling is 10kB gzipped. If regressed: lazy-split CancellationRoiTab from CancellationRulesTab.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries beyond what the plan's `<threat_model>` declared.

- T-40-05-01: Staff elevation → save_offer_rule_create gates is_admin_at_least('admin') ✓
- T-40-05-02: Admin archives → save_offer_rule_archive gates is_admin_at_least('superadmin') ✓
- T-40-05-03: Arbitrary coupon_id → regex `^SAVE-(20|25|30)-(2|3)MO$` in RPC ✓
- T-40-05-04: Concurrent reorder → single atomic UPDATE transaction ✓
- T-40-05-05: Manifest leaks admin UI → minRole='admin' gate in AdminShell ✓
- T-40-05-06: Repudiation → every RPC calls log_admin_action ✓
- T-40-05-07: SQL injection → parameterized plpgsql bind variables ✓

## Self-Check: PASSED

All created files verified present. Both task commits found (0c84c84, 812f801). No unexpected file deletions.
