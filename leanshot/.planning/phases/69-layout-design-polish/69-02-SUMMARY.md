---
phase: 69-layout-design-polish
plan: 2
subsystem: design-system
tags: [ds-04, audit, deno, ci, report-only]
requires: []
provides:
  - scripts/ci/audit-ds-primitives.ts
  - leanshot/.planning/design-system/primitive-adoption-report.md
affects: []
tech-stack:
  added:
    - Deno std@0.224.0 (fs/walk, path) — matches scripts/ci/check-sentry-imports.* precedent
  patterns:
    - heuristic regex audit + markdown report (mirrors lint-stripe-phi.ts shape, Deno runtime)
    - report-only exit 0 (Phase 69.5 / operator executes refactors)
key-files:
  created:
    - scripts/ci/audit-ds-primitives.ts
    - scripts/ci/audit-ds-primitives.test.ts
    - leanshot/.planning/design-system/primitive-adoption-report.md
  modified: []
decisions:
  - Use git-root scripts/ci/ + Deno runtime (matches Phase 67 check-sentry-imports precedent), NOT leanshot/scripts/ + tsx/vitest
  - Cover 4 primitives initially (Button/Card/Modal/Input); defer weaker-signal primitives (Sheet/Pill/EmptyState/Badge/ProgressRing/Skeleton/Sparkline/SwipeToDelete) to Phase 69.5
  - Card heuristic requires shadow utility (under-threshold without it) to reduce false positives
  - Inside-file Button/Modal imports do NOT suppress findings — only annotate, since one file CAN legitimately bypass its own imported primitive
metrics:
  duration: ~25 minutes
  completed: 2026-05-27T07:00Z
  tests: 20 passed (Deno)
  initial-findings: 4 (Button=0 Card=2 Modal=2 Input=0)
---

# Phase 69 Plan 69-02: audit-ds-primitives (DS-04) Summary

DS primitive adoption audit script (`scripts/ci/audit-ds-primitives.ts`) — heuristic regex walker over `leanshot/src/**/*.tsx` that flags likely one-off duplicates of `leanshot/src/components/ui/` primitives (Button, Card, Modal, Input) and writes a markdown report to `leanshot/.planning/design-system/primitive-adoption-report.md`. Always exits 0 (report-only); Phase 69.5 / operator executes refactors per-surface.

## What Shipped

### Script (`scripts/ci/audit-ds-primitives.ts`, ~310 lines)

- Deno runtime — uses `Deno.readTextFile`, `Deno.writeTextFile`, `Deno.mkdir`, `Deno.stat`, `https://deno.land/std@0.224.0/fs/walk.ts`. Matches sibling `check-sentry-imports.ts` precedent.
- CLI flags: `--root=PATH` (override scan root, default `Deno.cwd()`), `--out=PATH` (override report path, default `leanshot/.planning/design-system/primitive-adoption-report.md`), `--quiet` (suppress stdout summary).
- 4 primitive scans wired via shared `PrimitiveScan` interface:
  - **Button**: `<button>` + `bg-primary|bg-[var(--color-primary)` + `rounded-` + `px-N`
  - **Card**: `<div>` + `bg-surface|bg-[var(--color-surface)` + `border` + `rounded-` + `p[xy]?-N` + `shadow-` (shadow required to reduce false positives)
  - **Modal**: `<div role="dialog">`
  - **Input**: `<input>` + `border` + `rounded-` + `p[xy]?-N` + `(h-N|py-N)`
- `skipFile()` elides the primitive's own definition file (e.g., Button.tsx is not scanned for the Button signal).
- `importsPrimitive()` does NOT suppress findings — it only annotates with `(file already imports the primitive)`, because a single file CAN legitimately bypass its own imported primitive (e.g., AlertSnoozePopover.tsx already imports Modal but still has an inline `<div role="dialog">`).
- Report format: H1 title + generated timestamp + summary table + per-primitive H2 sections sorted by file/line for diff-friendly stable output. Empty buckets render `_None detected._`.

