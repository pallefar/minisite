---
phase: 51-full-traffic-conversion-tracking-system-unified-dashboard-ut
plan: 05
subsystem: admin/growth
tags: [admin-module, traffic-dashboard, ui-shell, slot-contract, wave-4-shell]
requires:
  - 51-03 (Wave-3 matview/RPC scaffolding — already merged on main)
provides:
  - admin-module: growth-traffic (route /admin/growth/traffic)
  - component: TrafficDashboardPage (default + named export)
  - slot: 5 named-export sub-tab stubs that Plans 51-06..09 overwrite
affects:
  - src/lib/admin/modules.ts (sibling entry next to growth-cac)
tech-stack:
  added: []
  patterns:
    - admin-module-sibling-entry (per [[feedback_admin_module_manifest_vs_router_branch_drift]])
    - stub-then-replace (per [[feedback_stub_then_replace_sibling_collision]])
    - URL-prefix-routing (popstate + history.pushState — no react-router)
key-files:
  created:
    - leanshot/src/components/admin/growth/TrafficDashboardPage.tsx
    - leanshot/src/components/admin/growth/TrafficDashboardPage.test.tsx
    - leanshot/src/components/admin/growth/TrafficChannelsTab.tsx (stub for 51-06)
    - leanshot/src/components/admin/growth/TrafficFunnelsTab.tsx (stub for 51-07)
    - leanshot/src/components/admin/growth/TrafficLandingPagesTab.tsx (stub for 51-08)
    - leanshot/src/components/admin/growth/TrafficRealtimeTab.tsx (stub for 51-09)
    - leanshot/src/components/admin/growth/TrafficTaxonomyPage.tsx (stub for 51-09)
  modified:
    - leanshot/src/lib/admin/modules.ts (added Activity lucide import + growth-traffic entry)
decisions:
  - "Sourced clinic_owner role from s.signedIn?.user?.app_metadata?.role (real codebase shape; PricingIOS.tsx precedent line 69) instead of the plan's fictional s.user.role"
  - "Used Pill active={bool} (Pill internally sets aria-pressed); used PillGroup segmented for role=tablist (the existing API surface)"
  - "Stub sub-tabs ship both NAMED + default exports — TrafficDashboardPage lazy-unwraps the NAMED export, which is the load-bearing slot contract"
metrics:
  duration_min: ~25
  completed: 2026-05-24
  commits: 1
  files_touched: 8
  lines_added: 523
---

# Phase 51 Plan 05: TrafficDashboardPage Admin Module Shell Summary

JWT-style sibling admin module to `growth-cac`: registers `growth-traffic` in
`ADMIN_MODULES`, ships a `TrafficDashboardPage` with 5-pill segmented PillGroup
+ URL-driven tab state, and locks a 5-slot stub contract so Wave-4 plans
51-06..09 can land their sub-tab implementations in parallel without same-file
merge collisions.

## What shipped

| File | Role | Lines |
|------|------|-------|
| `src/lib/admin/modules.ts` | +1 manifest entry (`growth-traffic`), +1 lucide import (`Activity as ActivityIcon`) | +30 |
| `src/components/admin/growth/TrafficDashboardPage.tsx` | Page shell: header + 5-pill tablist + URL-driven active-tab + lazy sub-tab Suspense | +209 |
| `src/components/admin/growth/TrafficDashboardPage.test.tsx` | 5 vitest+RTL tests (T1–T5) | +127 |
| `src/components/admin/growth/TrafficChannelsTab.tsx` | Stub for Plan 51-06 | +29 |
| `src/components/admin/growth/TrafficFunnelsTab.tsx` | Stub for Plan 51-07 | +23 |
| `src/components/admin/growth/TrafficLandingPagesTab.tsx` | Stub for Plan 51-08 | +23 |
| `src/components/admin/growth/TrafficRealtimeTab.tsx` | Stub for Plan 51-09 (real-time tab) | +26 |
| `src/components/admin/growth/TrafficTaxonomyPage.tsx` | Stub for Plan 51-09 (taxonomy admin) | +22 |

Commit: `266b7f73 feat(51-05): TrafficDashboardPage shell + growth-traffic admin module + 5 slot stubs`

## Verification

- ✅ `npx tsc -p tsconfig.app.json --noEmit` → 0 errors, exit 0
- ✅ `npx vitest run --config vite.config.ts src/components/admin/growth/TrafficDashboardPage.test.tsx` → 5/5 tests pass, ~870ms
- ✅ Typography drift grep `text-[12|14|16|20|24|32px]` → none (only 11 / 13 / 18 px used; 28px reserved for 51-09 hero metric)
- ✅ Bundle-budget grep `@tanstack/react-query` → not imported
- ✅ ROADMAP `51-05` checkbox flipped `[ ] → [x]`

