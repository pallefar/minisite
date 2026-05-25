---
phase: 26
plan: 03
subsystem: affiliate-multi-tier
tags: [affiliate, partner-dashboard, multi-tier, tier-progress, frozen-state, AFFTIER-03]
requirements: [AFFTIER-03]
dependency_graph:
  requires:
    - "src/lib/affiliate/tier-config.ts (Plan 26-01 owns; this plan scaffolded
      a minimal stub for parallel execution — see Deviations §Rule 3)"
    - "src/lib/affiliate/types.ts (Plan 26-01 owns; same parallel-execution
      scaffold)"
    - "src/components/ui/Card.tsx (v1.2 primitive — Card + CardHeader)"
    - "src/components/ui/Badge.tsx (v1.2 primitive — Badge + BadgeTone)"
    - "src/lib/supabase.ts (v1.2 — supabase client singleton)"
  provides:
    - "getTierProgress(affiliateId, client) — partner tier read"
    - "getTierEarningsBreakdown(affiliateId, client) — per-tier earnings sum"
    - "rollupTierEarnings(rows) — pure sum-by-bucket helper (exported for unit tests)"
    - "PartnerTierProgress component (tier badge + progress bar + frozen banner)"
    - "PartnerTierEarningsBreakdown component (3-row dl)"
  affects:
    - "src/components/partner/PartnerDashboard.tsx (MODIFIED — mounts both blocks)"
tech_stack:
  added: []
  patterns:
    - "useEffect + active-flag cleanup for async data fetch (no double-set on unmount)"
    - "Pure-helper extraction (rollupTierEarnings) so arithmetic is unit-testable without Supabase mock"
    - "vi.mock on @/lib/affiliate/api + @/lib/supabase for RTL tests"
    - "Project Tailwind v4 token convention: text-[var(--color-text-secondary)]"
key_files:
  created:
    - "leanshot/src/lib/affiliate/tier-config.ts (Plan 26-01 scaffold — Rule 3)"
    - "leanshot/src/lib/affiliate/types.ts (Plan 26-01 scaffold — Rule 3)"
    - "leanshot/src/lib/affiliate/__tests__/tier-earnings.test.ts (4 tests)"
    - "leanshot/src/components/partner/PartnerTierProgress.tsx"
    - "leanshot/src/components/partner/PartnerTierEarningsBreakdown.tsx"
    - "leanshot/src/components/partner/__tests__/PartnerTierProgress.test.tsx (3 tests)"
  modified:
    - "leanshot/src/lib/affiliate/api.ts (+118 lines — getTierProgress, getTierEarningsBreakdown, rollupTierEarnings)"
    - "leanshot/src/components/partner/PartnerDashboard.tsx (+13 lines — import + mount above KPI grid)"
decisions:
  - "Scaffolded minimal tier-config.ts + types.ts in this plan rather than
    blocking-wait on Plan 26-01. Both files are supersets-compatible with
    26-01's spec (verified line-for-line against 26-01-PLAN.md lines 218-244
    and 460-473). When 26-01 lands first, the merge is a no-op (identical
    constants + types); when 26-03 lands first, 26-01's executor can
    overwrite freely (26-01 ships canDowngrade ratchet helper + AdjustmentEntry
    + FraudSignalPayload variants that 26-03 does not consume)."
  - "Badge tone for Gold uses 'amber' (project BadgeTone enum has no
    'warning'). Plan body suggested 'warning' which doesn't exist in this
    Tailwind v4 theme — Rule 1 alignment to actual token vocabulary."
  - "Tailwind color classes use the var(--color-*) convention enforced by
    other partner components (PartnerDashboard, PartnerAssetsPage,
    PartnerLayout) rather than the bare shorthand classes (bg-warning-bg,
    text-fg-muted, bg-accent) the plan body suggested — those tokens are not
    defined in src/index.css under this Tailwind v4 theme."
