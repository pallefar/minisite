# Phase 70: Consolidated UAT — v1.4 Launch Gate - Context

**Gathered:** 2026-05-27
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous variant; `autonomous: false` phase — execute step deferred to operator)

<domain>
## Phase Boundary

Single multi-signal HUMAN-UAT phase that rolls up every outstanding UAT signal accumulated across v1.3 carry-over + Phase 42 device-UAT + new v1.4 per-phase UAT + Phase 69 design polish UAT + full regression sweep. Per `feedback_multi_signal_human_verify_checkpoint_pattern`: N discrete approve-able signals, not one mega-signal.

**In scope:**
- 33 v1.3 carry-over HUMAN-UAT signals (from `.planning/milestones/v1.3-uat-deferred.md` — Phase 35:6, Phase 36:3, Phase 40:4, Phase 41:6, Phase 43:4, Phase 44:4, Phase 51:6)
- 5 Phase 42 device-UAT signals (axe-core CI baseline, push device smoke, dark-mode VR snapshots, PWA installability, smart notifications)
- New v1.4 per-phase UAT signals from Phases 52-69 (vendor secrets, TestFlight + Play internal, push delivery, HealthKit, ad surfaces, watch apps, ES locale, Apple OAuth, RAG citations, Protocol Creator, Insights/Research, state privacy + DMCA, Stripe Tax + dunning, MFA, PITR + DDoS + funnel alerts, audience landing + demo sandbox, design polish)
- Phase 69 design polish UAT evidence (gsd-ui-auditor final-pass + dark-mode VR diff + mobile Lighthouse ≥90)
- Phase 69.7 operator-deferred items (5 Phase-65 vendor-secret gates, VR baselines, DS gates fire on PR)
- Full regression sweep: Playwright e2e + Deno test sweep + axe-core CI + Edge Fn smoke + Sentry health-check green ≥48h

**Out of scope:**
- Any code changes — this is verification only. If a signal exposes a bug, file a blocker and route through `/gsd-debug` or open a follow-up phase.
- v1.5+ candidates (HITRUST, EHR direct integration, full M5b AI personalization)
- Apple/Google submission process beyond first-build cold-launch verification (store review is post-launch ops)

</domain>

<decisions>
## Implementation Decisions

### Ship Rule (Area 1)

- **Pass criterion** — **Severity-tiered**. Critical signals MUST pass; non-critical can ship with documented `defer:<reason>`.
  - **Critical (block ship):** vendor secrets present (all 6 missing from 69.7 + originals), Stripe Tax active, MFA enroll + AAL2 + brute-force-lockout, 48h regression sweep green, device-UAT first-build cold-launch (iOS + Android), Apple OAuth signin + private-relay activation, push delivery (web + iOS + Android), HealthKit OPT-IN flow, payment-resilience dunning, PITR restore drill evidence.
  - **Non-critical (defer-OK):** copy reviews (already pre-assessed `copy-ok` in v1.3-uat-deferred), niche browser walkthroughs (Twitter/LinkedIn/Instagram embed cards), DMCA walkthrough, Phase 69 advisory FLAGs (9 from Phase 60 + Phase 69), demo-org auto-purge timing exactness.
- **Per-signal signoff format** — Markdown checkbox + footer line `signoff: <actor>, YYYY-MM-DD, <outcome_1line>`. Mirrors `.planning/milestones/v1.3-uat-deferred.md`.
- **Rollback trigger during watch window** — Any of these halts promote and resets 48h watch: P1 Sentry alert, PostHog funnel break, axe-CI red, Edge Fn smoke fail, Playwright e2e regression, Deno test sweep regression.
- **Authoritative go-decider** — **Karsten alone** (single-founder context).

### Signal Grouping & Sequencing (Area 2)

