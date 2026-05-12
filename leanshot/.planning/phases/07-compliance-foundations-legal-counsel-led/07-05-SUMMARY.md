---
phase: 07-compliance-foundations-legal-counsel-led
plan: 05
subsystem: compliance
tags: [compliance, hbnr, ftc, incident-response, runbook, mvp, docs]

requires:
  - phase: 07-compliance-foundations-legal-counsel-led
    provides: 07-01 CI-green entry condition (deferred-tests batch-fix; CI partial at 311c355)
provides:
  - FTC HBNR (16 CFR Part 318) incident-response runbook at .planning/runbooks/hbnr-incident-response.md
  - Founder COMPL-03 acknowledgement note at .planning/decisions/COMPL-03-ACKNOWLEDGEMENT.md
  - Content-grep Vitest test locking runbook shape (src/lib/compl-03-runbook.test.ts; 10 assertions)
  - ROADMAP Phase 7 SC#3 wording correction (no "FTC registration" — rule applies automatically)
affects: [phase-07-broad-public-launch-readiness, future-incident-response, annual-review-2027]

tech-stack:
  added: []
  patterns:
    - "Compliance-artifact content-grep test pattern: structural contract pinned by Vitest reading the runbook from disk + multi-line regex (mirrors `src/lib/supabase.test.ts` cross-cutting convention)"
    - "Public-by-design repo PII canary: assert known-PII strings (founder email) NOT present in published compliance artifacts"
    - "Founder acknowledgement note pattern: `.planning/decisions/<REQ-ID>-ACKNOWLEDGEMENT.md` with frontmatter (`requirement`, `acknowledged_date`, `next_review_due`, `runbook`) + annual review log appendix"

