---
phase: 64-legal-refresh
plan: "07"
subsystem: ui
tags: [cookie-banner, vanilla-cookieconsent, cpra, ccpa, legal, sitemap, react-lazy, hash-routing]

requires:
  - phase: 22-consent-auth
    provides: consent-config.ts vanilla-cookieconsent v3 config with EU/US geo fork
  - phase: 07-legal-pages
    provides: LegalLayout, LegalFooter LEGAL_LINKS pattern, hash route selectView pattern
  - phase: 64-legal-refresh
    plan: 64-05
    provides: DoNotSellPage, AccessibilityPage, DMCAPage components (Plan 64-05 stub replaced at merge)

provides:
  - Cookie banner US copy with Do Not Sell or Share anchor to /privacy/do-not-sell (LEGAL-07)
  - Cookie banner AUTH-16 cross-reference (sign-in rate-limiting mention per CPRA notice-of-security-practices)
  - buildConsentModalDescription(isEU) + buildFurtherInfoDescription() exported helpers (testable, bundle-safe)
  - CPRA vitest test suite (5 tests) asserting banner copy invariants
  - App.tsx hash routes: #/legal/accessibility, #/legal/dmca, #/privacy/do-not-sell (do-not-sell view)
  - LegalFooter LEGAL_LINKS extended from 4 to 8 entries (Accessibility, DMCA, Do Not Sell, Data Rights DSAR)
  - public/sitemap.xml with all legal surface URLs (LEGAL-10)
  - Stub components: DoNotSellPage, AccessibilityPage, DMCAPage (Plan 64-05 replaces at merge)

affects:
  - 64-legal-refresh (Plans 64-05, 64-08 close-out)
  - Any phase importing LegalFooter LEGAL_LINKS (shape changed from 4 to 8 entries)
  - Phase 07 e2e spec asserting LEGAL_LINKS count (needs update to 8 in close-out plan)

tech-stack:
  added: []
  patterns:
    - "buildConsentModalDescription(isEU) helper pattern: extract testable string builders from vanilla-cookieconsent config to avoid bundle-budget violation in tests"
    - "Stub-then-replace parallel wave pattern: DoNotSellPage/AccessibilityPage/DMCAPage stubs shipped by 64-07 with final prop signature; Plan 64-05 replaces body at merge"
    - "do-not-sell View type: non-#/legal/* hash route uses dedicated view type + selectView branch (not selectLegalPage switch)"

key-files:
  created:
    - leanshot/src/components/consent/__tests__/consent-config.cpra.test.ts
    - leanshot/public/sitemap.xml
    - leanshot/src/components/legal/DoNotSellPage.tsx
    - leanshot/src/components/legal/AccessibilityPage.tsx
    - leanshot/src/components/legal/DMCAPage.tsx
  modified:
    - leanshot/src/components/consent/consent-config.ts
    - leanshot/src/App.tsx
    - leanshot/src/components/layout/LegalFooter.tsx

key-decisions:
  - "Exported buildConsentModalDescription(isEU) and buildFurtherInfoDescription() helpers instead of testing initCookieConsent() directly — avoids triggering vanilla-cookieconsent value-import during unit tests (bundle-budget contract per file header)"
  - "Used Python for file mutations in consent-config.ts to avoid Edit tool Unicode curly-quote substitution that caused esbuild parse errors"
  - "Stub DoNotSellPage/AccessibilityPage/DMCAPage per feedback_stub_then_replace_sibling_collision pattern — Plan 64-05 runs in parallel wave and replaces stubs at merge"
  - "do-not-sell gets its own View type (not routed through selectLegalPage) because /privacy/do-not-sell is not under #/legal/* namespace per UI-SPEC §2"
  - "Data rights (DSAR) in LegalFooter uses pathname /settings/privacy/dsar not a hash — auth-required page; consistent with Phase 22 Plan 22-11 routing"

patterns-established:
  - "CPRA test pattern: loadInitWithGeo(country) resets modules per test, stubs vanilla-cookieconsent.run, inspects captured config directly"
  - "Consent copy helper extraction: separate buildXxx() functions keep the heavy CookieConsent.run call testable without importing the library"

requirements-completed: [LEGAL-07, LEGAL-10, AUTH-16]

duration: 35min
completed: 2026-05-26
---

# Phase 64 Plan 07: Cookie Banner + Routes + Sitemap Summary

**CPRA-compliant cookie banner with Do Not Sell link, AUTH-16 rate-limit mention, 3 new hash routes wired to Plan 64-05 page stubs, LegalFooter extended to 8 entries, and sitemap.xml with all legal URLs**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-05-26T22:40:00Z
- **Completed:** 2026-05-26T22:55:00Z
- **Tasks:** 2 (Task 1 TDD: 3 commits RED/GREEN; Task 2: 1 commit)
- **Files modified:** 7 (2 modified existing, 5 created)

## Accomplishments

