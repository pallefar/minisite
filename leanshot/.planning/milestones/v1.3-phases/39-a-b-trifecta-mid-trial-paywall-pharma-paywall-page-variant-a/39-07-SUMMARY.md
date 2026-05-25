---
phase: 39-a-b-trifecta-mid-trial-paywall-pharma-paywall-page-variant-a
plan: 07
subsystem: admin/growth-experiments
tags:
  - admin
  - growth
  - experiments
  - paywall
  - page-builder
  - ship-winner
  - bayesian
  - audit
  - tdd
dependency-graph:
  requires:
    - leanshot/src/components/admin/growth/ExperimentDashboardPage.tsx (39-06 shell)
    - leanshot/src/components/admin/growth/experiment-types.ts (39-06 types)
    - leanshot/src/components/admin/onboarding-builder/OnboardingABPanel.tsx (Ship-Winner verbatim contract)
    - supabase/functions/ship-winner-flag/index.ts (Phase 34/35 Edge Fn)
    - supabase/migrations/20270714000002_p39_variant_config.sql (variant rows)
    - supabase/migrations/20270714000007_p39_experiment_results_matview.sql
    - supabase/migrations/20270601000027_profiles_admin_role_column.sql (is_admin_at_least)
    - leanshot/src/components/ui/{Badge,Modal,Pill,Input,Button,Card}.tsx
  provides:
    - "BayesianBadge — tri-state Bayesian posterior badge (PAGEAB-07)"
    - "ShipWinnerConfirmModal — typed-confirmation modal for ship-below-95 (D-12)"
    - "TrafficSplitSlider — range input + preset Pills (10/20/50/80/90)"
    - "PaywallExperimentTab — Surface E Paywall sub-tab content (PAYWALL-03/04)"
    - "PageExperimentTab — Surface E Page-Builder sub-tab content (PAGEAB-03/05/07)"
    - "public.get_experiment_results(p_surface) SECDEF RPC — admin-gated ExperimentRow[]"
    - "public.admin_ship_below_95(p_variant_id, p_reason, p_posterior) SECDEF RPC — superadmin-gated audit writer"
    - "public.admin_audit_log table — append-only operator action trail (T-39-07-01)"
  affects:
    - 39-08 (Pharma sub-tab — extends the same shell; will reuse BayesianBadge + ShipWinnerConfirmModal)
    - 39-09 (page-builder editor; independent files but shares ship-winner-flag invoke contract)
tech-stack:
  added:
    - "public.admin_audit_log table (NEW — see Deviations §1)"
  patterns:
    - SECDEF RPC with is_admin_at_least() ordinal role gate (Pattern S2)
    - Verbatim Ship-Winner contract reuse via supabase.functions.invoke('ship-winner-flag', { body: { flag_id, variant } })
    - 2-step audit-then-flip split (admin_ship_below_95 RPC for audit, then ship-winner-flag for the actual PostHog patch)
    - Tri-state Bayesian badge — neutral <80% / warning <95% / success ≥95%
    - Typed-confirmation modal — exact-string + non-empty reason gating (D-12 mirror of V13-3)
    - DSv2 token-only styling (NO hex literals, NO arbitrary px values, NO useQuery/useMutation)
key-files:
  created:
    - leanshot/src/components/admin/growth/BayesianBadge.tsx
    - leanshot/src/components/admin/growth/BayesianBadge.test.tsx
    - leanshot/src/components/admin/growth/ShipWinnerConfirmModal.tsx
    - leanshot/src/components/admin/growth/ShipWinnerConfirmModal.test.tsx
    - leanshot/src/components/admin/growth/TrafficSplitSlider.tsx
    - leanshot/src/components/admin/growth/TrafficSplitSlider.test.tsx
    - leanshot/src/components/admin/growth/PaywallExperimentTab.tsx
    - leanshot/src/components/admin/growth/PaywallExperimentTab.test.tsx
    - leanshot/src/components/admin/growth/PageExperimentTab.tsx
    - leanshot/src/components/admin/growth/PageExperimentTab.test.tsx
    - supabase/migrations/20270714000016_p39_get_experiment_results_rpc.sql
    - supabase/migrations/20270714000017_p39_admin_ship_below_95_rpc.sql
    - supabase/tests/p39_ship_below_95_audit.sql
  modified:
    - leanshot/src/components/admin/growth/ExperimentDashboardPage.tsx
    - leanshot/src/components/admin/growth/ExperimentDashboardPage.test.tsx
