---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Platform Expansion
status: ready_to_plan
stopped_at: Phase 34 context gathered (4/4 gray areas locked; 20 decisions); Phase 36 + 37 + 41 + 51 plan-phase pending top-level re-invoke (runner-pool blocker)
last_updated: 2026-05-19T00:30:00Z
last_activity: 2026-05-19 -- background plan Phase 41 halted at researcher-spawn (expected, runner-pool blocker); Phase 36 + 37 + 51 also pending top-level re-invoke
progress:
  total_phases: 28
  completed_phases: 8
  total_plans: 83
  completed_plans: 77
  percent: 28
---

# Background dispatch note (2026-05-18)

`/gsd-plan-phase 51 --auto` invoked via /gsd-manager background path HALTED at executor-spawn — the documented runner-pool blocker (background Agent loses Task/Agent tool access; see memory `feedback_skill_in_background_agent_loses_tool_access` + `reference_gsd_tooling_quirks`). No plan artifacts produced. Phase 51 stays at `discussed` status. **Resolution: user re-invokes `/gsd-plan-phase 51 --auto` at TOP-LEVEL** (not via /gsd-manager dispatch) — preconditions otherwise met (CONTEXT.md present with 16 decisions; deps satisfied by Phase 33 ship 2026-05-18 + Phase 24/27/28/29/15 shipped).

# Background dispatch note (2026-05-19) — Phase 41

`/gsd-plan-phase 41 --auto` (Public Status Page + Embed-Provider Blocks) invoked via /gsd-manager background path **HALTED at researcher-spawn** — same documented runner-pool blocker as Phases 36 / 37 / 51 below. No plan artifacts produced for Phase 41. `41-CONTEXT.md` (18 decisions D-01..D-18 across two parallel workstreams) + `41-DISCUSSION-LOG.md` were already committed and remain untouched. Phase 41 stays at `Pending` status (per `gsd-sdk init.plan-phase`).

**Confirmed preconditions** (verified before halt):
- `phase_found: true`, `has_context: true`, `has_research: false`, `has_plans: false`, `plan_count: 0`, `phase_status: Pending`
- `context_path`: `.planning/phases/41-public-status-page-embed-provider-blocks/41-CONTEXT.md` (present, 18 decisions)
- `phase_req_ids`: POLISH-10, EMBED-01, EMBED-02, EMBED-03, EMBED-04, EMBED-05, EMBED-06, EMBED-07, EMBED-08 (9 requirements)
- Depends on: Phase 15 (page-builder block schema — shipped v1.2) + v1.2 Phase 22 (cookie consent — shipped); also load-bearing on P12 (CSP snapshot test + ad-free firewall — shipped), P25 (`audit_logs` schema), P37 (helpdesk KB extends embed reach — Phase 37 STILL PENDING per its own blocker), P50 (dompurify chain — shipped)
- Two parallel workstreams in one phase: Workstream A (Better Stack status page, D-01..D-06) + Workstream B (embed blocks: consent + CSP + custom-iframe security + Calendly OAuth, D-07..D-18)

**Blocker root cause:** Background-Agent runtime in this session exposes only Read/Edit/Write/Bash + MCP tools — no `Task` / `Agent` schema (confirmed via `ToolSearch select:Agent` returning no match, `ToolSearch select:Task` returning no match). `gsd-plan-phase` step 5 (spawn `gsd-phase-researcher`), step 7.8 (`gsd-pattern-mapper`), step 8 (`gsd-planner`), step 10 (`gsd-plan-checker`) all require `Agent()`. Workflow cannot proceed past step 4 (CONTEXT.md load) here. Per parent-prompt rule ("If you hit any access issue, do NOT work around it — let it fail and write the error to .planning/STATE.md as a blocker"), workflow halted before any agent spawn.

**Resolution:** User re-invokes `/gsd-plan-phase 41 --auto` at TOP-LEVEL Claude Code session (NOT via /gsd-manager background dispatch). Top-level session has the `Task`/`Agent` tools needed to dispatch researcher → pattern-mapper → planner → plan-checker chain. AUTO_CHAIN branch at step 5.6 will auto-fire `gsd-ui-phase 41 --auto` because this phase touches UI (D-08 branded placeholder card, D-10 loading skeleton, D-17 superadmin allowlist UI at `/admin/embeds/allowlist`).

**Planner outline guidance** (pre-computed during this background session — saves planner one pass):

