---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Platform Expansion
status: verifying
stopped_at: Phase 31 planning complete (8 plans, plan-checker iter-2 PASSED)
last_updated: "2026-05-18T08:13:25.337Z"
last_activity: 2026-05-18
progress:
  total_phases: 27
  completed_phases: 4
  total_plans: 62
  completed_plans: 35
  percent: 15
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-17 for v1.3 milestone)

**Core value:** Drug-level projection + injection-site rotation are the headline; everything else feeds context into that picture or interprets it.
**Current focus:** Phase 24 — Foundation — Modular Admin Shell + Event Taxonomy + Server-side PostHog

## Current Position

Phase: 30 — COMPLETE
Plan: 6 of 6 (ALL COMPLETE — Phase 30 EXECUTED)
Status: Phase complete — ready for verification
Last activity: 2026-05-18

### v1.3 milestone open (2026-05-17)

26 phases (numbered 24-49, continuing from v1.2). Granularity `fine`, mode `yolo`. 204 REQ-IDs across 24 workstreams. Synthesized research at `.planning/research/SUMMARY.md` (HIGH confidence, 8 open questions resolved at plan-phase).

**Phase ordering rationale:**

- Foundation (P24) first — load-bearing for measurement-dependent phases
- HIPAA engineering (P25) PARALLEL with vendor/legal from Wave 0
- Affiliate (P26) standalone
- Admin extensions (P27) bundled — shared infra for P28/30/34/37
- Clinic orgs (P28→29→30→31) sequential — each blocks the next
- i18n (P32) PARALLEL with clinic track
- Ad ETL (P33) after foundation
- Onboarding (P34) blocks paywall A/B (P39) — activation event lock-in
- Gamification (P35) + Review (P36) + Helpdesk (P37) — review→helpdesk routing
- Recommender (P38) blocks on HIPAA decision + SAVE (P40) for win-back
- A/B trifecta (P39) bundled
- Polish closeout (P40, P41, P42)
- M4 Community (P43→44→45→46→47→48→49) closes milestone with membership tier + feed + spaces + courses + events + moderation + search/digests

### v1.2 close (2026-05-17)

Milestone v1.2 SHIPPED 2026-05-17. 7 active phases (12-15, 19, 22-23) / 59 plans / 487 commits / +150,341 LOC. Production live at `https://leanshot.app` + `https://app.leanshot.app`. Supabase `ytnsipxxmzgaebkqmokp`: 21 v1.2 migrations + 8 Edge Fns + 51 RLS deny policies + 14 cron jobs. 5 phases (16-18, 20-21 — mobile/push/HealthKit/ads/watch) descoped to v1.4 = 44 REQs.

Progress: [██████░░░░] 56%

## Performance Metrics

**Velocity:**

- Total plans completed (v1.3): 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 24 | 0 | — | — |
| 25 | 0 | — | — |
| 26 | 0 | — | — |
| 27 | 0 | — | — |
| 28 | 0 | — | — |
| 29 | 0 | — | — |
| 30 | 0 | — | — |
| 31 | 0 | — | — |
| 32 | 0 | — | — |
| 33 | 0 | — | — |
| 34 | 0 | — | — |
| 35 | 0 | — | — |
| 36 | 0 | — | — |
| 37 | 0 | — | — |
| 38 | 0 | — | — |
| 39 | 0 | — | — |
| 40 | 0 | — | — |
| 41 | 0 | — | — |
| 42 | 0 | — | — |
| 43 | 0 | — | — |
| 44 | 0 | — | — |
| 45 | 0 | — | — |
| 46 | 0 | — | — |
| 47 | 0 | — | — |
| 48 | 0 | — | — |
| 49 | 0 | — | — |

**Recent Trend:**

- Last 5 plans: — (no plans executed in v1.3 yet)
- Trend: —

*Updated after each plan completion*
| Phase 28 P06 | 8 minutes | 2 tasks | 5 files |
| Phase 29 P00 | 8min | 3 tasks | 2 files |
| Phase 30 P00 | 90min | 4 tasks | 12 files |
| Phase 31 P00b | 6m | 3 tasks | 2 files |

## Accumulated Context

### Roadmap Evolution