decisions:
  - "Ship-Winner contract reused VERBATIM from OnboardingABPanel.tsx — body shape { flag_id, variant }, error-code handling for forbidden_not_superadmin / vendor_unconfigured, data-action='ship-winner' attribute, busyKey state on parent (UI-SPEC Hard Constraint 8)"
  - "D-12 split-responsibility: admin_ship_below_95 RPC writes the audit row, the browser separately invokes ship-winner-flag Edge Fn for the actual flag flip — keeps service-role context strictly on the cron path"
  - "ShipWinnerConfirmModal is pure-presentational (no supabase coupling) — the audit RPC call lives in the parent tab component so the modal is unit-testable without mocks"
  - "admin_audit_log SHIPPED INLINE (see Deviations §1) — the existing public.audit_logs is user-scoped with a CHECK-constrained action enum; widening it would couple unrelated concerns"
  - "BayesianBadge boundaries are STRICT inequalities at <0.80 and <0.95 (matches plan test cases at 0.79 → neutral, 0.80 → warning, 0.94 → warning, 0.95 → success)"
  - "Pharma tab placeholder PRESERVED — 39-06 placeholder rendered when activeTab='pharma' so 39-08 mounts cleanly without disrupting Paywall/Page tabs"
  - "Used adjacent vitest config workaround (vitest-39-07.config.ts, post-run deleted; same as 39-06 Deviation 1)"
metrics:
  duration: ~30min
  completed: 2026-05-24
  tasks: 2/2
  tests: 50/50 pass (23 widgets + 8 paywall + 6 page + 13 dashboard)
  files-created: 13
  files-modified: 2
---

# Phase 39 Plan 39-07: Wave 5 admin slice A — Paywall + Page-Builder sub-tabs of ExperimentDashboardPage Summary

Fills in 2 of the 3 sub-tabs of the 39-06 ExperimentDashboardPage shell with functional tables, plus the Ship-Winner typed-confirmation modal (D-12), the tri-state Bayesian badge (PAGEAB-07), the traffic-split slider, and the supporting SECDEF RPCs (`get_experiment_results` + `admin_ship_below_95`) with a pgTAP audit-trail proof. Plan 39-08 fills in the third (Pharma) tab.

## What shipped

### 1. BayesianBadge (`leanshot/src/components/admin/growth/BayesianBadge.tsx`)

Thin `Badge`-primitive wrapper. Tri-state per UI-SPEC §Color:

| Posterior | Tone | Text |
| --------- | ---- | ---- |
| `< 0.80`  | `neutral` (gray) | `Insufficient data (N%)` |
| `0.80 – < 0.95` | `warning` (orange) | `Trending (N%)` |
| `≥ 0.95` | `success` (sage) | `Significant (N%)` |

Percent is `Math.round(posterior * 100)`. NO `--color-primary` accent on this badge — UI-SPEC accent-reservation honored.

### 2. ShipWinnerConfirmModal (`leanshot/src/components/admin/growth/ShipWinnerConfirmModal.tsx`)

Typed-confirmation modal (D-12) opened by the sub-tab components when an operator clicks Ship-Winner on a variant whose posterior is `< 0.95`.

Contract:
- Confirm button enabled **only** when `typedValue === "ship-below-95"` (exact match — `"ship below 95"` with spaces is rejected) **AND** `reason.trim().length > 0`.
- `onConfirm(reason)` callback receives the reason string.
- The Modal primitive supplies `role="dialog"` + `aria-modal="true"`; the typed-confirmation `Input` has `aria-describedby` pointing to the explanatory body paragraph (UI-SPEC accessibility table).