Phase 41 splits naturally into 2 parallel workstreams per CONTEXT.md `<domain>`:

| Plan | Workstream | Objective | Wave | Depends on | REQs |
|------|------------|-----------|------|------------|------|
| 41-A1 | A — Better Stack | HUMAN-UAT: paid tier upgrade ($12/mo) + 7-component hybrid hierarchy (D-01) + Sentry/Vercel/Supabase OAuth + conservative auto-incident thresholds (D-02) + email subscriber form embed (D-03) + maintenance windows in BS admin (D-04) + CNAME `status.leanshot.app` (D-05). `autonomous: false`. | 1 | — | POLISH-10 |
| 41-B1 | B — Page Builder | Register 4 embed block types (`embed.calendly` / `embed.youtube` / `embed.tally` / `embed.custom_iframe`) in Phase 15 page-builder + shared render component for PageBuilder + Helpdesk KB renderer (EMBED-06 KB shim feature-flagged behind P37 status). | 1 | — | EMBED-01, EMBED-02, EMBED-06 |
| 41-B3 | B — CSP | Day-1 CSP enforcement per D-11/D-12: per-provider host entries in `vercel.json` + CSP snapshot test extension per P12 D-10 + Sentry CSP reporting endpoint. | 1 | — | EMBED-03, EMBED-04 |
| 41-B4 | B — Custom-iframe | `iframe_allowlist` table migration (D-14) + RLS deny + service-role insert + superadmin-only select via P27 `surfaceCheck` + server-side hostname-exact validator (D-15) + fixed sandbox `'allow-scripts allow-same-origin'` (D-16) + superadmin allowlist UI at `/admin/embeds/allowlist` (D-17, 90d audit-log retention via P25 `audit_logs`). | 1 | — | EMBED-04, EMBED-07 |
| 41-B7 | B — Cross-cutting | dompurify wiring for admin-pasted HTML (reuse P50 chain) + native `loading="lazy"` on every embed iframe + ad-free firewall verification (D-18: assert no embed block imports from `src/lib/native/ads*.ts` via grep gate). | 1 | — | EMBED-04 |
| 41-B2 | B — Consent | Cookie-consent gating + branded placeholder card (D-08) + auto-load on grant via P22 consent-state event emitter (D-09) + DS Skeleton loading state (D-10) + per-provider consent category mapping (D-07) + "Manage cookie preferences" deep-link. | 2 | 41-B1 | EMBED-04, EMBED-05 |
| 41-B5 | B — Dynamic CSP | Vercel routing middleware (or Edge Fn fallback) reads `iframe_allowlist` and injects custom-iframe hostnames at request-time per D-14 + cache invalidation when superadmin add/remove. RESEARCH must confirm middleware can mutate `Content-Security-Policy` response header on cached + non-cached routes. | 2 | 41-B4 | EMBED-04 |
| 41-B6 | B — Calendly preview | PageEditor inline Calendly preview via popup OAuth per V13-EMBED pitfall (popup NOT nested iframe) — `postMessage` origin validation + OAuth token storage shape (sessionStorage per-session) + popup-blocked error UX. | 2 | 41-B1 | EMBED-08 |

**Wave structure: 8 plans / 2 waves** (matches [[feedback_parallel_chunked_planning]] threshold of ≥5 plans → fire per-plan planners in parallel via `run_in_background`):
- Wave 1 (5 parallel): 41-A1, 41-B1, 41-B3, 41-B4, 41-B7 — independent file zones, no cross-plan collisions
- Wave 2 (3 plans): 41-B2 (needs block components from 41-B1), 41-B5 (needs `iframe_allowlist` from 41-B4), 41-B6 (needs block schema from 41-B1)