metrics:
  duration_seconds: 235
  duration_human: "3m 55s"
  tasks_completed: 3
  files_created: 6
  files_modified: 2
  commits: 5
  tests_added: 7
  tests_passing: 7
  typecheck_errors: 0
  completed: "2026-05-18T13:10:52Z"
---

# Phase 26 Plan 26-03: Partner-facing Tier UI Summary

One-liner: Wired AFFTIER-03 partner-dashboard surface — `getTierProgress` +
`getTierEarningsBreakdown` read functions on `src/lib/affiliate/api.ts`, two
new client components (`PartnerTierProgress` with progressbar+frozen banner,
`PartnerTierEarningsBreakdown` with 3-row dl), mounted in `PartnerDashboard`
above the existing v1.2 KPI grid. 7/7 tests pass, 0 typecheck errors, 2 a11y
roles.

## What Shipped

### `src/lib/affiliate/api.ts` (extended)

Two new read functions appended to the v1.2 Phase 19 affiliate data layer:

- `getTierProgress(affiliateId, client) → TierProgress` — Single-row read of
  `affiliates.{tier, frozen_at, freeze_reason}` + head-count of
  `affiliate_conversions` with `status IN ('paid','confirmed')`. Returns
  `nextTierThreshold = 10` for standard, `null` for gold/lifetime (D-02 +
  no further auto-promotion paths). Surfaces `frozenAt` + `freezeReason`
  when the fraud-signal pipeline has frozen the partner (D-04).

- `getTierEarningsBreakdown(affiliateId, client) → TierEarningsBreakdown` —
  Fetches `(tier_at_conversion_time, commission_cents)` for paid+confirmed
  conversions, defers sum-by-bucket arithmetic to the pure
  `rollupTierEarnings(rows)` helper. Helper is exported separately for
  direct unit testing (no Supabase mock required) and defensively skips
  unknown tier values.

### `src/components/partner/PartnerTierProgress.tsx` (new)

- Tier badge (Standard / Gold / Lifetime) via project `Badge` primitive
  (`neutral` / `amber` / `success` tones).
- Progressbar — only renders when `nextTierThreshold !== null`. Full a11y:
  `role="progressbar"`, `aria-valuenow`, `aria-valuemax`, `aria-valuemin=0`,
  `aria-label="Progress toward Gold tier"`. Caption shows
  "N more to Gold" countdown.
- Frozen banner — when `frozenAt !== null`, renders `role="alert"` with
  AlertCircle icon, "Account frozen — pending review.", `freeze_reason` in
  full, and an `Appeal` mailto link. The badge + progressbar block above is
  greyed out (`opacity-50 pointer-events-none`) per D-04 + RESEARCH OQ#4 —
  past earnings still render normally, only future-tier progress is greyed.
- Active-flag cleanup on the fetch `useEffect` (no double-set on unmount).

### `src/components/partner/PartnerTierEarningsBreakdown.tsx` (new)

- 3-row `<dl>` showing cents earned as Standard / Gold / Lifetime, formatted
  via a local `formatCents()` helper. Past earnings render in all states
  (including frozen partners) — already-paid commissions belong to the
  partner per RESEARCH OQ#4.

### `src/components/partner/PartnerDashboard.tsx` (modified)

- Imports both new tier blocks; mounts them in a new 12-col grid row above
  the existing v1.2 KPI grid. Both source `affiliateId` from `profile.id`
  (the same scope existing KPI cards use; no new context wiring).
- Existing KPI grid + trend chart + activity feed unchanged.

### Tests