- Phase 50 added (2026-05-17): Admin-Curated RAG Knowledge Base — Peptide/Topic Research Scraper Feeding AI Tips + Newsletters

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- v1.3 milestone open (2026-05-17): 26 phases at fine granularity, yolo mode; phase numbering continues from v1.2 (24-49, no reset)
- v1.3 stack additions (from `.planning/research/STACK.md`): react-i18next 15.7.4 + posthog-node 5.10.4 (Edge Fn) + pgvector + openai 6.13.0 (embeddings via AI Gateway) + @tanstack/react-query 5.x + react-table 8.x + react-virtual 3.x + react-markdown 9.x + remark-gfm + rehype-sanitize + dompurify 3.2.7 + canvas-confetti 1.9.3 + Resend Inbound + Better Stack + Meta/Google/TikTok ad SDKs + AWS SES (PHI path)
- v1.3 architecture: EXTENDS v1.2 (no rewrite); NEW org-context layer in `src/lib/org.ts`; NEW JWT `app_metadata.org_ids` claim with 336ms propagation window
- P28-00 (2026-05-17): Rename public.orgs → organizations atomically; CREATE OR REPLACE SECDEF bodies to patch audit_logs.table_name 'orgs' → 'organizations'; patch 19 files (embedded joins, field accesses, type definitions, test fixtures); 105 rows preserved.
- P28-03 (2026-05-17): Custom Access Token Hook live (supabase_auth_admin execute grant; org_ids injected at every token mint via STABLE SECDEF; p95 0.131ms on org_members_user_id_idx); ClinicWorkspaceSwitcherJwtOverlay 100ms poll/600ms ceiling/org_members probe; Spinner primitive added; 9/9 vitest pass; Playwright 3/3 skip (PLAYWRIGHT_RUN_P28=1 gate)
- v1.3 hard constraints: HIPAA BAA chain (6 vendors) + Stripe never signs BAA (PHI lint) + dual Anthropic credentials + activation event locks PAYWALL/REVIEW/RECOMMEND + page-builder canonical-link discipline + App/Play native review-prompt unconditional + i18n via `?lang=es` query (not `/es/` path)
- v1.3 bundle: 50 kB gz index hard ceiling; per-chunk ceilings declared in P24 — admin-shell 30 kB, helpdesk-widget 25 kB, i18n-runtime 15 kB, gamification-burst 8 kB, community-feed 20 kB, course-player 30 kB
- v1.3 vendor cost when HIPAA chain activates: +$1,864-4,364/mo (Supabase Team+addon $924, Vercel Pro+addon $350, Sentry Business $80, Anthropic Enterprise $500-2K, PostHog Boost optional $0-2K, AWS SES ~$10)
- [Phase ?]: OrgInviteAcceptance created inline; Playwright e2e gated on PLAYWRIGHT_RUN_P28=1; usePhiAccessLogger added for PHI audit
- P30-00 (2026-05-18): Postgres does not support ALTER MATERIALIZED VIEW ENABLE ROW LEVEL SECURITY (unsupported DDL) — use REVOKE + SECURITY DEFINER accessor functions for matview cross-tenant isolation
- P30-00 (2026-05-18): org_patient_links needed UNIQUE(org_id,patient_user_id) constraint before composite FK from org_patient_thresholds could reference it (42830 error at push time)
- P30-00 (2026-05-18): vials.name is the column name (not medication_name) per Phase 6 schema
- P30-05 (2026-05-18): clinic bundle ceiling raised 30 kB → 35 kB for Phase 30 components (ClinicianAlertsPanel + 5 siblings)
- P30-05 (2026-05-18): _is_org_clinician SECDEF pattern — bypasses org_members RLS recursion; required for any table whose RLS queries org_members role
- P30-05 (2026-05-18): Pre-validate before UPDATE when BEFORE UPDATE trigger can't fire on 0-row matches; use upsert instead
- P30-05 (2026-05-18): Inside RETURNS TABLE(col_name,...) functions, always qualify WHERE references to avoid 42702 ambiguity with output column names

### Pending Todos

None yet — roadmap just created. Phase 24 plan-phase is the next runnable.

### Blockers/Concerns

