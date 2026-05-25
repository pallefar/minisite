---
phase: 56-ad-network
plan: 05
type: execute
wave: 2
depends_on: [56-02]
files_modified:
  - leanshot/src/components/admin/growth/AdRevenueDashboardPage.tsx
  - leanshot/src/components/admin/growth/AdRevenueDashboardPage.test.tsx
  - leanshot/src/lib/admin/modules.ts
autonomous: true
requirements: [AD-06]
must_haves:
  truths:
    - "Admin nav shows an 'Ad Revenue' module under /admin/growth/ad-revenue"
    - "The dashboard renders eCPM / RPM / fill rate / CTR KPI tiles grouped by placement + network"
    - "The dashboard reads revenue via the get_ad_revenue_dashboard SECDEF RPC (admin-only)"
    - "Clicking the module routes to the dashboard (manifest route matches URL prefix — no router drift)"
  artifacts:
    - path: "leanshot/src/components/admin/growth/AdRevenueDashboardPage.tsx"
      provides: "Ad revenue dashboard reusing AdminMetrics KPI-strip pattern"
      exports: ["AdRevenueDashboardPage"]
    - path: "leanshot/src/lib/admin/modules.ts"
      provides: "ad-revenue ADMIN_MODULES entry"
      contains: "ad-revenue"
  key_links:
    - from: "leanshot/src/lib/admin/modules.ts"
      to: "AdRevenueDashboardPage"
      via: "lazy import + route 'growth/ad-revenue'"
      pattern: "growth/ad-revenue"
    - from: "leanshot/src/components/admin/growth/AdRevenueDashboardPage.tsx"
      to: "get_ad_revenue_dashboard"
      via: "supabase.rpc"
      pattern: "get_ad_revenue_dashboard"
---

<objective>
Build the admin revenue dashboard (AD-06): a new admin module `AdRevenueDashboardPage` reusing the `AdminMetrics*` KPI-strip pattern (eCPM / RPM / fill rate / CTR tiles by placement + network) reading from the `get_ad_revenue_dashboard` SECDEF RPC, registered via a single `ADMIN_MODULES` manifest entry with `route: 'growth/ad-revenue'` (URL-prefix routing — no hardcoded switch branch, avoids manifest↔router drift).

Purpose: Surfaces the revenue side of the unit-economics loop for staff. Reuses the existing admin design system (no new UI-SPEC per D). Verifiable now with mocked RPC data (real eCPM/RPM arrive with publisher fill at P70). The manifest `route` MUST be `'growth/ad-revenue'` (NOT `'ad-revenue'`) so AdminShell's `pathname.startsWith('/admin/growth/ad-revenue/')` prefix match resolves it (Pitfall 7).
Output: dashboard page + render test + manifest entry.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/56-ad-network/56-RESEARCH.md
@.planning/phases/56-ad-network/56-02-SUMMARY.md
@leanshot/src/lib/admin/modules.ts

<interfaces>
<!-- Verified from codebase. Reuse the existing growth/CAC module as the closest analog. -->

ADMIN_MODULES entry shape (src/lib/admin/modules.ts, interface AdminModule):
```
{ key: string; label: string; route: string; icon; lazy: () => Promise<{default: ComponentType}>; flagKey: string; minRole: AdminRole; }
```
Closest analog to COPY: the growth/cac entry (route: 'growth/cac', lazy → CACDashboardPage). Mirror its structure exactly. Use route: 'growth/ad-revenue', minRole: 'admin' as AdminRole, flagKey: 'admin.growth.ad_revenue.enabled', icon: reuse an already-imported icon (e.g. TrendingUpIcon).

Routing: AdminShell.tsx uses URL-prefix matching against `route`. A manifest entry is sufficient — do NOT add a switch branch (feedback_admin_module_manifest_vs_router_branch_drift).

AdminMetrics pattern (RESEARCH §6): AdminMetricsKpiStrip.tsx renders 4 <Card span={3}> tiles with useCountUp. Reuse the same 4-tile pattern for eCPM / RPM / fill rate / CTR. Group rows by network+placement.

