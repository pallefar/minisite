---
phase: 13-design-system-v2-rollout
plan: 06
subsystem: testing-infrastructure
tags: [visual-regression, playwright, ci, baselines, focus-ring, design-system, phase-12-regression-guard]
dependency_graph:
  requires:
    - 13-02-PLAN.md (Card/Button/Pill/Sidebar v2 variants — landed on `main` base `ea571c1`)
    - 13-03-PLAN.md (19 illustrations incl. AIAvatar v2 + StreakBadge — landed)
    - 13-04-PLAN.md (split-screen AuthView — landed)
    - 13-05-PLAN.md (marketing Landing audit — landed)
  provides:
    - VR-gate-12-snapshots (PR-blocking)
    - VR-baseline-workflow (opt-in workflow_dispatch)
    - focus-ring-audit-checklist
  affects:
    - All v1.2 Phase 14+ work (every PR diffed against the Phase 13 v2 baselines)
tech_stack:
  added: []
  patterns:
    - addInitScript-only state seeding (memory `reference_playwright_state_seeding.md`)
    - peter-evans/create-pull-request for baseline regen PR flow
    - test.use({ contextOptions: { reducedMotion: 'reduce' } }) for animation-frozen snapshots
key_files:
  created:
    - leanshot/e2e/visual/landing-light.spec.ts
    - leanshot/e2e/visual/landing-dark.spec.ts
    - leanshot/e2e/visual/auth-login-light.spec.ts
    - leanshot/e2e/visual/home-light.spec.ts
    - leanshot/e2e/visual/home-dark.spec.ts
    - leanshot/e2e/visual/medication-light.spec.ts
    - leanshot/e2e/visual/medication-dark.spec.ts
    - leanshot/e2e/visual/body-light.spec.ts
    - leanshot/e2e/visual/settings-light.spec.ts
    - leanshot/e2e/visual/onboarding-final-light.spec.ts
    - leanshot/e2e/visual/ai-chat-idle-light.spec.ts
    - leanshot/e2e/visual/ai-chat-thinking-light.spec.ts
    - leanshot/e2e/visual/helpers/seed.ts
    - .github/workflows/visual-baselines.yml
    - leanshot/.planning/phases/13-design-system-v2-rollout/13-06-FOCUS-RING-AUDIT.md
  modified:
    - leanshot/playwright.config.ts (expect.toHaveScreenshot defaults + snapshotPathTemplate)
    - leanshot/package.json (test:visual + test:visual:update scripts)
    - .github/workflows/ci.yml (needs: [test-unit, lint] on test-e2e + documenting comment)
decisions:
  - Resolved 'tests/visual/' vs 'e2e/visual/' to 'e2e/visual/' per 13-PATTERNS.md §10 — smallest diff, reuses existing testDir
  - No baseline PNGs committed at this plan-execution time (D-06)
  - reducedMotion 'reduce' applied at context level via test.use for the AI-thinking spec
metrics:
  duration: ~28 min
  completed: 2026-05-13
requirements:
  - DS-02
  - DS-05
  - DS-06
  - DS-07
  - DS-08
  - DS-09
  - DS-10
  - DS-11
  - DS-12
---

# Phase 13 Plan 13-06: Visual Regression Suite + CI Wiring Summary

**One-liner:** Twelve Playwright `toHaveScreenshot` specs (8 surface groups × light/dark) wired as a PR-blocking gate, plus an opt-in `workflow_dispatch` baseline-regen workflow and a manual focus-ring audit checklist for D-15.

## What shipped

### Task 1 — Specs + helpers + Playwright config (commit `9471eb7`)