**Cross-cutting concerns the planner MUST enforce:**
- [[reference_supabase_migration_filename_regex]] — `iframe_allowlist` migration strict `<14-digits>_name.sql`
- [[reference_supabase_migration_gotchas]] — RLS deny + service-role insert + admin select via SECURITY DEFINER with `set search_path = public, extensions`
- [[reference_migration_timestamp_collision_precheck]] — pre-merge glob for `<prefix>*.sql` collisions before push (P25 lesson — `20270702*` window is now in use, allocate fresh prefix)
- [[feedback_planner_iter1_anti_patterns]] — 41-B3 (static CSP in `vercel.json`) and 41-B5 (dynamic CSP frame-src middleware) must NOT shared-file-choreograph; clear ownership: static CSP base lives in `vercel.json`, middleware ONLY APPENDS hostnames from `iframe_allowlist` to `frame-src`, never edits `vercel.json` at runtime
- [[reference_grep_gate_comment_strip]] — CSP snapshot test must strip comments before grepping for forbidden patterns
- [[reference_claude_design_bundle_landmines]] — iframe height/transition CSS gotchas relevant for D-10 loading state (split-screen height stretch + transition `var()` warnings)
- [[reference_vite_static_env_inlining]] — if any per-env CSP report endpoint URL is injected at build time, use enumerated literal keys
- Bundle ceiling — embed block components inside existing page-builder chunk (no new chunk); admin allowlist UI inside admin-shell 30 kB ceiling (per Phase 24 D-18..20)
- Phase 12 D-04 firewall — `src/lib/native/ads*.ts` eslint zone UNAFFECTED (per D-18 contract); 41-B7 verification plan adds grep gate
- Phase 37 dependency for EMBED-06 — KB renderer integration must be feature-flagged if P37 hasn't shipped at execute-time (P37 currently `Pending` per its own STATE blocker)

**Risks the planner / checker must surface:**
- D-06 HUMAN-UAT (Better Stack account upgrade + 4 OAuth integrations + 7-component config + CNAME at registrar) has founder dependency — Plan 41-A1 MUST be `autonomous: false` with explicit checkpoints; ship the engineering side behind no-op until BS account ready
- D-14 dynamic CSP injection via Vercel middleware is the trickiest seam — research must confirm Vercel routing middleware CAN mutate `Content-Security-Policy` response header on cached + non-cached routes; alternative is Edge Fn proxy. Planner's discretion locked at 41-B5 plan-write
- D-17 superadmin allowlist UI consumes Phase 27 `surfaceCheck('admin.embeds.allowlist')` — requires admin role enum extension; check Phase 27 admin-role manifest before 41-B4 plan-write
- D-15 hostname-exact match (no subdomain wildcard) is a security trade-off; planner MUST include unit test asserting `meet.example.org` does NOT match `sub.meet.example.org`
- D-16 fixed sandbox flags (no admin override) — known UX trade-off; planner MUST add explicit acceptance criterion in 41-B4 that the sandbox attribute is FROZEN (no admin UI knob in v1.3)
- EMBED-06 (helpdesk KB reach) requires Phase 37 KB article renderer to be live — Phase 37 currently `Pending` per its own STATE blocker note. Plan 41-B1 must shim the KB renderer integration behind a feature flag and not block execute
- D-09 auto-load on consent grant uses Phase 22 consent-state event emitter; planner must read Phase 22 SUMMARY.md to confirm the exact event name + payload shape before writing 41-B2
- D-11 CSP reporting endpoint — verify Sentry CSP-report ingest URL format + whether project already has CSP reporting enabled; if not, this is a Sentry project-config change (browser-only per `reference_sentry_org.md`)

## Operator Next Steps (Phase 41 plan resume)

- **PRIMARY:** Re-invoke `/gsd-plan-phase 41 --auto` from a top-level Claude Code session (NOT via /gsd-manager background dispatch). Top-level session has the `Task`/`Agent` tool and can dispatch researcher → pattern-mapper → planner → plan-checker chain. AUTO_CHAIN branch will auto-fire `gsd-ui-phase 41 --auto` at step 5.6.
- The 8-plan / 2-wave outline above can be passed to the planner as a hint, but the planner is expected to validate against CONTEXT.md + RESEARCH.md and may diverge if RESEARCH surfaces an integration constraint (e.g., Vercel middleware CSP-mutation limits forcing 41-B5 into an Edge Fn split).
- In PARALLEL (vendor work that can start immediately, no engineering dep): Better Stack paid tier signup + Sentry/Vercel/Supabase OAuth integrations + CNAME registration at registrar. These are D-06 HUMAN-UAT items that Plan 41-A1 will track but can run while plan-phase + Wave 1 execute-phase happens.
- Phase 37 status check before EMBED-06 execute — if P37 still `Pending`, ensure 41-B1 ships the KB renderer shim behind a feature flag.

---

# Background dispatch note (2026-05-19) — Phase 36

