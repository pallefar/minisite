---
phase: 26
plan: 04
subsystem: affiliate-landing
tags: [AFFTIER-06, gold-tier, landing-template, playwright-screenshot, pitfall-6-fix]
requirements: [AFFTIER-06]
dependency_graph:
  requires:
    - 26-01 (affiliates.tier column + tier enum)
    - 19-08 (AffiliateLandingResolver + LandingTemplateCoach base)
    - 19-01 (affiliates_public_view + pol_affiliates_public_landing_read)
  provides:
    - LandingTemplateGold component (premium variant per D-12)
    - TEMPLATE_LOADERS.gold loader (resolver routing)
    - affiliates_public_view.tier column (downstream resolver/UI may consume)
    - Playwright toHaveScreenshot maxDiffPixels=100 ceiling (NET-NEW infra)
    - seedLandingFixture helper for downstream e2e specs that need approved affiliates
  affects:
    - AffiliatePublicRow interface gains optional `tier` field (forward-compat)
tech_stack:
  added:
    - none (uses existing React 19 + Tailwind v4 + Playwright + vitest infra)
  patterns:
    - service-role upsert seed fixture (idempotent by referral_code)
    - data-template="<tier>" attribute for e2e routing sanity-assertion
    - Pitfall-6 fix pattern: DEV throw, prod graceful fallback for missing loaders
key_files:
  created:
    - supabase/migrations/20270701000010_landing_template_gold_seed.sql
    - leanshot/src/components/landing/LandingTemplateGold.tsx
    - leanshot/src/components/landing/__tests__/LandingTemplateGold.test.tsx
    - leanshot/e2e/affiliate-landing-gold.spec.ts
    - leanshot/e2e/fixtures/affiliate-landing-seed.ts
  modified:
    - leanshot/playwright.config.ts (add maxDiffPixels=100 ceiling)
    - leanshot/src/components/landing/AffiliateLandingResolver.tsx (gold loader + tier override + Pitfall 6 fix)
    - leanshot/src/components/landing/LandingTemplateCoach.tsx (AffiliatePublicRow.tier optional field)
decisions:
  - "D-12 honored: SINGLE shared 'premium' variant across ALL Gold partners — per-partner branding deferred to v1.5"
  - "Pitfall 6 fix: silent `?? coach` fallback replaced with DEV throw + prod graceful Coach fallback so missing loaders surface in CI rather than serving Coach to Gold partners"
  - "Tier override: `tier === 'gold' ? 'gold' : template_choice` — Gold partners with legacy template_choice=coach still route to LandingTemplateGold (proven by the gold-test-aff fixture seeding template_choice=coach intentionally)"
  - "View extension via CREATE OR REPLACE — preserves security_invoker=true and column ordering; appends `tier` so positional consumers (none in tree) would still see the first 8 columns unchanged"
  - "playwright.config.ts uses BOTH maxDiffPixelRatio=0.01 (existing) AND maxDiffPixels=100 (new) — defense in depth so a tight crop cannot drift 50px without tripping the regression gate"
  - "AffiliatePublicRow.tier marked OPTIONAL + NULLABLE for forward-compat — Phase 19 vitest fixtures that pre-date Plan 26-01 still type-check without modification"
  - "Symlinked node_modules from main repo into worktree to run vitest GREEN — not committed (gitignored); avoids npm-install-leak documented in feedback_worktree_executor_npm_install_leak"
metrics:
  duration_seconds: 259
  duration_human: "4m 19s"
  tasks_completed: 3
  files_created: 5
  files_modified: 3
  commits: 4
  vitest_passing: 19
  tsc_clean: true
  completed_at: "2026-05-18T13:11:46Z"
---

# Phase 26 Plan 04: AFFTIER-06 Gold Landing Template + Resolver Tier Override Summary

**One-liner:** Gold-tier affiliates' `/r/{code}/landing` now routes to a shared premium template variant via a tier-override in `AffiliateLandingResolver`, with `affiliates_public_view` extended to expose `tier`, the silent-fallback Pitfall 6 fixed (DEV throw + prod graceful), and a 2-test Playwright screenshot regression gate (NET-NEW `maxDiffPixels=100` ceiling on top of existing `maxDiffPixelRatio=0.01`).

## What shipped

### Component layer
- **`LandingTemplateGold.tsx`** (NEW) — Premium variant of the affiliate landing. Mirrors `LandingTemplateCoach`'s `AffiliatePublicRow` prop shape so the resolver can hot-swap by tier. Renders the literal string **"Premium partner — {referral_code}"** in a badge — this is the AFFTIER-06 e2e sanity-assertion target. Carries `data-template="gold"` for e2e routing checks. Uses only `var(--color-*)` tokens (no hardcoded hex).
- **`AffiliateLandingResolver.tsx`** (MODIFIED) — Four edits:
  1. `TEMPLATE_LOADERS.gold = () => import('./LandingTemplateGold')`
  2. SELECT clause adds `,tier`
  3. `choice = tier === 'gold' ? 'gold' : template_choice` (tier override beats template_choice for Gold partners)
  4. Silent `?? coach` fallback replaced with: `import.meta.env.DEV ? throw : lazy(Coach)` (Pitfall 6 fix)
