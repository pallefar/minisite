---
phase: 52-vendor-setup-foundation
plan: "03"
subsystem: admin-ui
tags: [admin, vendor-smoke, ui, manifest]
requires:
  - 52-02-vendor-smoke-log-migration  # vendor_smoke_log table + RLS must exist
provides:
  - AdminVendorSmokeDashboard          # accessible at /admin/vendor-smoke
affects:
  - leanshot/src/lib/admin/modules.ts  # ADMIN_MODULES manifest updated
tech_stack:
  added: []
  patterns:
    - Pattern S1 dual-layer (is_staff RLS + minRole superadmin manifest gate)
    - AdminShell catch-all routing via manifest entry
key_files:
  created:
    - leanshot/src/components/admin/AdminVendorSmokeDashboard.tsx
  modified:
    - leanshot/src/lib/admin/modules.ts
decisions:
  - "Gated by vendor_smoke_log RLS (is_staff) + minRole:superadmin manifest — NO ClinicianMfaGuard (non-PHI admin surface; consistent with all other admin modules)"
  - "Copy correction: UI-SPEC said 06:00 UTC; plan 52-02 cron is 08:00 UTC — used 08:00 UTC"
  - "ShieldCheckIcon import reused (already at line ~45) — no duplicate import added"
  - "No AdminShell router edits — catch-all routing handles /admin/vendor-smoke automatically"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-25T07:59:59Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 1
---

# Phase 52 Plan 03: Admin Vendor Smoke Dashboard Summary

**One-liner:** Staff-only `/admin/vendor-smoke` dashboard wired to `vendor_smoke_log` table with table + loading/empty/error states, Run-smoke-now button invoking `vendor-smoke` Edge Fn, and manifest entry registered in `ADMIN_MODULES`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | AdminVendorSmokeDashboard component | `9c38ac79` | `src/components/admin/AdminVendorSmokeDashboard.tsx` (created, 296 lines) |
| 2 | Register vendor-smoke in ADMIN_MODULES manifest | `b99fb719` | `src/lib/admin/modules.ts` (modified) |

## What Was Built

### Task 1: AdminVendorSmokeDashboard Component

Created `leanshot/src/components/admin/AdminVendorSmokeDashboard.tsx` implementing the full 52-UI-SPEC contract:

- **Table view:** Vendor / Status / Last checked / Latency / Message columns. Column headers use the exact `AdminAffiliatesReviewQueue` class: `text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3`. Rows are `tabIndex={0}` keyboard-navigable with `focus-visible:ring-2`.
- **Status badges:** `BADGE_TONE` map `{ ok: 'success', fail: 'danger', not_configured: 'neutral' }` using existing `BadgeTone` values. Labels: "ok", "fail", "not configured".
- **Four states:** Loading (`<p>Loading…</p>`), Empty (`<EmptyState>` with inline CTA), Populated (table), Error (`role="alert"` paragraph in flat Card).
- **Run smoke now button:** `RunSmokeButton` inline sub-component; `loading` prop on `<Button>` during Fn invoke; success toast on completion; error toast on failure; `fetchRows()` re-called after successful run.
- **Not-authorized state:** Renders `<NotAuthorizedCard />` from AdminShell when `is_staff()` returns false.
- **Data layer:** `supabase.from('vendor_smoke_log').select('vendor_name,status,latency_ms,message,checked_at').order('vendor_name')` on mount.
- **Icons:** `ShieldCheck` and `Play` from `lucide-react`. All colors via `var(--color-*)` tokens — no hard-coded hex.

### Task 2: ADMIN_MODULES Manifest Registration

Added to `leanshot/src/lib/admin/modules.ts`:
```ts
{
  key: 'vendor-smoke',
  label: 'Vendor health',
  route: 'vendor-smoke',
  icon: ShieldCheckIcon,  // reuses existing import at line ~45
  lazy: () => import('@/components/admin/AdminVendorSmokeDashboard').then((m) => ({ default: m.AdminVendorSmokeDashboard })),
  flagKey: 'admin.vendor_smoke.enabled',
  minRole: 'superadmin' as AdminRole,
}
```

The catch-all router branch in AdminShell.tsx (line ~118: `pathname.startsWith('/admin/${m.route}/')`) automatically covers `/admin/vendor-smoke` — no router edits needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ClinicianMfaGuard string in comment triggered grep gate**
- **Found during:** Task 1 verification
- **Issue:** The doc comment stated "NO ClinicianMfaGuard" which caused `! grep -q "ClinicianMfaGuard"` to fail.
- **Fix:** Reworded comment to "No MFA/AAL2 guard needed" — preserving the intent without the flagged string.
- **Files modified:** `AdminVendorSmokeDashboard.tsx`
- **Commit:** `9c38ac79`

### Copy Correction (Documented in Plan)

The 52-UI-SPEC copywriting table stated "06:00 UTC" for the cron description. The actual cron schedule in migration 52-02 is 08:00 UTC. Used 08:00 UTC per plan instruction.

### No MFA/AAL2 Guard (Intentional — per Planner Annotation)

`ClinicianMfaGuard` was intentionally NOT wired. This is a non-PHI admin surface. Access is controlled by:
1. `vendor_smoke_log` RLS policy (`is_staff()` — server-enforced, from 52-02 migration)
2. `minRole: 'superadmin'` manifest gate (client UX layer)

This mirrors `AdminCompliancePage` exactly (Pattern S1 dual-layer). No admin module uses AAL2/ClinicianMfaGuard.

## Threat Surface Scan

No new threat surface beyond what was declared in the plan's `<threat_model>`. The dashboard reads `vendor_smoke_log` (non-PHI, fixed error codes only), and calls `vendor-smoke` Fn (which re-validates `is_staff` server-side). T-52-09, T-52-10, T-52-11 mitigations are implemented as planned.

## Known Stubs

None. The component is fully wired:
- Data fetch: `supabase.from('vendor_smoke_log')` query on mount
- Run-now: `supabase.functions.invoke('vendor-smoke')` + refetch
- All 4 states render real UI (loading/empty/error/populated)

## Self-Check

### Created files exist

- [x] `leanshot/src/components/admin/AdminVendorSmokeDashboard.tsx` — 296 lines

### Commits exist

- [x] `9c38ac79` — feat(52-03): AdminVendorSmokeDashboard component
- [x] `b99fb719` — feat(52-03): register vendor-smoke in ADMIN_MODULES manifest

### TSC verification

- No errors in `AdminVendorSmokeDashboard.tsx` when checked in main repo's `node_modules` context.
- No errors in `modules.ts` changes.
- Single `ShieldCheck as ShieldCheckIcon` import (no duplicate).

## Self-Check: PASSED
