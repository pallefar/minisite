---
phase: 64-legal-refresh
plan: 04
subsystem: ui
tags: [legal, privacy, react, tailwind, supabase, vitest, tdd, state-privacy, ccpa, gdpr-adjacent]

# Dependency graph
requires:
  - phase: 25-subprocessor-pipeline
    provides: public.subprocessor_snapshots table with vendors jsonb column
  - phase: 22-legal-foundation
    provides: PrivacyPolicy.tsx + TermsOfService.tsx + LegalLayout.tsx baseline
  - phase: 64-01-db-schema
    provides: LEGAL-01/LEGAL-04/LEGAL-08 requirements context

provides:
  - SubprocessorList component — live-fetches latest subprocessor_snapshots row (Phase 25 pipeline source of truth)
  - PrivacyPolicy extended with 5 state addendum sections (CA/VA/CO/CT/UT), TOC nav, What Changed banner, live SubprocessorList
  - TermsOfService extended with UGC content-license section, 8-rule Community Rules anchor, DMCA cross-reference

affects:
  - 64-05-new-legal-pages (DMCA page referenced from community-rules / TermsOfService)
  - 64-06-dsar-state-extension (DSAR portal linked from all 5 state addendum sections)
  - 64-08-close-out (legal-08 LEGAL-01/LEGAL-04 requirements completed here)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Live-fetch legal data from supabase_snapshots via maybeSingle() pattern (not static markdown)"
    - "Bracket-syntax Tailwind v4 tokens: bg-[var(--color-warning-soft)] — no shorthand aliases"
    - "TDD red/green: test file ships first with vi.mock(@/lib/supabase), component written to pass"
    - "State addendum draft disclaimer pattern: inline <em> at section top pending Phase 70 UAT"
    - "UCPA no-portability: UT section explicitly excludes portability right (narrower than VA/CO/CT)"

key-files:
  created:
    - leanshot/src/components/legal/SubprocessorList.tsx
    - leanshot/src/components/legal/__tests__/SubprocessorList.test.tsx
    - leanshot/src/components/legal/__tests__/PrivacyPolicy.state-addendums.test.tsx
  modified:
    - leanshot/src/components/legal/PrivacyPolicy.tsx
    - leanshot/src/components/legal/TermsOfService.tsx

key-decisions:
  - "SubprocessorList SELECT only captured_at + vendors — no BAA renewal dates or NDA timestamps (T-64-04-01)"
  - "All colors via var(--color-*) bracket syntax per Phase 60 BLOCKER lesson — no shorthand aliases that silently no-op"
  - "Draft disclaimer in every state addendum section to prevent regulator / counsel reading draft as final (T-64-04-04)"
  - "Utah section explicitly states NO portability right (UCPA narrower than VA/CO/CT — D-DSAR-Portal-Extensions)"
  - "node_modules symlinked from main checkout to worktree to enable vitest execution without npm install"

patterns-established:
  - "Legal-component live-fetch pattern: useEffect → supabase.from().select().order().limit(1).maybeSingle() → loading/empty/error/loaded states"
  - "State addendum template: anchored H2 + 3 subsections (rights / how to exercise / state-specific contact) + draft disclaimer"
  - "UGC content-license: user retains ownership, non-exclusive license terminates on deletion"

requirements-completed: [LEGAL-01, LEGAL-04, LEGAL-08]

# Metrics
duration: 18min
completed: 2026-05-26
---

# Phase 64 Plan 04: Privacy Policy + ToS Summary

**5 state-privacy addendum sections (CCPA/CDPA/CPA/CTDPA/UCPA) + live SubprocessorList from Phase 25 pipeline + ToS UGC content-license with 8 Community Rules + DMCA cross-reference — all via TDD with mocked Supabase**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-05-26T22:43:00Z
- **Completed:** 2026-05-26T20:53:36Z
- **Tasks:** 3 (Tasks 1 + 2 via TDD with RED/GREEN commits; Task 3 direct)
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- SubprocessorList component live-fetches from public.subprocessor_snapshots (Phase 25 cron source of truth) — never a static list. Columns: Vendor / Purpose / BAA Status / Region. Loading skeleton / empty state / error fallback with privacy@leanshot.app contact path (all 4 tests GREEN).
- PrivacyPolicy extended with: warning-soft banner (Last updated + What changed), sticky TOC nav with 11 anchor links, live SubprocessorList section, 5 anchored state addendum sections (California CCPA/CPRA, Virginia CDPA, Colorado CPA, Connecticut CTDPA, Utah UCPA), What Changed log (7 tests GREEN).
- TermsOfService extended with: UGC content-license clause, Community Rules sub-section (8 rules), DMCA takedown cross-reference, moderation rights reservation, Last updated banner. tsc clean.

## Task Commits

Each task committed atomically (TDD = RED then GREEN):

1. **Task 1 RED — SubprocessorList tests** - `77dc062a` (test)
2. **Task 1 GREEN — SubprocessorList component** - `dbfbd61a` (feat)
3. **Task 2 RED — PrivacyPolicy state-addendums tests** - `e9956984` (test)
4. **Task 2 GREEN — PrivacyPolicy extended** - `dfce14f4` (feat)
5. **Task 3 — TermsOfService UGC extension** - `5ea83302` (feat)

