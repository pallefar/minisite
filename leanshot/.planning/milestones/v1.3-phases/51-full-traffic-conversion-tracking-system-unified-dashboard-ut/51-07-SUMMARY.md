---
phase: 51-full-traffic-conversion-tracking-system-unified-dashboard-ut
plan: 07
subsystem: admin/growth
tags: [admin-module, traffic-dashboard, funnel-tab, anomaly-badge, slot-overwrite, wave-4]
requires:
  - 51-03 (SECDEF accessors for traffic_funnel_rollup matview — merged on main)
  - 51-04 (compute_channel_stage_rate RPC + funnel-anomaly-cron writing admin_notifications — merged on main)
  - 51-05 (TrafficDashboardPage shell + named-export slot contract — merged on main)
provides:
  - component: TrafficFunnelsTab (named + default export; zero-prop React.FC)
  - surface: per-audience funnel rollup chart + drill-in Sheet
affects:
  - leanshot/src/components/admin/growth/TrafficFunnelsTab.tsx (overwrites 51-05 stub)
tech-stack:
  added: []
  patterns:
    - server-authoritative-rollup-via-SECDEF-RPC (per Plan 51-03 contract)
    - admin_notifications-payload-driven-anomaly-badge (no client-side recompute; per T-51-33)
    - role-aware-org-scope (clinic_owner forwards org_id; admin passes null; per T-51-31)
    - useEffect-driven-fetch (no TanStack-Query; per UI-SPEC Hard Constraint 5)
    - BaseChart-bar-config (chart.js wrapper; reuse from v1.1)
    - PostgREST-builder-thenable-mock (test-time pattern for .from().select().eq().gte())
key-files:
  created:
    - leanshot/src/components/admin/growth/TrafficFunnelsTab.test.tsx
  modified:
    - leanshot/src/components/admin/growth/TrafficFunnelsTab.tsx
decisions:
  - "Re-aggregated rate client-side as sum(out_count) / sum(in_count) across channel_group + day rows — NOT mean-of-row-rates — because matview rate column is per-(channel,day) grain, not aggregated"
  - "Anomaly badge uses tone='warning' (orange #e37748 per UI-SPEC §Color row) and copy 'Below 7-day baseline by Xσ' — visual surface only, source-of-truth is admin_notifications.kind='traffic_funnel_drop' (T-51-33 client-side-tamper mitigation)"
  - "BaseChart wrapper takes a single ChartConfiguration via the `config` prop (real API), NOT the plan-prototype's separate type/data/options props — adapted at impl time"
  - "Sheet primitive uses `onClose` + `title` props (real API), NOT the plan-prototype's `onOpenChange` + nested header — adapted at impl time"
  - "Mocked BaseChart to a sentinel `<div role='img'>` in the test file — chart.js requires HTMLCanvasElement and jsdom does not provide one; this is the consistent jsdom precedent for chart-rendering surfaces"
  - "admin_notifications RLS-deny for clinic_owner role is non-fatal (T-51-32) — funnel chart still renders, just without anomaly badges; logged silently rather than surfacing an error toast"
metrics:
  duration_min: ~30
  completed: 2026-05-24
  commits: 2
  files_touched: 2
  lines_added: 800
---

# Phase 51 Plan 07: Funnels Tab Summary

Replaces the Plan 51-05 `TrafficFunnelsTab.tsx` stub with the full Conversion Funnels surface for the `growth/traffic` admin module. 3-pill audience switcher (Consumer / Clinic-org / Affiliate), BaseChart bar chart over the SECDEF `get_traffic_funnel_rollup` RPC, per-stage anomaly badges from `admin_notifications`, and per-stage drill-in Sheet with top-5 channel-origin rows.

## What shipped

| File | Role | Lines |
|------|------|-------|
| `src/components/admin/growth/TrafficFunnelsTab.tsx` | Full impl — overwrote Plan 51-05 stub | +536 / -14 |
| `src/components/admin/growth/TrafficFunnelsTab.test.tsx` | 4 vitest+RTL tests (T1–T4) | +264 |

Commits:
- `d02784f7 feat(51-07): Funnels tab — 3-audience switcher + BaseChart + anomaly badge + drill-in`
- `c89c486c test(51-07): TrafficFunnelsTab — 4 vitest+RTL tests (TRAFFIC-06/11)`

## Verification