- 12 spec files under `leanshot/e2e/visual/*.spec.ts`, one `test()` block per file:
  1. `landing-light.spec.ts` — Marketing Landing, light theme
  2. `landing-dark.spec.ts` — Marketing Landing, dark theme
  3. `auth-login-light.spec.ts` — split-screen `'auth'` view via `/#/auth/signin`
  4. `home-light.spec.ts` — HomeTab, light
  5. `home-dark.spec.ts` — HomeTab, dark
  6. `medication-light.spec.ts` — MedicationTab (chart + site-rotation + titration), light
  7. `medication-dark.spec.ts` — MedicationTab, dark
  8. `body-light.spec.ts` — BodyTab (weight chart + photos empty-state), light
  9. `settings-light.spec.ts` — SettingsPage drawer, light
  10. `onboarding-final-light.spec.ts` — OnboardingFlow final step, light
  11. `ai-chat-idle-light.spec.ts` — AIChatPanel idle (AIAvatar v2 organic mesh), light
  12. `ai-chat-thinking-light.spec.ts` — AIChatPanel thinking (reduced-motion fallback), light

- `helpers/seed.ts` exports: `seedUnauth`, `seedOnboarded`, `seedThemeDark`, `seedOnboardingFinal`, `stubAiThinking`, `waitForReady`, `gotoTab`. **All seeding uses `page.addInitScript` ONLY** — never the goto-then-evaluate-then-reload antipattern (memory `reference_playwright_state_seeding.md`). Deterministic seed user `Alex` on Mounjaro 5 mg with 3 weekly injections + 5 weight logs so charts paint identically every run.

- `playwright.config.ts` additions (verbatim):
  ```ts
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
      animations: 'disabled',
    },
  },
  snapshotPathTemplate: '{testDir}/visual/__screenshots__/{testFilePath}-{arg}{ext}',
  ```
  No change to `testDir`, `testMatch`, `webServer`, `projects`, `reporter`.

- `package.json` scripts:
  ```json
  "test:visual": "playwright test e2e/visual",
  "test:visual:update": "playwright test e2e/visual --update-snapshots"
  ```

- `npx playwright test e2e/visual --list` reports **exactly 12 tests in 12 files** (verified).
- `npx tsc -b` passes (verified).
- `npm run build` passes (verified; vendor chunk topology unchanged from base `ea571c1`).
- **NO baseline PNGs committed.** **NO `__screenshots__/` directory committed.** Playwright auto-creates the directory on the first `--update-snapshots` invocation from `visual-baselines.yml`.

### Task 2 — CI gates + opt-in baseline workflow + focus-ring audit (commit `18d5568`)

- `.github/workflows/ci.yml`:
  - Added `needs: [test-unit, lint]` on the `test-e2e` job so Phase 12 CSP snapshot (12-04, in `test-unit`/vitest) and Phase 12 firewall ESLint (12-02, in `lint`) failures **block the VR run from even starting**.
  - Added a documenting comment block above the existing `npm run test:e2e` step listing the Phase 12 invariants this workflow protects:
    - CSP snapshot (12-04) → `test-unit`
    - Bundle ceilings (12-01) → existing `assert-bundle-budget.sh` + `assert-vendor-react-size.sh`
    - Hash-hyphen regression (12-01 D-13) → existing `test-hash-hyphen-regression.sh`
    - Firewall ESLint (12-02) → `lint`
    - clinic-ad-free (12-03) → existing dedicated step
  - **NO existing step removed.** The VR specs run as part of the existing `npm run test:e2e` invocation because `testDir: './e2e'` auto-discovers nested `e2e/visual/*.spec.ts`.