- **Phase 25 Wave-0 vendor calls (kick off immediately):** Resend BAA, Anthropic Enterprise pricing, PostHog tier decision, Supabase Team+HIPAA upgrade, Vercel HIPAA add-on, Sentry Business, Meta Ads App Review. Vendor + legal work runs PARALLEL with engineering from Wave 0; 4-8 week lead time.
- **Phase 34 activation event lock-in** is load-bearing for P39 + P36 + P38; CONTEXT.md decision MUST land before any of those plan-phase.
- **Phase 28 multi-tenant `org_id` axis** is the largest schema slab (16+ tables); cross-tenant impersonation proof test required per table.
- **Phase 33 Meta App Review (Dev → Standard tier)** has 2-4 week vendor lead time — start application during P24/25 to avoid blocking P33 entry.
- **Carry-over runner-pool quirk**: `/gsd-manager` background plan/execute dispatch still lacks the Task tool. Use foreground Claude Code session for plan-phase + execute-phase.

### v1.2 Tech Debt + v1.3-deferred (carry-over to v1.4)

Items NOT addressed in v1.3 (per user direction: v1.3 = new-features-only):

| Category | Item | Carried to |
|----------|------|-----------|
| Mobile | Phase 16 Capacitor (MOBILE-01..10 + MONEY-06, 11 REQs; 9/11 plans shipped) | v1.4 |
| Mobile | Phase 17 Push Notifications (4 REQs) | v1.4 |
| Mobile | Phase 18 HealthKit + Two-tunnel Firewall (8 REQs) | v1.4 |
| Mobile | Phase 20 Ad Network (12 REQs) | v1.4 |
| Mobile | Phase 21 Watch Apps (8 REQs) | v1.4 |
| Onboarding | P22b ON-01 onboarding revamp | now subsumed by v1.3 ONBOARD workstream (P34) — revisit at v1.4 scoping |
| Tech debt | v1.2-era Vault `service_role_key` Vendor pass + unused-check baseline drift | v1.4 |

## Quick Tasks Completed

(Carried forward from v1.2; new quick tasks tracked from v1.3 forward)

| Date | Slug | Summary |
|------|------|---------|
| 2026-05-11 | fix-focus-loop-and-console | FocusCard infinite render loop, PostHog placeholder init, deprecated mobile-web-app meta |
| 2026-05-11 | fix-insights-and-home-render-loop | InsightsTab + HomeTab infinite render loops |
| 2026-05-11 | eslint-guard-unstable-selectors | ESLint `no-restricted-syntax` rule blocking `useStore(generateInsights|pickFocus)` |
| 2026-05-11 | add-dist-marketing-to-eslint-ignores | Added `dist-marketing/**` to ESLint global ignores |

## Deferred Items

(See PROJECT.md and v1.2-MILESTONE-AUDIT.md for full deferred-items log carried over from v1.1 and v1.2.)

## Session Continuity

Last session: 2026-05-18T08:13:25.330Z
Stopped at: Phase 31 planning complete (8 plans, plan-checker iter-2 PASSED)
Resume file: None

## Phase 25 plan-phase blocker (2026-05-17)

**Blocker:** The orchestrator was invoked via `Skill(gsd-plan-phase 25 --auto --skip-ui)` inside a background-mode subagent. The plan-phase workflow needs to spawn three subagents in sequence (`gsd-phase-researcher` → `gsd-planner` → `gsd-plan-checker`), but the `Task`/`Agent` tool is not available in this subagent context (confirmed via `ToolSearch select:Task` returning no match). Per parent-prompt instructions ("Background mode: do NOT use AskUserQuestion. If blocker, write to STATE.md and stop"), workflow halted before the researcher spawn.

**State on disk:**

- `.planning/phases/25-hipaa-audit-hardening-vendor-baa-chain/25-CONTEXT.md` — present (17 decisions D-01..D-17, 18 REQs HIPAA-01..18) ✓
- `.planning/phases/25-hipaa-audit-hardening-vendor-baa-chain/25-DISCUSSION-LOG.md` — present ✓
- `25-RESEARCH.md` — NOT created
- `25-VALIDATION.md` — NOT created (needs Validation Architecture section from RESEARCH.md)
- `25-PATTERNS.md` — NOT created
- `*-PLAN.md` — NONE
- `has_research=false`, `has_plans=false`, `plan_count=0`, `phase_status=Pending`

