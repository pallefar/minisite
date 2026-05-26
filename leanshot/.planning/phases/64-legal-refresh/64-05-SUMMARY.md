---
phase: 64-legal-refresh
plan: "05"
subsystem: ui
tags: [react, legal, ccpa, dmca, wcag, tailwind-v4, vitest, react-helmet-async]

# Dependency graph
requires:
  - phase: 07-policy-pages
    provides: LegalLayout wrapper + LegalFooter + existing legal pages structure

provides:
  - DoNotSellPage — CCPA/CPRA opt-out form with pre-submit Modal, POSTs to privacy-optout-process Fn
  - AccessibilityPage — WCAG 2.2 AA + ADA Title III statement + 30-day SLA + accessibility@leanshot.app
  - DMCAPage — § 512 takedown + counter-notice + safe-harbor + abuse@leanshot.app + agent-pending disclaimer
  - LegalLayout H1 upgrade — renders title prop as font-display 28px H1 (was void title placeholder)

affects:
  - 64-07 (App.tsx route wiring for new pages)
  - 64-04 (PrivacyPolicy + TermsOfService must remove duplicate H1s — see Known Stubs section)
  - 64-08 (close-out single-H1 invariant verification)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "LegalLayout-H1 pattern: LegalLayout now renders the title prop as the page H1; callers must NOT include their own <h1>"
    - "Legal page structure: LegalLayout wrapper + Helmet meta + draft disclaimer + article sections"
    - "Pre-submit confirmation Modal pattern for destructive legal actions (opt-out form)"

key-files:
  created:
    - leanshot/src/components/legal/DoNotSellPage.tsx
    - leanshot/src/components/legal/AccessibilityPage.tsx
    - leanshot/src/components/legal/DMCAPage.tsx
    - leanshot/src/components/legal/__tests__/DoNotSellPage.test.tsx
    - leanshot/src/components/legal/__tests__/AccessibilityPage.test.tsx
    - leanshot/src/components/legal/__tests__/DMCAPage.test.tsx
  modified:
    - leanshot/src/components/legal/LegalLayout.tsx
    - leanshot/src/components/legal/MedicalDisclaimer.tsx
    - leanshot/src/components/legal/ConsumerHealthData.tsx

key-decisions:
  - "LegalLayout H1: Upgraded LegalLayout to render <h1 className='text-heading font-display font-semibold mb-8'>{title}</h1>; all callers now get a consistent page H1"
  - "Duplicate H1 removal scope: MedicalDisclaimer.tsx + ConsumerHealthData.tsx patched inline (not 64-04 scope); PrivacyPolicy + TermsOfService deferred to Plan 64-04"
  - "DoNotSell Modal pattern: pre-submit confirmation Modal with verbatim UI-SPEC §Copywriting copy gates the network call"
  - "Fn endpoint lazy-fetch: VITE_SUPABASE_URL/functions/v1/privacy-optout-process fallback to /functions/v1/ path"
  - "Test matchers: getAllByText used where multiple elements share text; function matchers used for text split across elements"

patterns-established:
  - "Legal page TDD: RED tests fail with module-not-found; GREEN tests pass with actual components + updated matchers"
  - "node_modules symlink: worktree node_modules symlinked to main repo for vitest resolution"

requirements-completed:
  - LEGAL-02
  - LEGAL-05
  - LEGAL-06

# Metrics
duration: 45min
completed: 2026-05-26
---

# Phase 64 Plan 05: New Legal Pages Summary

**CCPA/CPRA opt-out form (DoNotSellPage) + WCAG/ADA accessibility statement + DMCA takedown page, all using LegalLayout with upgraded font-display H1 render**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-05-26T22:40:00Z
- **Completed:** 2026-05-26T23:25:00Z
- **Tasks:** 2 (Task 1: LegalLayout upgrade; Task 2: TDD — 3 pages + 3 test files)
- **Files created:** 6 (3 pages + 3 test files)
- **Files modified:** 3 (LegalLayout + MedicalDisclaimer + ConsumerHealthData)