## Manifest entry shape audit (vs `growth-cac`)

| Field | growth-cac | growth-traffic | Notes |
|-------|-----------|----------------|-------|
| `key` | `growth-cac` | `growth-traffic` | sibling naming |
| `label` | `Ad Spend / CAC` | `Traffic` | per UI-SPEC |
| `route` | `growth/cac` | `growth/traffic` | URL-prefix sub-routes auto-resolve in AdminShell |
| `icon` | `TrendingUpIcon` | `ActivityIcon` | per UI-SPEC + plan instruction; new lucide import added at top of file |
| `lazy` | named-export unwrap pattern | identical (`m.TrafficDashboardPage`) | matches CAC verbatim |
| `flagKey` | `admin.growth.cac.enabled` | `admin.growth.traffic.enabled` | naming convention preserved |
| `minRole` | `'admin'` | `'admin'` | Pattern S1 UX layer |
| `navGroup` field | not present | not present | confirmed by manifest read — UI-SPEC mentioned a "shared Growth nav group" but the existing growth-cac entry has no `navGroup` field; current AdminShell does not consume one. No addition needed. |

## ⚠️ Forward effects — slot contract for Plans 51-06..09

Wave-4 parallel plans 51-06..09 WILL overwrite the 5 stub sub-tab files
shipped here. They MUST respect this contract verbatim — otherwise the
shell's lazy import + Suspense slot will break:

| Slot | Owning plan | Module path | Required export shape |
|------|-------------|-------------|----------------------|
| TRAFFIC-CHANNEL-ROLLUP | **51-06** | `./TrafficChannelsTab` (i.e. `@/components/admin/growth/TrafficChannelsTab`) | **named** `export const TrafficChannelsTab: React.FC` (no props) |
| TRAFFIC-FUNNEL | **51-07** | `./TrafficFunnelsTab` | **named** `export const TrafficFunnelsTab: React.FC` (no props) |
| TRAFFIC-LANDING | **51-08** | `./TrafficLandingPagesTab` | **named** `export const TrafficLandingPagesTab: React.FC` (no props) |
| TRAFFIC-REALTIME | **51-09** (part A) | `./TrafficRealtimeTab` | **named** `export const TrafficRealtimeTab: React.FC` (no props) |
| TRAFFIC-TAXONOMY | **51-09** (part B) | `./TrafficTaxonomyPage` | **named** `export const TrafficTaxonomyPage: React.FC` (no props) |

### Hard constraints downstream plans MUST honor

1. **Named export is load-bearing.** TrafficDashboardPage.tsx does
   `import('./TrafficChannelsTab').then((m) => ({ default: m.TrafficChannelsTab }))`.
   Renaming/removing the named export breaks the slot. Default exports on the
   stub files are decorative; downstream plans may keep, replace, or drop the
   default export, but **must keep the named export under the same identifier**.

2. **No-props signature.** The shell passes zero props to sub-tabs. If a
   downstream plan needs role/org context, it must read directly from
   `useStore` — do not add props to the sub-tab component signature.

3. **Lazy chunk boundary stays at the slot.** The shell already wraps slot
   renders in `<Suspense fallback={<Skeleton .../>}>`. Sub-tab implementations
   may add their own Skeletons for in-tab loading, but should NOT re-export
   themselves via dynamic `import()` from within the file — that would
   double-lazy and break Suspense fallback timing.

4. **Slot marker comments are stable.** The 5 comment markers
   (`{/* TRAFFIC-CHANNEL-ROLLUP slot — Plan 51-06 */}` and siblings) live
   inside the Suspense JSX. Downstream plans MUST NOT delete or relocate these
   markers — they are the merge-conflict-resolution anchors for the Wave-4
   N-way merge.

5. **Typography ceiling: 11 / 13 / 18 / 28 px only.** Sub-tab implementations
   inherit the UI-SPEC ceiling. Linting/grep gates in 51-06..09 verify cards
   are constrained. The shell uses 11px (subtitle) + 18px (H1); 13px and 28px
   are reserved for sub-tabs.

6. **No `@tanstack/react-query`.** Existing CAC pattern is the canon:
   `useState + useEffect + useCallback fetchX` over Supabase RPC. Real-time
   tab's 5-min polling MUST use `setInterval` per UI-SPEC §Real-time polling.

7. **Visibility-pause:** Real-time tab (51-09 part A) should pause polling
   when `document.visibilityState === 'hidden'` per UI-SPEC §Real-time
   polling. This is a sub-tab concern — shell doesn't gate it.

## Deviations from plan

### Adjusted to match real APIs (Rule 1 — bugs in plan instructions)