- **Grouping** — **Environment-fixture-shared**: 8 groups matching ROADMAP "Plans: 8" hint.
  1. **Browser** — desktop Chrome/Safari/Firefox walkthroughs (admin surfaces, public knowledge hub, landing pages, e-commerce flow, embed previews)
  2. **iOS device** — TestFlight first-build, Apple OAuth + private relay, HealthKit OPT-IN, push delivery, watch app complications, Capacitor smoke
  3. **Android device** — Play internal-testing first-build, push delivery, Wear OS complication, Capacitor smoke
  4. **Stripe test** — Tax calculator across N states, 3-email dunning cadence, refund self-service, lifetime checkout (MEMBER-01), grandfathered pricing (MEMBER-02), save-offer coupon stack
  5. **Vendor-OAuth + secrets** — Apple Developer + Sign-in-with-Apple, Calendly OAuth, PostHog Personal API, AdMob/AdSense publisher, Better Stack, 6 missing 69.7 secrets, vault entries
  6. **Ops runbook drill** — PITR restore drill (Phase 67), DDoS k6 load-test review, funnel-break alert fire, MFA brute-force lockout fires on 6th attempt, demo-org auto-purge ≤7d
  7. **Regression-watch (48h)** — Playwright e2e + Deno sweep + axe-CI + Edge Fn smoke + Sentry health monitor for ≥48h post code-freeze
  8. **Final signoff + ship** — Cross-group rollup, go/no-go decision, `git tag v1.4.0-ship`, Slack #launch announcement, archive Phase 70 + milestone close
- **Plan structure** — 8 PLAN.md files, one per fixture group. Independently checkpointable. Per `feedback_multi_signal_human_verify_checkpoint_pattern`.
- **Execution ordering** — Fixture-natural (operator works through one machine/account setup at a time). Recommended sequence: 5 (vendor-OAuth + secrets) → 4 (Stripe test) → 1 (Browser) → 2 (iOS device) → 3 (Android device) → 6 (Ops drill) → 7 (Regression watch, runs in parallel with 1-6 once code-freeze hits) → 8 (Final signoff).
- **Parallelization** — Single-operator sequential. Plans are pause/resume-safe; each signal records signoff inline so a partial-completion checkpoint can survive a session restart.

### Signoff Capture & Evidence (Area 3)

- **Signoff location** — Inline checkboxes in each PLAN.md. Per-signal evidence (screenshots, logs, CLI output) committed to `.planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/<fixture-group>/<signal-slug>/`.
- **Required evidence per signal type:**
  - **Browser** — Screenshot (full page, timestamp visible in URL bar or system clock overlay).
  - **CLI** — Terminal output paste (full command + output, secrets redacted).
  - **Regression** — Green CI badge URL + Sentry "no P1" attestation (Sentry dashboard screenshot for the 48h window).
  - **Device** — Photo of physical device with timestamp visible (lock screen clock or running app showing time). For iOS: TestFlight build number in caption. For Android: Play internal-testing track + version code.
- **Signoff line format** — `signoff: karsten.haldan@gmail.com, YYYY-MM-DD, <outcome_1line>`. Outcome notes optional but encouraged when something surprising surfaces.
- **Defer-recording** — `defer:<reason>` value in checkbox row + opens GitHub issue tagged `v1.4-launch-deferral` for tracking past ship. Issue must include link back to the Phase 70 signal location.

### 48h Regression-Watch & Final Gate (Area 4)

- **Watch tooling** — Sentry P1 alerts + PostHog funnel-break alert (Phase 67 deliverable) + Better Stack uptime monitor + Edge Fn smoke schedule (every 5 min via pg_cron) + axe-CI on every PR + Playwright e2e + Deno test sweep on every push.
- **Green thresholds:**
  - 0 P1 Sentry errors during the watch window
  - Playwright e2e 100% pass on main
  - Deno test sweep 100% pass on main
  - axe-CI 0 violations introduced (existing baseline OK)
  - Sentry health page: all sources green
  - Edge Fn `/healthz` 10/10 across deployed Fns
  - Lighthouse mobile ≥90 across 3 audience landing pages
- **Watch window** — 48h rolling from last code-freeze commit. Any P1 alert during the window resets the timer to that incident commit.
- **GO issuance** — Signoff commit on `.planning/phases/70-consolidated-uat-v1-4-launch-gate/70-FINAL-SIGNOFF.md` + `git tag v1.4.0-ship` + Slack #launch announcement template (auto-built from final signoff summary).

</decisions>

<code_context>
## Existing Code Insights

**Source-of-truth artifacts (planner reads these):**