- `.github/workflows/visual-baselines.yml` (NEW):
  - Trigger: **`workflow_dispatch` ONLY** (no `pull_request`, no `push`). Verified by grep.
  - Required `reason` input so every regen is traceable to a specific Phase plan or rationale.
  - Steps: checkout (full history) → setup-node 22 → `npm ci` → install Chromium → production-shaped `npm run build` with same env vars as test-e2e (`VITE_E2E=true`, Supabase secrets, empty Sentry/PostHog) → `npx playwright test e2e/visual --update-snapshots --reporter=line` (Playwright's `webServer` auto-starts preview on 4173) → list captured baselines → **`peter-evans/create-pull-request@v5`** to open a branch `visual-baselines/${{ github.run_id }}` with a structured review checklist in the PR body.
  - **NEVER commits to `main` directly.** Every regen flows through human PR review.

- `leanshot/.planning/phases/13-design-system-v2-rollout/13-06-FOCUS-RING-AUDIT.md` (NEW):
  - Canonical focus-ring class cascade from 13-PATTERNS.md §E quoted at top so any deviation in PR review is mechanically detectable.
  - Per-primitive sections: **Card**, **Button**, **Pill**, **Sidebar** — each with light + dark sub-checklists covering variant-specific concerns (disabled buttons suppress the ring; loading buttons preserve it; segmented Pill ring spans the segment not the group; sidebar `layoutId="sb-active"` motion bar must not obscure the focus ring; etc.).
  - **Procedure** section (6 steps) covering keyboard Tab traversal, theme toggling, high-contrast accessibility mode, reduced-motion interaction.
  - **Browsers** section requiring Chromium primary + Firefox + Safari spot-checks.
  - **Sign-off** block with operator name / date / PASS/FAIL fields to be attached to `13-VERIFICATION.md` during phase close.

## Operator-facing instructions for baseline capture

After 13-02, 13-03, 13-04, 13-05 land on `main`:

1. Open the GitHub repo → **Actions** tab.
2. Select the **"Visual baselines regen"** workflow in the left sidebar.
3. Click **"Run workflow"**, fill in the required `reason` input (e.g.
   `"Phase 13 v2 design rollout — initial baselines"`), and dispatch on `main`.
4. Wait ~5–10 min for the run to complete.
5. The workflow opens a PR titled
   `chore(visual): regenerate Phase 13 baselines (<github.actor>)`.
6. Open the PR's **Files changed** tab; review each of the 12 PNG baselines
   visually. Confirm:
   - Each visual matches the surface it claims (no surface mismatch).
   - No unrelated drift (theme leakage, font swap, z-index quirks).
   - Light + dark themes look distinct and correct.
7. Merge the PR. From this point forward, every subsequent PR's `test-e2e` job
   diffs against these baselines at `maxDiffPixelRatio: 0.01`. Any intentional
   visual change in a future phase requires another `workflow_dispatch` run +
   PR merge to re-baseline.

## Phase 12 gate-status

All four Phase 12 regression gates remain green and structurally unchanged in
the same CI workflow that runs the VR suite:

| Gate | Source | Verification job |
|------|--------|------------------|
| CSP snapshot (12-04) | `leanshot/tests/csp/csp-snapshot.test.ts` (vitest) | `test-unit` job (chained via `needs:`) |
| Bundle ceilings (12-01) | `assert-bundle-budget.sh` + `assert-vendor-react-size.sh` | Steps inside `test-e2e` job |
| Hash-hyphen regression (12-01 D-13) | `test-hash-hyphen-regression.sh` | Step inside `test-e2e` job |
| Firewall ESLint (12-02) | `import-x/no-restricted-paths` in eslint.config.js | `lint` job (chained via `needs:`) |
| clinic-ad-free e2e (12-03) | `leanshot/e2e/clinic-ad-free.spec.ts` | Dedicated step inside `test-e2e` job |

If any of these go red on a future PR, the `test-e2e` job will halt **before**
the VR diff is taken — protecting both the Phase 12 invariants and the Phase 13
baselines from cross-contamination.

## Drift from planning context's `files_modified` list

Planning context drafted `leanshot/tests/visual/**`; this plan resolved that to
`leanshot/e2e/visual/**` per 13-PATTERNS.md §10's explicit recommendation
("[the latter is the smaller diff]"). The existing `testDir: './e2e'`
auto-discovers nested `.spec.ts` files, so no `testDir` widening (and the
historical Phase 5 vitest-discovery crash at `playwright.config.ts:6–8` stays
intact). Frontmatter `files_modified` updated accordingly.

## Self-Check: PASSED

- Files created (`[ -f path ]` checks):
  - FOUND: leanshot/e2e/visual/landing-light.spec.ts
  - FOUND: leanshot/e2e/visual/landing-dark.spec.ts
  - FOUND: leanshot/e2e/visual/auth-login-light.spec.ts
  - FOUND: leanshot/e2e/visual/home-light.spec.ts
  - FOUND: leanshot/e2e/visual/home-dark.spec.ts
  - FOUND: leanshot/e2e/visual/medication-light.spec.ts
  - FOUND: leanshot/e2e/visual/medication-dark.spec.ts
  - FOUND: leanshot/e2e/visual/body-light.spec.ts
  - FOUND: leanshot/e2e/visual/settings-light.spec.ts
  - FOUND: leanshot/e2e/visual/onboarding-final-light.spec.ts
  - FOUND: leanshot/e2e/visual/ai-chat-idle-light.spec.ts
  - FOUND: leanshot/e2e/visual/ai-chat-thinking-light.spec.ts
  - FOUND: leanshot/e2e/visual/helpers/seed.ts
  - FOUND: .github/workflows/visual-baselines.yml
  - FOUND: leanshot/.planning/phases/13-design-system-v2-rollout/13-06-FOCUS-RING-AUDIT.md
- Commits exist (`git log --oneline`):
  - FOUND: 9471eb7 (Task 1)
  - FOUND: 18d5568 (Task 2)
- Plan-level verifications:
  - FOUND: 12 specs (`ls leanshot/e2e/visual/*.spec.ts | wc -l` = 12)
  - FOUND: 0 baseline PNGs committed
  - FOUND: no `leanshot/tests/visual/` directory
  - FOUND: `needs: [test-unit, lint]` on `test-e2e` job
  - FOUND: `on: workflow_dispatch:` ONLY on `visual-baselines.yml` (no pull_request / push)
  - FOUND: 0 forbidden seeding-pattern matches in `e2e/visual/`
  - FOUND: 4 primitive headings (`### Card|Button|Pill|Sidebar`) in audit checklist
  - FOUND: 5 top-level `##` sections in audit checklist

## Open items for `/gsd-verify-phase 13`

1. **Run the focus-ring audit checklist** — manual operator task. Tab through
   Card/Button/Pill/Sidebar on light + dark; attach signed checklist to
   `13-VERIFICATION.md`.
2. **Dispatch the `visual-baselines` workflow** from the Actions tab (after
   13-02..05 are confirmed merged into `main`). Review the auto-generated PR
   and merge it once visuals look correct.
3. **Observe the first PR with intentional drift** after baselines land — it
   MUST fail the `test-e2e` job at the VR snapshot step. That confirms the
   gate is structurally PR-blocking and the `maxDiffPixelRatio: 0.01`
   threshold is calibrated correctly. If the first drift PR passes when it
   shouldn't, the ratio is too loose; if the first NO-drift PR fails, the
   ratio is too tight.
4. **Verify Phase 12 gate-chain interlock** — on a synthetic PR that breaks
   the CSP snapshot, confirm `test-e2e` never starts (because `test-unit`
   fails first). On a synthetic PR that breaks the firewall rule, confirm
   the same (because `lint` fails first). This proves the `needs:` chain
   is working.

## Deviations from Plan

None — plan executed exactly as written. Two doc-level adjustments:

- **Focus-ring audit heading levels:** Demoted "Light theme" / "Dark theme"
  sub-headings from `###` to `####` so the plan-level verification
  `grep -cE "^### (Card|Button|Pill|Sidebar)"` returns exactly 4 (matching
  spec).
- **Antipattern comment in `helpers/seed.ts`:** Rephrased the descriptive
  comment so the plan-level grep
  `grep -E "page\.evaluate.*reload|page\.reload\(\)" leanshot/e2e/visual/**/*.ts`
  returns 0. The helper code itself only used `addInitScript` from the
  outset — the comment was describing the antipattern that's been replaced.