- ✅ `npx tsc -p tsconfig.app.json --noEmit` → 0 errors, exit 0
- ✅ `npx vitest run src/components/admin/growth/TrafficFunnelsTab.test.tsx --config vite.config.ts` → 4/4 tests pass, ~917ms
- ✅ `grep -c get_traffic_funnel_rollup` → 3 occurrences (1 RPC call site + 2 comment refs)
- ✅ `grep -c BaseChart` → 3 occurrences (1 import + 1 reuse comment + 1 JSX site)
- ✅ Typography-ceiling grep `text-\[(12|14|16|20|24|32)px\]` → no matches (only 11 / 13 / 28 px used)
- ✅ `@tanstack/react-query` import grep → no matches
- ✅ ROADMAP `51-07` checkbox flipped `[ ] → [x]`

## Slot contract preserved

| Property | Required | Shipped |
|----------|----------|---------|
| Module path | `@/components/admin/growth/TrafficFunnelsTab` | unchanged |
| Named export | `export const TrafficFunnelsTab: React.FC` | preserved |
| Default export | optional but recommended | retained for debugger ergonomics |
| Signature | zero props (React.FC) | yes — role/org read directly from `useStore` |
| Lazy-unwrap | `m.TrafficFunnelsTab` | unchanged in `TrafficDashboardPage.tsx:54` |

## Implementation notes

### Server-authoritative rollup (TRAFFIC-06 / TRAFFIC-12)

Single RPC call:

```typescript
supabase.rpc('get_traffic_funnel_rollup', {
  p_org_id: orgFilter,         // null for admin, clinic's own org_id for clinic_owner
  p_start_date: sevenAgo,      // 7-day window
  p_end_date: today,
  p_audience: audience,        // 'consumer' | 'clinic-org' | 'affiliate'
});
```

Returns rows at the (channel_group, day, stage_in, stage_out) grain. The component aggregates these to per-stage_pair totals client-side, summing `in_count` / `out_count` rather than averaging row rates — this is the only correct way to derive the funnel rate when the matview is stored at finer grain than the display.

### Anomaly indicator (TRAFFIC-11)

Parallel read against `admin_notifications` filtered by `kind='traffic_funnel_drop'` within the last 24 hours. The Plan 51-04 funnel-anomaly-cron writes one row per `(channel_group, audience, funnel, stage_pair, date)` tuple under a `dedup_key`. Matching payloads on `(audience, stage_in, stage_out)` flag the stage with a `Badge tone="warning"` carrying the worst-case σ. No client-side recomputation — the matview + cron are the source of truth (T-51-33).

For clinic_owner accounts, RLS on `admin_notifications` denies the read entirely (P27 admin-only policy → T-51-32). The component swallows the deny silently and renders the funnel without badges — the intended cross-tenant isolation behavior, not an error.

### Role-aware org scope (T-51-31)

```typescript
const role = useStore((s) =>
  (s.signedIn?.user?.app_metadata as { role?: string } | undefined)?.role ?? null,
);
const orgId = useStore((s) =>
  (s.signedIn?.user?.app_metadata as { org_id?: string } | undefined)?.org_id ?? null,
);
const orgFilter = role === 'clinic_owner' ? orgId : null;
```

This mirrors the precedent set by `TrafficDashboardPage.tsx:120–129` (51-05) for reading role/org from `app_metadata`. Admin and superadmin pass `null` to the RPC for cross-org visibility; the RPC's gate falls back to `is_admin_at_least('admin')`. clinic_owner forwards their `org_id`; the RPC checks `_is_org_clinician(p_org_id, auth.uid())`. Any other role gets a `42501` from the RPC and the UI shows "Permission denied — admin role required".

### Drill-in Sheet

Tapping any stage row opens the bottom-sheet drawer with a top-5 table re-aggregated from the SAME RPC rows (no second RPC needed — `channel_group` is already a column in the matview). The sheet uses the existing primitive's `onClose` + `title` props; copy: `Channel origin — {label_in} → {label_out}` and subtitle `Top 5 channels — {audience} cohort`.

## Deviations from Plan

### Rule 1 — Bug (adapter)

**1. Plan-prototype BaseChart API mismatch**
- **Found during:** Task 1 implementation.
- **Issue:** Plan code uses `<BaseChart type="bar" data={...} options={...} />`. Real `BaseChart` (in `src/components/dashboard/charts/BaseChart.tsx`) takes a single `config: ChartConfiguration` prop plus `ariaLabel` + optional `height`.
- **Fix:** Built a memoized `ChartConfiguration` object and passed it via `config={chartConfig}`. Added `ariaLabel` per the BaseChart contract (required), and an explicit `height={280}`.
- **Files modified:** `TrafficFunnelsTab.tsx`
- **Commit:** `d02784f7`

