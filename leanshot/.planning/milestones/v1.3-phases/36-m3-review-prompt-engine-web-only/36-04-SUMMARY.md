---
phase: 36-m3-review-prompt-engine-web-only
plan: 04
subsystem: admin-ui
tags: [nps, admin, rule-builder, funnel, ab-variant, ship-winner, secdef-rpc, surface-d, surface-e, surface-f]

# Dependency graph
requires:
  - phase: 36-m3-review-prompt-engine-web-only
    plan: 01
    provides: review_prompt_rules + review_prompt_history.copy_variant (B2 column) + review_cta_catalog 5-row seed + list_review_prompt_rules / create / update / delete SECDEF RPCs + list_review_cta_catalog RPC
  - phase: 27-modular-admin-shell-extensions
    provides: cohort_definitions table + AdminCohortList primitives (CohortPicker wraps the same data source shape)
  - phase: 34-m2-onboarding-overhaul-activation-event
    provides: ship-winner-flag Edge Fn (re-used VERBATIM — no fork) + EVENTS.activation_completed.nps_trigger_eligible flag
  - phase: 24-foundation-modular-admin-shell-event-taxonomy-server-side-po
    provides: ADMIN_MODULES manifest + AdminShell prefix-branch routing + EventDef.nps_trigger_eligible field