Audit-trail wiring lives in the **parent tab component** — the modal is purely presentational so it is testable without supabase mocks.

### 3. TrafficSplitSlider (`leanshot/src/components/admin/growth/TrafficSplitSlider.tsx`)

`Input type="range"` styled with DSv2 `accent-[var(--color-primary)]` token, plus 5 preset `Pill` primitives at 10/20/50/80/90 per UI-SPEC. Active preset reflects `value === preset` via `aria-pressed`.

### 4. PaywallExperimentTab (`leanshot/src/components/admin/growth/PaywallExperimentTab.tsx`)

Renders one `Card` per `ExperimentRow` with:
- `variant_name` + optional `cohort_label`
- `BayesianBadge` for `posterior`
- Composite / Sample / Refund-7d numerics (tabular nums)
- Ship-Winner button with `data-action="ship-winner"` (UI-SPEC Hard Constraint 8; verbatim contract from `OnboardingABPanel.tsx:98-122`)
- D-12 cascade: `posterior >= 0.95` → direct `onShip(variantId)`; `< 0.95` → opens `ShipWinnerConfirmModal`; on confirm calls `admin_ship_below_95` RPC for audit then `onShip(variantId)` for the flag flip
- D-02 archived: refund-rate kill banner + "Re-enable variant" (`variant="destructive"`) CTA replaces the Ship-Winner button when `archived_at` is non-null

UI-SPEC composite-score callout: `Composite: paid_rate × 30d_retention = score (control baseline shown per row when available).` rendered above the row list.

### 5. PageExperimentTab (`leanshot/src/components/admin/growth/PageExperimentTab.tsx`)

Renders the page-variant rows with the D-11 42-day lifecycle banners:

| Condition | Banner | Tone | Copy |
| --------- | ------ | ---- | ---- |
| `warned_at != null AND archived_at == null` | 35-day warn | warning | `This variant auto-archives in {N} days. Ship a winner or roll back to control.` |
| `archived_at != null` (overrides warn) | 42-day archived | neutral (`--color-surface-elevated` + `--color-text-tertiary`) | `This variant was auto-archived on {date}. Traffic is back on control.` |

Same Ship-Winner cascade as PaywallExperimentTab (shared `ShipWinnerConfirmModal` + same `admin_ship_below_95` RPC call). `data-action="ship-winner"` attribute honored.

### 6. ExperimentDashboardPage wiring (`leanshot/src/components/admin/growth/ExperimentDashboardPage.tsx` modified)

- `busyKey` state is now writable (`setBusyKey`).
- New `handleShip` callback owns the `ship-winner-flag` Edge Fn invocation (verbatim shape: `body: { flag_id: row.variant_id, variant: row.variant_name }`). Surfaces `forbidden_not_superadmin` + `vendor_unconfigured` error codes per Pattern A (vendor-gated soft banner).
- Sub-tab content slot is now conditional:
  - `activeTab === 'paywall'` → `<PaywallExperimentTab rows={rows!} onShip={…} busyKey={…} />`
  - `activeTab === 'page'` → `<PageExperimentTab …/>`
  - `activeTab === 'pharma'` → 39-06 placeholder preserved (Plan 39-08 fills it in)

### 7. get_experiment_results SECDEF RPC (`supabase/migrations/20270714000016_p39_get_experiment_results_rpc.sql`)

Admin-only `RETURNS TABLE(...)` RPC joining `variant_config` + `experiment_results` matview + `cohort_definitions`. Returns the 15-column `ExperimentRow` shape filtered by `p_surface IN ('paywall', 'page', 'pharma')`. Gated by `is_admin_at_least('admin'::public.admin_role)` — raises `forbidden_not_admin` (SQLSTATE `42501`) otherwise.

