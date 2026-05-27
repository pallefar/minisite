# Phase 69: Layout & Design Polish — Context

**Gathered:** 2026-05-27
**Mode:** Compressed-discuss (mostly CI gates + audit-and-document; net-new ship surface is small)

## Phase Boundary

Design-system harmonization across all v1.1/v1.2/v1.3/v1.4 surfaces. Ship CI gates that prevent regression on token / typography / accent usage. Audit + fix obvious violations. Defer open-ended sweeps (a11y deep-dive, copywriting nits) to Phase 69.5 tech-debt sweep.

## Decisions

### D-01 — CI gate priority over manual sweep
**Choice:** Phase 69's high-leverage deliverable is the **3 CI gates** (DS-01 undefined-token grep, DS-02 typography ceiling grep, DS-03 accent reserved-list grep). These prevent regression on every future PR. Audit-and-fix passes for existing violations are secondary; CI gate failures point to them directly.

### D-02 — Sweep approach for DS-04..09
**Choice:** Ship grep-based **audit scripts** (not full fixes). Each script outputs a markdown report of violations. Operator (or Phase 69.5) executes fixes per-surface. This keeps Phase 69 scope bounded.

### D-03 — Dark mode VR snapshots (DS-06)
**Choice:** Playwright VR snapshot suite covering v1.4 surfaces (P52-68). Snapshots captured at light + dark + 375px mobile + 1280px desktop = 4 variants per page × N pages. Stored under `tests/vr/v1.4/`. Operator runs after deploy to detect regressions vs baseline.

### D-04 — gsd-ui-auditor clean-run (DS-10)
**Choice:** Run `gsd-ui-auditor` against the 7 newly-shipped surfaces (Phase 65: 3 + Phase 66: 5 + Phase 68: 3) — that's the v1.4 net-new surface. Per `[[reference_ui_checker_dimension_traps]]` the auditor catches what manual grep misses.

### D-05 — Deferred to Phase 69.5
- Audit-and-fix pass on every DS-04..09 violation
- Updating 18-modules-test (Phase 65 carry-over)
- Pre-existing src/lib/auth.test.ts / aal2-step-up / billing-sync / job-polling failures
- Per-function SECDEF EXECUTE-grant audit (Phase 66.5 carry-over)

### D-06 — Deploy gating
Same as 65-68 — code-complete; CI gates activate on next PR; operator-side scripts deferred.

## Code Context

- Tailwind v4 @theme tokens at `leanshot/src/index.css`
- DS primitives at `leanshot/src/components/ui/` (per CLAUDE.md: Button, Card, Modal, Sheet, Pill, EmptyState, etc.)
- `gsd-ui-auditor` agent: `~/.claude/agents/gsd-ui-auditor.md`
- Existing VR snapshots: check `leanshot/tests/vr/` if present
- Phase 60-13 already normalized typography to {11,13,18,28} × {400,600} for 6 files; Phase 69 CI gate enforces this
- Phase 65/66 surfaces already follow @theme tokens (per executor SUMMARYs); audit will likely find few violations on net-new code, more on legacy

## Deferred

- Refactor DS primitive duplicates to use unified components (DS-04 fix; sweep only ships audit)
- Full a11y axe-core CI sweep (DS-05) — defer to Phase 69.5
- Mobile gesture refinement (DS-07) — defer
- DESIGN-DECISIONS.md formalization (DS-08 exceptions doc) — defer