provides:
  - public.review_funnel_aggregate(int) SECDEF RPC — admin-gated aggregator returning { prompts_shown, rated_internal, external_clicked, by_variant jsonb }; reads copy_variant DIRECTLY from review_prompt_history (B2/W5; NO events_mirror fallback)
  - src/admin/modules/reviews/* — 5 pages + 1 router barrel + 5 vitest suites
  - src/components/admin/cohort/CohortPicker.tsx — net-new shared primitive (Pitfall 5 closed)
  - ADMIN_MODULES.reviews now real (placeholderFor removed; minRole upgraded staff→admin)

affects:
  - 36-05 (E2E test harness) — admin reviews module surface available for headless click-through
  - Phase 42+ (Ship-Winner consolidation) — when a shared ShipWinnerButton ships, VariantGrid + OnboardingABPanel both migrate

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module router barrel: index.ts re-exports ReviewsLayout default; ReviewsLayout owns trailing-segment switch (mirrors helpdesk/index.ts pattern)"
    - "Ship-Winner reuse contract — data-action=\"ship-winner\" attribute + invoke('ship-winner-flag', { body: { flag_id, variant } }) verbatim from OnboardingABPanel.tsx"
    - "SECDEF aggregator with COALESCE(copy_variant,'control') GROUP BY (B2/W5 direct read; no events_mirror lossy join)"
    - "Vitest mockImplementation routing by rpc fn-name argument for tests that issue multiple sequential RPC calls (cleaner than mockResolvedValueOnce stacking)"

key-files:
  created:
    - leanshot/src/admin/modules/reviews/index.ts
    - leanshot/src/admin/modules/reviews/ReviewsLayout.tsx
    - leanshot/src/admin/modules/reviews/RulesListPage.tsx
    - leanshot/src/admin/modules/reviews/RuleFormPanel.tsx
    - leanshot/src/admin/modules/reviews/FunnelDashboardPage.tsx
    - leanshot/src/admin/modules/reviews/VariantGrid.tsx
    - leanshot/src/admin/modules/reviews/CtaCatalogPage.tsx
    - leanshot/src/admin/modules/reviews/__tests__/RulesListPage.test.tsx
    - leanshot/src/admin/modules/reviews/__tests__/RuleFormPanel.test.tsx
    - leanshot/src/admin/modules/reviews/__tests__/FunnelDashboardPage.test.tsx
    - leanshot/src/admin/modules/reviews/__tests__/VariantGrid.test.tsx
    - leanshot/src/admin/modules/reviews/__tests__/CtaCatalogPage.test.tsx
    - leanshot/src/components/admin/cohort/CohortPicker.tsx
    - leanshot/src/components/admin/cohort/__tests__/CohortPicker.test.tsx
    - supabase/migrations/20270710000006_p36_review_funnel_aggregate_rpc.sql
    - supabase/migrations/__tests__/p36_funnel_aggregate.test.ts
  modified:
    - leanshot/src/lib/admin/modules.ts (reviews entry: lazy import @/admin/modules/reviews + minRole 'admin')

key-decisions:
  - "Module barrel pattern: index.ts (no JSX) re-exports the default from ReviewsLayout.tsx (JSX) — matches helpdesk/index.ts shape. Prevents JSX-in-.ts compile error while keeping the lazy import path stable (lib/admin/modules.ts:lazy: () => import('@/admin/modules/reviews'))."
  - "ReviewsLayout owns the trailing-segment switch (rules/funnel/cta-catalog). AdminShell.tsx already prefix-branches /admin/reviews/* (line 119); no router-code change required per [[feedback_admin_module_manifest_vs_router_branch_drift]]."
  - "VariantGrid reuses ship-winner-flag Edge Fn verbatim (Pattern K). Single call site at line 61 + identical data-action=\"ship-winner\" attribute + identical { flag_id, variant } body shape from OnboardingABPanel.tsx."
  - "B2/W5 closure: review_funnel_aggregate by_variant reads public.review_prompt_history.copy_variant DIRECTLY via COALESCE(copy_variant,'control') GROUP BY. NULL legacy rows collapse into the 'control' bucket. NO events_mirror join exists for variant attribution — events_mirror is referenced only for the global external_clicked count."
  - "RuleFormPanel mocks EVENTS via getter so per-test fixtures can mutate nps_trigger_eligible flags without re-importing — necessary because the project uses Object.values(EVENTS).filter pattern."
  - "Test pattern: vi.mockImplementation routing by RPC fn-name argument replaces mockResolvedValueOnce stacking for tests with multiple sequential RPC calls (list → delete → refetch). More robust than queue-based ordering when CohortPicker etc. issue parallel reads."

# Metrics
duration: ~25min
completed: 2026-05-22
---

# Phase 36 Plan 36-04: Admin Module (Rules / Funnel / CTA Catalog) Summary

**Ships the admin-side surface for REVIEW-02/06/07/08: 5 admin pages + 1 net-new CohortPicker primitive + 1 funnel-aggregate SECDEF RPC reading copy_variant directly from review_prompt_history (B2/W5 closed); Ship-Winner button reuses the existing Phase 34 ship-winner-flag Edge Fn verbatim — no fork.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-05-22
- **Tasks:** 3 (all autonomous; TDD RED→GREEN per task)
- **Files created:** 16 (3 components + 5 admin pages + 1 router barrel + 5 test suites + 1 migration + 1 vitest spec)
- **Files modified:** 1 (ADMIN_MODULES manifest entry)
- **Tests passing:** 23/23 vitest specs (Cohort 4 + RulesList 4 + RuleForm 4 + VariantGrid 4 + Funnel 4 + Catalog 3)

## Accomplishments

- ADMIN_MODULES.reviews swapped from placeholderFor → real lazy import; minRole upgraded staff → admin per D-02
- Single-condition rule-builder (D-02): RuleFormPanel renders EXACTLY 1 trigger picker + 1 cohort picker; no AND/OR/+ composition controls anywhere
- Ship-Winner reuse mandate (Pattern K) honored: VariantGrid invokes the existing ship-winner-flag Edge Fn with the same { flag_id, variant } shape + identical data-action="ship-winner" attribute as OnboardingABPanel.tsx
- B2/W5 funnel-attribution lock-in: review_funnel_aggregate reads copy_variant directly from review_prompt_history via COALESCE GROUP BY — events_mirror is referenced ONLY for the global external_clicked count; no variant attribution fallback path exists
- Pitfall 5 closed: CohortPicker shared primitive shipped as a thin wrapper over the existing cohort_definitions data source

## Task Commits

1. **Task 1: CohortPicker + funnel-aggregate RPC + manifest patch** — `200f7f3` (feat)
2. **Task 2: ReviewsLayout router + RulesListPage + RuleFormPanel (Surface D)** — `c5e3638` (feat)
3. **Task 3: FunnelDashboardPage + VariantGrid + CtaCatalogPage (Surfaces E + F)** — `7594cb5` (feat)

## Funnel RPC Return Shape (for downstream consumers)

```sql
review_funnel_aggregate(p_window_days int) returns table (
  prompts_shown   bigint,
  rated_internal  bigint,
  external_clicked bigint,
  by_variant      jsonb  -- shape: { "<variant>": { prompts_shown, rated_internal }, ... }
)
```

`by_variant` is built from `review_prompt_history`:

```sql
select coalesce(
  jsonb_object_agg(
    bucket,
    jsonb_build_object('prompts_shown', cnt_total, 'rated_internal', cnt_rated)
  ),
  '{}'::jsonb
)
from (
  select
    coalesce(copy_variant, 'control') as bucket,
    count(*) as cnt_total,
    count(*) filter (where rating_value is not null) as cnt_rated
  from public.review_prompt_history
  where fired_at > v_cutoff
  group by coalesce(copy_variant, 'control')
) per_variant;
```

Empty window → `by_variant = '{}'::jsonb` (COALESCE wraps the NULL aggregate).

## B2/W5 Closure — verification grep counts

| Check | Count | Expected | Status |
|-------|-------|----------|--------|
| `copy_variant` in 20270710000006_p36_review_funnel_aggregate_rpc.sql | 6 | ≥1 | ✓ |
| `events_mirror.*copy_variant` OR `copy_variant.*events_mirror` co-occurrence | 0 | 0 (fallback absent) | ✓ |
| `events_mirror` occurrences in the migration (global external_clicked only) | 1 select stmt | 1 | ✓ |
| Migration filename matches strict 14-digit prefix | yes | yes | ✓ |
| Migration timestamp ahead of latest on disk (20270710000005 from 36-01) | yes | yes | ✓ |
| Total 20270710*.sql migrations after this plan | 6 | 6 | ✓ |

## Ship-Winner Reuse — verification grep counts

| Check | Count | Expected | Status |
|-------|-------|----------|--------|
| `data-action="ship-winner"` in VariantGrid.tsx | 2 (JSX prop + JSDoc) | ≥1 | ✓ |
| `supabase.functions.invoke('ship-winner-flag'` call site in VariantGrid.tsx | 1 (line 61; the other match is a JSDoc reference) | 1 | ✓ |
| New ship-winner-* Edge Fns under supabase/functions/ | 0 (only existing `ship-winner-flag` remains) | 0 | ✓ |

## Files Created/Modified

### Migrations
- `supabase/migrations/20270710000006_p36_review_funnel_aggregate_rpc.sql` — SECDEF RPC `review_funnel_aggregate(int)`; admin gate; copy_variant direct read; events_mirror only for external_clicked count

### Admin module (`leanshot/src/admin/modules/reviews/`)
- `index.ts` — barrel re-exporting `default` from ReviewsLayout
- `ReviewsLayout.tsx` — pathname-based sub-route switch (rules / funnel / cta-catalog)
- `RulesListPage.tsx` — Surface D rule cards + kebab menu + Confirm-on-Delete + RuleFormPanel mount
- `RuleFormPanel.tsx` — D-02 single-condition form + nps_trigger_eligible event filter + empty-list fallback
- `FunnelDashboardPage.tsx` — Surface E 3-bar funnel via BaseChart + 7/30/90/All selector + VariantGrid mount + EmptyState on 0 prompts
- `VariantGrid.tsx` — A/B variant rows + Ship-Winner Confirm modal + ship-winner-flag Edge Fn invoke
- `CtaCatalogPage.tsx` — Surface F read-only table + v1.4 mobile-shell warning pill + claim status dot

### Shared admin primitive
- `leanshot/src/components/admin/cohort/CohortPicker.tsx` — single-select wrapper exposing { value, onChange, placeholder }; "Clear selection" affordance returns null

### Manifest patch
- `leanshot/src/lib/admin/modules.ts:139–146` — replaced `placeholderFor('Phase 32+ ...')` with `() => import('@/admin/modules/reviews')`; `minRole: 'staff' → 'admin'`

### Tests (vitest)
- 4 CohortPicker tests (empty, row-select, clear, selected-row data-attr)
- 4 RulesListPage tests (empty state, non-empty cards, New-rule opens form, delete flow with Confirm)
- 4 RuleFormPanel tests (filter to nps_trigger_eligible, D-02 single-condition enforcement, empty-eligible fallback, Save payload contract)
- 4 VariantGrid tests (empty, row count + data-action, Ship Confirm→invoke, error→toast)
- 4 FunnelDashboardPage tests (mount RPC, 3 bars, EmptyState on zero, window-change refetch)
- 3 CtaCatalogPage tests (5 rows, mobile-shell warning pill, footer note + no Add button)
- 1 live-DB vitest spec for review_funnel_aggregate (auto-skips without SUPABASE env)

## Decisions Made

- **Module barrel split (index.ts ↔ ReviewsLayout.tsx).** The lazy import in modules.ts resolves `@/admin/modules/reviews` (no extension), so index.ts must compile clean. Putting JSX in index.ts would force a .tsx rename; the helpdesk module solves this with the same barrel split (`index.ts` re-exports default from `HelpdeskLayout.tsx`). Same pattern adopted here.
- **AdminShell branch coverage.** AdminShell.tsx already prefix-branches `/admin/reviews/*` (line 119: `pathname.startsWith(...)`). ReviewsLayout owns the trailing-segment switch. No router-code change required per `[[feedback_admin_module_manifest_vs_router_branch_drift]]`.
- **VariantGrid Ship-Winner contract — verbatim reuse, no shared helper.** OnboardingABPanel.tsx inlines the Ship-Winner button + invoke pattern. RESEARCH Assumption A3 anticipated either (a) extract to shared `ShipWinnerButton` or (b) inline-duplicate with a P42 TODO. Chose (b) — extracting a shared helper would touch OnboardingABPanel.tsx (out of plan scope); duplicating preserves bounded blast radius. Marked for P42 polish.
- **No events_mirror fallback in review_funnel_aggregate.** B2/W5 fixed at plan-time. Variant attribution lives on review_prompt_history.copy_variant (Wave 1 column; Wave 2 writes it). The RPC body references events_mirror exactly once — for the global external_clicked count, which is captured client-side by nps-cta-click-log per Pitfall 10.
- **CohortPicker is a fresh read of cohort_definitions, not a wrapper of AdminCohortList.** AdminCohortList has Promote/Archive actions and a status filter that don't fit single-select usage in a form. CohortPicker re-uses the same data shape but renders a compact list optimised for inline form picking; both components remain independently testable.
- **Mock pattern: vi.mockImplementation routing by RPC fn-name argument.** Tests with sequential RPC calls (list → delete → refetch) are more robust with fn-name-routed implementations than mockResolvedValueOnce stacking; CohortPicker's parallel read otherwise consumed queued mocks out of order.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `index.ts` cannot contain JSX**
- **Found during:** Task 2 (initial tsc run)
- **Issue:** Plan listed `leanshot/src/admin/modules/reviews/index.ts` as the router file with JSX. But `.ts` files reject JSX → 20 TS1005/TS1109/TS1110 errors.
- **Fix:** Split into `index.ts` (barrel; pure re-export) + `ReviewsLayout.tsx` (JSX router). Same pattern as `src/admin/modules/helpdesk/index.ts` ↔ `HelpdeskLayout.tsx`. The lazy import in modules.ts (`() => import('@/admin/modules/reviews')`) still resolves cleanly because index.ts re-exports `default`.
- **Files modified:** `leanshot/src/admin/modules/reviews/index.ts` (barrel), `leanshot/src/admin/modules/reviews/ReviewsLayout.tsx` (new; router).
- **Verification:** `npx tsc -p tsconfig.app.json --noEmit` → 0 errors; tests still resolve `@/admin/modules/reviews/RulesListPage` etc.
- **Committed in:** c5e3638 (Task 2 commit).

**2. [Rule 1 — Bug] chart.js `animation: boolean | undefined` type mismatch**
- **Found during:** Task 3 (final tsc run)
- **Issue:** Chart.js's `AnimationSpec` accepts `false | undefined` but not `true`; ternary `reduced ? false : undefined` returns `boolean | undefined` which TS narrows incorrectly. tsc error TS2322.
- **Fix:** Cast to `as false | undefined` to match the chart.js typing. Runtime behaviour identical (`true` is never produced because `reduced` is the only `true` arm and that arm returns `false`).
- **Files modified:** `leanshot/src/admin/modules/reviews/FunnelDashboardPage.tsx`.
- **Verification:** `npx tsc -p tsconfig.app.json --noEmit` → 0 errors; FunnelDashboardPage tests still pass.
- **Committed in:** 7594cb5 (Task 3 commit).

**3. [Rule 3 — Blocking] npm install required in worktree before tsc / lint / tests**
- **Found during:** Initial environment setup (before Task 1)
- **Issue:** `node_modules` is gitignored, so worktree branches don't inherit it (per `reference_npm_install_worktree_main_drift`).
- **Fix:** Ran `npm install --no-audit --no-fund --ignore-scripts` to bypass the @sentry/capacitor pre-install hook (pre-existing version drift, not introduced by this plan).
- **Files modified:** none (node_modules gitignored).
- **Committed in:** N/A.

---

**Total deviations:** 3 auto-fixed (2 Rule 3 — Blocking, 1 Rule 1 — Bug). No plan-scope creep — all fixes confined to declared files_modified.

## Issues Encountered

- Project-wide `npm run lint` reports ≥249 pre-existing problems (import-x/order, unused vars in legacy RLS tests, etc.); my modified files pass eslint clean. Per scope boundary rule and fix-attempt limit, these are NOT addressed.
- The live-DB vitest spec `supabase/migrations/__tests__/p36_funnel_aggregate.test.ts` auto-skips without SUPABASE_* env vars (mirroring the Wave 1 contract-test pattern). It will be exercised against the linked project at phase close-out via `supabase db push --linked` + a one-shot vitest run with the env vars present, per `feedback_phase_close_out_db_push_verification`.

## User Setup Required

None — no new external service configuration. The funnel dashboard reads from data populated by Wave 1/2/3; the Ship-Winner button gates on the existing ship-winner-flag Edge Fn which needs `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID` (Plan 34-10 human checkpoint owns this — unchanged here).

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: surface | `supabase/migrations/20270710000006_p36_review_funnel_aggregate_rpc.sql` | New SECDEF RPC `review_funnel_aggregate` is admin-gated (T-36-21 + T-36-24 mitigated in-body). No PII leak (aggregate counts + variant breakdown only). |
| threat_flag: surface | `leanshot/src/admin/modules/reviews/*` | 5 new admin pages; all writes route through Wave 1 SECDEF RPCs that re-check admin_role server-side (Pattern S1). VariantGrid's Ship-Winner gate is server-side at the existing ship-winner-flag Edge Fn (superadmin re-check). No new untracked trust boundary. |

## Admin Module Bundle Delta (against 30 kB admin-shell ceiling)

Bundle measurement deferred to phase close-out — `npm run build` + `assert-bundle-budget.sh` will run after all Phase 36 waves merge. Heuristic per file LOC: ~5 new TS/TSX source files at ~80-160 LOC each + minimal lucide-react glyph additions (`MoreVertical`, `ExternalLink` already in vendor-icons). Estimated incremental gz: ~6-8 kB → well under the 30 kB ceiling shared with onboarding-builder / helpdesk / gamification.

## Next Phase / Wave Readiness

- **36-05 (E2E test harness):** ready — admin surface fully testable via headless click-through; ReviewsLayout's pathname-based router responds to plain `<a>` navigation; CohortPicker exposes data-testid="cohort-picker-row-{id}" hooks.
- **Phase 42+ ShipWinnerButton consolidation:** VariantGrid + OnboardingABPanel inline the same Ship-Winner button shape. When P42 extracts a shared `<ShipWinnerButton>` helper, both call sites migrate (TODO in VariantGrid.tsx header comment).
- **Phase close-out:** the `supabase db push --linked` step ships the new migration; the live-DB vitest spec (`p36_funnel_aggregate.test.ts`) becomes runnable with SUPABASE env present.

## Verification Grep Counts (per plan's <verification>)

| Check | Count | Expected | Status |
|-------|-------|----------|--------|
| `placeholderFor('Phase 32+'` in modules.ts | 0 | 0 (placeholder removed) | ✓ |
| `data-action="ship-winner"` in VariantGrid.tsx | 2 (JSX prop + JSDoc reference) | ≥1 | ✓ |
| `supabase.functions.invoke('ship-winner-flag'` call site in VariantGrid.tsx | 1 actual call (line 61) | 1 | ✓ |
| `nps_trigger_eligible` in RuleFormPanel.tsx | 4 | ≥1 | ✓ |
| `copy_variant` in 20270710000006_p36_review_funnel_aggregate_rpc.sql | 6 | ≥1 | ✓ |
| `events_mirror.*copy_variant` OR `copy_variant.*events_mirror` co-occurrence in funnel migration | 0 | 0 (fallback absent) | ✓ |
| Migration filename `20270710000006_p36_review_funnel_aggregate_rpc.sql` exists with strict 14-digit prefix | yes | yes | ✓ |
| `aria-label.*add.*condition|and-clause|or-clause` in RuleFormPanel.tsx (D-02 enforcement) | 0 | 0 | ✓ |
| `npx tsc -p tsconfig.app.json --noEmit` | 0 errors | 0 errors | ✓ |
| `npx eslint src/admin/modules/reviews src/components/admin/cohort/CohortPicker.tsx` | 0 errors | 0 errors | ✓ |
| Plan-scope vitest suites | 23/23 pass (6 files) | all pass | ✓ |

## Self-Check: PASSED

All claimed files exist; all claimed commits resolve in `git log`:

```
200f7f3 feat(36-04): CohortPicker primitive + funnel-aggregate RPC + manifest patch
c5e3638 feat(36-04): admin reviews router + RulesListPage + RuleFormPanel (Surface D)
7594cb5 feat(36-04): FunnelDashboardPage + VariantGrid + CtaCatalogPage (Surfaces E + F)
```

Files verified:
- `leanshot/src/admin/modules/reviews/{index.ts,ReviewsLayout.tsx,RulesListPage.tsx,RuleFormPanel.tsx,FunnelDashboardPage.tsx,VariantGrid.tsx,CtaCatalogPage.tsx}` ✓
- `leanshot/src/admin/modules/reviews/__tests__/{RulesListPage,RuleFormPanel,FunnelDashboardPage,VariantGrid,CtaCatalogPage}.test.tsx` ✓
- `leanshot/src/components/admin/cohort/CohortPicker.tsx` + `__tests__/CohortPicker.test.tsx` ✓
- `supabase/migrations/20270710000006_p36_review_funnel_aggregate_rpc.sql` ✓
- `supabase/migrations/__tests__/p36_funnel_aggregate.test.ts` ✓
- `leanshot/src/lib/admin/modules.ts` (modified — placeholderFor removed) ✓

---
*Phase: 36-m3-review-prompt-engine-web-only*
*Plan: 04*
*Completed: 2026-05-22*