- Cookie banner US copy extended with Do Not Sell or Share anchor (`/privacy/do-not-sell`) and sign-in rate-limiting mention (AUTH-16 CPRA notice-of-security-practices) — EU copy unchanged per GDPR scope
- Extracted `buildConsentModalDescription(isEU)` and `buildFurtherInfoDescription()` testable helpers; 5 CPRA vitest tests pass
- App.tsx: 3 new lazy chunks + `#/legal/accessibility`, `#/legal/dmca` added to `selectLegalPage`; `do-not-sell` view type + `#/privacy/do-not-sell` dispatch + render branch
- LegalFooter `LEGAL_LINKS` extended from 4 to 8 entries
- `public/sitemap.xml` created with 4 existing + 4 new legal surface URLs

## Task Commits

1. **Task 1 RED: CPRA failing tests** - `2f01a3d4` (test)
2. **Task 1 GREEN: consent-config implementation** - `548483ad` (feat)
3. **Task 2: App.tsx routes + LegalFooter + sitemap** - `15cdc2d9` (feat)

## Files Created/Modified

- `src/components/consent/consent-config.ts` - Added `buildConsentModalDescription(isEU)` + `buildFurtherInfoDescription()` helpers; US copy includes Do Not Sell + rate-limit mention
- `src/components/consent/__tests__/consent-config.cpra.test.ts` - 5 CPRA compliance tests
- `src/App.tsx` - 3 new lazy imports, selectLegalPage extended, do-not-sell view type + dispatch + render
- `src/components/layout/LegalFooter.tsx` - LEGAL_LINKS extended 4→8 entries
- `public/sitemap.xml` - New file with all legal surface URLs
- `src/components/legal/DoNotSellPage.tsx` - Stub (Plan 64-05 replaces)
- `src/components/legal/AccessibilityPage.tsx` - Stub (Plan 64-05 replaces)
- `src/components/legal/DMCAPage.tsx` - Stub (Plan 64-05 replaces)

## Decisions Made

- `buildConsentModalDescription(isEU)` extracted as testable helper to avoid triggering vanilla-cookieconsent value-import in tests (bundle-budget contract).
- Used Python for file mutations in consent-config.ts because the Edit tool substitutes straight ASCII single quotes with Unicode curly quotes (U+2018/U+2019) which esbuild rejects as syntax errors.
- Stub legal pages created per `feedback_stub_then_replace_sibling_collision` pattern — Plan 64-05 runs in same wave and replaces stubs at merge.
- `do-not-sell` gets its own `View` type (not routed through `selectLegalPage`) because `/privacy/do-not-sell` is NOT under `#/legal/*` namespace per UI-SPEC §2.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created stub legal page components for Plan 64-05 files**
- **Found during:** Task 2 (App.tsx lazy imports)
- **Issue:** DoNotSellPage, AccessibilityPage, DMCAPage don't exist yet — Plan 64-05 runs in same parallel wave. tsc would fail without these imports resolving.
- **Fix:** Created 3 stub components with correct export signatures per `feedback_stub_then_replace_sibling_collision` pattern. Stubs render placeholder content; Plan 64-05 replaces with full implementations at merge.
- **Files modified:** src/components/legal/DoNotSellPage.tsx, AccessibilityPage.tsx, DMCAPage.tsx
- **Verification:** tsc clean after stubs created
- **Committed in:** 15cdc2d9 (Task 2 commit)

**2. [Rule 1 - Bug] Used Python for consent-config.ts mutations**
- **Found during:** Task 1 GREEN (consent-config implementation)
- **Issue:** Edit/Write tools convert ASCII single quotes to Unicode curly quotes (U+2018/U+2019). These produce `Unexpected "'"` esbuild parse errors when used as string delimiters. Vitest transforms use esbuild.
- **Fix:** Used Python subprocess to write file content with guaranteed ASCII apostrophes. JavaScript escape sequence `’` used for the curly apostrophe in copy text.
- **Impact:** No functional change; identical runtime behavior.

---

**Total deviations:** 2 auto-fixed (1 blocking stub creation, 1 bug encoding)
**Impact on plan:** Both auto-fixes necessary. No scope creep. Stub pattern documented for merge-time awareness.

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| DoNotSellPage renders placeholder text | `src/components/legal/DoNotSellPage.tsx` | Plan 64-05 creates full opt-out form (same wave) |
| AccessibilityPage renders placeholder text | `src/components/legal/AccessibilityPage.tsx` | Plan 64-05 creates WCAG statement (same wave) |
| DMCAPage renders placeholder text | `src/components/legal/DMCAPage.tsx` | Plan 64-05 creates DMCA policy page (same wave) |

## Threat Flags

No new security-relevant surfaces beyond what the plan's threat model covers. Banner copy is authored/static; vanilla-cookieconsent sanitizes attribute strings. Hash route dispatch is client-side only.

## Issues Encountered

- Edit/Write tools produce Unicode curly quotes in string literals which esbuild rejects — worked around with Python for consent-config.ts mutations. This is a systematic toolchain issue; future plans modifying this file should be aware.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 64-05 (same wave) creates full DoNotSellPage, AccessibilityPage, DMCAPage; their merge replaces the stubs in this plan
- Plan 64-08 close-out: axe-core CLI audit against staging URL (human-verify gate); LegalFooter e2e spec needs updating to 8-entry LEGAL_LINKS shape
- REQUIREMENTS LEGAL-07 (Do Not Sell link in banner), LEGAL-10 (sitemap), AUTH-16 (rate-limit notice) are now CLOSED

---
*Phase: 64-legal-refresh*
*Completed: 2026-05-26*