- **`LandingTemplateCoach.tsx`** (MODIFIED) — `AffiliatePublicRow` gains optional `tier?: 'standard' | 'gold' | 'lifetime' | null` field for forward-compat with the resolver SELECT.

### Database layer
- **`20270701000010_landing_template_gold_seed.sql`** (NEW migration) — Two concerns:
  - **Recreates `public.affiliates_public_view`** appending the `tier` column (preserves `security_invoker=true`; first 8 columns unchanged for positional safety).
  - **Seeds `_template_gold` landing_pages row** + paired published revision (mirrors the existing Coach/Story/Method pattern verbatim with premium-tier copy + single shared variant per D-12).
- Migration deferred to orchestrator for `supabase db push` per execution context.

### Test layer
- **`LandingTemplateGold.test.tsx`** (NEW) — 4 vitest assertions: premium badge, signup CTA href, hero heading present, footer attribution. Initial RED run failed at module-resolve; GREEN run passes 4/4 after `getAllByText` refinement (display_name + "Premium partner" each appear multiple times by design).
- **`affiliate-landing-gold.spec.ts`** (NEW) — 2-test Playwright spec:
  - Standard fixture → `[data-template="coach"]` baseline
  - Gold fixture (with legacy `template_choice='coach'`) → `[data-template="gold"]` baseline. **This is the regression target for Pitfall 6** — the gold fixture intentionally keeps `template_choice='coach'` so the test fails if the tier override is ever removed.
  - Both tests sanity-assert the `data-template` attribute BEFORE the screenshot diff so routing regressions fail fast.
- **`affiliate-landing-seed.ts`** (NEW fixture helper) — Service-role upsert of `std-test-aff` (tier=standard) and `gold-test-aff` (tier=gold). Idempotent on `referral_code`.

### Infrastructure
- **`playwright.config.ts`** (MODIFIED) — Added `maxDiffPixels: 100` to the existing `toHaveScreenshot` block. Both bounds (`maxDiffPixelRatio: 0.01` AND `maxDiffPixels: 100`) now apply jointly so a tight crop (badge / hero CTA) cannot drift ~50 px without tripping the regression gate.

## Per-task commits

| Task | Commit  | Description                                                              |
| ---- | ------- | ------------------------------------------------------------------------ |
| 1    | b48edc1 | feat(26-04-01) playwright snapshot ceiling + affiliate-landing seed fixture |
| 2-R  | 4ca5960 | test(26-04-02) RED — LandingTemplateGold vitest assertions               |
| 2-G  | 9136b05 | feat(26-04-02) GREEN — gold template + resolver tier-override + view extension |
| 3    | 945f118 | test(26-04-03) AFFTIER-06 playwright screenshot baselines                |

## Success criteria — ALL PASS

1. `grep -c 'gold:' AffiliateLandingResolver.tsx` → **1** ✓
2. `grep -q 'no loader for template_choice' AffiliateLandingResolver.tsx` → ✓
3. `grep -q 'toHaveScreenshot' playwright.config.ts` → ✓
4. `test -f LandingTemplateGold.tsx` → ✓
5. `npx tsc --noEmit -p tsconfig.app.json` → exit 0 (clean) ✓

## Verification beyond plan

- `npx vitest run src/components/landing/` → **19/19 passing** (4 new + 15 pre-existing — no regressions).
- Threat T-26-18 (Gold partner sees Coach template via silent fallback) mitigated: Pitfall 6 throw in DEV + sanity assertion `[data-template="gold"]` in e2e.

## Deviations from Plan

### [Rule 3 — blocking issue] View extension scope

- **Found during:** Task 2 (RED-to-GREEN transition).
- **Issue:** The plan's must_have says "Resolver SELECT includes affiliates.tier so 'gold' tier routes to gold template", but the resolver queries `affiliates_public_view` (not `affiliates` table directly per Plan 19-08 anon-readable contract), and the view as shipped in `20270101000004_tier_effective_view.sql` exposes only 8 columns — `tier` is NOT among them. Adding `.select(',tier')` against the view returns nothing for that column; the override would be dead code.
- **Fix:** Extended the seed migration (`20270701000010_landing_template_gold_seed.sql`) to ALSO `CREATE OR REPLACE` the view appending `tier`. Preserved `security_invoker=true` and column ordering so existing consumers (none in tree depend on ordinal position, but cheap insurance) are unaffected.
- **Files modified:** `supabase/migrations/20270701000010_landing_template_gold_seed.sql`
- **Commit:** 9136b05

### [Rule 3 — blocking issue] AffiliatePublicRow.tier field

