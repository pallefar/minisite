---
plan: "70-08-final-signoff"
phase: "70"
wave: 0
depends_on: []
autonomous: false
type: execute
requirements:
  - UAT-06
  - UAT-07
files_modified:
  - .planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/final-signoff/**
  - .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-08-PLAN-final-signoff.md
  - .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-FINAL-SIGNOFF.md
  - .planning/STATE.md
  - .planning/ROADMAP.md
fixture_group: "final-signoff"
estimated_duration: "1-2 hours operator time (rollup + decision + tag + announcement)"
must_haves:
  - "final-signoff-S01-rollup-status-from-plans-01-07"
  - "final-signoff-S02-apply-ship-rule"
  - "final-signoff-S03-go-no-go-decision"
  - "final-signoff-S04-git-tag-v1-4-0-ship"
  - "final-signoff-S05-slack-launch-announcement"
  - "final-signoff-S06-milestone-close-handoff"
---

<objective>
Plan 08 — Final signoff. The rollup + ship decision plan. Runs LAST. Reads the signoff state of Plans 01-07, applies the severity-tiered ship rule from CONTEXT.md Area 1, issues go/no-go, and (on go) tags `v1.4.0-ship` + posts Slack #launch announcement + archives Phase 70 + writes the v1.4 milestone-close handoff.

Cannot start until Plan 07 S10 (48h window closed GREEN) AND all critical signals across Plans 01-06 are signed off.

Multi-signal structure (UAT-06) is implicitly satisfied by the 8-plan / per-signal-checkbox structure itself; this plan's job is to ASSERT that fact + apply the ship rule (UAT-07).

Purpose: UAT-06 (multi-signal structure assertion) + UAT-07 (ship rule decided + applied uniformly) coverage.

Output: `70-FINAL-SIGNOFF.md` artifact (the launch-gate decision record), `git tag v1.4.0-ship` annotated tag, Slack #launch post, STATE.md milestone flip to `status: completed`, ROADMAP.md Phase 70 checkbox flipped, v1.4 milestone close handoff appended to STATE.md.
</objective>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/70-consolidated-uat-v1-4-launch-gate/70-CONTEXT.md
@.planning/phases/70-consolidated-uat-v1-4-launch-gate/70-01-PLAN-vendor-oauth-secrets.md
@.planning/phases/70-consolidated-uat-v1-4-launch-gate/70-02-PLAN-stripe-test.md
@.planning/phases/70-consolidated-uat-v1-4-launch-gate/70-03-PLAN-browser.md
@.planning/phases/70-consolidated-uat-v1-4-launch-gate/70-04-PLAN-ios-device.md
@.planning/phases/70-consolidated-uat-v1-4-launch-gate/70-05-PLAN-android-device.md
@.planning/phases/70-consolidated-uat-v1-4-launch-gate/70-06-PLAN-ops-runbook-drill.md
@.planning/phases/70-consolidated-uat-v1-4-launch-gate/70-07-PLAN-regression-watch.md
@.planning/phases/70-consolidated-uat-v1-4-launch-gate/70-07-WATCH-DASHBOARD.md
</context>

<tasks>

<task id="08-S01" name="Signal — Read + rollup signoff status from Plans 01-07">
  <type>verification</type>
  <signal_id>final-signoff-S01-rollup-status-from-plans-01-07</signal_id>
  <criticality>critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - All seven sibling PLAN.md files (frontmatter + Resume State + Composite Approval sections)
  </read_first>
  <action>
1. Read each Plan 01-07 PLAN.md. For each, capture:
   - count of critical signals total
   - count of critical signals signed off (`- [x]` not `- [ ]`)
   - count of non-critical signals signed off
   - count of signals with `defer:` (open GH issues count)
   - Composite Approval disposition picked (approved / approved-non-criticals-deferred / blocked)
2. Build a rollup table in `70-FINAL-SIGNOFF.md`:

   | Plan | Critical (done/total) | Non-critical signed | Deferred (issues) | Disposition |
   |------|----------------------:|--------------------:|------------------:|------------|
   | 70-01 vendor-oauth-secrets | 15/15 | 5/6 | 1 | approved-non-criticals-deferred |
   | 70-02 stripe-test | 9/9 | 1/1 | 0 | approved |
   | ... | ... | ... | ... | ... |

3. Also surface any `blocked:` dispositions prominently with the blocker reason.
4. Capture the rollup output.
  </action>
  <acceptance_criteria>
    - rollup table populated in 70-FINAL-SIGNOFF.md
    - all 7 plans accounted for
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/final-signoff/S01-rollup-status-from-plans-01-07/rollup-table.md
  </acceptance_criteria>
  <defer_clause>Cannot defer. This is the prerequisite for any ship decision.</defer_clause>
</task>

<task id="08-S02" name="Signal — Apply severity-tiered ship rule (UAT-07)">
  <type>verification</type>
  <signal_id>final-signoff-S02-apply-ship-rule</signal_id>
  <criticality>critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-CONTEXT.md §Decisions Area 1 (Ship Rule)
  </read_first>
  <action>
1. Apply the rule from CONTEXT.md Area 1: severity-tiered. **Critical signals MUST pass; non-critical can ship with documented `defer:&lt;reason&gt;`.**
2. The critical list (verbatim from CONTEXT.md):
   - vendor secrets present (all 6 missing from 69.7 + originals) — Plan 01 critical signals
   - Stripe Tax active — Plan 02 S01
   - MFA enroll + AAL2 + brute-force-lockout — Plan 06 S04
   - 48h regression sweep green — Plan 07 S10
   - device-UAT first-build cold-launch (iOS + Android) — Plan 04 S01 + Plan 05 S01
   - Apple OAuth signin + private-relay activation — Plan 04 S02
   - push delivery (web + iOS + Android) — Plan 03 implicit + Plan 04 S04 + Plan 05 S02
   - HealthKit OPT-IN flow — Plan 04 S03
   - payment-resilience dunning — Plan 02 S03
   - PITR restore drill evidence — Plan 06 S01
3. Build a "critical checklist" in `70-FINAL-SIGNOFF.md`:

   ```
   ## Critical Signal Pass Checklist
   - [x] Plan 01 — 15/15 critical signed
   - [x] Plan 02 S01 (Stripe Tax)
   - [x] Plan 02 S03 (3-email dunning)
   - [x] Plan 04 S01 (iOS TestFlight)
   - [x] Plan 04 S02 (Apple OAuth + private relay)
   - [x] Plan 04 S03 (HealthKit OPT-IN)
   - [x] Plan 04 S04 (push web Safari + APNs)
   - [x] Plan 05 S01 (Android Play first-build)
   - [x] Plan 05 S02 (push Chrome + FCM)
   - [x] Plan 06 S01 (PITR drill)
   - [x] Plan 06 S04 (MFA brute-force lockout)
   - [x] Plan 07 S10 (48h window GREEN)
   ```

4. If ALL critical boxes ticked → SHIP RULE: APPLIED → GO eligible.
5. If ANY critical box NOT ticked → SHIP RULE: APPLIED → NO-GO. Document which critical signal failed + the blocker.
  </action>
  <acceptance_criteria>
    - critical checklist populated
    - explicit GO-eligible / NO-GO determination recorded
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/final-signoff/S02-apply-ship-rule/ship-rule-decision.md
  </acceptance_criteria>
  <defer_clause>Cannot defer. UAT-07 ship-rule application is the entire phase deliverable.</defer_clause>
</task>

<task id="08-S03" name="Signal — Karsten issues go/no-go decision">
  <type>decision</type>
  <signal_id>final-signoff-S03-go-no-go-decision</signal_id>
  <criticality>critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - S01 rollup + S02 ship rule checklist
    - .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-CONTEXT.md (Karsten alone = authoritative go-decider)
  </read_first>
  <action>
1. Operator (Karsten) reviews the S01 rollup + S02 ship rule output. This is the final go/no-go moment.
2. **Decision options:**
   - `GO` — all critical green. Proceed to S04 (tag) + S05 (announce) + S06 (close).
   - `NO-GO` — at least one critical red. Halt Phase 70. File the blockers as new issues. Reschedule launch + reopen Phase 70 once blockers cleared.
3. Record the decision in `70-FINAL-SIGNOFF.md`:
   ```
   ## Decision
   - Decision: GO | NO-GO
   - Decided by: karsten.haldan@gmail.com
   - Decided at: YYYY-MM-DDTHH:MM:SSZ
   - Rationale: &lt;1-3 sentences&gt;
   ```
4. If NO-GO: append a "Blocker remediation" section listing each blocker + planned remediation phase / issue link.
  </action>
  <acceptance_criteria>
    - explicit GO or NO-GO recorded with timestamp + signature
    - if NO-GO: blocker remediation section populated
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: 70-FINAL-SIGNOFF.md decision section
  </acceptance_criteria>
  <defer_clause>Cannot defer. This is the irreducible launch moment.</defer_clause>
</task>

<task id="08-S04" name="Signal — git tag v1.4.0-ship (on GO only)">
  <type>verification</type>
  <signal_id>final-signoff-S04-git-tag-v1-4-0-ship</signal_id>
  <criticality>critical</criticality>
  <fixture>cli</fixture>
  <action>
**Only run if S03 = GO.**

1. Confirm working tree clean:
   `cd /Users/karstenhaldan/minisite/leanshot && git status` → "nothing to commit".
2. Ensure on `main` at the freeze SHA (or a clean superset that doesn't introduce regression):
   `git checkout main && git pull origin main`
3. Create annotated tag with the launch summary:
   `git tag -a v1.4.0-ship -m "v1.4 Launch Gate — Phase 70 signoff $(date -u +%Y-%m-%dT%H:%M:%SZ). Decided by karsten.haldan@gmail.com. 7 plans approved. See .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-FINAL-SIGNOFF.md"`
4. Push tag:
   `git push origin v1.4.0-ship`
5. Verify:
   `git tag -l v1.4.0-ship` shows the tag locally; GH:
   `gh release view v1.4.0-ship 2&gt;/dev/null || gh api repos/:owner/:repo/tags | jq '.[] | select(.name=="v1.4.0-ship")'`
6. (Optional) create a GH Release from the tag:
   `gh release create v1.4.0-ship --title "v1.4 Launch" --notes-file .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-FINAL-SIGNOFF.md`
  </action>
  <acceptance_criteria>
    - tag exists locally + pushed to origin
    - tag is annotated with signoff metadata
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/final-signoff/S04-git-tag-v1-4-0-ship/tag-sha.txt
  </acceptance_criteria>
  <defer_clause>Skip entirely if S03 = NO-GO. Otherwise cannot defer.</defer_clause>
</task>

<task id="08-S05" name="Signal — Slack #launch announcement (on GO only)">
  <type>verification</type>
  <signal_id>final-signoff-S05-slack-launch-announcement</signal_id>
  <criticality>critical</criticality>
  <fixture>cli</fixture>
  <action>
**Only run if S03 = GO.**

1. Auto-build the Slack message from the 70-FINAL-SIGNOFF.md summary. Template:

   ```
   :rocket: *LeanShot v1.4.0 is GO*

   Phase 70 (Consolidated UAT) signed off &lt;UTC ts&gt;.
   • Critical signals: {N}/{N} green
   • Plans approved: 7
   • Non-critical deferred: {M} (open as `v1.4-launch-deferral` issues)
   • Git tag: `v1.4.0-ship` ({short-sha})
   • Watch window: 48h GREEN

   See:
   • Signoff: .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-FINAL-SIGNOFF.md
   • Release: &lt;gh-release-url&gt;
   ```

2. Post via Slack CLI / curl + webhook (configure incoming webhook URL via env or `gh secret`). If Slack not yet wired, use a simple curl POST to the #launch webhook URL.
3. Capture the Slack message timestamp + permalink. Save to evidence dir.
  </action>
  <acceptance_criteria>
    - Slack message posted to #launch
    - permalink captured
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/final-signoff/S05-slack-launch-announcement/permalink.txt
  </acceptance_criteria>
  <defer_clause>Skip entirely if S03 = NO-GO. Otherwise: defer-OK if Slack webhook not yet configured; manually post and document.</defer_clause>
</task>

<task id="08-S06" name="Signal — Archive Phase 70 + v1.4 milestone close handoff">
  <type>verification</type>
  <signal_id>final-signoff-S06-milestone-close-handoff</signal_id>
  <criticality>critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/STATE.md
    - .planning/ROADMAP.md
  </read_first>
  <action>
1. **Flip Phase 70 ROADMAP checkbox**:
   `sed -i '' 's/^- \[ \] \*\*Phase 70: Consolidated UAT/- [x] **Phase 70: Consolidated UAT/' .planning/ROADMAP.md`
   (Per `feedback_roadmap_format_variance_close_out_check`, verify with grep before/after.)
2. **Flip UAT-01..07 boxes in REQUIREMENTS.md**:
   For each `- [ ] **UAT-0N**:` whose plan signed off, flip to `- [x]`. Same `sed` pattern.
3. **Update STATE.md**:
   - Set `status: completed` for milestone v1.4
   - Append a milestone-close handoff section enumerating: shipped phases (52-70), deferred items (open GH issues), v1.5 carry-overs (perf followups, watch hardware unavailable items, etc.)
   - Update progress counters: `completed_phases` to the post-Phase-70 count; `percent: 100`
   - **CAUTION** per `reference_state_complete_phase_writes_wrong_counters`: do NOT use `gsd-sdk state.complete-phase` here (known counter bug). Edit STATE.md manually then `git diff` to verify the edit lands correctly.
4. **Optional** — write `.planning/milestones/v1.4-MILESTONE-AUDIT.md` mirroring the v1.3-MILESTONE-AUDIT.md format. Defer-OK for v1.5.
5. **Commit**:
   `git add .planning/ROADMAP.md .planning/STATE.md .planning/REQUIREMENTS.md .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-FINAL-SIGNOFF.md && git commit -m "milestone(v1.4): close — Phase 70 GO, v1.4.0-ship tagged" && git push origin main`
  </action>
  <acceptance_criteria>
    - ROADMAP Phase 70 checked
    - UAT-01..07 boxes flipped in REQUIREMENTS.md
    - STATE.md milestone v1.4 status=completed with milestone-close handoff appended
    - git push pushed all close-out artifacts to origin/main
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/final-signoff/S06-milestone-close-handoff/ — git SHA of close-out commit
  </acceptance_criteria>
  <defer_clause>Cannot defer (on GO). Skip entirely if S03 = NO-GO.</defer_clause>
</task>

<task id="08-S07" name="Signal — Evidence directory bootstrap + final-signoff doc scaffold">
  <type>verification</type>
  <signal_id>final-signoff-S07-evidence-bootstrap</signal_id>
  <criticality>non-critical</criticality>
  <fixture>cli</fixture>
  <action>
1. `mkdir -p .planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/final-signoff/`
2. Create S01..S06 subdirs.
3. Create `70-FINAL-SIGNOFF.md` scaffold with section headers:
   ```
   # v1.4.0 Launch Signoff
   ## Rollup (Plan 01-07 status)
   ## Critical Signal Pass Checklist
   ## Decision
   ## Tag + Release
   ## Slack announcement
   ## Milestone close
   ```
4. Each subsequent task (S01..S06) fills in its section.
  </action>
  <acceptance_criteria>
    - evidence dirs exist
    - 70-FINAL-SIGNOFF.md scaffold committed
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
  </acceptance_criteria>
  <defer_clause>Non-critical bootstrap. Run BEFORE S01.</defer_clause>
</task>

</tasks>

<verification>
End-of-plan: `70-FINAL-SIGNOFF.md` exists with all 6 sections populated; ROADMAP + STATE + REQUIREMENTS all reflect Phase 70 close; on GO, `v1.4.0-ship` tag pushed + Slack announced.
</verification>

<success_criteria>
- All 6 critical signals signed off (S01, S02, S03, S04, S05, S06). On NO-GO, S04-S06 are skipped (not deferred) and Phase 70 enters blocker-remediation mode.
- S07 bootstrap signed.
- Evidence under `evidence/final-signoff/`.
- 70-FINAL-SIGNOFF.md complete.
</success_criteria>

## Resume State

- [ ] **S01** — Rollup status from Plans 01-07 — signoff: __________
- [ ] **S02** — Apply severity-tiered ship rule — signoff: __________
- [ ] **S03** — Karsten go/no-go decision — signoff: __________
- [ ] **S04** — git tag v1.4.0-ship (GO only) — signoff: __________
- [ ] **S05** — Slack #launch announcement (GO only) — signoff: __________
- [ ] **S06** — Milestone close + handoff — signoff: __________
- [ ] **S07** — Evidence dir + scaffold bootstrap — signoff: __________

## Composite Approval

| Disposition | Meaning |
|-------------|---------|
| `GO` | All critical S01-S06 signed off; v1.4 ships |
| `NO-GO` | At least one critical signal across Plans 01-07 cannot land; S04-S06 skipped; Phase 70 stays open until blockers remediated |

<output>
This is the terminal plan. After S06 commits, `/gsd-autonomous` (or operator) can archive Phase 70 + close the v1.4 milestone. No further GSD plans run within the v1.4 milestone after this. Next: v1.5 milestone kickoff.
</output>
