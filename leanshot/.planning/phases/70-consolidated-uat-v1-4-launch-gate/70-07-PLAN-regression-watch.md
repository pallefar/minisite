---
plan: "70-07-regression-watch"
phase: "70"
wave: 0
depends_on: []
autonomous: false
type: execute
requirements:
  - UAT-05
files_modified:
  - .planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/regression-watch/**
  - .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-07-PLAN-regression-watch.md
  - .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-07-WATCH-DASHBOARD.md
fixture_group: "regression-watch"
estimated_duration: "48 hours wall-clock from code-freeze (operator captures evidence every ~6h)"
must_haves:
  - "regression-watch-S01-code-freeze-snapshot"
  - "regression-watch-S02-playwright-e2e-green"
  - "regression-watch-S03-deno-test-sweep-green"
  - "regression-watch-S04-axe-ci-no-new-violations"
  - "regression-watch-S05-edge-fn-healthz-10-of-10"
  - "regression-watch-S06-sentry-p1-zero"
  - "regression-watch-S07-posthog-funnel-no-break"
  - "regression-watch-S08-better-stack-uptime-green"
  - "regression-watch-S09-lighthouse-mobile-min-90-watch-window"
  - "regression-watch-S10-48h-window-elapsed"
---

<objective>
Plan 07 — Regression watch (48h). The operator runs this continuously from code-freeze (last v1.4 commit on `main`) for ≥48 hours, capturing evidence at ~6h intervals. The gates enumerated in CONTEXT.md Area 4 must all stay green for the full window. If any gate flips red, the timer resets to the incident commit (per CONTEXT.md Area 4: "Any P1 alert during the window resets the timer to that incident commit.").

This is a "watch" plan, not a one-shot. It runs in PARALLEL with Plans 01-06 once code-freeze hits — the 48h clock starts at code-freeze and the operator can work through Plans 01-06 during that window. Final signoff captures the watch-window-end timestamp + the snapshot of the dashboard.

The 7 green thresholds (CONTEXT.md Area 4):
1. 0 P1 Sentry errors during the watch window
2. Playwright e2e 100% pass on main
3. Deno test sweep 100% pass on main
4. axe-CI 0 violations introduced (existing baseline OK)
5. Sentry health page: all sources green
6. Edge Fn `/healthz` 10/10 across deployed Fns
7. Lighthouse mobile ≥ 90 across 3 audience landing pages

Also: Better Stack uptime green; PostHog funnel-break alert dormant.

Purpose: UAT-05 (full regression sweep ≥48h green) coverage.

Output: signoff checkboxes filled inline + a separate `70-07-WATCH-DASHBOARD.md` (the running 48h log; operator pastes Sentry/PostHog/Better Stack screenshots into it every ~6h) + final CI green badge URLs + evidence committed to `evidence/regression-watch/`.
</objective>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/70-consolidated-uat-v1-4-launch-gate/70-CONTEXT.md
@.planning/phases/69.7-vercel-supabase-build-deploy-verification/69.7-SUMMARY.md
@.planning/phases/67-operational-runbooks-observability/67-SUMMARY.md

**Prereqs:** Plan 01 S12 (Better Stack API key) required for uptime threshold. Plan 03 S19 + Plan 04 S12 + Plan 05 S08 already capture Lighthouse evidence — re-run within the watch window.

**Special note:** This plan's tasks are mostly continuous monitoring + ~6h snapshots, plus a final integrated review at hour 48. The "evidence" is a time-series of dashboard captures.
</context>

<tasks>

<task id="07-S01" name="Signal — Code-freeze commit captured + watch window opens">
  <type>verification</type>
  <signal_id>regression-watch-S01-code-freeze-snapshot</signal_id>
  <criticality>critical</criticality>
  <fixture>cli</fixture>
  <action>
1. Declare code freeze. The operator stops merging any non-emergency PRs to `main`. The most recent `main` SHA at freeze is the start anchor.
2. Capture the freeze SHA + UTC timestamp:
   `git -C /Users/karstenhaldan/minisite/leanshot log -1 --format='%H %cI' origin/main` → record output.
3. Create `70-07-WATCH-DASHBOARD.md` adjacent to this PLAN with the following sections:
   - "Code freeze" — SHA, UTC timestamp, expected window end (= freeze ts + 48h)
   - "Hour 0 / 6 / 12 / 18 / 24 / 30 / 36 / 42 / 48 snapshots" — 9 slots, each with subsections for Sentry / PostHog / Better Stack / CI / Lighthouse
   - "Incidents" — table for any P1 / regression
4. Commit the dashboard file with message `docs(70-07): open 48h regression watch — &lt;short-sha&gt;`.
5. Set a reminder/calendar entry for the window end timestamp.
  </action>
  <acceptance_criteria>
    - freeze SHA + UTC timestamp captured
    - 70-07-WATCH-DASHBOARD.md created + committed
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/regression-watch/S01-code-freeze-snapshot/freeze-sha.txt
  </acceptance_criteria>
  <defer_clause>Cannot defer. This is the entry point of the watch window.</defer_clause>
</task>

<task id="07-S02" name="Signal — Playwright e2e suite 100% pass on main (continuous)">
  <type>verification</type>
  <signal_id>regression-watch-S02-playwright-e2e-green</signal_id>
  <criticality>critical</criticality>
  <fixture>regression</fixture>
  <read_first>
    - .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-CONTEXT.md §Decisions Area 4
  </read_first>
  <action>
1. Each CI run on `main` triggers the Playwright e2e suite (per Phase 67 CI config). The watch threshold: 100% pass across ≥2 runs separated by ≥24h within the window.
2. Capture the GitHub Actions URL for the most recent main-branch e2e run:
   `gh run list --workflow="e2e.yml" --branch=main --limit=5 --json status,conclusion,databaseId,url,headSha,createdAt | jq`
3. Confirm conclusion='success' for the post-freeze runs.
4. If any run fails: classify whether it's a regression vs an infra flake. Regression → halts the window + resets timer. Flake → retrigger + document.
5. At hour 48, paste the final 2-3 run URLs into the watch dashboard.
  </action>
  <acceptance_criteria>
    - ≥2 e2e runs on main during the 48h window, both green
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/regression-watch/S02-playwright-e2e-green/run-urls.txt
  </acceptance_criteria>
  <defer_clause>Cannot defer. UAT-05 threshold.</defer_clause>
</task>

<task id="07-S03" name="Signal — Deno test sweep 100% pass on main (continuous)">
  <type>verification</type>
  <signal_id>regression-watch-S03-deno-test-sweep-green</signal_id>
  <criticality>critical</criticality>
  <fixture>regression</fixture>
  <read_first>
    - .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-CONTEXT.md §Decisions Area 4
  </read_first>
  <action>
1. Each push to `main` triggers Deno test sweep across all Edge Fns. Local cross-Fn smoke also runnable:
   `$HOME/.deno/bin/deno test --no-check supabase/functions/`
2. Capture GH Actions URL for the latest main Deno test-sweep workflow:
   `gh run list --workflow="deno-test.yml" --branch=main --limit=5 --json conclusion,url,headSha,createdAt | jq`
3. Confirm 100% pass. ≥2 runs within the 48h window.
4. If failure: triage per S02 rules.
  </action>
  <acceptance_criteria>
    - ≥2 Deno sweep runs on main during 48h window, both green
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/regression-watch/S03-deno-test-sweep-green/run-urls.txt
  </acceptance_criteria>
  <defer_clause>Cannot defer.</defer_clause>
</task>

<task id="07-S04" name="Signal — axe-CI 0 new violations (continuous)">
  <type>verification</type>
  <signal_id>regression-watch-S04-axe-ci-no-new-violations</signal_id>
  <criticality>critical</criticality>
  <fixture>regression</fixture>
  <action>
1. Each PR + main push runs axe-CI. Threshold: 0 NEW violations vs existing baseline (per CONTEXT.md Area 4 wording "existing baseline OK").
2. Capture axe-CI summary from the latest main run:
   `gh run list --workflow="axe-ci.yml" --branch=main --limit=5 --json conclusion,url`
3. Confirm summary shows 0 net-new violations.
  </action>
  <acceptance_criteria>
    - 0 net-new axe violations across the window
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/regression-watch/S04-axe-ci-no-new-violations/
  </acceptance_criteria>
  <defer_clause>Cannot defer.</defer_clause>
</task>

<task id="07-S05" name="Signal — Edge Fn /healthz 10/10 (continuous)">
  <type>verification</type>
  <signal_id>regression-watch-S05-edge-fn-healthz-10-of-10</signal_id>
  <criticality>critical</criticality>
  <fixture>regression</fixture>
  <read_first>
    - .planning/phases/69.7-vercel-supabase-build-deploy-verification/69.7-SUMMARY.md
  </read_first>
  <action>
1. Run the smoke script every ~6h (Phase 69.7 ships `scripts/smoke-edge-fns.sh` per CONTEXT.md):
   `cd /Users/karstenhaldan/minisite/leanshot && bash scripts/smoke-edge-fns.sh`
2. Confirm 10/10 Fns return HTTP 200 + `{ok:true, fn:"<name>"}` from /healthz with the anon-key Authorization header (per `reference_supabase_edge_fn_jwt_gateway_healthz`).
3. Paste output into the watch dashboard at each ~6h snapshot.
4. If any healthz flips to non-200: classify (deploy regression vs vendor-cascading-issue) + record in Incidents.
  </action>
  <acceptance_criteria>
    - ≥8 ~6h snapshots over the window, all 10/10 (every snapshot)
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/regression-watch/S05-edge-fn-healthz-10-of-10/snapshots-h0..h48.txt
  </acceptance_criteria>
  <defer_clause>Cannot defer.</defer_clause>
</task>

<task id="07-S06" name="Signal — Sentry P1 = 0 (continuous)">
  <type>verification</type>
  <signal_id>regression-watch-S06-sentry-p1-zero</signal_id>
  <criticality>critical</criticality>
  <fixture>regression</fixture>
  <action>
1. Sign in to Sentry → LeanShot project → Issues. Filter: `is:unresolved level:fatal` OR `is:unresolved level:error events:&gt;10` (per Phase 67 P1 definition; adjust to actual config).
2. Confirm 0 issues match.
3. Capture Sentry dashboard screenshot at each ~6h snapshot — paste into watch dashboard.
4. Sentry P1 page (https://sentry.io/leanshot/health) — confirm all sources green.
5. If a P1 fires: triage immediately. If genuine regression → window resets to incident commit. If false positive → suppress + document.
  </action>
  <acceptance_criteria>
    - 0 P1 issues across the full window
    - all Sentry health sources green
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/regression-watch/S06-sentry-p1-zero/ — screenshots
  </acceptance_criteria>
  <defer_clause>Cannot defer.</defer_clause>
</task>

<task id="07-S07" name="Signal — PostHog funnel-break alert dormant (continuous)">
  <type>verification</type>
  <signal_id>regression-watch-S07-posthog-funnel-no-break</signal_id>
  <criticality>critical</criticality>
  <fixture>regression</fixture>
  <action>
1. Sign in to PostHog → Alerts → confirm the funnel-break alert (Plan 06 S03 setup) is in "OK" state continuously across the window.
2. Check PostHog → Insights → main launch funnel (signup → activation → first-dose) → spot-check conversion rates remain within expected band (no sudden drops).
3. ~6h snapshots: capture funnel chart screenshot + paste into watch dashboard.
4. If alert fires: P1 — investigate + log in Incidents.
  </action>
  <acceptance_criteria>
    - alert remains OK across full window
    - funnel conversion stable
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/regression-watch/S07-posthog-funnel-no-break/
  </acceptance_criteria>
  <defer_clause>Cannot defer.</defer_clause>
</task>

<task id="07-S08" name="Signal — Better Stack uptime green (continuous)">
  <type>verification</type>
  <signal_id>regression-watch-S08-better-stack-uptime-green</signal_id>
  <criticality>critical</criticality>
  <fixture>regression</fixture>
  <read_first>
    - Plan 01 S12 (BETTER_STACK_API_KEY)
  </read_first>
  <action>
1. Sign in to Better Stack → Uptime → confirm all monitors green continuously.
2. Capture dashboard screenshot at each ~6h snapshot.
3. Any monitor flip to RED: P1 — investigate.
4. Also: confirm bs-status-poller Edge Fn is reporting in (Plan 01 S12 dependency).
  </action>
  <acceptance_criteria>
    - all Better Stack monitors green across window
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/regression-watch/S08-better-stack-uptime-green/
  </acceptance_criteria>
  <defer_clause>Cannot defer.</defer_clause>
</task>

<task id="07-S09" name="Signal — Lighthouse mobile ≥90 re-run within window">
  <type>verification</type>
  <signal_id>regression-watch-S09-lighthouse-mobile-min-90-watch-window</signal_id>
  <criticality>critical</criticality>
  <fixture>regression</fixture>
  <action>
1. At hour 24 + hour 48, re-run Lighthouse on the 3 audience landing pages (`/patients`, `/doctors`, `/clinics`):
   `for path in /patients /doctors /clinics; do npx lighthouse "https://&lt;staging&gt;${path}" --preset=mobile --quiet --output=json --output-path="evidence/regression-watch/S09-lighthouse-mobile-min-90-watch-window/h${HOUR}-${path//\//-}.json"; done`
2. Confirm all 4 categories ≥ 90 at both hour 24 + hour 48 captures.
3. Compare to Plan 03 S19 capture (the freeze-time baseline) — should be stable or improved.
  </action>
  <acceptance_criteria>
    - hour 24 + hour 48 reports both ≥ 90 across 4 categories
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/regression-watch/S09-lighthouse-mobile-min-90-watch-window/ — 6 JSON reports
  </acceptance_criteria>
  <defer_clause>Cannot defer.</defer_clause>
</task>

<task id="07-S10" name="Signal — 48h window elapsed cleanly + final dashboard committed">
  <type>verification</type>
  <signal_id>regression-watch-S10-48h-window-elapsed</signal_id>
  <criticality>critical</criticality>
  <fixture>regression</fixture>
  <action>
1. At freeze ts + 48h (assuming no timer reset), capture the final state of every gate above + paste into the watch dashboard "Hour 48 snapshot" section.
2. Run a final integrated sweep:
   - `bash scripts/smoke-edge-fns.sh` → 10/10
   - `gh run list --branch=main --limit=10 --json conclusion,workflowName | jq '.[] | select(.conclusion=="failure")' | wc -l` → 0
   - Sentry P1 count: 0
   - Better Stack: all green
   - PostHog funnel-break alert: OK
3. Update the watch dashboard with: "Window closed at &lt;UTC timestamp&gt;. Status: GREEN — ready for go decision."
4. Commit the final dashboard:
   `git add .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-07-WATCH-DASHBOARD.md && git commit -m "docs(70-07): close 48h regression watch — GREEN at &lt;sha&gt;"`
  </action>
  <acceptance_criteria>
    - 48h elapsed without any gate going red
    - final dashboard committed
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/regression-watch/S10-48h-window-elapsed/window-closed.txt with git SHA of close commit
  </acceptance_criteria>
  <defer_clause>
    Cannot defer. If timer reset, restart from S01 with the new freeze ts. Plan 08 final-signoff cannot proceed until this signal completes.
  </defer_clause>
</task>

<task id="07-S11" name="Signal — Evidence directory bootstrap">
  <type>verification</type>
  <signal_id>regression-watch-S11-evidence-bootstrap</signal_id>
  <criticality>non-critical</criticality>
  <fixture>cli</fixture>
  <action>
1. `mkdir -p .planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/regression-watch/`
2. Create S01..S10 subdirs.
3. Confirm `gh` CLI is authenticated: `gh auth status`.
  </action>
  <acceptance_criteria>
    - evidence dirs exist
    - gh auth works
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
  </acceptance_criteria>
  <defer_clause>Non-critical bootstrap.</defer_clause>
</task>

</tasks>

<verification>
End-of-plan: 48h elapsed cleanly; `70-07-WATCH-DASHBOARD.md` exists with 9 snapshot blocks (h0/h6/h12/.../h48) all filled in; final dashboard committed; UAT-05 threshold met.
</verification>

<success_criteria>
- All 9 critical signals signed off (S01-S10 minus the bootstrap S11).
- S11 bootstrap signed.
- Evidence under `evidence/regression-watch/`.
- `70-07-WATCH-DASHBOARD.md` is committed with full window log.
</success_criteria>

## Resume State

- [ ] **S01** — Code-freeze SHA + window open — signoff: __________
- [ ] **S02** — Playwright e2e green (≥2 runs) — signoff: __________
- [ ] **S03** — Deno test sweep green (≥2 runs) — signoff: __________
- [ ] **S04** — axe-CI 0 new violations — signoff: __________
- [ ] **S05** — Edge Fn /healthz 10/10 (≥8 snapshots) — signoff: __________
- [ ] **S06** — Sentry P1 = 0 across window — signoff: __________
- [ ] **S07** — PostHog funnel-break alert dormant — signoff: __________
- [ ] **S08** — Better Stack uptime green — signoff: __________
- [ ] **S09** — Lighthouse mobile ≥90 (h24 + h48) — signoff: __________
- [ ] **S10** — 48h window closed GREEN — signoff: __________
- [ ] **S11** — Evidence dir bootstrap — signoff: __________

## Composite Approval

| Disposition | Meaning |
|-------------|---------|
| `approved` | All 11 signals green; window closed clean |
| `approved — non-criticals-deferred` | Not applicable — all 10 functional signals are critical |
| `blocked: <reason>` | Any gate flipped during the window; restart from S01 |

<output>
Update PLAN.md inline + maintain `70-07-WATCH-DASHBOARD.md` continuously. Plan 08 final-signoff CANNOT issue go until S10 closes GREEN.
</output>