**2. Plan-prototype Sheet API mismatch**
- **Found during:** Task 1 implementation.
- **Issue:** Plan code uses `<Sheet open={...} onOpenChange={...}>{children}</Sheet>` with a custom h3 header inside the body. Real `Sheet` primitive uses `onClose` + `title` props and renders the title itself.
- **Fix:** Used `onClose={() => setDrillStage(null)}` + `title="Channel origin — {label_in} → {label_out}"`. Moved the subtitle copy into the body.
- **Files modified:** `TrafficFunnelsTab.tsx`
- **Commit:** `d02784f7`

### Rule 2 — Critical functionality

**3. Anomaly read failure is non-fatal**
- **Found during:** Task 1 implementation; reviewing T-51-32 mitigation.
- **Issue:** Plan-prototype unconditionally trusted `anomalyData`. clinic_owner accounts RLS-deny on `admin_notifications` (P27 admin-only). Without a defensive branch, RLS errors would either propagate or set anomalies to `null`/`undefined`, breaking the badge filter.
- **Fix:** Wrap anomaly payload extraction in `(!notifErr && anomalyData)` and silently default to `[]` on either failure. Also added a runtime type-guard `typeof channel_group === 'string'` to drop malformed jsonb payloads. Funnel chart still renders.
- **Files modified:** `TrafficFunnelsTab.tsx`
- **Commit:** `d02784f7`

**4. Disable Refresh button while loading**
- **Found during:** Task 1 implementation.
- **Issue:** Plan-prototype Refresh button has no loading state — double-clicks fire racing RPCs.
- **Fix:** Added `disabled={loading}` to the Refresh `<Button>`.
- **Files modified:** `TrafficFunnelsTab.tsx`
- **Commit:** `d02784f7`

### Rule 3 — Blocking issue

**5. cwd-drift to main repo at start of execution**
- **Found during:** Pre-commit safety asserts.
- **Issue:** First Write/Bash batch operated under cwd `/Users/karstenhaldan/minisite` (the main repo root), NOT the worktree at `/Users/karstenhaldan/minisite/.claude/worktrees/agent-ac57adb155a83af9c/`. This is the documented `feedback_worktree_executor_pwd_drift_leaks_to_main` failure mode (MEMORY.md). Files landed in main; the worktree branch had no commits.
- **Fix:** Copied the two written files (`TrafficFunnelsTab.tsx` + `TrafficFunnelsTab.test.tsx`) into the worktree, ran `git checkout -- ` + `rm` to restore main to baseline (only pre-existing ROADMAP.md drift unrelated to this plan remained), symlinked `node_modules` from main into worktree to avoid `npm install` cost (per `reference_sentry_capacitor_npm_install_blocker`), re-ran tsc + vitest from the worktree (all green), then committed from the per-agent worktree branch.
- **Files modified:** (filesystem-level recovery, no commits in main repo)
- **Commit:** rescue done before `d02784f7` landed; main repo working tree clean except pre-existing ROADMAP drift.

### Test infrastructure

**6. PostgREST builder needs thenable mock**
- **Found during:** Task 2 test authoring.
- **Issue:** `supabase.from('admin_notifications').select('payload').eq('kind', '...').gte('created_at', '...')` is awaited directly. Standard `vi.fn()` doesn't model PostgREST's fluent thenable shape.
- **Fix:** Built a chainable builder object whose `.then(resolve)` returns `{ data: mockNotifPayloads, error: null }`. Each test mutates `mockNotifPayloads` to seed an anomaly or not.
- **Files modified:** `TrafficFunnelsTab.test.tsx`
- **Commit:** `c89c486c`

## Threat coverage (51-07 register)

| Threat ID | Disposition | Mitigation surface |
|-----------|-------------|--------------------|
| T-51-31 — clinic_owner reads other org funnels | mitigate | RPC SECDEF gate (_is_org_clinician) + `orgFilter` forced from app_metadata.org_id |
| T-51-32 — admin_notifications payload leaks internals | accept | clinic_owner RLS deny on admin_notifications (P27); component silently renders without badges |
| T-51-33 — client-side rate tampering | accept | matview rates are authoritative; client `(out/in)*100` is presentation-only formatting |

## Threat Flags

(None — this plan introduces no new network endpoints, auth paths, file-access patterns, or schema changes. All SQL reads route through pre-existing 51-03 SECDEF accessors + 51-04 cron-written notifications.)

## Self-Check: PASSED

- ✅ `leanshot/src/components/admin/growth/TrafficFunnelsTab.tsx` — exists, overwritten (536 lines)
- ✅ `leanshot/src/components/admin/growth/TrafficFunnelsTab.test.tsx` — exists (264 lines)
- ✅ Commit `d02784f7` — present on branch `worktree-agent-ac57adb155a83af9c`
- ✅ Commit `c89c486c` — present on branch `worktree-agent-ac57adb155a83af9c`
