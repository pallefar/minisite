# Session Handoff — 2026-05-31

Continuation of the 70-07 launch-readiness work. `origin/main` = **`bab769db`**.
(Local checkout may be behind — `git pull` first.)

## Landed on `origin/main` this session

| Work | Commit / PR |
|---|---|
| Unit-tests job green (3 unhandled-rejection roots) | cascades 53–55 |
| Format check green + E2E "exactly one index chunk" | format fix + cascade-56 `ec7ad4a5` |
| **Phase 71** — admin "Push Updates" UI + centralized changelog → store release notes | **PR #9** (squash `c3d6e267`) |
| PR #8 main-regression cleanup (auth.getUser mock, unused-exports baseline 552/571→558/577, css-logical, 2 roster-perf CI bugs) | folded into PR #9 |
| **Events-chunk E2E blocker** — shared `vendor-markdown` + `admin-product-updates` chunks | **PR #10** (squash `bab769db`) |

## Remaining RED on `main` — all pre-existing / operator-deferred (NOT from this session)

1. **E2E Playwright smoke — 69 failures.** Surfaced only after the bundle wall was
   cleared. Two causes: (a) **VR baselines never captured** — "Phase 69 VR baselines
   DEFERRED to operator"; specs `toHaveScreenshot('medication-light.png', …)` have no
   committed snapshot. (b) **preview-app timeouts** (`locator.click: Test timeout
   30000ms`). Fix needs operator VR-baseline capture against a working staging URL
   (`playwright test --config playwright.config.vr.ts --update-snapshots`) + a
   timeout diagnosis. This is the biggest remaining E2E item.
2. **DS-02 typography** — Phase-69 design-system debt (15 violations in pre-existing
   admin files; `scripts/ci/check-typography-ceiling.ts`, fail-on-any).
3. **RAG eval PR-gate** — intentionally RED until the RAG Edge Fns deploy.

## Phase 71 go-live (operator)

- `supabase db push` the new migration `20290110000001_p71_changelog_status_version.sql`
  (deliberately NOT pushed by the executor).
- Enable PostHog flag `admin.product-updates.enabled`.
- Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in the fastlane CI env so
  `scripts/sync-store-release-notes.mjs` can read published entries at release time.

## Next big rocks (recommend fresh session each)

- **App-store setup** — see `APP-STORE-SETUP-PLAN-2026-05-31.md` (this dir). User has
  Apple Developer + Play Console accounts as of 2026-05-30.
- **AdMob** — framework scaffolded (`src/lib/native/ads.ts`, `AdRenderer`,
  `PlatformAdSlot`); operator AdMob account not yet created; wiring (`initAdNetwork()`
  at boot + surface integration) deferred.
- **VR baselines + Playwright timeouts** — to genuinely green E2E.

## Durable memory written this session
`reference_vitest_unhandled_rejection_green_assertions_red_job`,
`reference_vite_index_chunk_collision_bundle_guards`,
`reference_leanshot_ci_gate_topology_gotchas`,
`feedback_shared_checkout_concurrent_branch_switch_hazard`,
`project_appstore_changelog_initiative`. NOTE: this checkout is SHARED with another
concurrent session — verify `git status -sb`/branch before every commit; land focused
fixes via isolated worktrees + `git push origin <sha>:main`.