`variant_name` is derived as `coalesce(config->>'name', 'variant_' || left(id::text, 8))` (no `variant_config.variant_name` column exists; the config jsonb carries operator-edited names). `refund_rate_baseline_30d` is `NULL` until the Wave-2 refresh extension lands (Plan 39-10 close-out) — the UI tolerates NULL and the kill-switch cron path computes its own baseline.

### 8. admin_ship_below_95 SECDEF RPC + admin_audit_log table (`supabase/migrations/20270714000017_p39_admin_ship_below_95_rpc.sql`)

Single migration ships both:
- **`public.admin_audit_log` table**: append-only, `(actor_id uuid, action text, context jsonb, created_at)` with RLS enabled and NO INSERT/UPDATE/DELETE policy (Pattern S2 — SECDEF RPCs are the only writers). Two indexes: `(actor_id, created_at desc)` + `(action, created_at desc)`.
- **`public.admin_ship_below_95(p_variant_id, p_reason, p_posterior)` RPC**: SUPERADMIN-gated (`is_admin_at_least('superadmin')` — raises `forbidden_not_superadmin` SQLSTATE `42501` for any other role). Validates `p_reason` non-empty + `p_posterior in [0,1]` + `p_variant_id not null`. INSERTs one row into `admin_audit_log` with `action='ship_below_95'` and `context = jsonb_build_object('variant_id', p_variant_id, 'posterior', p_posterior, 'reason', p_reason)`. **Does NOT** invoke `ship-winner-flag` — the browser invokes that separately (D-12 split-responsibility keeps service-role context on the cron path, not the user-action path).

### 9. pgTAP audit-trail proof (`supabase/tests/p39_ship_below_95_audit.sql`)

7-plan test covering both T-39-07-01 and T-39-07-02 mitigations:

| # | Test | Mitigation |
| - | ---- | ---------- |
| 1 | `admin_audit_log` has RLS enabled | Pattern S2 |
| 2 | `admin_audit_log` has NO INSERT/UPDATE/DELETE/ALL policies | Pattern S2 (default-deny) |
| 3 | admin (non-superadmin) → `forbidden_not_superadmin` (SQLSTATE `42501`) | T-39-07-02 elevation |
| 4 | superadmin call succeeds (lives_ok) | T-39-07-02 inverse |
| 5 | Exactly one `admin_audit_log` row written with full context fields populated | T-39-07-01 repudiation |
| 6 | Whitespace-only reason → `reason_required` (SQLSTATE `22023`) | D-12 defense-in-depth |
| 7 | `admin_audit_log_action_created_idx` exists | operational |

`begin/rollback` leaves zero DB residue. Named dollar-quote tags `$auth$` per `[[reference_postgres_dollar_quote_nesting_in_cron_body]]`.

## Test results

```
Test Files  6 passed (6)
     Tests  50 passed (50)
  Duration  ~1.2s
```

| File | Tests | Status |
| ---- | ----- | ------ |
| `BayesianBadge.test.tsx` | 7 | PASS |
| `ShipWinnerConfirmModal.test.tsx` | 10 | PASS |
| `TrafficSplitSlider.test.tsx` | 6 | PASS |
| `PaywallExperimentTab.test.tsx` | 8 | PASS |
| `PageExperimentTab.test.tsx` | 6 | PASS |
| `ExperimentDashboardPage.test.tsx` | 13 (9 from 39-06 + 4 new T10–T13) | PASS |

`tsc -p tsconfig.app.json --noEmit` → exit 0.
`eslint` → exit 0 on all 8 touched src files.

## Hard Constraints (UI-SPEC) compliance

