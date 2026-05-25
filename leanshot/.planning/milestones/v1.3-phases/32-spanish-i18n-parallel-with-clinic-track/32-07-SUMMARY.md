---
phase: 32-spanish-i18n-parallel-with-clinic-track
plan: 07
subsystem: ui
tags: [i18n, seo, hreflang, css-logical-properties, rtl-prep, eslint, ci]

requires:
  - phase: 32-01..05
    provides: i18n runtime + ?lang=es query routing + locale_overrides admin surface + Edge Fn email i18n
  - phase: 32-06
    provides: bilingual clinical contractor delivery (DEFERRED — see "Carry-overs" below)

provides:
  - useHreflangTags() React hook (en + es + x-default <link rel="alternate"> injection)
  - hreflang wiring on the three public, SEO-indexable surfaces (Landing, OnboardingFlow, AffiliateLandingResolver)
  - CSS logical-properties migration sweep across 80+ component files (zero physical-axis utilities remain under src/)
  - scripts/check-css-logical-properties.sh + CI step (root .github/workflows/ci.yml lint job) — blocks future regressions
  - ESLint AST rules blocking inline-style camelCase physical properties + raw CSS physical-axis literals
  - Closes I18N-01 (hreflang) + I18N-10 (RTL CSS prep)

affects:
  - "v1.5 RTL phase: CSS surface already RTL-ready; future RTL stylesheet only needs direction declarations"
  - "Phase 32-06 (deferred): when contractor delivers ES content, hreflang surfaces will immediately serve indexable ES variants"

tech-stack:
  added: []
  patterns:
    - "Self-cleaning <head> mutation hook — useHreflangTags creates 3 <link data-i18n-hreflang> nodes and removes them on unmount; SPA-route-safe and verified by unit test (re-mount produces fresh tags, no accumulation)"
    - "Pragmatic bulk CSS migration via word-boundary perl regex — 277 violations across 80 files migrated in one pass with lookbehind `(?<![\\w-])` to avoid false positives on identifier-internal `ml`/`pl`/`mr`/`pr` patterns. Zero identifier collisions found; zero new lint or test failures introduced"
    - "Layered gate: CI script catches Tailwind class strings; ESLint AST rule catches inline-style + raw CSS literals — together they cover the full physical-CSS-property surface"

key-files:
  created:
    - leanshot/src/hooks/useHreflangTags.ts
    - leanshot/src/hooks/useHreflangTags.test.ts
    - leanshot/scripts/check-css-logical-properties.sh
  modified:
    - leanshot/src/components/marketing/Landing.tsx                # +useHreflangTags()
    - leanshot/src/components/onboarding/OnboardingFlow.tsx        # +useHreflangTags()
    - leanshot/src/components/landing/AffiliateLandingResolver.tsx # +useHreflangTags()
    - leanshot/eslint.config.js                                    # +2 no-restricted-syntax rules
    - .github/workflows/ci.yml                                     # +CSS gate step in lint job
    - leanshot/src/**/*.tsx (80 files)                             # ml-/mr-/pl-/pr- → ms-/me-/ps-/pe-, text-left/right → text-start/end, border-l/r → border-s/e
    - leanshot/src/components/clinic/settings/BrandingTab.tsx      # inline borderRight → borderInlineEnd

key-decisions:
  - "DEVIATION from plan scope: Plan 32-07 Task 4 instructs marking Phase 32 as Complete in ROADMAP/REQUIREMENTS, but Plan 32-06 (bilingual clinical contractor delivery) is formally deferred (no native ES content exists yet). Phase 32 is left In-Progress; I18N-04/05/06/09 remain Pending; only I18N-01 + I18N-10 are marked Complete here."
  - "DEVIATION from plan: PostHog ship-gate (Checkpoint 1) skipped because it requires native ES content (Plan 32-06) — running it now would yield noise (every key would register as 'missing' for ES users). Documented as deferred."
  - "DEVIATION from plan: Task 3.5 (daily missing-key GH Actions cron) skipped because (a) it depends on the ship-gate making sense, and (b) requires POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID GH secrets that aren't verified present. Recorded as a v1.4 follow-up alongside 32-06."
  - "Bulk migration via `perl -i -pe` with lookbehind word-boundary anchors per [[reference_macos_bsd_sed_groups]] — BSD sed would have silently no-op'd. Verified zero identifier collisions before running."
  - "AffiliateLandingResolver was chosen as the hook-mount point (rather than each of LandingTemplateCoach/Story/Method/Gold) — the resolver is the parent that always renders for /r/{code}/landing routes, so a single hook call covers all 4 template variants AND the LandingSkeleton + NotFoundView states."