Data source (from 56-02-SUMMARY.md): get_ad_revenue_dashboard(p_start_date, p_end_date) SECDEF RPC returns (network, report_date, impressions, clicks, fill_rate, estimated_revenue_usd, ecpm_usd, rpm_usd). CTR = clicks/impressions; the RPC returns the raw counts — compute CTR client-side. Call via supabase.rpc('get_ad_revenue_dashboard', {...}) using the existing admin supabase client import.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: AdRevenueDashboardPage (eCPM/RPM/fill/CTR) (AD-06)</name>
  <files>leanshot/src/components/admin/growth/AdRevenueDashboardPage.tsx, leanshot/src/components/admin/growth/AdRevenueDashboardPage.test.tsx</files>
  <behavior>
    - Renders 4 KPI tiles labeled eCPM, RPM, Fill Rate, CTR (reusing the AdminMetricsKpiStrip Card pattern).
    - Given mocked RPC rows, computes CTR = clicks/impressions (0 when impressions===0) and shows fill_rate as a percentage.
    - Renders a per-network + per-placement breakdown (table or grouped rows) from the RPC result.
    - Handles empty result (no revenue yet — pre-P70) with an empty state, not a crash.
  </behavior>
  <action>Create src/components/admin/growth/AdRevenueDashboardPage.tsx exporting AdRevenueDashboardPage. On mount, call supabase.rpc('get_ad_revenue_dashboard', { p_start_date, p_end_date }) (reuse the admin supabase client — grep src/lib/admin or the CACDashboardPage for the client import). Aggregate rows into the 4 KPIs (eCPM avg, RPM avg, fill rate avg, CTR = total clicks / total impressions with divide-by-zero guard) rendered via the AdminMetrics KPI-strip Card pattern (4× Card span={3} with useCountUp). Below the strip, render a per-network+placement breakdown. Empty state when no rows. Match the existing growth dashboard layout/DS — no new design tokens (reuse admin DS per D). Write AdRevenueDashboardPage.test.tsx (RED) with a mocked rpc returning sample rows: assert the 4 tile labels render, CTR computed correctly, fill rate shown, and an empty-result render shows the empty state.</action>
  <verify>
    <automated>cd leanshot && npx vitest run src/components/admin/growth/AdRevenueDashboardPage.test.tsx --config vite.config.ts</automated>
  </verify>
  <done>Dashboard renders eCPM/RPM/fill/CTR tiles from mocked RPC data with correct CTR + empty-state handling; tests green.</done>
</task>

<task type="auto">
  <name>Task 2: Register ad-revenue admin module (manifest entry, no router drift)</name>
  <files>leanshot/src/lib/admin/modules.ts</files>
  <action>Add ONE ADMIN_MODULES entry mirroring the growth/cac entry: key:'ad-revenue', label:'Ad Revenue', route:'growth/ad-revenue' (MUST match the /admin/growth/ad-revenue URL prefix — Pitfall 7; NOT 'ad-revenue'), icon: an already-imported icon (TrendingUpIcon or the icon CAC uses), lazy: () => import('@/components/admin/growth/AdRevenueDashboardPage').then((m) => ({ default: m.AdRevenueDashboardPage })), flagKey:'admin.growth.ad_revenue.enabled', minRole:'admin' as AdminRole. Do NOT add a switch branch in AdminShell.tsx — the URL-prefix match handles routing (drift lesson). Do not import native/health.</action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && grep -q "growth/ad-revenue" leanshot/src/lib/admin/modules.ts && grep -q "AdRevenueDashboardPage" leanshot/src/lib/admin/modules.ts && cd leanshot && npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -i "modules.ts" || echo "tsc-clean-for-modules"</automated>
  </verify>
  <done>Manifest has the ad-revenue entry with route 'growth/ad-revenue' and lazy import of AdRevenueDashboardPage; no AdminShell switch branch added; tsc clean.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| admin client → revenue RPC | staff-only revenue data crosses to the browser |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-56-14 | Information Disclosure | AdRevenueDashboardPage data | mitigate | reads via get_ad_revenue_dashboard SECDEF RPC which raises 42501 for non-admins; module minRole 'admin' |
| T-56-15 | Elevation of Privilege | admin module routing | mitigate | manifest minRole 'admin' + AdminShell role gate; URL-prefix route matches (no unreachable/fall-through branch) |
</threat_model>

<verification>
- Task verify commands (dashboard render test + manifest grep + tsc).
- Module reachability: route 'growth/ad-revenue' matches AdminShell pathname.startsWith('/admin/growth/ad-revenue/') — verified by convention (Pitfall 7) and the render test importing the lazy target.
</verification>

<success_criteria>
A reachable admin module renders eCPM/RPM/fill/CTR by placement+network from the admin-only RPC, registered via a single manifest entry with the correct route prefix and no router drift — proven by render test + manifest grep.
</success_criteria>

<output>
Create `.planning/phases/56-ad-network/56-05-SUMMARY.md` when done. Confirm the module route and the RPC call signature used.
</output>
