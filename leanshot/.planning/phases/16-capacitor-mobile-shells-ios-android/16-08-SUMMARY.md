---
phase: 16-capacitor-mobile-shells-ios-android
plan: 08
subsystem: aso-marketing-assets
tags: [aso, playwright, screenshots, store-listing, en-only, checkpoint-returned]
status: partial-autonomous-complete-awaiting-human-action
requires:
  - 16-01 (Capacitor scaffold; iOS + Android shells)
  - playwright.config.ts (P15 base)
provides:
  - opt-in playwright `aso` project (PLAYWRIGHT_RUN_ASO=1 or --project=aso)
  - EN App Store + Play Store listing copy (character-budget compliant, anti-steering clean)
  - R4 scope split ledger (DE/ES/FR deferred to v1.2.1)
  - landing-pad directories for screenshot output
affects:
  - default playwright suite (chromium gets testIgnore for e2e/aso/**)
tech-stack:
  added: []
  patterns:
    - playwright dynamic-project gating via process.env + process.argv inspection
key-files:
  created:
    - leanshot/e2e/aso/aso-capture.spec.ts
    - leanshot/apps/ios/store-listing-en.md
    - leanshot/apps/android/store-listing-en.md
    - leanshot/apps/ios/marketing/screenshots/en-US/.gitkeep
    - leanshot/apps/android/marketing/screenshots/en-US/.gitkeep
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-08-DEFERRED-LOCALES.md
  modified:
    - leanshot/playwright.config.ts (added aso project + chromium testIgnore + env gate)
decisions:
  - "Playwright `aso` project is dynamically appended only when PLAYWRIGHT_RUN_ASO=1 or --project=aso/aso is in argv. Pattern: spread into projects[] via conditional ternary at config load. Keeps default CI suite at 108 tests (was 114 with eager-included aso)."
  - "ASO capture spec uses in-app click navigation (not `?tab=` deep-link) because src/App.tsx only parses `#/settings?upgrade=` from hash. Falls back to direct Zustand setTab via window.useStore if nav button absent."
  - "iOS Description hits 1334/4000 chars -- left intentional headroom for Pitfall-4 anti-steering audit at submission time + future product-feature additions before re-paste."
  - "MOBILE-04 satisfied by EN slice only at P16; DE/ES/FR explicit-split in 16-08-DEFERRED-LOCALES.md per R4. App Store + Play Store accept EN-only first submission."
checkpoint:
  type: human-action
  resume-signal: "aso-assets-done" | "aso-screenshots-only" | "skip-aso"
  blocks: ["screenshot capture (requires running dev server + demo-account seed)", "preview.mov hand-recording (~3-4h QuickTime + iMovie per D-21)", "App Store category answer (Health & Fitness vs Medical -- compliance implication)", "Final marketing-copy human sign-off"]
metrics:
  duration_min: ~25
  completed_date: 2026-05-16
  tasks_complete_autonomous: 3
  tasks_complete_human: 0
  tasks_deferred_to_checkpoint: 1
---

# Phase 16 Plan 16-08: ASO Playwright Capture + EN-only Store Listings Summary

EN-only slice of MOBILE-04: opt-in Playwright multi-viewport capture spec, EN App Store + Play Store listing copy (character-budget compliant), and a documented R4 scope split deferring DE/ES/FR translations + per-locale screenshot re-captures to v1.2.1. Screenshot generation + 30s preview.mov hand-record gated to human checkpoint (Task 4).

## What Shipped Autonomously

| Task | Commit | Files | Verification |
| ---- | ------ | ----- | ------------ |
| 1: ASO capture spec + Playwright project | `279e5cb` | `e2e/aso/aso-capture.spec.ts`, `playwright.config.ts`, 2 `.gitkeep` files | `npx playwright test --project=aso --list` → 6 tests (iphone-15-pro-max, iphone-14, ipad-pro-12.9, pixel-phone, pixel-tablet, wear-os); default list excludes aso (108 tests, was 114); `tsc -b --noEmit` exit 0 |
| 2: EN store-listing copy (iOS + Android) | `e596d64` | `apps/ios/store-listing-en.md`, `apps/android/store-listing-en.md` | All character budgets pass (see table below); anti-steering grep clean; disclaimer + core-value pair present in both descriptions |
| 3: R4 deferred-locales ledger | `a7446d3` | `.planning/phases/16-.../16-08-DEFERRED-LOCALES.md` | 5 H2 sections; tokens MOBILE-04, R4, v1.2.1 each present |

## Character Budget Compliance (Task 2 truths)

### iOS (`apps/ios/store-listing-en.md`)

| Section | Length | Budget | Status |
| ------- | ------:| ------:| ------ |
| Title | 23 | 30 | PASS (23% headroom) |
| Subtitle | 27 | 30 | PASS (10% headroom) |
| Promotional Text | 141 | 170 | PASS (17% headroom) |
| Description | 1,334 | 4,000 | PASS (67% headroom) |
| Keywords | 71 | 100 | PASS (29% headroom) |
| Support URL | n/a | n/a | https://leanshot.app/support |
| Marketing URL | n/a | n/a | https://leanshot.app |

### Android (`apps/android/store-listing-en.md`)

| Section | Length | Budget | Status |
| ------- | ------:| ------:| ------ |
| Title | 23 | 30 | PASS |
| Short description | 75 | 80 | PASS (tight; reflects Play Console's 80-char hard cap) |
| Full description | 1,642 | 4,000 | PASS |

### Anti-steering Audit (Pitfall 4)

`grep -iE "(save by subscrib|discount on web|cheaper on the web|leanshot\.app/account)" apps/ios/store-listing-en.md` → 0 matches.

Description mentions "A web version is available at leanshot.app" as a neutral capability statement, NOT framed as a purchase channel.

### Compliance Disclaimer

Both descriptions contain: "LeanShot is not a medical device and does not provide medical advice."

## Checkpoint Items (require human-action — Task 4)

The plan is `autonomous: false` and Task 4 is `type="checkpoint:human-action"`. The following items require human input and/or interactive shell work that an autonomous executor cannot complete:

### A. Screenshot generation (~10 min, gated on dev server + seeded demo account)

1. Start dev server: `cd leanshot && npm run dev` (port 5173).
2. Log in with a fresh, non-PII demo account; seed enough state that Home, Photo gallery, and Medication chart screens are visually populated (per T-16-08-01).
3. Run capture spec: `cd leanshot && npx playwright test --project=aso`. Note: the spec runs 6 viewport tests x 3 screens = 18 navigations; allow ~2-3 min.
4. Verify counts:
   - `find apps/ios/marketing/screenshots/en-US -name '*.png' | wc -l` → expect 9
   - `find apps/android/marketing/screenshots/en-US -name '*.png' | wc -l` → expect 9
5. Spot-check 2 PNGs visually for PII + render correctness (`apps/ios/marketing/screenshots/en-US/iphone-15-pro-max-home.png` + `apps/android/marketing/screenshots/en-US/pixel-phone-photo-gallery.png`).

### B. 30-second App Store Preview video (~3-4 hours, per D-21)

QuickTime hand-record + iMovie cut + caption overlays. See plan Task 4(B) for step-by-step (iPhone 6.7" connected, demo account, 30s smooth take, EN caption overlays, H.264 .mov export to `apps/ios/marketing/preview.mov`). If > 100 MB, `git lfs track "*.mov"` before commit.

### C. App Store category selection (decision required)

LeanShot is a GLP-1 tracker. The two plausible App Store / Play Store categories are:

| Option | Pro | Con |
| ------ | --- | --- |
| **Health & Fitness** (recommended) | Standard review track; no extra medical compliance gates; matches positioning ("not a medical device") | Lower discoverability vs Medical in some search contexts |
| Medical | Higher trust signal; potentially higher CTR on medical-search keywords | Stricter regulator review; risk of being asked for HIPAA / FDA disclosures inconsistent with PROJECT.md compliance posture; may be rejected if reviewers flag dosage projections |

**Recommendation:** Health & Fitness (matches PROJECT.md "Not yet a HIPAA covered entity" stance + the in-copy disclaimer). Confirm before submitting in Plan 16-09.

### D. Final marketing-copy sign-off

The drafted copy is autonomous-default-ready, but final submission should have human review for:
- Brand voice nits (e.g., does "GLP-1 patients by people who use them" sit right with the target audience?)
- Keyword tuning (current keyword bag: `GLP-1,semaglutide,tirzepatide,weight loss,injection log,peptide tracker` -- 71/100 chars; room for `Ozempic,Mounjaro,Wegovy,Zepbound` if Apple's keyword-trademark policy permits)

### E. Play Console Data Safety form

If not already covered by Plan 16-07's `apps/android/data-safety.md` (which exists at this commit -- see `git ls-tree HEAD apps/android/data-safety.md`), reuse it. No new work required here unless the EN listing reveals a gap.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] `?tab=` deep-link convention not actually supported**

- **Found during:** Task 1 read-first inspection.
- **Issue:** Plan's interfaces block listed `?tab=body` and `?tab=medication` as the SCREENS path values, citing existing `selectViewLogged` / tab-handler support. `grep -nE "\?tab=|searchParams" src/App.tsx` only revealed `#/settings?upgrade=plus_monthly` parsing -- no `?tab=` reader.
- **Fix:** Implemented the plan's documented fallback (in-app click via `page.getByRole('button', { name: <tab> })`, with a `window.useStore.getState().setTab()` fallback when the button is not in the DOM).
- **Files modified:** `leanshot/e2e/aso/aso-capture.spec.ts` (gotoTab helper).
- **Commit:** `279e5cb`.

**2. [Rule 2 - Missing critical functionality] Default Playwright suite was eager-loading `aso` project**

- **Found during:** Task 1 verification.
- **Issue:** With just `testMatch: /e2e\/aso\/.*\.spec\.ts$/` on the aso project, `npx playwright test --list` (no `--project` flag) included all 6 aso tests in the default-run total (114 vs 108). The plan's verification step #8 explicitly requires `grep -c 'aso-capture' returns 0` in default list -- mirroring the established opt-in posture.
- **Fix:** Added a config-load-time gate (`ASO_OPT_IN`) that inspects `process.env.PLAYWRIGHT_RUN_ASO` and `process.argv` for `--project=aso`/`aso`, then conditionally spreads the aso project into `projects[]`. Belt-and-suspenders: `chromium` project also gets `testIgnore: /e2e\/aso\/.*\.spec\.ts$/` so even if the gate ever inverts, chromium does not sweep the spec.
- **Files modified:** `leanshot/playwright.config.ts`.
- **Commit:** `279e5cb`.

**3. [Rule 3 - Blocking issue] worktree had no `node_modules`**

- **Found during:** Task 1 verification (`npx playwright test --list` exited with `ERR_MODULE_NOT_FOUND: @playwright/test`).
- **Issue:** `git worktree add` does not copy `node_modules` (gitignored), and the parallel-execution notes explicitly forbid `npm install` (scope creep).
- **Fix:** Symlinked main repo's `node_modules` into the worktree (`ln -s /Users/karstenhaldan/minisite/leanshot/node_modules node_modules`). Removed the symlink before writing the SUMMARY to avoid leaking it into the merge. `node_modules/` is gitignored so it was never staged.
- **Files modified:** none committed.

## Known Stubs

None.

## Threat Flags

None new. The plan's threat model (T-16-08-01 through T-16-08-05) is intact; the human-action checkpoint (Task 4) carries forward the PII-safety mitigations (T-16-08-01 + T-16-08-02 demo-account seeding requirement).

## Demo-Account Identifier (audit trail placeholder)

| Capture surface | Demo account |
| --------------- | ------------ |
| Screenshots (Task 4A) | _(to be filled by human at resume; record the account email + creation timestamp in this row when Task 4A executes)_ |
| Preview video (Task 4B) | _(same as above; preferably the same demo account for visual continuity)_ |

## Carryover to v1.2.1

Per `16-08-DEFERRED-LOCALES.md`:
- DE / ES / FR translations of both store listings (DeepL Pro + human medical-tone review).
- DE / ES / FR re-captures (gated on app-side i18n -- separate v1.2.1 phase).
- Per-locale audio for preview.mov (D-21 follow-up).
- Generalize aso-capture spec to VIEWPORTS x LOCALES OR add `aso-capture-{de,es,fr}.spec.ts`.

## Hand-off

- **Plan 16-09 (submission lanes)** consumes:
  - `apps/ios/store-listing-en.md` (paste into App Store Connect)
  - `apps/android/store-listing-en.md` (paste into Play Console)
  - `apps/ios/marketing/screenshots/en-US/*.png` (after Task 4A)
  - `apps/android/marketing/screenshots/en-US/*.png` (after Task 4A)
  - `apps/ios/marketing/preview.mov` (after Task 4B)
- **Plan 16-10 (launch gate)** verifies all of the above exist + meet store requirements.
- **v1.2.1 follow-up** picks up `.planning/phases/16-capacitor-mobile-shells-ios-android/16-08-DEFERRED-LOCALES.md`.

## Self-Check: PASSED

- `git log --oneline -3 worktree-agent-a05f15560cfce5f99` → 3 commits found (`a7446d3`, `e596d64`, `279e5cb`).
- All 7 listed files exist:
  - `leanshot/e2e/aso/aso-capture.spec.ts` FOUND
  - `leanshot/playwright.config.ts` FOUND (modified)
  - `leanshot/apps/ios/store-listing-en.md` FOUND
  - `leanshot/apps/android/store-listing-en.md` FOUND
  - `leanshot/apps/ios/marketing/screenshots/en-US/.gitkeep` FOUND
  - `leanshot/apps/android/marketing/screenshots/en-US/.gitkeep` FOUND
  - `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-08-DEFERRED-LOCALES.md` FOUND
- Anti-steering grep on iOS listing → 0 matches (CLEAN).
- Character budgets validated for both listings (see tables above).
- `npx playwright test --project=aso --list` → 6 tests (PASS).
- `npx playwright test --list | grep -c aso-capture` → 0 (PASS, opt-in posture honored).
- `npx tsc -b --noEmit` → exit 0 (PASS).