**Pre-flight verified (workflow steps 1–4):**

- gsd-sdk init.plan-phase JSON parsed cleanly (researcher=sonnet, planner=opus, checker=sonnet)
- CONTEXT.md loaded — 17 D-XX decisions, 18 REQ-IDs (HIPAA-01..18), 3 concurrent workstreams (vendor BAA chain, engineering controls, compliance/process)
- `--skip-ui` flag honored — UI-SPEC gate (step 5.6) skips
- `nyquist_validation_enabled=true` — VALIDATION.md required after RESEARCH.md produces Validation Architecture
- Phase 24 is referenced as load-bearing prerequisite (`audit_logs`, admin shell manifest, `_shared/posthog-server.ts`, `disable_session_recording_on_url` base regex)

**Resume options for operator (run from a top-level Claude Code session, NOT from a nested subagent):**

1. **Re-invoke at top level:** `/gsd-plan-phase 25 --auto --skip-ui` — top-level Claude Code has the `Task` tool and can dispatch the researcher → planner → checker chain. This is the recommended path.

2. **Manual subagent invocation:** From a top-level session, drive the three steps individually:
   ```
   /gsd-research-phase 25            # or invoke gsd-phase-researcher directly via Task
   # then VALIDATION.md is created automatically if Research has "## Validation Architecture"
   /gsd-plan-phase 25 --skip-ui      # skips re-research because RESEARCH.md now exists
   ```

3. **Skip research (faster, lower fidelity):** `/gsd-plan-phase 25 --skip-research --skip-ui` — planner works from CONTEXT.md + REQUIREMENTS.md only. Acceptable for Phase 25 because CONTEXT.md is already dense (17 locked decisions); risk is Nyquist Dimension 8 failures at plan-checker time.

**Planner outline guidance (pre-computed during this session — saves planner one pass):**

Based on the 17 decisions + 3 concurrent workstreams in CONTEXT.md and the [[feedback_parallel_chunked_planning]] threshold (≥5 plans triggers chunked planning), Phase 25 is likely **8–10 plans across 3 waves**:

