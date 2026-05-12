---
phase: 06-patient-cloud-sync-slice-2-full-data-migration-photos
spec: 06-UI-SPEC.md
checked: 2026-05-12
checker: gsd-ui-checker (sonnet)
verdict: APPROVED
blocking_findings: 0
flag_findings: 6
---

# Phase 6 UI-SPEC Check

## Verdict: APPROVED

All 6 dimensions PASS. No BLOCK-severity findings. Six non-blocking notes for planner awareness.

## Per-Dimension Verdict

| # | Dimension | Verdict | Notes |
|---|-----------|---------|-------|
| 1 | Token compliance | PASS (1 nit) | All claimed tokens exist in `src/index.css` @theme; one Tailwind-class-vs-CSS-variable cross-reference flagged in N1 |
| 2 | Component reuse | PASS | Modal/Toast/ProgressBar/Skeleton/Badge APIs honored verbatim |
| 3 | Accessibility | PASS | role/aria-live/focus management wired; spec correctly identifies a pre-existing Skeleton a11y gap to fold-fix |
| 4 | Z-index ladder | PASS | Default `z-[100]` correct — MigrationModal ships post-tour, no GuidedTour stacking-deadlock recurrence |
| 5 | Context compliance | PASS | All 14 LOCKED decisions (D-01..D-14) honored; D-12 sync-defer.ts dynamic import explicitly called out at §1 lines 333-334 |
| 6 | Cross-phase consistency | PASS | Tone, vocabulary, token-reuse posture match 05-UI-SPEC verbatim |

## Non-Blocking Findings (planner awareness)

### N1 — `--duration-deliberate` vs Tailwind `duration-500` (Dim 1, FLAG)
Spec line 526 references `--duration-deliberate` for ProgressBar 500ms interp, but `ProgressRing.tsx:111` uses `duration-500` Tailwind class. Both resolve to 500ms but aren't bound to each other if the design system later retunes `--duration-deliberate`.

### N2 — `--color-warning-soft` underlying primitive is rose-soft, not amber-soft (Dim 3 nit)
`src/index.css:69` defines `--color-warning-soft: var(--color-rose-soft)`. Spec narrative at lines 127 + 151 says "amber-soft" — visual outcome unchanged (cream/coral pairing same as `EmailVerificationBanner`), but anyone greping for "amber-soft" won't find it.

### N3 — `Badge` prop is `tone` not `variant` (Dim 2, FLAG)
Spec hedges at lines 397 + 411 ("Use existing `Badge` if its API accepts `variant='warning'`"). Actual API: `tone="warning"`. Planner: use `<Badge tone="warning">Queued</Badge>` or the inline-compose fallback shown in the spec.

### N4 — Toast `durationMs` extension is genuine new public API (Dim 2, FLAG)
`Toast.tsx:13` hardcodes `setTimeout(dismiss, 2400)`. The proposed `durationMs?: number` extension is legit, minimal, additive — but it's a public-API delta on the `useToast` / store contract that planner should track in the changelog.

### N5 — Skeleton `prefers-reduced-motion` is a real bug, correctly identified (Dim 3, PASS)
`Skeleton.tsx:23` uses inline `style.animation` which can race against `index.css:485-499` `*` reduced-motion `!important`. Explicit `useReducedMotion()` is the safer pattern (already used elsewhere). Fold-fix into Phase 6 plan is good catch.

### N6 — AvatarMenu sync dot color overload (Dim 5/6, FLAG)
Current verified-state dot is `--color-success`. Proposed Phase 6 sync-state-5 (synced) is also `--color-success`. Visually fine, semantically a small overload (verified-and-synced indistinguishable from verified-but-not-syncing). `aria-label` differentiation handles AT layer. Planner: confirm dual-meaning OR split the `isSyncEnabled === false` case to a different hue.

## What's Solid (preserve in planning)

- **Zero new tokens** — spec doubles down on Phase 5's discipline; no `--color-migration-progress` invention.
- **D-12 explicit** — §1 Component Spec lines 333-334 spell out the dynamic-import-via-`sync-defer.ts` requirement + the 50 kB gzip CI assertion.
- **Resume case copy** ("Picking up where we left off — {doneCount} of {totalCount} sections done.") matches D-02 intent + reuses existing token vocabulary.
- **Conflict toast `kind=info`** (not error) matches D-11 explicit "informational, not failure" language.
- **Row state matrix** for `MigrationEntityRow` covers pending/in-progress/complete/error with distinct iconography + color — no accent overuse.
- **Reduced-motion section per component**, not a global afterthought.
- **AvatarMenu deferred surface is optional** — Phase 6 success criteria do not depend on it, plan stays resilient if scope tightens.

## Ready for Next Step

`/gsd-plan-phase 6` can now proceed. The planner will read:
- 06-CONTEXT.md (14 LOCKED decisions)
- 06-UI-SPEC.md (visual + interaction contracts)
- This 06-UI-CHECK.md (any of the 6 N-findings the planner wants to surface as task acceptance criteria)
- 05-* artifacts (Phase 5 patterns to mechanically extend)

Once research and validation strategy land, planner can author Plan 06-01 (CI hardening) + Plan 06-02+ (migration UI, photo storage, new-tables sync) with all UI contracts pre-locked.