| # | Constraint | How honored |
| - | ---------- | ----------- |
| 1 | Typography `text-sm/base/xl/2xl`; weights 400/700 | All 5 new components use only `text-sm`, `text-base`; bold via `font-bold`. No `text-[Npx]`. |
| 2 | Spacing tokens only | All `gap-*`, `p-*`, `mb-*` resolve to {1, 2, 3, 4, 6, 8}. No `[Npx]` arbitrary values. |
| 3 | No hex literals | Zero `#` color literals in component source. All colors via `var(--color-*)`. |
| 4 | `--color-primary` accent allowlist | Used only on `Pill active` (TrafficSplitSlider preset selection — UI-SPEC reserve list item 1), `Button variant='primary'` (Ship-Winner — UI-SPEC reserve list item 1), `accent-[var(--color-primary)]` on range input. NOT used on Badge backgrounds. |
| 5 | NO server-state library | Zero `useQuery/useMutation/QueryClient` strings — grep-clean. |
| 8 | Ship-Winner verbatim reuse | `data-action="ship-winner"` attribute present in PaywallExperimentTab + PageExperimentTab buttons; `ship-winner-flag` invoked via `supabase.functions.invoke('ship-winner-flag', { body: { flag_id, variant } })` in ExperimentDashboardPage — same shape as OnboardingABPanel.tsx:98-122. |

## Deviations from Plan

### 1. [Rule 2 - Missing critical functionality] admin_audit_log table shipped inline

- **Found during:** Task 1 GREEN (writing admin_ship_below_95 RPC)
- **Issue:** The plan's `<interfaces>` block referenced `INSERT admin_audit_log row …` as if the table already existed, but `grep -l admin_audit_log supabase/migrations/` returned no hits. The existing `public.audit_logs` table is user-scoped (RLS `auth.uid() = user_id`) with a CHECK-constrained `action` enum that doesn't include `'ship_below_95'`. Widening that enum + re-purposing user-scoped audit for an admin-only table would couple unrelated concerns AND the threat model T-39-07-01 mitigation **requires** an audit table (without one, repudiation goes un-mitigated).
- **Fix:** Created `public.admin_audit_log` table INLINE in the same `20270714000017_*` migration as the RPC. Schema: `(id uuid pk, actor_id uuid → auth.users, action text, context jsonb, created_at timestamptz)`. RLS enabled; SELECT for admins; NO write policies (Pattern S2 default-deny). Two indexes for operational queries.
- **Files modified:** `supabase/migrations/20270714000017_p39_admin_ship_below_95_rpc.sql` (now ships table + RPC together; documented in the migration header)
- **Commit:** `15e212fa`
- **Memory reference:** `[[feedback_executor_auto_adds_missing_migration]]` — Wave-N executors auto-ship un-declared SECDEF/RPC migrations when the consumer would fail without them.

### 2. [Rule 3 - Blocking] Adjacent vitest config for src/ unit tests (recurrence of 39-06 Deviation 1)

- **Found during:** Task 1 RED verification
- **Issue:** Same project-wide gap documented in `39-06-SUMMARY.md` Deviation 1 — `npx vitest run src/...` returns `No test files found` because `vitest.config.ts` has both `test.include` and `projects: [...]`, and Vitest 4.x lets `projects` supersede the outer config.
- **Fix:** Created `vitest-39-07.config.ts` with explicit `test.include` targeting the 6 test files in scope + `@vitejs/plugin-react` (for TSX JSX transform) + `setupFiles: ['./src/test-setup.ts']` (for `@testing-library/jest-dom` matchers). Deleted post-run; NOT committed.
- **Files modified:** ephemeral only
- **Commit:** N/A (config never committed)
- **Permanent fix:** out of scope per SCOPE BOUNDARY (project-wide issue); 39-06 Summary already flags this for a follow-on focused plan.

### 3. [Rule 1 - Bug] ESLint --fix applied import-x/order corrections

- **Found during:** Task 2 verify gate
- **Issue:** Type-only imports (`import type { ExperimentRow, InvokeError } from './experiment-types'`) violated the project's `import-x/order` alphabetical rule when placed after sibling component imports.
- **Fix:** `npx eslint --fix` re-ordered the imports in all 3 modified/new files (PaywallExperimentTab, PageExperimentTab, ExperimentDashboardPage). No semantic change; tests still pass.
- **Files modified:** `PaywallExperimentTab.tsx`, `PageExperimentTab.tsx`, `ExperimentDashboardPage.tsx`
- **Commit:** `1163d315` (rolled into Task 2 GREEN)