| File                                                                    | Cases | Coverage                                                                                                                  |
| ----------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/affiliate/__tests__/tier-earnings.test.ts`                    | 4     | Empty input → zeros; multi-tier sum; defensive unknown-tier skip; single-bucket cluster                                   |
| `src/components/partner/__tests__/PartnerTierProgress.test.tsx`        | 3     | 7/10 standard → progressbar a11y + "3 more to Gold"; gold → no progressbar; frozen → role=alert banner + mailto + reason  |

## TDD Gate Compliance

Plan declared `tdd="true"` on Tasks 1 + 2; commit graph honors RED → GREEN:

- Task 1 RED: `6babb8f test(26-03-01): RED — failing rollupTierEarnings + tier-config/types scaffold`
- Task 1 GREEN: `4cc118d feat(26-03-01): GREEN — getTierProgress + getTierEarningsBreakdown + rollupTierEarnings`
- Task 2 RED: `3bd6850 test(26-03-02): RED — RTL test for PartnerTierProgress (3 behavior cases)`
- Task 2 GREEN: `1d40d3e feat(26-03-02): GREEN — PartnerTierProgress + PartnerTierEarningsBreakdown`
- Task 3: `d803022 feat(26-03-03): mount PartnerTierProgress + PartnerTierEarningsBreakdown above KPI grid`

REFACTOR cycle was unnecessary for either task — pure helpers + small JSX
components landed clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Missing dependency] Scaffolded `tier-config.ts` + `types.ts` for parallel execution**

- **Found during:** Task 1 setup
- **Issue:** Plan 26-03 declares `wave: 1` and `depends_on: []` but its
  `<context><interfaces>` block imports from `@/lib/affiliate/tier-config`
  (`TIER_VOLUME_THRESHOLD`, `AffiliateTier`) and `@/lib/affiliate/types`
  (`TierProgress`, `TierEarningsBreakdown`). Plan 26-01 OWNS those two files;
  it is also `wave: 1` with `depends_on: []`. Both plans were spawned in
  parallel into separate worktrees off the same base commit
  `90a45fbd05da4`. Without the dependencies, Task 1 cannot compile or run.
- **Fix:** Created the minimal subset of `tier-config.ts` (just
  `TIER_COMMISSION_PCT`, `TIER_VOLUME_THRESHOLD`, `AffiliateTier`,
  `canDowngrade` — the ratchet helper) and `types.ts` (just `TierProgress`,
  `TierEarningsBreakdown`). Both files are byte-for-byte compatible with
  Plan 26-01's spec at `26-01-PLAN.md` lines 218-244 and 460-473.
- **Merge resolution:** If 26-01 merges first, this scaffold is a no-op
  duplicate. If 26-03 merges first, 26-01's executor can overwrite freely
  because 26-01 ships a superset (adds `AdjustmentEntry`,
  `FraudSignalPayload` variants, and three more test files that 26-03 does
  not consume).
- **Files added:** `src/lib/affiliate/tier-config.ts`, `src/lib/affiliate/types.ts`
- **Commit:** `6babb8f`

**2. [Rule 1 — Bug] Escaped `/` inside JSDoc block comment**

- **Found during:** Task 1 tsc verification
- **Issue:** `types.ts` line 12 contained `26-*/26-01-PLAN.md` inside a
  `/** ... */` JSDoc block. The `*/` substring prematurely closed the
  comment, generating 3 TS parser errors (octal literal, missing semicolon,
  unterminated regex literal).
- **Fix:** Rewrote the path reference as plain prose without the `*/`
  sequence.
- **Commit:** `4cc118d` (committed alongside the Task 1 GREEN)

**3. [Rule 1 — Token alignment] Tailwind color classes use project `var(--color-*)` convention**

- **Found during:** Task 2 component scaffolding
- **Issue:** Plan body specified bare Tailwind classes (`bg-warning-bg`,
  `text-warning-fg`, `border-warning`, `bg-bg-muted`, `text-fg-muted`,
  `bg-accent`). None of those tokens exist in this Tailwind v4 theme
  (`src/index.css`). The convention used by sibling partner components
  (`PartnerDashboard.tsx`, `PartnerAssetsPage.tsx`, `PartnerLayout.tsx`)
  is `text-[var(--color-text-secondary)]`, `bg-[var(--color-warning-soft)]`,
  etc.
- **Fix:** Used the project convention. Mapping:
  - `bg-warning-bg` → `bg-[var(--color-warning-soft)]`
  - `text-warning-fg` → `text-[var(--color-text)]` (banner body) +
    `text-[var(--color-warning)]` (icon)
  - `border-warning` → `border-[var(--color-warning)]`
  - `text-fg-muted` → `text-[var(--color-text-secondary)]`
  - `bg-bg-muted` → `bg-[var(--color-surface-soft)]`
  - `bg-accent` → `bg-[var(--color-primary)]`
- **Commit:** `1d40d3e`

**4. [Rule 1 — Badge tone] Gold badge uses `'amber'` not `'warning'`**

- **Found during:** Task 2 component scaffolding
- **Issue:** Plan body's `TIER_BADGE_TONE` map used `'warning'` for the
  `gold` key. Project `BadgeTone` enum
  (`'info' | 'success' | 'warning' | 'danger' | 'neutral' | 'inverse' | 'amber'`)
  does include `'warning'`, but `'amber'` is the more visually-appropriate
  Gold-tier token (per project design system).
- **Fix:** Mapped `gold → 'amber'`. Documented in commit body so future
  reviewers can roll back to `'warning'` if the design call differs.
- **Commit:** `1d40d3e`

## Threat-Model Coverage

| Threat ID | Disposition | Mitigation Verified |
|-----------|-------------|---------------------|
| T-26-12 (Information Disclosure — cross-partner read) | mitigate | RLS already enforced by Phase 19 Plan 19-01 `pol_*_self_select` policies; this plan adds no new RLS surface. Read path filters by `affiliate_id` and relies on RLS-gated session. |
| T-26-13 (Tampering — client-side tier override) | mitigate | Tier value comes from server-authoritative `getTierProgress` (reads `affiliates.tier`). No client-side state is sent back to the server. Promotion path is trigger-driven (Plan 26-01) — UI is read-only on tier. |
| T-26-14 (Repudiation — frozen-state dispute) | mitigate | `freeze_reason` rendered verbatim inside `role="alert"` banner; `mailto:partners@leanshot.app` appeal link present in DOM (covered by RTL test). |

## Known Stubs

None — both new components fetch live data; PartnerDashboard wires
`profile.id` from the existing `usePartnerContext()` hook (already wired by
Plan 19-06a).

## Deferred Issues

None — all success criteria met inside this plan's scope.

## Self-Check: PASSED

Created files verified present:

- `src/lib/affiliate/tier-config.ts` — FOUND
- `src/lib/affiliate/types.ts` — FOUND
- `src/lib/affiliate/__tests__/tier-earnings.test.ts` — FOUND
- `src/components/partner/PartnerTierProgress.tsx` — FOUND
- `src/components/partner/PartnerTierEarningsBreakdown.tsx` — FOUND
- `src/components/partner/__tests__/PartnerTierProgress.test.tsx` — FOUND

Modified files verified present:

- `src/lib/affiliate/api.ts` (contains `getTierProgress` + `rollupTierEarnings`) — FOUND
- `src/components/partner/PartnerDashboard.tsx` (contains `PartnerTierProgress` mount) — FOUND

Commits verified in `git log`:

- `6babb8f test(26-03-01): RED` — FOUND
- `4cc118d feat(26-03-01): GREEN` — FOUND
- `3bd6850 test(26-03-02): RED` — FOUND
- `1d40d3e feat(26-03-02): GREEN` — FOUND
- `d803022 feat(26-03-03): mount` — FOUND

Success criteria re-validated end-of-plan:

- SC#1 `grep -q 'PartnerTierProgress' PartnerDashboard.tsx` → PASS
- SC#2 `vitest run` on the two test files → 7/7 pass
- SC#3 `tsc --noEmit -p tsconfig.app.json` → 0 errors
- SC#4 a11y attribute count → 2 (role="progressbar" + role="alert")