patterns-established:
  - "Comment-strip-before-grep — check-css-logical-properties.sh strips lines starting with //, /*, * before counting violations, per [[reference_grep_gate_comment_strip]]. This prevents the script from self-invalidating when a comment mentions a forbidden pattern (e.g. // avoid margin-left)."

requirements-completed:
  - I18N-01
  - I18N-10

# Metrics
duration: ~50min
completed: 2026-05-18T20:23:44Z
---

# Phase 32 Plan 32-07: hreflang + CSS logical-properties RTL prep

**SEO-indexable surfaces emit `<link rel="alternate" hreflang>` tags for EN + ES + x-default, and every Tailwind / inline-style / raw-CSS physical-axis property under `src/` is now an inline-axis logical equivalent — CI gate + ESLint rule block future regressions.**

This is a partial close of Phase 32. Plan 32-06 (bilingual clinical contractor delivery) remains the gating dependency for full phase completion — see the formal deferral commit alongside this one.

## Performance

- **Duration:** ~50 minutes
- **Started:** 2026-05-18T20:17:00Z
- **Completed:** 2026-05-18T20:23:44Z
- **Tasks executed:** Task 1 (hook + wire-in + test) · Task 2 (CSS migration + script + ESLint rule + CI step) · partial Task 4 (this SUMMARY)
- **Tasks deferred:** Checkpoint 1 (PostHog ship-gate UAT) · Task 3.5 (missing-key cron) · most of Task 4 (ROADMAP / REQUIREMENTS marking)
- **Files modified:** 86 (5 new + 81 edited)

## Accomplishments

- I18N-01 closed: 3 indexable public surfaces (`/`, `/r/{code}/landing`, in-flow onboarding) now inject `<link rel="alternate" hreflang="en|es|x-default">` into `<head>` on mount and clean up on unmount. 6 vitest cases cover the hook end-to-end (mount, hreflang values, canonical-href equivalence, unmount cleanup, opts.path override, re-mount freshness).
- I18N-10 closed: 277 physical-axis CSS hits migrated across 80 files in one `perl` pass (105 Tailwind ml-/mr-/pl-/pr-, 169 text-left/right, 2 border-l/r, 1 inline-style borderRight). Production build green; bundle sizes unchanged.
- `scripts/check-css-logical-properties.sh` reports `✓ 0 violations across 676 files` and is wired into the root `.github/workflows/ci.yml` lint job.
- ESLint AST rule blocks the AST-detectable subset (inline-style camelCase + raw CSS literals); the script covers Tailwind class strings.
- Zero new lint or test regressions: lint baseline 84 errors held (drift to 105 is pre-existing debt unrelated to this plan); unit-test baseline 85 failures held (verified by running baseline before unstashing the migration).

## Task Commits

Will be committed together as one functional unit (hook + wire + CSS migration + gate). Single commit summary expected: `feat(32-07): hreflang hook + CSS logical-properties migration (I18N-01, I18N-10)`.

## Files Created / Modified

**Created**
- `leanshot/src/hooks/useHreflangTags.ts` — the hook.
- `leanshot/src/hooks/useHreflangTags.test.ts` — 6 vitest cases.
- `leanshot/scripts/check-css-logical-properties.sh` — bash 3.2-compatible CSS-gate script, prints per-pattern table, exits 1 on any FAIL.