key-files:
  created:
    - .planning/runbooks/hbnr-incident-response.md (121 lines)
    - .planning/decisions/COMPL-03-ACKNOWLEDGEMENT.md (43 lines)
    - src/lib/compl-03-runbook.test.ts (86 lines, 10 assertions)
  modified:
    - .planning/ROADMAP.md (Phase 7 SC#3 line — 1 line changed, surgical diff)

key-decisions:
  - "Test file path corrected from plan-spec `src/test/compl-03-runbook.test.ts` to `src/lib/compl-03-runbook.test.ts` per existing cross-cutting test convention (verified via `ls src/lib/*.test.ts` showing `supabase.test.ts`, `auth-migration.test.ts`, etc.)"
  - "Sole-founder bus-factor accepted-risk recorded explicitly in both the runbook (§On-call escalation) and the acknowledgement (acknowledgement #3) — researcher Open Question #6 resolved as 'accept with out-of-band continuity record'"
  - "Counsel-engagement trigger preserved as operational triage (not D-01 invalidation): the runbook explicitly says engaging counsel during a real high-risk incident is allowed and does not retroactively re-open D-01"

patterns-established:
  - "5 mandatory `##` section headings as a structural contract — readers depend on them by name (founder during incident, content-grep test in CI). Section renames break CI; section splits break operational use."
  - "Sentinel anchor uniqueness: `## 60-day notification clock` is asserted to appear EXACTLY once. Prevents accidental duplication from a markdown editor split."
  - "Federal Register URL as the single canonical statutory anchor (federalregister.gov/documents/2024/05/30/2024-10855) — durable, primary-source, citable in legal correspondence."

requirements-completed: [COMPL-03]

duration: ~18min
completed: 2026-05-12
---

# Phase 7 Plan 5: FTC HBNR Incident-Response Runbook + Founder Acknowledgement Summary

**HBNR (16 CFR Part 318) compliance closes with an internal 5-section incident-response runbook (121 lines, FedReg-cited) + dated founder acknowledgement + CI-pinned content-grep test — no FTC registration exists to file (researcher Key Finding #6 corrects the ROADMAP misnomer).**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-05-12T~17:58Z (local)
- **Completed:** 2026-05-12T~18:08Z (local)
- **Tasks:** 4 / 4 complete
- **Files modified:** 4 (3 created + 1 surgical edit)
- **Test delta:** 434 → 444 unit tests (+10, all passing)

## Accomplishments

- COMPL-03 requirement closed without paid attorney engagement (D-01 honored).
- 121-line operational runbook gives the founder a single-document procedure for the 60-day notification clock, including a day-by-day cadence (D+0 contain → D+60 hard deadline).
- ROADMAP SC#3 wording corrected: prior phrasing ("FTC HBNR registration is filed (confirmation number recorded)") was a misnomer — 16 CFR Part 318 applies automatically; there is no enrollment process.
- Annual-review machinery in place: both artifacts have `next_review_due: 2027-05-12` in frontmatter, and the acknowledgement carries an annual-review log appendix the founder appends to each year.
- Content-grep test in CI now defends the runbook's structural shape — any silent edit that removes or renames a section will fail CI.
- PII canary in test prevents accidental commit of founder PII to the public-by-design repo (T-07-05-03 mitigation).

## Task Commits

Each task was committed atomically:

1. **Task 1: HBNR incident-response runbook** — `c6422e4` (docs)
2. **Task 2: Founder COMPL-03 acknowledgement note** — `ee5ee5e` (docs) **[contaminated — see Deviations]**
3. **Task 3: Vitest content-grep test** — `29e2b60` (test)
4. **Task 4: ROADMAP SC#3 correction** — `987dfd5` (docs)

**Plan metadata (this SUMMARY):** to be added in the final wrap-up commit.

## Files Created/Modified

- `.planning/runbooks/hbnr-incident-response.md` — FTC HBNR (16 CFR Part 318) incident-response runbook. 121 lines. 5 `##` sections (Definitions, 60-day notification clock, Breach decision tree, On-call escalation, Post-incident review) plus Annual review + Primary sources. Cites Federal Register 2024-10855 + Cornell LII mirror.
- `.planning/decisions/COMPL-03-ACKNOWLEDGEMENT.md` — Dated founder acknowledgement of HBNR applicability + 60-day clock + sole-founder bus-factor accepted-risk + annual review commitment. 43 lines.
- `src/lib/compl-03-runbook.test.ts` — Vitest content-grep test. 86 lines, 10 assertions: existence, line-count ≥120, 5 section headings (parameterized via `it.each`), sentinel-anchor uniqueness, Federal Register URL citation, PII canary (founder email absent).
- `.planning/ROADMAP.md` — Phase 7 SC#3 line edited from "FTC HBNR registration is filed (confirmation number recorded...)" to reference the two real artifacts (`.planning/runbooks/hbnr-incident-response.md` + `.planning/decisions/COMPL-03-ACKNOWLEDGEMENT.md`) and the misnomer correction. Surgical 1-line diff confirmed by `git diff HEAD~1 HEAD -- leanshot/.planning/ROADMAP.md`.

## Decisions Made

- **Test path correction**: Plan spec named the test file `leanshot/src/test/compl-03-runbook.test.ts`. The existing repo convention (verified) puts cross-cutting tests under `src/lib/` co-mingled with the `.ts` they assert against (e.g., `src/lib/supabase.test.ts`, `src/lib/auth-migration.test.ts`). Adopted `src/lib/compl-03-runbook.test.ts` — matches convention, no new directory required, no Vitest config changes needed.
- **Runbook length expansion**: First draft came in at 112 lines (below the ≥120 floor). Extended `## 60-day notification clock` with a "Failure-mode reminders" subsection and `## On-call escalation` with a "Channels monitored daily for breach signals" subsection. Both additions are substantive (not filler) — they encode failure modes (mis-counted population, discovery-timestamp drift) and breach-signal channels (Sentry, Supabase, support inbox, GitHub, Vercel) that a founder would actually reference during an incident.

## Deviations from Plan

### Critical: Wave-2 cross-contamination at Task 2 commit

**1. [Rule 4 - Architectural — surfaced, not auto-recovered] 07-02 sibling staged files included in commit `ee5ee5e`**

- **Found during:** Task 2 (Founder COMPL-03 acknowledgement commit).
- **Issue:** When committing Task 2 with `git add leanshot/.planning/decisions/COMPL-03-ACKNOWLEDGEMENT.md && git commit ...`, the resulting commit `ee5ee5e` included **7 additional files** that belong to Wave-2 sibling plan 07-02: `leanshot/src/App.tsx` (69-line modification), `leanshot/src/components/layout/LegalFooter.tsx`, and 5 new files under `leanshot/src/components/legal/` (ConsumerHealthData.tsx, LegalLayout.tsx, MedicalDisclaimer.tsx, PrivacyPolicy.tsx, TermsOfService.tsx).
- **Root cause:** The Wave-2 orchestrator is running 07-02, 07-05, and 07-08 against the **same single-repo checkout** (no worktree isolation — `git rev-parse --show-toplevel` returns `/Users/karstenhaldan/minisite`, parent of `leanshot/`, and there is no per-agent branch). The 07-02 sibling agent had already staged its files into the shared index before my Task 2 `git add` call. `git commit` with no path-pathspec captures everything staged in the index, not only my just-added file.
- **Why not auto-recovered:** Rolling back `ee5ee5e` (e.g., `git reset --soft HEAD~1` + re-commit with `git commit -o <path>`) would either (a) leave 07-02's work uncommitted and racy with their own commit attempt, or (b) require coordinating with the 07-02 agent — neither is safe under Rule 4's "architectural / requires user decision" disposition. The 07-08 sibling also landed `3ccbb61` mid-execution, confirming heavy parallel write activity on this checkout.
- **Mitigation taken:** For Tasks 3 and 4, I switched to verifying the staged set with `git diff --cached --stat` BEFORE each `git commit`. Both subsequent commits (`29e2b60` and `987dfd5`) are clean single-file commits.
- **Surfaced to:** This SUMMARY. The orchestrator should treat `ee5ee5e` as a co-commit between 07-05 and 07-02, and 07-02's executor should be informed that its Legal-page files have already landed on main via my Task 2 commit.

**Total deviations:** 1 surfaced (architectural / Rule 4 — Wave-2 isolation gap; no auto-recovery).
**Impact on plan:** Functionally zero — all 4 of my plan's success criteria are satisfied and verified. Coordination concern only — the 07-02 executor will discover its work already committed when it tries to commit, and should be able to adapt (it will see its files in `git log` and skip its commit step or amend).

## Issues Encountered

- **Initial runbook draft was 112 lines (8 short of the 120-line floor)** — extended with two substantive subsections (failure-mode reminders + breach-signal channels). Not filler; both are content the founder would actually need during an incident. Final line count: 121.
- **Wave-2 shared-checkout cross-contamination** — see Deviations §1 above. Not resolvable from within a single executor's scope.

## User Setup Required

None — pure docs + test slice. No external services, no env vars, no database migrations, no UI surfaces.

## Follow-ups

- **Annual review due 2027-05-12.** Both `.planning/runbooks/hbnr-incident-response.md` and `.planning/decisions/COMPL-03-ACKNOWLEDGEMENT.md` carry `next_review_due: 2027-05-12` in their frontmatter. The runbook's `## Annual review` section enumerates the 5 review steps (URLs resolve, sync-table list matches codebase, statutory amendments, update review-due dates, append acknowledgement log row).
- **Orchestrator hardening (recommended):** Wave-2 parallelism on a single non-worktree checkout caused commit contamination at `ee5ee5e`. Future multi-wave runs should either (a) use git worktrees (per `feedback/get-shit-done` docs), (b) serialize commits via a lock, or (c) have each executor use `git commit -o <pathspec>` strictly. I adopted (c) for my own Tasks 3/4 but cannot retro-fix Task 2.
- **`Plans: TBD` ROADMAP block** — intentionally left untouched per plan instructions; expected to be populated by a roll-up step or the final-plan write in this phase.

## Next Phase Readiness

- COMPL-03 (one of 4 Phase 7 compliance requirements) is closed.
- Remaining Phase 7 SCs: SC#1 (privacy policy + COMPL-01), SC#2 (WMHMDA CHDP + COMPL-02), SC#4 (data export + account delete + COMPL-06), SC#5 (account-deletion smoke test). My commit landed alongside 07-02 (legal pages) and 07-08 (audit_logs migration) work — Phase 7 closure depends on those plans + the entry-condition CI gap (07-01 partial; 4 pass / 7 fail at 311c355) being resolved.
- No blockers introduced by this plan.

## Self-Check: PASSED

- 4/4 expected artifacts on disk (121 + 43 + 86 + 133 lines).
- 4/4 task commits resolvable in `git log` (`c6422e4`, `ee5ee5e`, `29e2b60`, `987dfd5`).
- `npm run test:unit -- src/lib/compl-03-runbook.test.ts` → 10/10 pass.
- `npm run test:unit` (full suite) → 444/444 pass (was 434; +10 from this plan).
- ROADMAP SC#3 grep: new wording present, old "FTC HBNR registration is filed (confirmation number recorded" absent.

---
*Phase: 07-compliance-foundations-legal-counsel-led*
*Plan: 05*
*Completed: 2026-05-12*