`/gsd-plan-phase 36 --auto` (M3 Review Prompt Engine - Web Only) invoked via /gsd-manager background path **HALTED at researcher-spawn** — same documented runner-pool blocker as Phase 51 + 37 below. No plan artifacts produced for Phase 36. CONTEXT.md (21 decisions D-01..D-21 across 5 areas; REVIEW-01..08 fully covered; canonical refs to Phase 24/27/34/35/37 resolved) + DISCUSSION-LOG.md were already committed and remain untouched. Phase 36 stays at `Pending` status (per `gsd-sdk init.plan-phase`).

**Confirmed preconditions** (verified before halt):
- `phase_found: true`, `has_context: true`, `has_research: false`, `has_plans: false`, `plan_count: 0`
- `context_path`: `.planning/phases/36-m3-review-prompt-engine-web-only/36-CONTEXT.md` (present)
- Depends on: Phase 24 (events.ts registry) — SHIPPED in v1.2; Phase 37 (helpdesk core) — discussed but **NOT YET PLANNED** (same blocker)
- 8 REQ-IDs ready: REVIEW-01..08
- V13-3 BLOCKER plan-checker hook required by Success Criterion #1 → planner must inject ESLint AST rule + grep backup tasks (D-03, D-04)

**Resolution:** User re-invokes `/gsd-plan-phase 36 --auto` at TOP-LEVEL (not via /gsd-manager dispatch). Top-level surfaces the Agent/Task tools needed to spawn gsd-phase-researcher, gsd-planner, and gsd-plan-checker.

**Cross-phase note:** Phase 36 D-10 + D-18 references Phase 37 D-15 (helpdesk ticket-create path); Phase 37 is also pending plan-phase (same runner-pool blocker). Consider planning Phase 37 first OR planning both at top-level in sequence — Phase 36 plans will need to grep `.planning/phases/37-*/37-*-PLAN.md` for the ticket-create Edge Fn contract.

---

# Background dispatch note (2026-05-19) — Phase 37

`/gsd-plan-phase 37 --auto` (M6 Helpdesk Core) invoked via background path **HALTED at executor-spawn** — same documented runner-pool blocker as Phase 51 above. No plan artifacts produced for Phase 37. CONTEXT.md (16 KB, 22 decisions) + DISCUSSION-LOG.md were already committed at 2026-05-19 04:58 and remain untouched. Phase 37 stays at `Pending` status (per `gsd-sdk init.plan-phase`).

**Confirmed preconditions** (verified before halt):
- `phase_status`: Pending
- `has_context`: true (`.planning/phases/37-m6-helpdesk-core/37-CONTEXT.md` — 22 decisions across PHI routing / AI assist / widget / inbound email)
- `has_research`: false, `has_plans`: false
- `phase_req_ids`: HELP-01..HELP-13 (13 requirements)
- Depends on: Phase 25 (Resend BAA decision — shipped) + Phase 27 (admin shared infra — needed to verify before execute)

**Blocker root cause:** Background-Agent runtime in this session exposes only Read/Edit/Write/Bash + MCP tools — no `Task` / `Agent` schema. `gsd-plan-phase` step 5 (spawn `gsd-phase-researcher`), step 7.8 (`gsd-pattern-mapper`), step 8 (`gsd-planner`), step 10 (`gsd-plan-checker`) all require `Agent()`. Workflow cannot proceed past step 4 (CONTEXT.md load) here.

**Resolution:** User re-invokes `/gsd-plan-phase 37 --auto` at TOP-LEVEL (not via /gsd-manager background dispatch). All other preconditions met.

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-17 for v1.3 milestone)

**Core value:** Drug-level projection + injection-site rotation are the headline; everything else feeds context into that picture or interprets it.
**Current focus:** Phase 50 — admin curated rag knowledge base peptide topic research scra

## Current Position

Phase: 50
Plan: Not started
Status: Ready to plan
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

Progress: [██████░░░░] 63%

## Performance Metrics

**Velocity:**

- Total plans completed (v1.3): 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 24 | 0 | — | — |
| 25 | 10 | - | - |
| 26 | 0 | — | — |
| 27 | 0 | — | — |
| 28 | 0 | — | — |
| 29 | 0 | — | — |
| 30 | 0 | — | — |
| 31 | 0 | — | — |
| 32 | 0 | — | — |
| 33 | 5 | - | - |
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
| Phase 31 P03 | 8 | 3 tasks | 6 files |
| Phase 31 P06 | 40min | 3 tasks | 12 files |