- `.planning/milestones/v1.3-uat-deferred.md` — 33 signals across Phase 35/36/40/41/43/44/51, each with explicit CLI commands, browser URLs, resume signals, current disposition. Mirror this structure into Phase 70 PLANs.
- `.planning/phases/42-*/42-CARRY-OVER.md` — 5 Phase 42 device-UAT signals.
- `.planning/phases/69.7-*/69.7-SUMMARY.md` — 5 operator-deferred items from the most recent autonomous run (stripe-tax-active, coupons-created, 6 missing secrets, vr-baselines-reviewed, ds-gates-fire-on-pr).
- `.planning/STATE.md` — current milestone position + carry-over chain.
- Per-phase deploy notes for Phases 52-69 (where they exist).

**Established UAT patterns to mirror:**
- `v1.3-uat-deferred.md` per-signal block format: `### Signal N — <name>` + CLI/browser/device steps + `Resume signal: <slug>` + Composite Approval table at bottom.
- `.planning/phases/<N>/<N>-DEPLOY-NOTES.md` for actionable runbooks.
- `.planning/milestones/v1.3-MILESTONE-AUDIT.md` for audit structure (precedent for v1.4-MILESTONE-AUDIT.md generated post-Phase 70).

**Vendor secrets verification commands** (from PROJECT.md):
```bash
vercel env ls | grep -E '^(APPLE_TEAM_ID|APPLE_BUNDLE_ID|...)'
supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep -E '^(...)'
```

**Edge Fn smoke pattern** (from Phase 69.7):
- All deployed Fns expose `/healthz` (JWT-gated; needs `Authorization: Bearer <anon_key>` + `apikey: <anon_key>` per `reference_supabase_edge_fn_jwt_gateway_healthz`).
- Smoke script in `scripts/smoke-edge-fns.sh`.

**Regression suites already wired:**
- `npm run test:e2e` — Playwright e2e on main
- `npx vitest run --config vite.config.ts` (workaround per `reference_vitest_4_projects_config_masks_default`)
- `deno test --no-check supabase/functions/` — cross-Fn sweep ($HOME/.deno/bin/deno)
- `npx jest-axe` / axe-core CI per Phase 42 baseline

</code_context>

<specifics>
## Specific Ideas

- **8 plans, one per fixture group** — see Area 2 above.
- **Mirror `v1.3-uat-deferred.md` per-signal structure** — proven, ergonomic, resumable.
- **Evidence directory layout:**
  ```
  .planning/phases/70-consolidated-uat-v1-4-launch-gate/
  ├── 70-CONTEXT.md  (this file)
  ├── 70-01-PLAN-vendor-oauth-secrets.md
  ├── 70-02-PLAN-stripe-test.md
  ├── 70-03-PLAN-browser.md
  ├── 70-04-PLAN-ios-device.md
  ├── 70-05-PLAN-android-device.md
  ├── 70-06-PLAN-ops-runbook-drill.md
  ├── 70-07-PLAN-regression-watch.md
  ├── 70-08-PLAN-final-signoff.md
  ├── 70-FINAL-SIGNOFF.md  (created at execute time by operator)
  └── evidence/
      ├── vendor-oauth-secrets/
      ├── stripe-test/
      ├── browser/
      ├── ios-device/
      ├── android-device/
      ├── ops-runbook-drill/
      └── regression-watch/
  ```
- **Critical-signal explicit list** — the planner must enumerate which signals are critical-block vs defer-OK in each plan's signoff table, not leave it ambiguous.
- **Resume contract** — every plan must end with a "Resume state" block matching v1.3-uat-deferred.md so an interrupted session can pick up at the next un-checked signal.
- **GitHub issue auto-creation script** — `scripts/uat-defer.sh <signal-slug> <reason>` opens a `v1.4-launch-deferral` tagged issue and links back to the Phase 70 file:line. Saves manual gh-cli typing.
- **48h watch dashboard** — single markdown page (`70-07-WATCH-DASHBOARD.md`) the operator pastes Sentry/PostHog/Better Stack screenshots into every 6h during the window.

</specifics>

<deferred>
## Deferred Ideas

- **Cross-org operator coordination** — multi-stakeholder ceremony / external advisor signoff. Not needed for single-founder context.
- **Press-release-grade announcement** — Slack #launch is sufficient. Defer marketing/PR to post-launch.
- **Video recording per signal** — overkill for v1.4. Photo + screenshot suffices.
- **Strict 0-warning regression baseline** — accepted 0-error / pre-existing-warning baseline matches the carry-over lint posture from Phase 69.6.
- **Manual Sentry signoff per signal** — automated 48h watch + threshold gates supersede manual per-signal Sentry checks.

</deferred>