- **Found during:** Task 2.
- **Issue:** `AffiliatePublicRow` (defined in `LandingTemplateCoach.tsx`) did not include `tier`. Adding it via `as AffiliatePublicRow` cast in the resolver would lose type safety; downstream consumers would not see the field.
- **Fix:** Added `tier?: 'standard' | 'gold' | 'lifetime' | null` as an OPTIONAL + NULLABLE field so Phase 19 fixtures (Coach/Story/Method vitest files) that don't pass `tier` still type-check without modification.
- **Files modified:** `leanshot/src/components/landing/LandingTemplateCoach.tsx`
- **Commit:** 9136b05

### [Rule 3 — blocking issue] Vitest cannot run in fresh worktree

- **Found during:** Task 2 RED (running `npx vitest run`).
- **Issue:** Fresh worktrees do NOT carry `node_modules/` (gitignored). `npx vitest` failed with module-not-found.
- **Fix:** Symlinked `leanshot/node_modules` from the main repo into the worktree (`ln -sf /Users/karstenhaldan/minisite/leanshot/node_modules node_modules`). This is NOT committed (gitignored) and does not leak from worktree to main (per [[feedback_worktree_executor_npm_install_leak]] — the leak risk is from `npm install` writing to main; a symlink is safe).
- **Commit:** none (filesystem-only, gitignored)

### [Rule 2 — auto-add critical functionality] `data-template` attribute on Coach

- **Found during:** Task 3 e2e spec authoring.
- **Issue:** The plan's e2e spec uses `page.locator('text=/Premium partner/')` as sanity assertion. For the Standard baseline, the equivalent sanity check needed a stable hook on the Coach template. `LandingTemplateCoach` already had `data-template="coach"` (Phase 19 19-08 pre-existed). The Gold template needed the same hook.
- **Fix:** Added `data-template="gold"` to `LandingTemplateGold.tsx` root `<main>` mirroring the Coach convention. Used in both spec sanity assertions for symmetry.
- **Files modified:** `leanshot/src/components/landing/LandingTemplateGold.tsx`
- **Commit:** 9136b05 (rolled into GREEN)

### [TDD-shape] RED test refinement after GREEN landed

- **Found during:** Task 2 GREEN re-run.
- **Issue:** RED tests used `getByText` for "Premium partner" and "Alex Premium" but the GREEN implementation renders each string in 2+ places (badge + heading subhead; subhead + footer). Strict `getByText` threw on multiple matches.
- **Fix:** Refined to `getAllByText(...).length >= 1` and added a `data-testid="aff-code"` hook on the referral_code span so the badge test can scope. This is a TDD-shape refinement, not a behavioral relaxation — the e2e sanity assertion in the Playwright spec still binds on visible text.
- **Files modified:** `leanshot/src/components/landing/__tests__/LandingTemplateGold.test.tsx`
- **Commit:** 9136b05

## Known Stubs

None. All wired data flows are real: the resolver SELECT fetches `tier` live from the view, the template renders real props from the affiliate row, and the e2e spec seeds real fixture rows via service-role.

## Threat Flags

None. The only surface introduced is the additional `tier` column on `affiliates_public_view` — already covered by the original threat model (T-26-15: SELECT enumerates only public columns; `tier` is a non-PII enum value), and `pol_affiliates_public_landing_read` still gates `status='approved'`. No new endpoints, auth paths, or trust boundaries.

## Self-Check

See SELF-CHECK section at end of file.

## Pending follow-ups (NOT blockers)

- **`supabase db push`** — Deferred to orchestrator per execution context. Migration `20270701000010_landing_template_gold_seed.sql` MUST land in the live project before the Playwright spec can pass (the spec fails at `seedLandingFixture` if `affiliates.tier` column is missing, and fails at the screenshot diff if the view does not yet expose `tier`).
- **Baseline PNGs** — Pending first post-push run. Plan note: "If Plan 26-07 Task 4 push has not occurred when this test runs, it WILL fail at seed (column 'tier' missing). That is expected — Wave-0 stub behavior." Generate via `PLAYWRIGHT_RUN_P26=1 npx playwright test e2e/affiliate-landing-gold.spec.ts --update-snapshots` then commit PNGs under the snapshotPathTemplate path.
- **`tier` field as required (non-optional)** — Currently `tier?: ... | null` for forward-compat with Phase 19 fixtures. Once Plan 26-01 ships everywhere and the view always exposes `tier`, this can be tightened to required `tier: 'standard' | 'gold' | 'lifetime'` in a future plan.

## Self-Check: PASSED

- `[ -f supabase/migrations/20270701000010_landing_template_gold_seed.sql ]` → FOUND
- `[ -f leanshot/src/components/landing/LandingTemplateGold.tsx ]` → FOUND
- `[ -f leanshot/src/components/landing/__tests__/LandingTemplateGold.test.tsx ]` → FOUND
- `[ -f leanshot/e2e/affiliate-landing-gold.spec.ts ]` → FOUND
- `[ -f leanshot/e2e/fixtures/affiliate-landing-seed.ts ]` → FOUND
- `git log --oneline | grep b48edc1` → FOUND
- `git log --oneline | grep 4ca5960` → FOUND
- `git log --oneline | grep 9136b05` → FOUND
- `git log --oneline | grep 945f118` → FOUND
