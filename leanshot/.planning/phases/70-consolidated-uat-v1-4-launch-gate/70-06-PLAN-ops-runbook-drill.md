---
plan: "70-06-ops-runbook-drill"
phase: "70"
wave: 0
depends_on: []
autonomous: false
type: execute
requirements:
  - UAT-03
files_modified:
  - .planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/ops-runbook-drill/**
  - .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-06-PLAN-ops-runbook-drill.md
fixture_group: "ops-runbook-drill"
estimated_duration: "3-4 hours operator time (PITR restore is the long-pole — full snapshot restore can take 30-90 min)"
must_haves:
  - "ops-runbook-drill-S01-pitr-restore-drill-evidence"
  - "ops-runbook-drill-S02-ddos-k6-load-test-review"
  - "ops-runbook-drill-S03-funnel-break-alert-fires"
  - "ops-runbook-drill-S04-mfa-brute-force-lockout-on-6th"
  - "ops-runbook-drill-S05-k-anonymity-enforcement-cohort-suppress"
  - "ops-runbook-drill-S06-admin-2fa-enforcement"
---

<objective>
Plan 06 — Ops runbook drill. All operational + security drills that prove the v1.4 ops runbooks (Phase 67) actually work end-to-end + the security guards (Phase 66, Phase 62) fire as designed: Point-in-time-restore (PITR) drill against a test snapshot (Phase 67), DDoS k6 load-test results review (Phase 67), funnel-break alert fires on synthetic traffic drop (Phase 67), MFA brute-force lockout fires on 6th failed attempt (Phase 66), demo-org auto-purge ≤7d (Phase 68 — also covered in Plan 03 S16 but ops-side here), k-anonymity-enforcement enforcement (Phase 62 — cohort <5 returns suppressed), admin 2FA enforcement (Phase 23 + 32 legacy + Phase 66 consumer-side parity), traffic-recorder env signal (Phase 67).

These are operational drills — operator-driven CLI + Supabase Dashboard + observability stack interactions. Most signals require active Sentry + PostHog + Better Stack accounts (Plan 01 S12).

Purpose: UAT-03 (Phase 66 MFA brute-force, Phase 67 PITR + DDoS + funnel-break, Phase 62 k-anonymity, Phase 68 demo-org-purge) coverage.

Output: signoff checkboxes filled inline + screenshot evidence of dashboards + CLI outputs + alert webhook payloads committed to `evidence/ops-runbook-drill/<signal-slug>/`.
</objective>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/70-consolidated-uat-v1-4-launch-gate/70-CONTEXT.md
@.planning/phases/67-operational-runbooks-observability/67-SUMMARY.md

**Prereqs:** Plan 01 S12 (Better Stack API key) for funnel-break alert visibility. PITR drill can run against a test branch project to avoid impacting prod.
</context>

<tasks>

<task id="06-S01" name="Signal — PITR restore drill (Phase 67)">
  <type>verification</type>
  <signal_id>ops-runbook-drill-S01-pitr-restore-drill-evidence</signal_id>
  <criticality>critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/phases/67-operational-runbooks-observability/67-SUMMARY.md
    - .planning/phases/67-operational-runbooks-observability/67-CARRY-OVER.md
  </read_first>
  <action>
1. Create a Supabase test branch (or use a sacrificial project) to avoid restoring against production: Supabase Dashboard → ytnsipxxmzgaebkqmokp → Branches → "Create branch" (named `pitr-drill`).
2. **Snapshot the current state**: capture row count of a witness table at a known timestamp:
   `supabase db query --linked "SELECT COUNT(*) FROM public.injections WHERE recorded_at &lt; '2026-05-27T12:00:00Z';"` → record output.
3. **Perform a destructive change** on the test branch (NOT prod): e.g. `DELETE FROM public.injections WHERE recorded_at &gt; now() - interval '1 hour';`. Record row-count delta.
4. **Restore via PITR** on the test branch to the timestamp captured in step 2: Supabase Dashboard → branches → pitr-drill → Database → PITR Restore → pick the timestamp → confirm.
5. Wait for restore to complete (typically 5-30 minutes depending on DB size). Confirm via Dashboard banner "Restore complete".
6. Re-run the witness query → confirm row count matches the pre-destruction count.
7. **Capture evidence**: timing data (restore-start ts, restore-complete ts, total elapsed), screenshots of the restore UI, witness-table count before + after.
8. Document in `evidence/ops-runbook-drill/S01-pitr-restore-drill-evidence/PITR-DRILL.md` as a runbook checklist with timings — this artifact becomes the v1.4 launch ops record.
  </action>
  <acceptance_criteria>
    - PITR restore completes successfully on test branch
    - witness table count restored to expected value
    - end-to-end elapsed time documented (sets RTO baseline)
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/ops-runbook-drill/S01-pitr-restore-drill-evidence/PITR-DRILL.md + screenshots
  </acceptance_criteria>
  <defer_clause>Cannot defer. PITR drill is CONTEXT.md Area 1 critical-gate (compliance + DR posture).</defer_clause>
</task>

<task id="06-S02" name="Signal — DDoS k6 load-test results review (Phase 67)">
  <type>verification</type>
  <signal_id>ops-runbook-drill-S02-ddos-k6-load-test-review</signal_id>
  <criticality>non-critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/phases/67-operational-runbooks-observability/
  </read_first>
  <action>
1. Locate the Phase 67 k6 load-test script(s): `scripts/load-tests/` or `tests/load/` per Phase 67 ship.
2. Run the script against staging at moderate intensity (NOT against production):
   `k6 run --vus 100 --duration 60s scripts/load-tests/edge-fn-spike.js`
3. Review k6 output: p95 latency, error rate, RPS achieved. Confirm:
   - p95 &lt; 1000ms for /healthz endpoints
   - error rate &lt; 1%
   - no Supabase rate-limiting kicks
4. Cross-check Sentry during the run: confirm no spike in P1 errors. PostHog: confirm event ingestion kept up.
5. Document results in `evidence/ops-runbook-drill/S02-ddos-k6-load-test-review/LOAD-TEST-RUN.md`.
6. If Phase 67 ship includes a higher-intensity "DDoS simulation" config — note this v1.4 is review-only (don't actually DDoS the staging URL unless coordinated with Vercel + Supabase support; defer the higher-intensity run to post-launch when SRE process is in place).
  </action>
  <acceptance_criteria>
    - k6 run completes with p95 &lt; 1000ms + error rate &lt; 1%
    - no Sentry P1 spike during run
    - results documented
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/ops-runbook-drill/S02-ddos-k6-load-test-review/LOAD-TEST-RUN.md
  </acceptance_criteria>
  <defer_clause>
    Defer-OK if k6 not locally installed; review the Phase 67 baseline results in lieu of re-running.
  </defer_clause>
</task>

<task id="06-S03" name="Signal — Funnel-break alert fires on test traffic drop (Phase 67)">
  <type>verification</type>
  <signal_id>ops-runbook-drill-S03-funnel-break-alert-fires</signal_id>
  <criticality>critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/phases/67-operational-runbooks-observability/
  </read_first>
  <action>
1. Identify the Phase 67 funnel-break alert config (likely in PostHog Alerts or a custom HogQL-driven alert). Confirm it exists and is enabled: PostHog → Alerts → search "funnel break" → enabled, threshold defined (e.g. "Sign-up → activation conversion drops below 10% over a 15-min window").
2. **Synthesize a traffic drop**: temporarily suppress the funnel by either:
   - (a) injecting a synthetic burst of "started signup but bounced" events via the PostHog API, OR
   - (b) sending a high volume of bot-like start events without follow-through.
   Use the PostHog API with a test project token to avoid polluting production data — or run on a dedicated funnel-break-test funnel.
3. Wait the alert evaluation window (15 min if that's the config).
4. Confirm alert fires: check the configured Slack channel + email + Better Stack (per Phase 67 fan-out). Capture screenshots of alert delivery in each channel.
5. Snooze/silence the alert post-drill to avoid noise.
  </action>
  <acceptance_criteria>
    - alert fires within the configured evaluation window
    - notification arrives in at least one configured channel
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/ops-runbook-drill/S03-funnel-break-alert-fires/
  </acceptance_criteria>
  <defer_clause>Cannot defer. Phase 67 funnel-break alert is CONTEXT.md Area 1 critical-gate.</defer_clause>
</task>

<task id="06-S04" name="Signal — MFA brute-force lockout fires on 6th failed attempt (Phase 66)">
  <type>verification</type>
  <signal_id>ops-runbook-drill-S04-mfa-brute-force-lockout-on-6th</signal_id>
  <criticality>critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/phases/66-consumer-account-security/
  </read_first>
  <action>
1. Sign in as a test user → Settings → Security → "Enable two-factor authentication (TOTP)". Set up TOTP via Google Authenticator or similar.
2. Sign out. Sign in with email + password → MFA challenge screen appears.
3. **Enter 5 wrong TOTP codes** in sequence (`000000`, `111111`, etc.). Each should be rejected with "Invalid code".
4. **Enter a 6th wrong code**. Confirm the response is now: "Too many failed attempts. Account locked for 15 minutes." (or equivalent lockout language per Phase 66 spec).
5. Confirm `auth_rate_limit_log` row inserted:
   `supabase db query --linked "SELECT user_id, event_type, count, locked_until FROM public.auth_rate_limit_log WHERE user_id='&lt;test-user&gt;' ORDER BY created_at DESC LIMIT 1;"`
   Expected: event_type='mfa_brute_force_lockout', count ≥ 6, locked_until set to 15 minutes from now.
6. Wait 15 min (or fast-forward locked_until via SQL update for testing) → confirm next sign-in attempt succeeds with the correct TOTP code.
7. Capture screenshots of each step.
  </action>
  <acceptance_criteria>
    - lockout fires on 6th failed attempt
    - auth_rate_limit_log row populated
    - lock clears after 15 minutes
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/ops-runbook-drill/S04-mfa-brute-force-lockout-on-6th/
  </acceptance_criteria>
  <defer_clause>Cannot defer. Consumer MFA brute-force-lockout is CONTEXT.md Area 1 critical-gate.</defer_clause>
</task>

<task id="06-S05" name="Signal — k-anonymity-enforcement cohort suppression (Phase 62)">
  <type>verification</type>
  <signal_id>ops-runbook-drill-S05-k-anonymity-enforcement-cohort-suppress</signal_id>
  <criticality>critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/phases/62-insights-research-engine/
  </read_first>
  <action>
1. From admin → /admin/insights/new (or direct API call to the Insights query endpoint). Run a cohort query that selects fewer than 5 users:
   `select * from rpc_insights_cohort_query(filter := '{"age_min": 95, "state": "WY"}'::jsonb);`
   Expected: returns suppressed marker (e.g. `{ suppressed: true, reason: 'cohort_lt_5' }`) — NOT actual rows.
2. Run a cohort query that selects ≥ 5 users:
   `select * from rpc_insights_cohort_query(filter := '{"goal_type": "weight_loss"}'::jsonb);`
   Expected: returns aggregated data (count, means, distributions) with NO individual user PII.
3. Confirm RLS prevents direct access to underlying tables for non-admin users:
   `curl -H "Authorization: Bearer &lt;non-admin-jwt&gt;" "https://ytnsipxxmzgaebkqmokp.supabase.co/rest/v1/insights_cohort_query?select=*"`
   Expected: 401/403 or empty.
4. Capture all 3 outputs in evidence.
  </action>
  <acceptance_criteria>
    - cohort &lt; 5 suppressed at RPC level
    - cohort ≥ 5 aggregated without PII
    - non-admin cannot bypass via direct table access
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/ops-runbook-drill/S05-k-anonymity-enforcement-cohort-suppress/
  </acceptance_criteria>
  <defer_clause>Cannot defer. K-anonymity is a privacy compliance guard.</defer_clause>
</task>

<task id="06-S06" name="Signal — Admin 2FA enforcement (Phase 23/32 legacy + Phase 66 parity)">
  <type>verification</type>
  <signal_id>ops-runbook-drill-S06-admin-2fa-enforcement</signal_id>
  <criticality>non-critical</criticality>
  <fixture>browser</fixture>
  <read_first>
    - .planning/phases/66-consumer-account-security/
  </read_first>
  <action>
1. Sign in as admin → /admin/profile or Settings → confirm "Two-factor authentication" status. If not enabled, enable it (admin role MUST have 2FA per Phase 23/32 legacy + Phase 66 enforcement).
2. Sign out → sign in as admin → confirm MFA challenge is REQUIRED, not optional (no skip button).
3. Try to access /admin/* surfaces with an admin session that has 2FA disabled (you may need to set this up via SQL on a test admin user): confirm a redirect to "Enroll 2FA before continuing" page (per Phase 66 enforcement).
4. Capture screenshots of: enforcement banner, MFA-required sign-in, redirect-to-enroll for non-2FA admin.
  </action>
  <acceptance_criteria>
    - admin 2FA is mandatory at sign-in
    - admin without 2FA is redirected to enroll
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/ops-runbook-drill/S06-admin-2fa-enforcement/
  </acceptance_criteria>
  <defer_clause>Defer-OK if Phase 66 enforcement landed for consumer-only in this milestone with admin enforcement carried to v1.5.</defer_clause>
</task>

<task id="06-S07" name="Signal — Traffic-recorder env signal (Phase 67)">
  <type>verification</type>
  <signal_id>ops-runbook-drill-S07-traffic-recorder-env-signal</signal_id>
  <criticality>non-critical</criticality>
  <fixture>cli</fixture>
  <action>
1. Confirm Phase 67 traffic recorder env signal: `vercel env ls production | grep -i traffic`. Set if missing.
2. Generate a small burst of requests against staging (10 GETs to /healthz).
3. Check the recorder log (likely Sentry breadcrumb stream, or a dedicated Logflare/Better Stack source per Phase 67): confirm 10 recorded events match the burst.
4. Document.
  </action>
  <acceptance_criteria>
    - env signal present
    - recorder log shows the synthetic burst
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/ops-runbook-drill/S07-traffic-recorder-env-signal/
  </acceptance_criteria>
  <defer_clause>Defer-OK if traffic recorder is post-launch-only.</defer_clause>
</task>

<task id="06-S08" name="Signal — Demo-org auto-purge cron functional (Phase 68, ops-side)">
  <type>verification</type>
  <signal_id>ops-runbook-drill-S08-demo-org-auto-purge-cron</signal_id>
  <criticality>non-critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/phases/68-audience-landing-sales-enablement/
  </read_first>
  <action>
1. Check cron registration for demo-org-purge:
   `supabase db query --linked "SELECT jobname, schedule, command FROM cron.job WHERE command ILIKE '%demo-org-purge%';"`
2. Confirm a recent cron run executed (after Plan 03 S16 manual trigger if not yet scheduled-fired):
   `supabase db query --linked "SELECT * FROM cron.job_run_details WHERE jobid IN (SELECT jobid FROM cron.job WHERE command ILIKE '%demo-org-purge%') ORDER BY start_time DESC LIMIT 5;"`
3. Sanity: same as Plan 03 S16 demonstration, but here confirmed at cron-level (not manual invocation).
  </action>
  <acceptance_criteria>
    - cron.job entry exists
    - at least one cron.job_run_details row from the last 24h
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/ops-runbook-drill/S08-demo-org-auto-purge-cron/
  </acceptance_criteria>
  <defer_clause>Defer-OK if cron has not yet self-fired but manual trigger worked.</defer_clause>
</task>

<task id="06-S09" name="Signal — Evidence directory bootstrap">
  <type>verification</type>
  <signal_id>ops-runbook-drill-S09-evidence-bootstrap</signal_id>
  <criticality>non-critical</criticality>
  <fixture>cli</fixture>
  <action>
1. `mkdir -p .planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/ops-runbook-drill/`
2. Create S01..S08 subdirs.
  </action>
  <acceptance_criteria>
    - evidence dirs exist
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
  </acceptance_criteria>
  <defer_clause>Non-critical bootstrap.</defer_clause>
</task>

</tasks>

<verification>
End-of-plan: every critical signal signed off; PITR + funnel-break + MFA-lockout + k-anonymity all proven end-to-end.
</verification>

<success_criteria>
- All 4 critical signals signed off (S01, S03, S04, S05).
- Non-critical signals (S02, S06, S07, S08, S09) signed OR `defer:<reason>`.
- Evidence under `evidence/ops-runbook-drill/`.
</success_criteria>

## Resume State

- [ ] **S01** — PITR restore drill — signoff: __________
- [ ] **S02** — DDoS k6 load-test review (non-critical) — signoff: __________
- [ ] **S03** — Funnel-break alert fires — signoff: __________
- [ ] **S04** — MFA brute-force lockout on 6th attempt — signoff: __________
- [ ] **S05** — k-anonymity-enforcement cohort suppress — signoff: __________
- [ ] **S06** — Admin 2FA enforcement (non-critical) — signoff: __________
- [ ] **S07** — Traffic-recorder env signal (non-critical) — signoff: __________
- [ ] **S08** — Demo-org auto-purge cron (non-critical) — signoff: __________
- [ ] **S09** — Evidence dir bootstrap — signoff: __________

## Composite Approval

| Disposition | Meaning |
|-------------|---------|
| `approved` | All 9 signals green |
| `approved — non-criticals-deferred` | 4 critical signals green; non-criticals deferred |
| `blocked: <reason>` | Any critical signal cannot land |

<output>
Update PLAN.md inline. Plan 08 aggregates this file's checkbox state.
</output>