## Accomplishments

- LegalLayout now renders the `title` prop as `<h1 className="text-heading font-display font-semibold mb-8">` — ending the `void title` placeholder from Phase 7
- DoNotSellPage (LEGAL-02): form with name/email/state-residency Select/3 checkboxes + pre-submit Modal with verbatim UI-SPEC §Copywriting + fetch POST to `privacy-optout-process` Fn + success/error states
- AccessibilityPage (LEGAL-05): 6 sections covering WCAG 2.2 AA, ADA Title III, conformance status, 30-day SLA, `accessibility@leanshot.app` contact with "Report an accessibility issue" CTA
- DMCAPage (LEGAL-06): 6 sections covering designated agent (pending), takedown § 512(c)(3), counter-notice § 512(g), safe-harbor, cross-ref to ToS, `Submit DMCA notice` mailto CTA
- 13 vitest unit tests — all passing (6 DoNotSell, 3 Accessibility, 4 DMCA)
- Zero Phase 60 BLOCKER tokens used in production JSX

## Task Commits

TDD task 2 follows RED → GREEN commit pattern:

1. **Task 1: LegalLayout H1 upgrade + duplicate H1 removal** - `8cae8db6` (feat)
2. **Task 2 RED: Failing tests for 3 new pages** - `64c045b1` (test)
3. **Task 2 GREEN: Implement DoNotSellPage + AccessibilityPage + DMCAPage** - `60965d8c` (feat)

**Plan metadata:** _(created with final commit)_

## Files Created/Modified

- `leanshot/src/components/legal/LegalLayout.tsx` — upgraded to render `{title}` as font-display H1; updated file-header comment
- `leanshot/src/components/legal/MedicalDisclaimer.tsx` — removed duplicate internal H1 (now provided by LegalLayout)
- `leanshot/src/components/legal/ConsumerHealthData.tsx` — removed duplicate internal H1 (now provided by LegalLayout)
- `leanshot/src/components/legal/DoNotSellPage.tsx` — CCPA/CPRA opt-out form (LEGAL-02)
- `leanshot/src/components/legal/AccessibilityPage.tsx` — WCAG 2.2 AA + ADA Title III statement (LEGAL-05)
- `leanshot/src/components/legal/DMCAPage.tsx` — DMCA agent + takedown + counter-notice + safe-harbor (LEGAL-06)
- `leanshot/src/components/legal/__tests__/DoNotSellPage.test.tsx` — 6 behavior tests
- `leanshot/src/components/legal/__tests__/AccessibilityPage.test.tsx` — 3 behavior tests
- `leanshot/src/components/legal/__tests__/DMCAPage.test.tsx` — 4 behavior tests

## Decisions Made

- LegalLayout H1 upgrade is **not** backward-incompatible: existing callers that had their own `<h1>` now produce double H1. MedicalDisclaimer.tsx + ConsumerHealthData.tsx patched in this plan (not owned by 64-04). PrivacyPolicy.tsx + TermsOfService.tsx are 64-04's files — deferred.
- Modal uses `dismissible` default (true) so user can close via ESC/backdrop; this is correct UX for an opt-out form (not a blocking medical disclaimer modal).
- Cancel CTA copy "Keep my information as-is" chosen over "Keep my data rights pending" (which is the DSAR portal cancel copy per UI-SPEC §3) as it's more natural for the opt-out form context.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed duplicate H1 from MedicalDisclaimer.tsx and ConsumerHealthData.tsx**
- **Found during:** Task 1 (LegalLayout H1 upgrade)
- **Issue:** MedicalDisclaimer.tsx and ConsumerHealthData.tsx both had their own internal `<h1>` elements, which would create double-H1 pages after LegalLayout started rendering the title
- **Fix:** Removed the internal `<h1>` from both files; substituted with just the metadata line (effective date). PrivacyPolicy.tsx + TermsOfService.tsx are Plan 64-04's files and were NOT modified.
- **Files modified:** MedicalDisclaimer.tsx, ConsumerHealthData.tsx
- **Committed in:** `8cae8db6` (Task 1 commit)