### Tests (`scripts/ci/audit-ds-primitives.test.ts`, ~270 lines)

20 Deno test cases covering:

| # | Coverage |
| --- | --- |
| 1-3 | `buttonScan` — styled-button positive, `<Button>` negative, unstyled-button negative |
| 4-7 | `cardScan` — surface-bg + var(--color-surface) positives, `<Card>` negative, missing-shadow under-threshold negative |
| 8-9 | `modalScan` — `<div role="dialog">` positive, non-dialog div negative |
| 10-12 | `inputScan` — styled-input positive, `<Input>` negative, unstyled-input negative |
| 13 | `scanFile` — Button.tsx itself is skipped |
| 14 | `scanFile` — finding inside Button-importing file IS reported, with annotation |
| 15 | `scanFile` — 1-based line + relative path correctness |
| 16-17 | `buildReport` — zero-findings empty buckets + multi-primitive bucketing/summary table |
| 18 | `scanRoot` — end-to-end walk of `<root>/leanshot/src` finds duplicates and excludes Good.tsx |
| 19 | `runMain` — writes report file + exits 0 with non-zero findings |
| 20 | `runMain` — clean codebase produces `Total findings: **0**` + exit 0 |

All 20 pass: `deno test --no-check --allow-read --allow-write --allow-env scripts/ci/audit-ds-primitives.test.ts` → `ok | 20 passed | 0 failed (21ms)`.

### Initial audit run

```
[audit-ds-primitives] wrote leanshot/.planning/design-system/primitive-adoption-report.md
  — 4 findings (Button=0 Card=2 Modal=2 Input=0)
```

The 4 findings on current main, for Phase 69.5 to triage:

| Primitive | File | Line | Notes |
| --- | --- | --- | --- |
| Card | `leanshot/src/components/layout/Topbar.tsx` | 106 | rounded-pill search-bar shape — likely legit (pill-shaped, not card-shaped); operator should de-prioritize |
| Card | `leanshot/src/components/onboarding/ConsumerOnboardingRenderer.tsx` | 250 | onboarding card wrapper — strong candidate for `<Card>` refactor |
| Modal | `leanshot/src/components/clinic/alerts/AlertSnoozePopover.tsx` | 173 | popover-as-dialog; could be `<Sheet>` or `<Modal mobileFullscreen>` (file already imports Modal — annotated) |
| Modal | `leanshot/src/components/dashboard/ai/CitationPopover.tsx` | 380 | citation popover; same shape as AlertSnoozePopover (file already imports the primitive — annotated) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Path location: `scripts/ci/` lives at git root, NOT under `leanshot/`**