## Accumulated Context

### Roadmap Evolution

- Phase 50 added (2026-05-17): Admin-Curated RAG Knowledge Base — Peptide/Topic Research Scraper Feeding AI Tips + Newsletters
- Phase 51 added (2026-05-18): Full traffic + conversion tracking system + unified dashboard (UTM/source attribution, funnel analytics, ad-spend rollup) — layers on top of Phase 33 hourly ad-spend ETL to deliver an operator-facing traffic + conversion dashboard

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
- [Phase ?]: 31-03

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

Last session: 2026-05-18T17:39:13.584Z
Stopped at: Phase 51 context gathered
Resume file: .planning/phases/51-full-traffic-conversion-tracking-system-unified-dashboard-ut/51-CONTEXT.md

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

## Phase 25 execute-phase blocker (2026-05-18)

**Blocker:** The execute-phase orchestrator was invoked via `Skill(gsd-execute-phase 25)` inside a background-mode subagent. The execute-phase workflow needs to spawn 10 `gsd-executor` subagents (across 3 waves) plus a `gsd-verifier` subagent. Per `<runtime_compatibility>` in execute-phase.md, when the `Agent()`/`Task` tool is unavailable the fallback is sequential inline execution — but 10 plans (3-5 tasks each, ~35 tasks total spanning 9 migrations + 6 Edge Fns + multiple React components + 7 policy markdowns) is too large to execute inline within a single orchestrator context window. Per orchestrator parent-prompt rules ("If you hit … any access issue, do NOT work around it — let it fail and write the error to .planning/STATE.md as a blocker so the manager can surface it with resolution guidance"), workflow halted before any executor dispatch.

**Pre-flight work landed on `main` (committed + pushed; safe to resume from):**

- `83f6ba9` `docs(phase-25): begin HIPAA audit hardening phase` — STATE.md marked Phase 25 executing (via `gsd-sdk query state.begin-phase`).
- `52fc7a7` `fix(phase-25): retimestamp 9 migrations 20260519/20→20270702 to clear Phase 50 RAG collisions` — Plan 25-01 (3 migrations), 25-02 (2), 25-03 (1), 25-04 (1), 25-09 (2) had their migration timestamps `20260519000001..7` + `20260520000001..2` collide with the Phase 50 RAG migrations that already shipped on main (`rag_topics_table` through `rag_cost_ledger_table`). Per [[reference_migration_timestamp_collision_precheck]], renumbered all 9 to `20270702000001..9` (safe future window — highest existing is `20270701000012_affiliate_lifetime_recurring_cron.sql`). Plan files patched in place via `perl -i -pe`; verified zero leftover `20260519`/`20260520` references in any 25-*-PLAN.md, CONTEXT.md, or RESEARCH.md.

**Pre-flight verified (workflow steps 1–4):**

- gsd-sdk init.execute-phase JSON parsed cleanly: 10 plans, all incomplete, milestone v1.3, agents installed, runtime=claude, USE_WORKTREES=true, PARALLELIZATION=true, CONTEXT_WINDOW=200000, TDD_MODE=false, MVP_MODE=false.
- No `.continue-here.md` blocking anti-patterns in phase dir.
- No git submodules — `USE_WORKTREES_FOR_PLAN=true` for every plan.
- Local main exactly at `origin/main` after the two pre-flight commits pushed (`52fc7a7..origin/main` ↔ `52fc7a7..main`), so per [[feedback_push_origin_before_parallel_worktree_dispatch]] all worktree executors will fork from the correct base.
- Intra-wave files_modified overlap check passed for Wave 1 (6 plans: 25-01, 02, 03, 04, 05, 07) and Wave 2 (3 plans: 25-06, 08, 09) — zero shared files within either wave. Cross-wave overlaps exist (`.github/workflows/ci.yml` in 25-05/W1, 25-06/W2, 25-10/W3; `SettingsPage.tsx` in 25-02/W1, 25-08/W2) but those serialize via wave ordering as designed.

**Wave structure (from `gsd-sdk query phase-plan-index 25`):**

| Wave | Plans | Notes |
|------|-------|-------|
| 1 | 25-01, 25-02, 25-03, 25-04, 25-05, 25-07 | 25-01..04 non-autonomous (checkpoints); 25-05, 25-07 autonomous |
| 2 | 25-06, 25-08, 25-09 | 25-06 autonomous; 25-08, 25-09 non-autonomous; both 25-08/09 depend on 25-01 |
| 3 | 25-10 | Non-autonomous; depends on 25-01 + 25-09 |