**2. [Rule 1 - Bug] Fixed file-header comment referencing BLOCKER token names**
- **Found during:** Task 2 verification (BLOCKER token grep gate)
- **Issue:** DoNotSellPage.tsx file-header comment mentioned `text-text-primary`, `bg-surface-card` etc. by name, causing the `grep -E "text-text-primary|..."` gate to fire on comments
- **Fix:** Replaced the multi-line comment with a single-line reference to "Phase 60 BLOCKER rule" without listing the token names
- **Files modified:** DoNotSellPage.tsx (comment only)
- **Committed in:** `60965d8c` (Task 2 GREEN commit)

**3. [Rule 1 - Bug] Updated test matchers to handle multi-element text rendering**
- **Found during:** Task 2 GREEN phase (first test run)
- **Issue:** `screen.getByText()` failed with "Found multiple elements" for text appearing in both headings and body; `screen.getByText()` also failed for text split across parent element + inline `<a>` child
- **Fix:** Switched failing assertions to `getAllByText(pattern).length >= 1`; used function matcher `(_, el) => el.textContent.includes(...)` for cross-element text
- **Files modified:** All 3 test files
- **Committed in:** `60965d8c` (Task 2 GREEN commit)

---

**Total deviations:** 3 auto-fixed (2 Rule 1 bugs, 1 Rule 1 test bug)
**Impact on plan:** All auto-fixes necessary for correctness. No scope creep.

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| `[Agent Name — pending registration]` | `leanshot/src/components/legal/DMCAPage.tsx:56` | DMCA agent not yet registered with U.S. Copyright Office — **operator action required at Phase 70 UAT**: register at https://ecfs.copyright.gov/ and update placeholder |
| `[Address — pending registration]` | `leanshot/src/components/legal/DMCAPage.tsx:59` | Same as above — physical address required for registered agent |

These stubs do NOT prevent the plan's goal: the DMCA page renders and routes correctly. The stubs are explicitly documented per UI-SPEC §5 ("agent info (placeholder until U.S. Copyright Office filing)").

## Single-H1 Invariant Note

After this plan ships, the following files still have internal H1s that will create double-H1 pages when rendered:
- `PrivacyPolicy.tsx` — Plan 64-04's responsibility
- `TermsOfService.tsx` — Plan 64-04's responsibility

**Merger / Plan 64-08 close-out MUST verify**: `grep -c "<h1" leanshot/src/components/legal/*.tsx` — expected: exactly 1 per file (the one in LegalLayout.tsx rendered via H1 delegation, and 0 in individual page files). Plan 64-04 must remove the internal H1 from both files.

## Issues Encountered

- **Worktree node_modules missing**: Worktree doesn't have node_modules by default (per reference `npm_install_worktree_main_drift`). Resolved by symlinking `leanshot/node_modules → /Users/karstenhaldan/minisite/leanshot/node_modules` inside the worktree.
- **vitest --reporter=basic invalid**: `--reporter=basic` caused a startup error in vitest 4.x. Omitted the flag; tests ran with default reporter.

## Threat Flags

No new threat surface introduced beyond what the plan's `<threat_model>` documented:
- DoNotSellPage → `/functions/v1/privacy-optout-process` POST (T-64-05-01, mitigated by Plan 64-02 Fn-side validation)
- DoNotSellPage form invisible if BLOCKER tokens used — mitigated (T-64-05-04) — verified clean

## Next Phase Readiness

- All 3 new legal page components are ready to be lazy-loaded; **Plan 64-07** must add hash routes `#/privacy/do-not-sell`, `#/legal/accessibility`, `#/legal/dmca` to App.tsx
- Plan 64-02 must deploy `privacy-optout-process` Edge Fn for DoNotSellPage POST to succeed at runtime
- Plan 64-04 must remove duplicate H1 from PrivacyPolicy.tsx + TermsOfService.tsx

---
*Phase: 64-legal-refresh*
*Completed: 2026-05-26*
