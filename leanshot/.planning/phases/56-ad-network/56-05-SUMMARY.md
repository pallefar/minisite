---
phase: 56-ad-network
plan: "05"
subsystem: admin-growth
tags: [admin, revenue, ad-network, dashboard, kpi]
dependency_graph:
  requires: [56-02]
  provides: [AdRevenueDashboardPage, admin-module-growth-ad-revenue]
  affects: [leanshot/src/lib/admin/modules.ts]
tech_stack:
  added: []
  patterns: [AdminMetrics-KpiStrip-Card-span-3, useCountUp, URL-prefix-manifest-routing, Pattern-S1-dual-layer]
key_files:
  created:
    - leanshot/src/components/admin/growth/AdRevenueDashboardPage.tsx
    - leanshot/src/components/admin/growth/AdRevenueDashboardPage.test.tsx
  modified:
    - leanshot/src/lib/admin/modules.ts
decisions:
  - "Used body prop (not description) for EmptyState — matched existing EmptyStateProps interface"
  - "Used getAllByText in tests to handle aria-label duplicates (KPI tile label + aria-label value both contain label text)"
  - "CTR computed client-side as total clicks / total impressions with explicit divide-by-zero guard"
  - "Route 'growth/ad-revenue' (NOT 'ad-revenue') per Pitfall 7 — AdminShell pathname.startsWith prefix match"
  - "TrendingUpIcon reused from existing modules.ts import — no new icon import needed"
metrics:
  duration: "~8 minutes"
  completed: "2026-05-25"
  tasks_completed: 2
  files_created: 2
  files_modified: 1
requirements: [AD-06]
---

# Phase 56 Plan 05: Admin Revenue Dashboard Summary

Admin revenue dashboard (AD-06) shipping eCPM/RPM/fill rate/CTR KPI strip + per-network breakdown table reusing AdminMetrics Card pattern, registered via a single ADMIN_MODULES manifest entry at route `growth/ad-revenue`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | AdRevenueDashboardPage (RED) | fbff2997 | AdRevenueDashboardPage.test.tsx |
| 1 | AdRevenueDashboardPage (GREEN) | ae3225e9 | AdRevenueDashboardPage.tsx, .test.tsx |
| 2 | Register ad-revenue manifest entry | 1f09b980 | modules.ts, AdRevenueDashboardPage.tsx, .test.tsx |

## What Was Built

**AdRevenueDashboardPage** (`leanshot/src/components/admin/growth/AdRevenueDashboardPage.tsx`):
- 4 KPI tiles (eCPM / RPM / Fill Rate / CTR) using Card span={3} + useCountUp — mirrors AdminMetricsKpiStrip pattern exactly
- CTR computed client-side: total clicks / total impressions with divide-by-zero guard (returns 0 when impressions === 0)
- Fill rate rendered as percentage from raw decimal `fill_rate` field
- Per-network breakdown table with columns: Network, Impressions, Clicks, CTR, Fill Rate, eCPM, RPM, Revenue
- Network aggregation groups multiple rows by `network` key (avg eCPM/RPM/fill, summed impressions/clicks/revenue)
- Empty state when RPC returns `[]` or `null` (pre-P70 no-data scenario)
- Skeleton loading state + RPC error state
- All reads via `get_ad_revenue_dashboard(p_start_date, p_end_date)` SECDEF RPC — no direct table reads
- Default date range: last 30 days, computed at mount
- No hardcoded hex colors — CSS design tokens only (`var(--color-*)`)

**ADMIN_MODULES entry** (`leanshot/src/lib/admin/modules.ts`):
- key: `growth-ad-revenue`, label: `Ad Revenue`, route: `growth/ad-revenue`
- icon: `TrendingUpIcon` (already imported — no new import added)
- minRole: `admin` (Pattern S1 UX layer; SECDEF RPC re-checks server-side)
- flagKey: `admin.growth.ad_revenue.enabled`
- No AdminShell switch branch — URL-prefix routing resolves `/admin/growth/ad-revenue/` automatically

**Tests** (8 passing):
- 4 KPI tile labels render (getAllByText handles aria-label duplicates)
- CTR present after mock RPC
- Fill rate tile present
- Per-network breakdown (google, meta) renders network names
- Empty state for `[]` result
- Empty state for `null` result
- Divide-by-zero guard: zero impressions renders without crash
- get_ad_revenue_dashboard RPC called on mount with p_start_date / p_end_date

## RPC Call Signature Used

```typescript
supabase.rpc('get_ad_revenue_dashboard', {
  p_start_date: 'YYYY-MM-DD',
  p_end_date: 'YYYY-MM-DD',
})
// Returns: AdRevenueRow[] | null
// AdRevenueRow: { network, report_date, impressions, clicks, fill_rate,
//                 estimated_revenue_usd, ecpm_usd, rpm_usd }
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] EmptyState `description` prop → `body` prop**
- **Found during:** tsc check after Task 1 implementation
- **Issue:** Plan spec said "empty state" without specifying prop name; implementation used `description` but EmptyStateProps only has `body`
- **Fix:** Changed both EmptyState call sites to use `body` prop
- **Files modified:** AdRevenueDashboardPage.tsx
- **Commit:** 1f09b980

**2. [Rule 1 - Bug] Test assertions with `getByText` → `getAllByText`**
- **Found during:** GREEN phase test run
- **Issue:** KPI tile label text (e.g., "eCPM") appears in both the visible label div AND the aria-label attribute value; `getByText` fails on multiple matches
- **Fix:** All KPI label and empty-state assertions use `getAllByText(...).length > 0`
- **Files modified:** AdRevenueDashboardPage.test.tsx
- **Commits:** ae3225e9, 1f09b980

## Threat Mitigations Applied

| Threat ID | Mitigation |
|-----------|-----------|
| T-56-14 (Info Disclosure) | Data reads via get_ad_revenue_dashboard SECDEF RPC — raises 42501 for non-admins |
| T-56-15 (EoP via routing) | manifest minRole 'admin' + route 'growth/ad-revenue' — no fall-through or unreachable branch |

## Known Stubs

None — the dashboard renders real RPC data; empty state is intentional for pre-P70 no-data scenario.

## Self-Check: PASSED

- [x] `leanshot/src/components/admin/growth/AdRevenueDashboardPage.tsx` exists
- [x] `leanshot/src/components/admin/growth/AdRevenueDashboardPage.test.tsx` exists
- [x] Commit fbff2997 exists (test RED)
- [x] Commit ae3225e9 exists (implementation GREEN)
- [x] Commit 1f09b980 exists (manifest + fixes)
- [x] `grep "growth/ad-revenue" modules.ts` passes
- [x] `grep "AdRevenueDashboardPage" modules.ts` passes
- [x] tsc clean (no modules.ts or AdRevenueDashboardPage errors)
- [x] 8/8 tests passing