**Resume options for operator (run from a top-level Claude Code session, NOT from a nested subagent):**

1. **Recommended:** Re-invoke `/gsd-execute-phase 25` from a top-level Claude Code session. Top-level Claude Code has the `Agent` tool and can dispatch 6 parallel worktree-isolated executors for Wave 1, then 3 for Wave 2, then 1 for Wave 3. All pre-flight work (timestamp fixes, STATE update, origin push) is already on main — resumption is a no-op for steps 1-4; the orchestrator will discover 10 incomplete plans and begin Wave 1 dispatch.

2. **One wave per session:** `/gsd-execute-phase 25 --wave 1`, then `--wave 2`, then `--wave 3`. Useful if the parallel-executor token budget at top level is tight or if checkpoint plans (25-01, 02, 03, 04, 08, 09, 10 — non-autonomous) need user interaction between waves.

3. **Interactive sequential:** `/gsd-execute-phase 25 --interactive` — executes plans one at a time inline (no subagents), with user checkpoints between tasks. Lower token usage per plan but takes much longer wall-clock.

**Known risks the executor / verifier must surface:**

- **Plan 25-03 SES**: AWS SES BAA must be live before any PHI email can actually send. Per [[reference_vendor_gated_send_health_check]] the plan should ship the production code path with a startup health check that no-ops with logged warning if the SES BAA capability isn't verified. PHI never reaches Resend (D-02).
- **Plan 25-04 Anthropic**: Single most testable HIPAA control. The CI test asserting 403 refusal when `anthropic_enterprise_baa` capability is missing is the verification fulcrum for HIPAA-04 SC #1 — verifier MUST grep for it.
- **Plan 25-05/06 CI lint**: Both modify `.github/workflows/ci.yml`. Wave-sequenced correctly (W1 vs W2), but verifier should grep that both `lint-stripe-phi` and `audit-sentry-mask` job steps exist after Wave 2 merges.
- **Plan 25-07 PostHog**: Per RESEARCH correction #1, `disable_session_recording_on_url` config option does NOT exist in posthog-js. The implementation must use global `disable_session_recording: true` default + programmatic `startSessionRecording()/stopSessionRecording()` driven by route changes. If the executor writes the non-existent config option, the verifier should fail the plan.
- **Plan 25-09 baa-expiry-check + subprocessor-diff Edge Fns**: Per [[reference_deno_test_discovery]] tests must be named `<name>.test.ts` (not `<name>-test.ts`). Plan frontmatter already uses the correct pattern.
- **HIPAA: PHI never lands in PostHog or Sentry.** Parent-prompt rule. Plans 25-06 (Sentry mask audit) + 25-07 (PostHog replay disable) are the two engineering enforcers. Verifier MUST check the runtime guards are wired into `src/main.tsx` / `src/App.tsx`, not just shipped as standalone scripts.

**Manifest of pre-flight state (so resumer doesn't repeat work):**

- HEAD: `52fc7a7` (pushed to origin/main).
- STATE.md frontmatter: `status: executing`, `last_activity: 2026-05-18 -- Phase 25 execution started`, `progress.completed_phases: 6`.
- ROADMAP.md Phase 25 entry: still `[ ]` (not yet checked); plans count 10/10 incomplete.
- No `*-SUMMARY.md` files in `.planning/phases/25-hipaa-audit-hardening-vendor-baa-chain/` yet.
- No worktree branches active (`git worktree list` shows main only).

## Operator Next Steps (Phase 25 execute resume)

- **PRIMARY:** Re-invoke `/gsd-execute-phase 25` from a top-level Claude Code session.
- **PARALLEL** (still owed from Phase 24/25 Wave 0): 6 vendor BAA calls (Supabase Team+HIPAA $924/mo, Vercel HIPAA addon $350/mo, Sentry Business $80/mo, Anthropic Enterprise sales call, AWS SES via AWS Artifact, PostHog Boost ~$0-2K) + Drata SOC 2 Type I onboarding. All have 4–8 week lead times. Per [[reference_hipaa_baa_vendor_matrix]] Stripe NEVER signs BAA (banking exemption) — Plan 25-05 PHI lint enforces this at CI time.