## Files Created/Modified

- `leanshot/src/components/legal/SubprocessorList.tsx` — New: live-fetches subprocessor_snapshots, table view with 4 columns, loading/empty/error states
- `leanshot/src/components/legal/__tests__/SubprocessorList.test.tsx` — New: 4 vitest tests via vi.mock(@/lib/supabase)
- `leanshot/src/components/legal/__tests__/PrivacyPolicy.state-addendums.test.tsx` — New: 7 vitest tests for state anchors, TOC, banner, UCPA no-portability
- `leanshot/src/components/legal/PrivacyPolicy.tsx` — Extended: TOC, banner, SubprocessorList section, 5 state addendums, What Changed log
- `leanshot/src/components/legal/TermsOfService.tsx` — Extended: UGC content-license, Community Rules (8 rules), DMCA cross-ref, Last updated banner

## Decisions Made

- SubprocessorList selects only `captured_at, vendors` — no internal BAA renewal dates (T-64-04-01 mitigation)
- All colors use bracket syntax `bg-[var(--color-warning-soft)]` per Phase 60 BLOCKER lesson — shorthand aliases silently no-op in Tailwind v4
- Utah section explicitly states "no portability right" per UCPA — narrower than VA/CO/CT (D-DSAR-Portal-Extensions spec)
- Draft disclaimer `<em>` at top of every state addendum section + UGC section — prevents regulator/counsel reading draft as final (T-64-04-04)
- Symlinked `node_modules` from main leanshot checkout to worktree to enable vitest execution

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed forbidden-token list from SubprocessorList comment**
- **Found during:** Task 1 verify
- **Issue:** JSDoc comment listing the forbidden tokens (`text-text-primary`, `bg-surface-card`, etc.) by name triggered the `! grep -E` gate in the plan's automated verify, causing false-positive failure
- **Fix:** Rewrote comment to say "no undefined Tailwind v4 tokens" without naming them
- **Files modified:** SubprocessorList.tsx
- **Committed in:** `dbfbd61a` (Task 1 GREEN commit)

**2. [Rule 1 - Bug] Fixed `getByText(/Last updated/i)` multiple-element error in test**
- **Found during:** Task 2 GREEN phase
- **Issue:** PrivacyPolicy renders "Last updated" in both the warning banner and the header, causing `getByText` to throw "Found multiple elements"
- **Fix:** Changed test to use `getAllByText(/Last updated/i).length > 0` assertion
- **Files modified:** PrivacyPolicy.state-addendums.test.tsx
- **Committed in:** `dfce14f4` (Task 2 GREEN commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs)
**Impact on plan:** Both fixes were minor correctness corrections in tests / comments. No scope changes.

## Issues Encountered

- Worktree had no `node_modules` — symlinked from main checkout (`ln -s /Users/karstenhaldan/minisite/leanshot/node_modules`) to enable vitest execution. Standard worktree pattern.
- `--reporter=basic` flag caused vitest to fail (resolves as a file path, not a reporter name). Dropped the flag; tests run correctly without it.

## User Setup Required

None — no external service configuration required. SubprocessorList reads from existing public.subprocessor_snapshots RLS (Phase 25 made it publicly readable).

## Known Stubs

None — SubprocessorList live-fetches from the database; empty and error states are handled gracefully. The state addendum text is first-draft copy with explicit draft disclaimers directing to Phase 70 UAT for legal counsel review. This is intentional per CONTEXT D-01 (internal-authored copy + external legal review at staging).

## Threat Flags

No new security surfaces introduced. Existing subprocessor_snapshots anon-read RLS verified in Phase 25. React auto-escaping mitigates XSS from vendors jsonb (T-64-04-02 accepted).

## TDD Gate Compliance

- Task 1: RED commit `77dc062a` → GREEN commit `dbfbd61a` (gate compliant)
- Task 2: RED commit `e9956984` → GREEN commit `dfce14f4` (gate compliant)
- Task 3: non-TDD (type="auto" without tdd="true")

## Next Phase Readiness

- Plan 64-05 (new legal pages: /privacy/do-not-sell, /legal/accessibility, /legal/dmca) can proceed — DMCA cross-reference in ToS + state addendum "Do Not Sell" links already pointing to correct routes
- Plan 64-06 (DSAR state extensions) can proceed — state addendum sections already link to /account/data-rights portal
- Phase 70 UAT: legal counsel must review all 5 state addendum sections + UGC section before production flag; draft disclaimers are in place

---
*Phase: 64-legal-refresh*
*Completed: 2026-05-26*

## Self-Check: PASSED

Files exist:
- leanshot/src/components/legal/SubprocessorList.tsx: FOUND
- leanshot/src/components/legal/__tests__/SubprocessorList.test.tsx: FOUND
- leanshot/src/components/legal/__tests__/PrivacyPolicy.state-addendums.test.tsx: FOUND
- leanshot/src/components/legal/PrivacyPolicy.tsx: FOUND (modified)
- leanshot/src/components/legal/TermsOfService.tsx: FOUND (modified)

Commits exist:
- 77dc062a: FOUND
- dbfbd61a: FOUND
- e9956984: FOUND
- dfce14f4: FOUND
- 5ea83302: FOUND