| Plan | Objective | Wave | Depends on | REQs | Key files / decisions |
|------|-----------|------|------------|------|-----------------------|
| 25-01 | `vendor_baa_chain` migration + RLS deny + nightly cron seed | 1 | — | HIPAA-12, HIPAA-13 | new migration; D-12 |
| 25-02 | `phi_access_log` migration + `log_phi_access` SECURITY DEFINER RPC + patient-side viewer route | 1 | — | HIPAA-14 | new migration; D-07, D-08 |
| 25-03 | `_shared/email-router.ts` (AWS SES via `@aws-sdk/client-sesv2` + Resend) + health-check stub | 1 | — | HIPAA-03 (D-03) | new shared module; gated per [[reference_vendor_gated_send_health_check]] |
| 25-04 | Anthropic dual-credential router in `ai-chat` Edge Fn + `_shared/anthropic-baa-allowlist.ts` BAA-scope guard + Deno test for refusal path | 1 | — | HIPAA-04, HIPAA-07 | D-13, D-14 (success criterion #1 — refusal path tested) |
| 25-05 | `scripts/lint-stripe-phi.ts` + CI workflow step + `scripts/stripe-phi-keywords.json` | 1 | — | HIPAA-08 (D-09) | success criterion #2 |
| 25-06 | `scripts/audit-sentry-mask.ts` + `scripts/sentry-mask-required-props.json` + CI step + PostHog `disable_session_recording_on_url` regex extension in `src/main.tsx` | 1 | — | HIPAA-16, HIPAA-17 | D-15, D-16; success criterion #5; coordinate with Phase 24 base regex |
| 25-07 | Clinician MFA hard-cut at `/clinic/*` (Vercel Routing Middleware extension of Phase 24 admin aal2 + patient optional-MFA Settings UI + step-up on sensitive patient actions | 2 | 25-01, P24 admin shell | HIPAA-15, HIPAA-11 | D-10, D-11 |
| 25-08 | `/admin/compliance` page (new Phase 24 admin-shell module entry) — vendor_baa_chain UI + expiry banner + subprocessor-diff feed + Drata sync status; subprocessor-diff weekly cron Edge Fn | 2 | 25-01, P24 admin shell manifest | HIPAA-01, HIPAA-12, HIPAA-13 | D-12; success criterion #3 |
| 25-09 | Written policy bundle under `/legal/hipaa/` (7 markdown files per D-06) + Drata onboarding stub + annual risk-assessment template | 3 | — (founder/process; can ship in parallel) | HIPAA-02, HIPAA-05, HIPAA-06, HIPAA-09, HIPAA-10, HIPAA-18 | D-05, D-06, D-17; vendor-gated by Drata 6wk lead time |
| 25-10 | Phase 24 coordination patch — confirm `_shared/posthog-server.ts` ownership, ensure `audit_logs` migration shipped first, extend admin role enum reuse | 1 | — (read-only verification) | (none — coordination plan) | dependency assertions; small |

Wave-1 has 7 parallel plans (25-01..06 + 25-10 verification); Wave-2 (25-07, 25-08) blocks on admin-shell + vendor_baa_chain; Wave-3 (25-09) is process/policy and can ship anytime within phase window. This shape satisfies [[feedback_parallel_chunked_planning]] — fire per-plan planners in parallel via `run_in_background` once at top level.

**Cross-cutting concerns the planner must enforce:**

- [[reference_supabase_migration_filename_regex]] — strict `<14-digit>_name.sql` (no letter suffix)
- [[reference_supabase_migration_gotchas]] — SECURITY DEFINER `set search_path = public, extensions`; RLS deny on append-only tables
- [[reference_vendor_gated_send_health_check]] — wraps 25-03 (SES) and 25-09 (Drata) for the 4–8 week vendor lead window
- [[reference_rls_fixture_gotruechient_flake]] — RLS tests for `vendor_baa_chain` and `phi_access_log` use admin.generateLink + /auth/v1/verify pattern (ES256-compat)
- Phase 24 `_shared/posthog-server.ts` and `audit_logs` migration ownership — Phase 25 plans must NOT duplicate; verify Phase 24 ships first or coordinate file-level ownership in 25-10
- Bundle ceilings (Phase 24 D-18..20) — Phase 25 adds NO new client-side chunk; `/admin/compliance` lives inside admin-shell 30 kB ceiling (per CONTEXT.md Integration Points)

**Risks the planner / checker must surface:**

- D-13/D-14 dual-credential split — secrets storage (Supabase Function secrets vs Vercel env) is "Claude's Discretion"; recommend Function secrets to keep secrets out of build pipeline
- D-09 PHI keyword list — initial 22 keywords; CI lint must false-positive-allowlist via inline `// stripe-phi-lint:allow reason='...'` comments
- Vendor BAA `signed_at` pre-stubbing — Plan 25-01 may insert rows with `status='pending'` then flip to `signed` as each of 6 vendor calls closes during Wave 0 (per "Claude's Discretion" note)
- D-08 patient PHI-access viewer in Settings — UX touch despite `--skip-ui` flag; planner should produce minimal admin-shell-style list view, not a full UI-SPEC contract

## Operator Next Steps

- **PRIMARY:** Re-invoke `/gsd-plan-phase 25 --auto --skip-ui` from a top-level Claude Code session (NOT nested under a Skill/Task) so the orchestrator can spawn researcher/planner/checker subagents.
- In PARALLEL (still owed from Phase 24 Wave 0): kick off the 6 vendor BAA calls (Supabase Team+HIPAA, Vercel HIPAA addon, Sentry Business, Anthropic Enterprise, AWS SES via AWS Artifact, PostHog tier decision) + Drata SOC 2 Type I onboarding. All have 4–8 week lead times; engineering plans 25-03/04/08/09 ship behind health-check stubs per [[reference_vendor_gated_send_health_check]] until BAA `signed_at` populated in `vendor_baa_chain`.
- Coordinate Phase 24 plan-phase first OR mark 25-10 as a verification gate before 25-08 ships, since Phase 25 reads admin-shell manifest + `_shared/posthog-server.ts` + `audit_logs` from Phase 24.