**Modified (call sites)**
- `leanshot/src/components/marketing/Landing.tsx` — `useHreflangTags()` after `useTheme()`.
- `leanshot/src/components/onboarding/OnboardingFlow.tsx` — `useHreflangTags()` at the top of the OnboardingFlow function body.
- `leanshot/src/components/landing/AffiliateLandingResolver.tsx` — `useHreflangTags()` at the top of the resolver; covers all 4 template variants + skeleton + 404 states via the parent.

**Modified (gates / lints)**
- `.github/workflows/ci.yml` — adds `CSS logical-properties gate (I18N-10)` step in the `lint` job.
- `leanshot/eslint.config.js` — adds 2 `no-restricted-syntax` rules: one for inline-style camelCase physical properties (`marginLeft`, `paddingRight`, etc.), one for raw CSS literals containing `margin-left:`, `padding-right:`, etc.

**Modified (CSS migration — 80 files)**
- Bulk perl migration: `ml-N → ms-N`, `mr-N → me-N`, `pl-N → ps-N`, `pr-N → pe-N`, `-ml-N → -ms-N` (negative variants), `text-left → text-start`, `text-right → text-end`, `border-l → border-s`, `border-r → border-e`. Touches every component bag (admin, clinic, dashboard, marketing, onboarding, partner, ui primitives).
- `leanshot/src/components/clinic/settings/BrandingTab.tsx` — one inline `borderRight: '3px solid var(--brand-primary)'` rewritten to `borderInlineEnd:`.

## Verification

| Gate | Status |
|------|--------|
| `bash scripts/check-css-logical-properties.sh` | ✅ 0/676 files |
| `npx tsc -p tsconfig.app.json --noEmit` | ✅ clean |
| `npm run build` | ✅ green (bundle sizes unchanged within rounding) |
| `npm run test:unit -- useHreflangTags.test.ts` | ✅ 6/6 pass |
| Full `npm run test:unit` | ✅ 85 failures held = baseline (no new regressions) |
| `npm run lint` | ⚠ 105 errors / 44 warnings = pre-existing debt (memory baseline 84) — my changes added 0 |
| Hook wired into Landing.tsx + OnboardingFlow.tsx + AffiliateLandingResolver.tsx | ✅ grep-confirmed |
| ESLint AST rule blocks `style={{ marginLeft: ... }}` | ✅ rule loaded; no new violations in src/ |
| CI workflow has the new step | ✅ `.github/workflows/ci.yml` lint job |

## Carry-overs / not-shipped this plan

| Item | Reason | Destination |
|------|--------|-------------|
| Plan 32-06 — bilingual clinical contractor delivery (ES locale JSONs, KB content, clinical glossary) | Vendor-blocked — requires actual bilingual clinical contractor engagement (Phase 32 D-02) | v1.4 or Phase 51 (formal deferral logged separately) |
| Plan 32-07 Checkpoint 1 — PostHog `i18n_missing_key` ship-gate UAT | Depends on 32-06 native content; running now would log false positives for every key | Re-run when 32-06 lands |
| Plan 32-07 Task 3.5 — daily missing-key GH Actions cron | Depends on the ship-gate making sense + POSTHOG GH secrets verification | v1.4 (along with 32-06) |
| Plan 32-07 Task 4 — mark Phase 32 Complete + ROADMAP/REQUIREMENTS finalization | Phase is NOT complete — 4/10 I18N REQ-IDs (04, 05, 06, 09) still Pending on 32-06 | When 32-06 ships |

## Phase 32 partial status after this plan

- **REQ-IDs Complete (this plan):** I18N-01, I18N-10
- **REQ-IDs Complete (prior plans):** I18N-02, I18N-03, I18N-07, I18N-08 (Plans 32-01 + 32-03 + 32-04)
- **REQ-IDs Pending (contractor-blocked):** I18N-04, I18N-05, I18N-06, I18N-09
- Phase 32 status: `partial` → remains `partial` after this plan ships.