1. **`Pill` prop is `active` not `aria-pressed`.** The plan's example JSX wrote
   `<Pill aria-pressed={activeTab === 'channels'}>`. The actual `Pill` component
   at `src/components/ui/Pill.tsx:33` already sets `aria-pressed={active}`
   internally; consumers pass `active={bool}`. Files using `aria-pressed`
   directly would still work (passed through as a button attr) but conflict
   with the internal one. **Fix:** used `active={...}` consistently.

2. **`PillGroup` `role` API.** Plan wrote `<PillGroup role="tablist"
   ariaLabel="...">`. Actual `PillGroup` accepts a `segmented?: boolean` prop
   that emits `role="tablist"` automatically (and the default emits
   `role="group"`); `ariaLabel` is not a prop — `aria-label` passes via
   `...rest`. **Fix:** used `<PillGroup segmented aria-label="...">`.

3. **`EmptyState` prop names.** Plan wrote `<EmptyState heading="..." body="..."/>`.
   Actual API is `title` (not `heading`) per `src/components/ui/EmptyState.tsx`.
   **Fix:** stub files use `title=`.

4. **Store user shape doesn't have `role` / `org.name`.** Plan's `useStore`
   mock `{ user: { role: 'clinic_owner', org: { name: 'Acme Clinic' } } }`
   refers to fields that don't exist on the real `User` type. The actual
   role-detection precedent is at `src/components/PricingIOS.tsx:69` which
   reads `s.signedIn?.user?.app_metadata?.role`. **Fix:** shell reads from
   `app_metadata.{role, org_name}` defensively; test mocks the same path.
   This kept Test T5 ("Acme Clinic" subtitle) honest against the real schema.

### Auto-fixed environmental issues (Rule 3 — blocking)

5. **No `node_modules` in worktree.** Per `reference_npm_install_worktree_main_drift`,
   `node_modules/` is gitignored and worktrees don't inherit. **Fix:** symlinked
   `/Users/karstenhaldan/minisite/leanshot/node_modules` into the worktree
   leanshot/ (not committed; appears as untracked symlink in `git status`).

6. **vitest 4.x `projects:` config masks default test runner.** Per
   `reference_vitest_4_projects_config_masks_default`, plain
   `npx vitest run src/...` returns "No test files found" because the
   phase38-eval project config is loaded instead. **Fix:** used
   `--config vite.config.ts` workaround. The plan's verify command would
   have hit this; SUMMARY documents it so the verifier doesn't re-trip.

### Authentication gates

None — this plan ships pure UI shell + manifest. No vendor secrets, no auth
flows, no Edge Fn deploys.

## Known stubs

The 5 stub sub-tab files (`TrafficChannelsTab.tsx`, `TrafficFunnelsTab.tsx`,
`TrafficLandingPagesTab.tsx`, `TrafficRealtimeTab.tsx`, `TrafficTaxonomyPage.tsx`)
each render an `EmptyState` placeholder. These are **intentional stubs** owned
by Plans 51-06..09 — see "Forward effects" section above. The shell does NOT
need to wire data to ship; the plan deliberately defers data wiring to the
parallel Wave-4 sub-plans.

The stubs are NOT a goal failure for Plan 51-05 — the plan's stated objective
is "Create the growth/traffic admin module shell … this plan provides the shell
so Plans 51-06..09 can land sub-tabs in parallel" (51-05-PLAN.md `<objective>`).
Stub-then-replace is the canonical Wave parallelism pattern per
`feedback_stub_then_replace_sibling_collision`.

## Threat flags

None — no new network endpoints, no auth paths, no schema changes. The
threat register's `T-51-25 / T-51-26 / T-51-27` items are addressed by:

- **T-51-25 (privilege escalation):** ADMIN_MODULES `minRole: 'admin'` enforced
  by AdminShell role-filter (existing Phase 24 mechanism).
- **T-51-26 (clinic-owner cross-org leak):** scope-aware subtitle in shell;
  data-fetching gates are downstream in 51-06..09 SECDEF RPCs.
- **T-51-27 (URL path injection):** `TAB_FROM_PATH` whitelist; unknown paths
  fall back to `'channels'`; no string interpolation into DOM.

## Self-Check: PASSED

- ✅ File `leanshot/src/components/admin/growth/TrafficDashboardPage.tsx` exists
- ✅ File `leanshot/src/components/admin/growth/TrafficDashboardPage.test.tsx` exists
- ✅ Files `Traffic{Channels,Funnels,LandingPages,Realtime}Tab.tsx` + `TrafficTaxonomyPage.tsx` exist
- ✅ `src/lib/admin/modules.ts` contains `growth-traffic` entry
- ✅ Commit `266b7f73` present in `git log --all`
- ✅ ROADMAP.md `51-05` row flipped to `[x]`