- **Found during:** Task 1, initial implementation
- **Issue:** I first wrote the script under `leanshot/scripts/ci/` following the convention of other leanshot-internal audit scripts (`leanshot/scripts/audit-sentry-mask.ts`, `lint-stripe-phi.ts`). After inspection, the project also has a **git-root** `scripts/ci/` directory containing Phase 67 `check-sentry-imports.ts` — and the plan's `files_modified` paths (`scripts/ci/audit-ds-primitives.ts`, no `leanshot/` prefix) are git-root-relative per `[[reference_minisite_monorepo_layout]]`.
- **Fix:** Moved both files to git-root `scripts/ci/` and rewrote them in Deno to match the Phase 67 precedent (the plan's `<known_lessons>` Deno hint was the real signal — Deno is the runtime for git-root `scripts/ci/*`, not vitest).
- **Files affected:** `scripts/ci/audit-ds-primitives.ts`, `scripts/ci/audit-ds-primitives.test.ts` (final locations); transient (deleted before commit) `leanshot/scripts/ci/*`.
- **Lesson:** The Phase 69-02 PLAN said "Deno test runner" in `<known_lessons>` and the orchestrator prompt repeated it. I initially overweighted the local-leanshot Node/tsx convention from `audit-sentry-mask` and underweighted the Deno hint. The hint was correct because it referred to `scripts/ci/`, a git-root location with its own (Phase 67) precedent. Rule 3 fix.
- **Commit:** d70d54d2 (single combined commit — no separate fixup commit needed since the wrong-location files were uncommitted scratch).

**2. [Rule 3 — Blocking] node_modules missing in worktree (transient, recovered)**

- **Found during:** Initial vitest run attempt (before the Deno pivot)
- **Issue:** Worktree had no `node_modules/`, so `npx vitest` could not resolve `vite-plugin-pwa` import in `vite.config.ts`.
- **Fix:** Per `[[reference_sentry_capacitor_npm_install_blocker]]` / `[[reference_npm_install_worktree_main_drift]]`, symlinked `node_modules → /Users/karstenhaldan/minisite/leanshot/node_modules`. After the Rule-3 pivot to Deno (which has zero dependency on node_modules), the symlink became unnecessary; it remains as an untracked, gitignored symlink in the worktree.
- **Files affected:** None tracked.

### Process Note

**Accidental delete-then-restore of `leanshot/.planning/design-system/` content.**

After cleaning up the wrong-location `leanshot/scripts/ci/` directory, I ran `rm -rf .planning/design-system` from inside `leanshot/`, intending to remove an empty directory the audit script had just created. But that path also contained ~144 pre-existing tracked files (the design-system reference content — chats, project, ui_kits). `git checkout HEAD -- leanshot/.planning/design-system` immediately restored everything (verified: 0 changes after restore vs HEAD; working tree clean before I proceeded with the Deno rewrite). No commits contain the accidental deletion. Lesson worth noting: `rm -rf` from inside a sub-monorepo dir CAN target unintended ancestors when followed by `cd` between Bash calls — the cwd-drift assertion in the executor protocol catches this for `git commit` but not for `rm`. **No data was committed in the deleted state.** All 144 files match HEAD post-recovery.

## Files Changed

| Path | Change | Lines |
| --- | --- | --- |
| `scripts/ci/audit-ds-primitives.ts` | created | +310 |
| `scripts/ci/audit-ds-primitives.test.ts` | created | +252 |
| `leanshot/.planning/design-system/primitive-adoption-report.md` | created | +49 |

Total: 3 files, +711 lines.

## Commits

| Hash | Type | Description |
| --- | --- | --- |
| d70d54d2 | feat(69-02) | DS-04 audit-ds-primitives Deno script + report |

## Success Criteria

- [x] `scripts/ci/audit-ds-primitives.ts` standalone Deno script — created at git-root, runs via `deno run -A scripts/ci/audit-ds-primitives.ts`
- [x] 4+ Deno test cases (one per primitive's duplicate signal + one negative) — shipped 20 Deno tests covering 4 primitives × (positive + negative) + scanFile behavior + buildReport + end-to-end runMain (clean + dirty)
- [x] Runs against current codebase + produces report at `leanshot/.planning/design-system/primitive-adoption-report.md` — 4 findings emitted, file written
- [x] Exit code 0 always (report-only) — verified by 2 end-to-end Deno tests (`runMain` clean + dirty), plus manual invocation against real codebase (exit=0)
- [x] SUMMARY.md committed — this file (will be in the post-plan metadata commit)

## How to Run

```bash
# From git root
deno run -A scripts/ci/audit-ds-primitives.ts            # writes report; exit 0
deno run -A scripts/ci/audit-ds-primitives.ts --quiet    # writes report; no stdout
deno test --no-check --allow-read --allow-write --allow-env scripts/ci/audit-ds-primitives.test.ts
```

## Self-Check: PASSED

- [x] `scripts/ci/audit-ds-primitives.ts` exists — `ls scripts/ci/audit-ds-primitives.ts` → FOUND
- [x] `scripts/ci/audit-ds-primitives.test.ts` exists — FOUND
- [x] `leanshot/.planning/design-system/primitive-adoption-report.md` exists — FOUND
- [x] Commit `d70d54d2` exists — `git log --oneline | grep d70d54d2` → FOUND
- [x] All 20 Deno tests pass — verified via `deno test`
- [x] Real-codebase invocation produces report + exits 0 — verified