## Self-Check: PASSED

**Files created (all exist on disk):**
- `leanshot/src/components/admin/growth/BayesianBadge.tsx` — FOUND
- `leanshot/src/components/admin/growth/BayesianBadge.test.tsx` — FOUND
- `leanshot/src/components/admin/growth/ShipWinnerConfirmModal.tsx` — FOUND
- `leanshot/src/components/admin/growth/ShipWinnerConfirmModal.test.tsx` — FOUND
- `leanshot/src/components/admin/growth/TrafficSplitSlider.tsx` — FOUND
- `leanshot/src/components/admin/growth/TrafficSplitSlider.test.tsx` — FOUND
- `leanshot/src/components/admin/growth/PaywallExperimentTab.tsx` — FOUND
- `leanshot/src/components/admin/growth/PaywallExperimentTab.test.tsx` — FOUND
- `leanshot/src/components/admin/growth/PageExperimentTab.tsx` — FOUND
- `leanshot/src/components/admin/growth/PageExperimentTab.test.tsx` — FOUND
- `supabase/migrations/20270714000016_p39_get_experiment_results_rpc.sql` — FOUND
- `supabase/migrations/20270714000017_p39_admin_ship_below_95_rpc.sql` — FOUND
- `supabase/tests/p39_ship_below_95_audit.sql` — FOUND

**Files modified (verified via git log):**
- `leanshot/src/components/admin/growth/ExperimentDashboardPage.tsx` — `grep -q "PaywallExperimentTab" leanshot/src/components/admin/growth/ExperimentDashboardPage.tsx` → match
- `leanshot/src/components/admin/growth/ExperimentDashboardPage.test.tsx` — `grep -q "T10: paywall tab renders" leanshot/src/components/admin/growth/ExperimentDashboardPage.test.tsx` → match

**Commits exist:**
- `33100732` `test(39-07): RED — BayesianBadge + ShipWinnerConfirmModal + TrafficSplitSlider`
- `15e212fa` `feat(39-07): GREEN — BayesianBadge + ShipWinnerConfirmModal + TrafficSplitSlider + SECDEF RPCs`
- `a2a72f69` `test(39-07): RED — PaywallExperimentTab + PageExperimentTab + Dashboard sub-tab wiring`
- `1163d315` `feat(39-07): GREEN — PaywallExperimentTab + PageExperimentTab + dashboard wiring`

**Verify constraints (per plan `<verify><automated>`):**
- 50/50 vitest cases pass; tsc exits 0; eslint exits 0
- `test -f supabase/migrations/20270714000016_p39_get_experiment_results_rpc.sql` → exists
- `test -f supabase/migrations/20270714000017_p39_admin_ship_below_95_rpc.sql` → exists
- `test -f supabase/tests/p39_ship_below_95_audit.sql` → exists
- `grep -q "is_admin_at_least('superadmin'" supabase/migrations/20270714000017_p39_admin_ship_below_95_rpc.sql` → match
- `grep -q 'data-action="ship-winner"' src/components/admin/growth/PaywallExperimentTab.tsx` → match
- `grep -q 'ship-winner-flag' src/components/admin/growth/ExperimentDashboardPage.tsx` → match (verbatim invoke contract honored)

## Success Criteria

- PAYWALL-03 (paid_rate × 30d_retention composite shown per row) — done via PaywallExperimentTab Composite numeric
- PAYWALL-04 (Ship-Winner promotes variant) — done via verbatim ship-winner-flag invoke
- PAGEAB-03 (42-day archive lifecycle banners) — done via PageExperimentTab 35/42-day banners
- PAGEAB-05 (Ship-Winner promotes page variant) — done via shared cascade
- PAGEAB-07 (Bayesian significance badge tri-state) — done via BayesianBadge
- Plan 39-08 can mount the Pharma tab into the same shell without disrupting Paywall/Page tabs — pharma branch placeholder preserved
- Typed-confirmation + audit-log + Bayesian badge all operational
