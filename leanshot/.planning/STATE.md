---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Platform Expansion
status: executing
stopped_at: Phase 39 UI-SPEC approved
last_updated: "2026-05-22T07:27:25.697Z"
last_activity: 2026-05-22 -- Phase 39 planning complete
progress:
  total_phases: 28
  completed_phases: 12
  total_plans: 171
  completed_plans: 133
  percent: 43
---

# Background dispatch note (2026-05-19) — Phase 40

`/gsd-plan-phase 40 --auto` (Cancellation Save-Offers Flow) invoked via /gsd-manager background path **HALTED at researcher-spawn** — same documented runner-pool blocker as Phases 36 / 37 / 41 / 51 below. No PLAN.md artifacts produced for Phase 40. `40-CONTEXT.md` (22 decisions D-01..D-22) + `40-DISCUSSION-LOG.md` were already committed before this run and remain untouched. Phase 40 stays at `Pending` status (per `gsd-sdk init.plan-phase`).

**Partial progress made before halt** (preserves work the user paid for):

- **UI-SPEC.md generated + committed** at `e83b7a1` — `.planning/phases/40-cancellation-save-offers-flow/40-UI-SPEC.md`. Three surfaces:
  - **Surface 1:** Three-step Cancellation Modal (reason picklist → server-picked offer → loss-summary). Single chunked component per CONTEXT specifics.
  - **Surface 2:** Admin Save-Offer Rule Editor (`/admin/cancellation/rules`, new `AdminShell` module).
  - **Surface 3:** Admin ROI Dashboard (`/admin/cancellation/roi`, P33 admin-CAC dashboard pattern reuse).
- All 6 UI-checker dimensions self-verified PASS inline (Copywriting: specific CTAs + solution-path error states; Visuals: per-surface focal points; Color: 60/30/10 with explicit accent reserved-list; Typography: 4 sizes 13/16/18/22 / 2 weights 400/600; Spacing: all multiples of 4 with 2 justified exceptions; Registry: not applicable — custom primitives only).
- AUTO_CHAIN flag set via `gsd-sdk query config-set workflow._auto_chain_active true` before the UI-phase delegation; the parent plan-phase orchestrator should re-read this on the top-level re-invoke. (Cleanup note: this flag should be reset to `false` before the next non-auto invocation.)

**Confirmed preconditions** (verified before halt):

- `phase_found: true`, `has_context: true`, `has_research: false`, `has_plans: false`, `plan_count: 0`, `phase_status: Pending`
- `context_path`: `.planning/phases/40-cancellation-save-offers-flow/40-CONTEXT.md` (22 decisions across Eligibility / Pause mechanics / Discount stacking / Modal UX / Claude's Discretion sections)
- `phase_req_ids`: POLISH-01, POLISH-02, POLISH-03, POLISH-04 (4 requirements)
- Phase has heavy UI footprint (3 surfaces) — UI-SPEC.md is now present + committed, so the top-level re-invoke at step 5.6 (UI Design Contract Gate) will detect existing UI-SPEC and SKIP `gsd-ui-phase`.
- Depends on (per ROADMAP): v1.2 Phase 14 (Stripe subscriptions live — shipped) + Phase 27 (cohort eligibility — shipped); also load-bearing on P19 (affiliate coupon stacking — D-15 abuse vector surfaces), P26-07 (stripe-webhook dispatcher case-arm pattern — D-11), P29 (clinic per-patient billing variance — D-04 clinic-distinct offer set), P37 (helpdesk ticket-create — D-21 service-quality-issue routing), P34 (PostHog Experiments + Ship-Winner — D-22 A/B variant pattern).

**Blocker root cause:** Background-Agent runtime in this session exposes only Read/Edit/Write/Bash + MCP tools — no `Task` / `Agent` schema (confirmed via `ToolSearch select:Task` returning "No matching deferred tools found"). `gsd-plan-phase` step 5 (spawn `gsd-phase-researcher`), step 7.8 (`gsd-pattern-mapper`), step 8 (`gsd-planner`), step 10 (`gsd-plan-checker`) all require `Agent()`. Workflow cannot proceed past step 5.6 here. Per parent-prompt rule ("If you hit any access issue, do NOT work around it — let it fail and write the error to .planning/STATE.md as a blocker"), workflow halted before any agent spawn.

**Resolution:** User re-invokes `/gsd-plan-phase 40 --auto` at TOP-LEVEL Claude Code session (NOT via /gsd-manager background dispatch). Top-level session has the `Task`/`Agent` tools needed to dispatch researcher → pattern-mapper → planner → plan-checker chain. Step 5.6 UI-SPEC gate will detect the existing `40-UI-SPEC.md` and SKIP `gsd-ui-phase` automatically — saving one full agent-spawn round-trip.

**Planner outline guidance** (pre-computed during this background session — saves the planner one full pass when the user re-invokes):

Phase 40 splits naturally into 6 plans across 3 waves. The 3-step modal is a single chunked component per CONTEXT specifics ("plan-checker must enforce that the modal is a SINGLE chunked component, not 3 separate routes"). Migration + Edge Fn + Stripe-webhook dispatcher extensions are isolated Wave 1; the customer-facing modal + admin surfaces depend on the schema landing first.

| Plan | Objective | Wave | Depends on | REQs |
|---|---|---|---|---|
| 40-01 | Schema: `cancellation_offers_log` (append-only, 2-axis RLS) + `save_offer_rules` (cohort × tenure × reason × offer-type, priority int, active bool) + supporting CHECK constraints widening for any new status enum values per `[[feedback_planner_missed_status_enum_widening]]`. Stripe coupon-pool seed migration (6 fixed combos: SAVE-{20/25/30}-{2/3}MO per D-12/D-13). | 1 | none | POLISH-01, POLISH-04 |
| 40-02 | Stripe webhook dispatcher extension: new case arms for `customer.subscription.paused` + `customer.subscription.resumed` (mirror to `subscriptions.paused_until` + `is_paused` per D-11; case arms BEFORE default per P26-07 lesson). New event handlers `customer-subscription-paused.ts` + `customer-subscription-resumed.ts` mirroring invoice-paid.ts pattern. T-7d resume-reminder pg_cron + T-0 confirmation email via `_shared/email-router.ts` (D-09). | 1 | none | POLISH-03 |
| 40-03 | Edge Fn `cancellation-decide-offer`: server-side offer recommendation engine. Inputs: user_id + reason. Outputs: single `OfferType` + offer config (coupon code | pause duration | extension days | downgrade target). Logic: cohort × tenure-bucket × reason → look up matching rule by priority. Anti-gaming gates (D-02 lifetime cap, D-03 12mo cooldown) + clinic-org fork (D-04). Cold-start hardcoded reason→offer mapping; warm-start Bayesian over `cancellation_offers_log` take-rates. Stacking-cap clamp (D-15: 35% combined effective). | 2 | 40-01 | POLISH-01, POLISH-04 |
| 40-04 | Frontend: `CancellationModal.tsx` (single lazy chunk) — 3-step funnel per UI-SPEC Surface 1 + offer-decision client (`decide-offer-client.ts`). Analytics events per CONTEXT canonical_refs (`cancellation_started`, `cancellation_reason_picked`, `save_offer_shown`, `save_offer_accepted`, `save_offer_declined`, `cancellation_completed`, `cancellation_aborted`, `cancellation_dismissed`, `subscription_paused`, `subscription_resumed`). Service-quality-issue → P37 ticket-create wire on cancellation-complete (D-21). Bundle ceiling: new `cancellation` chunk ~13 kB gz cap. | 2 | 40-01, 40-03 | POLISH-01 |
| 40-05 | Admin Save-Offer Rule Editor — `AdminShell` module registration in `src/lib/admin/modules.ts` (`id: 'cancellation'`, `route: 'cancellation'`, `minRole: 'support_admin'` read / `'support_lead'` write, PostHog flag `admin_cancellation` default true). `CancellationRulesTab.tsx` per UI-SPEC Surface 2. SECDEF RPCs: `upsert_save_offer_rule`, `update_save_offer_rule_active`, `delete_save_offer_rule`, `reorder_save_offer_rules` (drag = priority swap). Surface gating via `surfaceCheck('admin.cancellation.rules.edit')`. | 3 | 40-01 | POLISH-01, POLISH-04 |
| 40-06 | Admin ROI Dashboard — `CancellationRoiTab.tsx` per UI-SPEC Surface 3. Aggregate query (PG materialized view OR plain view with sane indexes; planner decides) over `cancellation_offers_log`: offers-shown / acceptance-rate / revenue-recovered (deferred MRR × months retained) / avg-retention-extension. Chart.js stacked-bar via `BaseChart`. Cohort breakdown table. CSV export Edge Fn `download_cancellation_roi_csv`. PostHog Experiments + Ship-Winner wiring per D-22 (mirrors P34 D-20). | 3 | 40-01, 40-02 (data for revenue-recovered computation), 40-05 | POLISH-02 |

**Cross-cutting plan-checker concerns to flag at iter-1** (per `[[feedback_planner_iter1_anti_patterns]]`):

- **CHECK-constraint widening** for `cancellation_offers_log.status` enum + `save_offer_rules.active`: ship in 40-01 same plan that introduces the column. Per `[[feedback_planner_missed_status_enum_widening]]`.
- **D-15 stacking-abuse mitigation choice** must be explicit in PLAN.md (CONTEXT surfaces 4 candidates; recommended per CONTEXT specifics: cap combined effective discount at 35%, server clamps). Plan-checker enforce in 40-03.
- **D-04 clinic-org fork** — admin must NOT see pause / extended-trial / downgrade rule-editor fields when editing a clinic-org rule. Surface 2 conditional UI; plan-checker enforce in 40-05.
- **Stripe webhook HUMAN-UAT** — Stripe Dashboard needs to subscribe webhook endpoint to `customer.subscription.paused` + `customer.subscription.resumed` events. Add as Task 5 HUMAN-UAT in 40-02 per `[[project_phase26_shipped]]` lesson + CONTEXT deferred-ideas note.
- **Migration filename regex** per `[[reference_supabase_migration_filename_regex]]`: 14-digit timestamp + name strict. Pre-merge collision check per `[[reference_migration_timestamp_collision_precheck]]`.
- **D-17 single-chunk constraint**: `CancellationModal.tsx` must NOT route-split steps. Plan-checker grep for `react-router` or new route entries inside this PR — none expected.
- **Bundle ceiling raises**: new `cancellation` chunk ~13 kB gz + admin chunk delta. Update `scripts/assert-bundle-budgets.sh` per `[[reference_bundle_budget_hash_hyphen]]`.
- **Anti-gaming D-02 pause-exemption math**: D-02 says "pause does NOT count toward the lifetime 2-take cap" + D-10 says "extending a pause counts as a new pause-take". These two rules interact — verify 40-03 implementation increments the counter on EXTEND but not on INITIAL pause-take. Plan-checker enforce assertion test.

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
**Current focus:** Phase 35 — M3 Gamification Engine

## Current Position

Phase: 35 (M3 Gamification Engine) — EXECUTING
Plan: 1 of 10
Status: Ready to execute
Last activity: 2026-05-22 -- Phase 39 planning complete

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

Progress: [█████████░] 90%

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
| Phase 38 P01 | 12min | 3 tasks | 13 files |
| Phase 38 P02 | 10min | 3 tasks | 15 files |
| Phase 38 P09 | 28min | 3 tasks | 7 files |
| Phase 34 P06 | 708 | 3 tasks | 14 files |
| Phase 37 P03 | 8m | 3 tasks | 4 files |

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
- [Phase ?]: Plan 50-04: Vault key 'service_role_key' (existing convention)
- [Phase ?]: Plan 50-04: Vite-side mirror modules for Deno-runtime files using npm: specifiers (test path)
- [Phase ?]: Plan 50-04: Open-web crawl chunk INSERT deferred to v1.4 (no synthetic open-web rag_sources row)
- [Phase ?]: Phase 38-01: multi-source match_content_embeddings RPC signature locked for Phase 50 forward-compat
- [Phase ?]: Plan 34-06: Consumer renderer activates only when onboarding_flows.config has steps — empty seeded row falls through to legacy DEFAULT_STEPS
- [Phase ?]: Plan 34-09: extend onboarding-funnel-query with list_experiments branch — One Edge Fn surface owns both HogQL Insights + feature_flag listing — single auth/health-check/cache

### Pending Todos

None yet — roadmap just created. Phase 24 plan-phase is the next runnable.

### Blockers/Concerns

- **Phase 25 Wave-0 vendor calls (kick off immediately):** Resend BAA, Anthropic Enterprise pricing, PostHog tier decision, Supabase Team+HIPAA upgrade, Vercel HIPAA add-on, Sentry Business, Meta Ads App Review. Vendor + legal work runs PARALLEL with engineering from Wave 0; 4-8 week lead time.
- **Phase 34 activation event lock-in** is load-bearing for P39 + P36 + P38; CONTEXT.md decision MUST land before any of those plan-phase.
- **Phase 28 multi-tenant `org_id` axis** is the largest schema slab (16+ tables); cross-tenant impersonation proof test required per table.
- **Phase 33 Meta App Review (Dev → Standard tier)** has 2-4 week vendor lead time — start application during P24/25 to avoid blocking P33 entry.
- **Carry-over runner-pool quirk**: `/gsd-manager` background plan/execute dispatch still lacks the Task tool. Use foreground Claude Code session for plan-phase + execute-phase.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260521-gbm | Fix dashboard desktop/tablet responsiveness — unlayered `* { margin: 0 }` killed all Tailwind margin utilities; moved into `@layer base` + split AppShell main offset/centering | 2026-05-21 | 8da34fa | [260521-gbm-fix-dashboard-desktop-tablet-responsiven](./quick/260521-gbm-fix-dashboard-desktop-tablet-responsiven/) |
| 260521-lt0 | Fix Vercel build failure — Phase 35-07 `api/` OG share-card functions had no tsconfig (JSX off + node16 extension errors); added `api/tsconfig.json` + `.js` import extensions. Supabase verified healthy (no drift). | 2026-05-21 | a8a9585 | [260521-lt0-fix-vercel-build-failure-api-og-share-ca](./quick/260521-lt0-fix-vercel-build-failure-api-og-share-ca/) |

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

Last session: 2026-05-22T05:10:09.414Z
Stopped at: Phase 39 UI-SPEC approved
Resume file: 

.planning/phases/39-a-b-trifecta-mid-trial-paywall-pharma-paywall-page-variant-a/39-UI-SPEC.md

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

## Phase 34 plan-phase blocker (2026-05-19)

**Blocker:** `Skill(gsd-plan-phase, "34 --auto")` invoked inside a background-mode subagent (parent prompt dispatched it from /gsd-manager). The plan-phase workflow requires spawning `gsd-phase-researcher` -> `gsd-planner` -> `gsd-plan-checker` subagents (per `~/.claude/get-shit-done/workflows/plan-phase.md` steps 5/8/10), but the `Task`/`Agent` tool is **not surfaced** in this background runtime. Confirmed via `ToolSearch select:Task` (no match) and keyword search `Agent task launch subagent` (no match). This is the **same blocker pattern** documented for Phase 25 plan-phase (2026-05-17) and Phase 51 plan-phase (STATE frontmatter `stopped_at`), and matches memory `feedback_skill_in_background_agent_loses_tool_access` + `reference_gsd_tooling_quirks` ("/gsd-manager background dispatch fails — runner pool lacks Task tool").

Per parent-prompt rules ("If you hit a blocker, write it to STATE.md as a blocker and stop. Do NOT silently work around permission or file access errors"), workflow halted **before** the researcher spawn. No PLAN.md / RESEARCH.md / VALIDATION.md / PATTERNS.md / UI-SPEC.md artifacts written.

**Pre-flight verified (workflow steps 1-4):**

- `gsd-sdk query init.plan-phase 34` parsed cleanly: researcher=sonnet, planner=opus, checker=sonnet; `phase_status=Pending`; `has_context=true`; `has_research=false`; `has_plans=false`; `plan_count=0`; `commit_docs=true`; `research_enabled=true`; `plan_checker_enabled=true`; `nyquist_validation_enabled=true`; `mode=yolo`.
- `gsd-sdk query roadmap.get-phase 34` confirms phase exists with 5 success criteria and 13 REQ-IDs (ONBOARD-01..13).
- CONTEXT.md present: 20 D-XX decisions across 4 areas (Activation Event D-01..05, Anon->Auth Merge D-06..10, First-Action Surface D-11..15, Step Builder + A/B D-16..20) + 5 Claude's-Discretion items + canonical refs to Phase 24/19/25/31 + 6 reusable-asset pointers in existing codebase.
- DISCUSSION-LOG.md present (gathered 2026-05-18).
- Closed-phase gate (§1.5) PASSES — phase is Pending, not Complete; no `--force` needed.
- UI gate (§5.6) would trigger — heavy UI surface (admin step builder drag-drop + 3-card first-action UI + mobile Lighthouse 90 + >=44px tap targets). `--auto` flag implies `AUTO_CHAIN` -> auto-generate UI-SPEC via `Skill(gsd-ui-phase, "34 --auto")`. That nested Skill ALSO lacks Task tool in this background context. Operator decision required at top level: either `--skip-ui` or run `/gsd-ui-phase 34` first.

**State on disk:**

- `.planning/phases/34-m2-onboarding-overhaul-activation-event/34-CONTEXT.md` — present (20 decisions, 5 success criteria, 4 deferred items, 6 reusable assets enumerated)
- `.planning/phases/34-m2-onboarding-overhaul-activation-event/34-DISCUSSION-LOG.md` — present
- `34-RESEARCH.md` — NOT created
- `34-VALIDATION.md` — NOT created (needs Validation Architecture section from RESEARCH.md per §5.5)
- `34-PATTERNS.md` — NOT created
- `34-UI-SPEC.md` — NOT created (UI gate would trigger; `--skip-ui` would bypass)
- `*-PLAN.md` — NONE

**Resume options for operator (run from a TOP-LEVEL Claude Code session, NOT from `/gsd-manager` background dispatch or any nested Skill/Task):**

1. **Recommended:** From a top-level Claude Code session, invoke `/gsd-plan-phase 34 --auto`. Top-level Claude Code has the `Task`/`Agent` tool surfaced and can dispatch researcher -> (UI-SPEC auto-gen if needed) -> planner -> plan-checker, with chunked-planning auto-fired if outline lands >=5 plans (very likely given 20 decisions across 4 workstreams).

2. **Skip UI auto-gen for now:** `/gsd-plan-phase 34 --auto --skip-ui` — saves one Skill nesting hop. The planner produces task-level UI guidance from CONTEXT.md's 4 UI-bearing decisions (D-12 hybrid 3-card, D-16 palette + reorder, D-18 superadmin permission, D-19 split slider) instead of a separated UI-SPEC contract. Recommended since CONTEXT.md UI decisions are already pinned and Phase 34 mostly extends existing primitives (`OnboardingFlow.tsx` rewrite + admin shell additions per Phase 24 manifest).

3. **Skip research (faster, lower fidelity):** `/gsd-plan-phase 34 --skip-research --skip-ui` — planner works from CONTEXT.md + REQUIREMENTS.md only. NOT recommended — Phase 34 has 4 net-new mechanics (anonymous_sessions richest-data merge, server-side activation event property shape, PostHog Experiments ship-winner flag flip, drag-drop palette schema) that benefit from researcher's API/landmine survey. Nyquist Dimension 8 also at risk without RESEARCH.md.

**Planner outline guidance (pre-computed from CONTEXT.md to save planner one pass — chunked-planning candidate per [[feedback_parallel_chunked_planning]]):**

Phase 34 is likely **9 plans across 3 waves**. Per [[feedback_chunked_planning_integration_seam_blindspot]], the integration seams between the activation event Edge Fn (D-05) and the first-action triggers in dashboard log paths must have a single explicit-owner plan, not be spread across "whoever touches the dashboard."

| Plan | Objective | Wave | Depends on | REQs | Key files / decisions |
|------|-----------|------|------------|------|-----------------------|
| 34-01 | `anonymous_sessions` migration + RLS deny + 30-day TTL cron + cookie issuance helper (`_ls_anon`) + Edge Fn `/api/anon-session/upsert` | 1 | — | ONBOARD-01, ONBOARD-11 (partial), ONBOARD-12 (cookie reuse) | new migration; D-06, D-09, D-10; mirror Phase 31 `org_onboarding_flows` JSONB+RLS shape |
| 34-02 | `onboarding_flows` (consumer) migration + `version_id` discipline + RLS + seed default v1 flow + `useConsumerOnboardingFlow()` hook (sibling to Phase 31 `useOrgOnboardingFlow`) | 1 | — | ONBOARD-03, ONBOARD-07 (read), ONBOARD-08 (flag binding) | new migration; D-17; mirror Phase 31 schema |
| 34-03 | `activation_events` migration + `events.ts` registry extension (`activation_completed` with goal_type/action_type/window_days/days_since_signup) + `posthog-server.ts` `captureActivation()` wrapper + fire-once user check + 7-day-window guard + Deno test | 1 | — | ONBOARD-06 (activation), TAXO-02 (server-side capture) — LOCK consumed by P36/P38/P39 | new migration; D-01..D-05; reuse Phase 24 `_shared/posthog-server.ts` |
| 34-04 | `profiles.primary_goal` enum column (8-goal catalog widening) + CHECK constraint widen-migration co-shipped per [[feedback_planner_missed_status_enum_widening]] + Settings UI edit per D-14 | 1 | — | ONBOARD-13 (partial) | enum widening; D-11, D-14 |
| 34-05 | Consumer onboarding rewrite — REWRITE `OnboardingFlow.tsx` to consume config-driven steps from `onboarding_flows`, A/B variant resolution via PostHog feature flag payload + smart defaults (Accept-Language/IP/profile fallback) + magic-link + Google OAuth + Apple OAuth (web) + mobile >=44px primitives + social-proof rail (live counter + rotating 3 testimonials w/ 30s) | 2 | 34-02, 34-04 | ONBOARD-02, ONBOARD-03, ONBOARD-04, ONBOARD-05, ONBOARD-12 | depends on Phase 19 dual-cookie reuse for `_aff` propagation |
| 34-06 | First-action surface — 3-card hybrid UI per D-12 with recommended-card emphasis per goal (D-13 mapping), action triggers fire `captureActivation()` from server-side log path on first qualifying insert (NOT the card click), `family-supporter` waitlist card | 2 | 34-03, 34-04, 34-05 | ONBOARD-06, ONBOARD-13 | D-12, D-13, server-side activation fire per D-05 |
| 34-07 | Anonymous -> authenticated merge service-role Edge Fn — richest-data scoring (count non-null prefs + draft entries) per D-07, atomic merge of (a) prefs (b) drafts (c) PostHog alias `posthog.alias(authed_user_id, anon_distinct_id)` (d) `_aff` cookie reattach, cleanup of merged anonymous row, RLS-safe via service_role only | 2 | 34-01, 34-04 | ONBOARD-01 (merge), ONBOARD-11 (race resolution) | D-07, D-08, D-10 |
| 34-08 | Admin step builder UI — drag/drop palette (text/single-select/multi-select/scale/weight/date/NPS/custom-component) + step reorder + JSONB save to `onboarding_flows.config` + branching if-then routing + preview route + `surfaceCheck('onboarding.ship_winner')` permission gate | 3 | 34-02 (schema) + Phase 24 admin shell | ONBOARD-07, ONBOARD-08 (draft variants), ONBOARD-09 (preview route) | D-16, D-18, D-19; reuse Phase 15 page-builder palette pattern; bundle ceiling — admin-shell 30 kB |
| 34-09 | PostHog Experiments + Ship-Winner — bind variant to PostHog Experiment via `posthog-node` Edge Fn API, write new `onboarding_flows` version on Ship-Winner click, flip feature flag to 100% on new version, per-step funnel analytics SQL/queries fed into admin panel, rollback flip-back action | 3 | 34-02, 34-08 | ONBOARD-08, ONBOARD-10 (per-step funnel analytics) | D-17, D-19, D-20; superadmin-only via 34-08 surfaceCheck |

**Cross-cutting concerns the planner must enforce:**

- [[reference_supabase_migration_filename_regex]] — `<14-digits>_name.sql` strict, no letter suffix; pre-check timestamp collisions against Phase 25 (`20270702*`), Phase 50 RAG (`rag_*`), Phase 33 (`affiliate_lifetime_recurring_*`) per [[reference_migration_timestamp_collision_precheck]] — Phase 34 migrations should target `20270703000001..N` window
- [[reference_supabase_migration_gotchas]] — SECURITY DEFINER `set search_path = public, extensions`; RLS deny patterns; partial-index expressions IMMUTABLE
- [[reference_supabase_auth_traps]] — magic-link redirect double-`#` hash route on SPAs; free-tier 2/hr email rate-limit (e2e impact — don't call public auth-email endpoints from e2e)
- [[feedback_planner_missed_status_enum_widening]] — Plan 34-04 MUST ship `profiles.primary_goal` CHECK widening in the SAME migration that adds the column; failure mode is 23514 in prod when first user picks `family-supporter`
- [[reference_vite_static_env_inlining]] — no dynamic `import.meta.env[VITE_${x}]` for PostHog/Supabase keys; use enumerated literal-key ternaries
- [[feedback_planner_iter1_anti_patterns]] — shared-file choreography across plans (Plan 34-05/06 both touch `OnboardingFlow.tsx` if not careful — Plan 34-05 OWNS rewrite, 34-06 adds the 3-card subcomponent as a sibling file)
- [[feedback_chunked_planning_integration_seam_blindspot]] — activation event seam: D-05 says fire from Edge Fn that processes the FIRST QUALIFYING ACTION INSERT (not the card click) — Plan 34-06 owns server-side fire, NOT the dashboard log-path plan; planner must call out exactly which existing log endpoints need a `captureActivation()` shim added
- Bundle ceilings (Phase 24 D-18..20) — admin step builder lives inside admin-shell 30 kB ceiling; consumer onboarding lazy-chunk `onboarding-preview` (already declared in CONTEXT.md Established Patterns) — likely warrants a new dedicated ceiling line in Phase 24 manifest if it exceeds the residual budget
- HIPAA — anonymous_sessions draft entries (weight + symptoms) are SENSITIVE not PHI yet (pre-signup), but Sentry/PostHog mask lists from Phase 25 D-15/16 still apply; merge Edge Fn touches PHI post-signup so it inherits Phase 25 audit_log requirements

**Risks the planner / checker must surface:**

- **D-03 single event name with property shape** — if downstream P36/P38/P39 expect 8 separate event names, breakage. Plan 34-03 should include a markdown contract block enumerating the property shape verbatim so downstream phases can hold the contract.
- **D-07 richest-data scoring tie-break** — what if two anonymous sessions tie on richness score? Planner should pick deterministic tiebreaker (suggest: most-recent `last_activity_at`).
- **D-12 3-card UI on mobile 375px** — 3 stacked cards + emphasized one + Lighthouse 90 budget is tight; planner should call out asset budget for the recommended-card "pill badge" graphic.
- **D-20 PostHog Experiments vs raw feature flags** — Experiments API on PostHog has different SDK call shape than feature-flag eval; verify `posthog-node` 5.10.4 Experiments support before locking in. Researcher should flag this.
- **D-08(c) PostHog alias on merge** — `posthog.alias(authed_user_id, anonymous_distinct_id)` rewires identity; if called twice on race, identity merge can corrupt. Plan 34-07 must guard with a `merged_user_id IS NULL` check inside the Edge Fn under SELECT ... FOR UPDATE.
- **family-supporter activation as build-habit proxy** — Plan 34-06 must NOT lock activation event property to `action_type='supported_person_configured'` for these users since that table doesn't exist v1.3; activation fires on whichever action they actually log (D-15 + Specifics).
- **Apple OAuth web** — Apple Services ID + return URLs need configuration in Apple Developer; vendor-config-not-code task. Plan 34-05 should ship Apple OAuth wiring behind a config-presence check per [[reference_vendor_gated_send_health_check]] pattern if Apple Services ID isn't provisioned yet.

## Operator Next Steps (Phase 34 plan resume)

- **PRIMARY:** From a top-level Claude Code session, invoke `/gsd-plan-phase 34 --auto` (or `--auto --skip-ui` to skip the nested UI-SPEC auto-gen Skill call). The pre-computed outline above can be passed to the planner as additional context to save one planning pass.
- **PARALLEL prep work (no top-level session required):**
  - Confirm PostHog Experiments API support in `posthog-node` 5.10.4 — D-20 lock depends on this.
  - Provision Apple Developer Services ID + return URLs for web Apple OAuth — vendor-config block for Plan 34-05.
  - Verify migration timestamp window `20270703000001..N` is collision-free against any merged Phase 25/33/50 migrations on main (last seen highest: `20270702000009`).
- **DOWNSTREAM IMPACT WARNING:** Phase 34 D-01..D-05 LOCK the activation event shape consumed by Phase 36 (review eligibility), Phase 38 (recommender retraining), and Phase 39 (paywall trigger). The CONTEXT.md decisions are sufficient to lock the shape NOW — those downstream plan-phase commands can proceed in parallel using CONTEXT.md D-01..D-05 even before Phase 34 ships, per the load-bearing note in STATE Blockers ("Phase 34 activation event lock-in is load-bearing").

## Phase 35 plan-phase blocker (2026-05-19)

**Blocker:** `/gsd-plan-phase 35 --auto` invoked via `/gsd-manager` background path. The plan-phase workflow needs to spawn three subagents in sequence (`gsd-phase-researcher` → `gsd-planner` → `gsd-plan-checker`), but the `Task`/`Agent` tool is not available in this subagent context (confirmed via `ToolSearch select:Task` returning no match; cross-references: [[feedback_skill_in_background_agent_loses_tool_access]] + [[reference_gsd_tooling_quirks]]). Per parent-prompt rule ("If you hit a blocker, write it to STATE.md as a blocker and stop"), workflow halted before researcher spawn. Same shape as the Phase 25 / Phase 51 / Phase 34 background-runner blockers recorded earlier in this STATE.md.

**State on disk:**

- `.planning/phases/35-m3-gamification-engine/35-CONTEXT.md` — present (21 D-XX decisions across XP economy, streak/freeze, leaderboard, weekly challenges + Claude's Discretion section) ✓
- `.planning/phases/35-m3-gamification-engine/35-DISCUSSION-LOG.md` — present ✓
- `35-RESEARCH.md` — NOT created
- `35-VALIDATION.md` — NOT created (would be created after RESEARCH.md `## Validation Architecture` block lands)
- `35-PATTERNS.md` — NOT created
- `*-PLAN.md` — NONE
- `has_research=false`, `has_plans=false`, `plan_count=0`, `phase_status=Pending`

**Pre-flight verified (workflow steps 1–4):**

- `gsd-sdk query init.plan-phase 35` parsed cleanly: researcher=sonnet, planner=opus, checker=sonnet, research_enabled=true, plan_checker_enabled=true, nyquist_validation_enabled=true, commit_docs=true, auto_advance=false, mode=yolo.
- CONTEXT.md loaded — 21 D-XX decisions (D-01..D-21) + Claude's-discretion block covering confetti/share-card OG/badge-seed/ProgressRing-reuse/gamification-burst-chunk.
- REQ-IDs from ROADMAP: `GAME-01, GAME-02, GAME-03, GAME-04, GAME-05, GAME-06, GAME-07, GAME-08, GAME-09` (9 REQs).
- Depends on: Phase 24 (event taxonomy, server-side PostHog, bundle ceilings — gamification-burst 8 kB gz), Phase 27 (cohort builder + admin-shell extension surface). Both shipped.
- UI gate (5.6) APPLIES — phase touches UI (dashboard cards, progress rings, settings opt-in, admin module). However: CONTEXT.md already specifies UI patterns via "reuse `src/components/ui/ProgressRing.tsx`" + "extend admin shell module pattern" + "Settings → Leaderboards subtab." This is component-level reuse, not a new design surface — per [[feedback_uispec_for_frontend_heavy_phases]] the default would be "generate UI-SPEC first," but the rich CONTEXT.md decision set (21 decisions including all UX cadence, opt-in nudge timing, confetti cooldown, handle regex) means `--skip-ui` is defensible. Operator should pick: (a) `/gsd-ui-phase 35` first for a per-phase UI contract, or (b) `--skip-ui` and rely on CONTEXT decisions + ProgressRing reuse.
- Schema push gate (5.7) APPLIES — phase ships ≥5 new migrations (xp_ledger, freeze_tokens_ledger, streak_state, weekly_challenges, badge_catalog, leaderboard matview, cohort_definitions.leaderboard_enabled column). `[BLOCKING]` Supabase `supabase db push --linked` task MUST be injected per [[reference_supabase_worktree_temp_state]].

**Resume options for operator (run from a top-level Claude Code session, NOT from a nested subagent):**

1. **PRIMARY — Re-invoke at top level:** `/gsd-plan-phase 35 --auto` — top-level Claude Code has the `Task` tool and can dispatch the researcher → planner → checker chain. Recommended because:
   - RESEARCH.md lands first (Nyquist Dimension 8 inputs)
   - VALIDATION.md auto-created from `## Validation Architecture` section
   - Plan-checker iterates over the planner output (max 3 revisions)
   - Per [[feedback_parallel_chunked_planning]] with ≥5 plans, planner orchestration fires plan-by-plan in parallel via `run_in_background`

2. **UI-first then plan:** `/gsd-ui-phase 35 --auto` then `/gsd-plan-phase 35 --auto` — produces a richer UI-SPEC.md contract before plans. Adds ~one round-trip but reduces UI-related plan-checker iterations. Recommended if the design-bundle pattern at `.planning/design-system/` is meant to inform the gamification surfaces — see [[feedback_design_bundle_as_ui_spec]].

3. **Skip-UI:** `/gsd-plan-phase 35 --auto --skip-ui` — relies on CONTEXT decisions + existing component reuse. Acceptable because CONTEXT.md captures every UX cadence decision (D-09 single 24h-ahead notify, D-12 opt-in nudge at level 5, D-13 handle regex, D-21 Monday kickoff). Risk: planner might propose new design surfaces (admin challenge form layout, leaderboard table styling) that benefit from a UI-SPEC contract.

4. **Skip research (faster, lower fidelity):** `/gsd-plan-phase 35 --skip-research --skip-ui` — planner works from CONTEXT.md + REQUIREMENTS.md only. CONTEXT.md is dense (21 locked decisions); risk is Nyquist Dimension 8 failures at plan-checker time and missed library/integration detail (e.g., `canvas-confetti` 1.9.3 stack-lock; PostHog Experiments cohort-scoped variant binding patterns from Phase 34 D-20).

**Planner outline guidance (pre-computed during this session — saves one planner pass):**

Based on the 21 decisions, 9 REQ-IDs, and the [[feedback_parallel_chunked_planning]] threshold (≥5 plans triggers chunked planning), Phase 35 is likely **10–12 plans across 3 waves**. The phase has natural seam boundaries — append-only ledger DB layer, streak/freeze cron service, leaderboard matview+UI, admin challenge module, share-card edge fn, dashboard surfaces — that planners can own independently:

| Plan | Objective | Wave | Depends on | REQs | Key files / decisions |
|------|-----------|------|------------|------|-----------------------|
| 35-01 | `xp_ledger` migration + append-only RLS deny + `compute_level(xp_total)` Postgres function (D-04 deterministic) + ledger-replay rollback test (success criterion #1) | 1 | — | GAME-01 | new migration `20270703000001_xp_ledger.sql`; D-01, D-02, D-04; pure-function level computation enables the rollback test |
| 35-02 | `streak_state` migration + `freeze_tokens_ledger` migration + hourly `pg_cron` streak job per `profiles.timezone` + monthly freeze-token grant cron + auto-apply logic (D-08) | 1 | 35-01 (xp_ledger writer fires events streak job reads) | GAME-02 | new migrations; D-06, D-07, D-08, D-10; [[reference_postgres_dollar_quote_nesting_in_cron_body]] named tags; [[reference_supabase_pg_cron_vault_service_role_pattern]] vault decrypted_secrets |
| 35-03 | `leaderboard_matview` migration + `cohort_definitions.leaderboard_enabled` column + 15-min `pg_cron` REFRESH MATERIALIZED VIEW CONCURRENTLY + 7d rolling XP score function (D-16) + REVOKE + SECURITY DEFINER accessor pattern per P30-00 lesson | 1 | — | GAME-04 (partial) | new migration + ALTER cohort_definitions; D-11, D-14, D-15, D-16; matview RLS-bypass via accessor RPC |
| 35-04 | XP-grant Edge Fn `xp-grant` + integration into existing log-write paths (injection-log, weight-log, symptom-log, workout-log Edge Fns or RPC triggers) + server-side PostHog capture (D-05 — Phase 24 server-side pattern) | 1 | 35-01 | GAME-01, GAME-09 | new Edge Fn `supabase/functions/xp-grant/index.ts`; Deno test naming `xp-grant.test.ts` per [[reference_deno_test_discovery]]; integrates with existing log-write call sites |
| 35-05 | `weekly_challenges` migration + `challenge_assignments` migration + `badge_catalog` migration + initial badge seed (12-20 badges per Claude's-discretion) + challenge-completion check Edge Fn / cron | 2 | 35-01, 35-02 | GAME-05, GAME-08, GAME-09 | new migrations; D-17, D-18, D-19; status enum (active/completed/archived) — per [[feedback_planner_missed_status_enum_widening]] ship CHECK widening in SAME plan |
| 35-06 | Admin module `/admin/gamification` — challenge create form (D-17 simple form, no drag-drop builder), cohort-scope picker, A/B variant toggle (D-20 PostHog Experiments binding mirrors Phase 34 D-20), freeze-token grant UI (D-10 with `granted_by_admin_user_id` audit), leaderboard_enabled toggle per cohort | 2 | 35-03 (cohort col), 35-05 (challenges), P27 admin shell | GAME-03, GAME-05, GAME-08 | extends `surfaceCheck('admin.gamification.*')`; admin-shell 30 kB ceiling; new admin route registered in admin shell manifest |
| 35-07 | Dashboard surfaces — `GamificationCard` + `LevelProgressCard` + `StreakCard` + `LeaderboardCard` + share-card preview button; ProgressRing reuse for streak + level rings (D-claude); `useReducedMotion` gates all animation | 2 | 35-01, 35-02, 35-03 | GAME-01, GAME-02, GAME-04 | new files in `src/components/dashboard/cards/`; index ceiling (50 kB gz) respected by routing canvas-confetti + framer-motion through `sync-defer.ts` |
| 35-08 | `gamification-burst` chunk packaging + canvas-confetti 1.9.3 lazy-load via `sync-defer.ts` + `useReducedMotion` fallback (ProgressRing pulse) + level-up + challenge-complete burst triggers + 60s cooldown (D-claude anti-spam) + bundle-budget CI assertion ≤8 kB gz | 2 | 35-07 | GAME-06 (success criterion confetti gate) | new file `src/lib/gamification/burst.ts`; bundle-budget script update per [[reference_bundle_budget_hash_hyphen]] |
| 35-09 | Vercel Function `api/og/level-up.png` (share-card OG image, D-claude template) + OG meta tags wired to share modal + `?ref=share` query param → `_aff` cookie write per Phase 19 dual-cookie pattern + Twitter/X/LinkedIn/Instagram OG validation | 2 | 35-07 | GAME-07 | new Vercel function at repo root `api/og/level-up.png.ts`; SC #5 |
| 35-10 | Settings → Leaderboards subtab — opt-in toggle (D-12 default OFF), handle picker with regex validation (D-13 `^[A-Za-z0-9]{6,24}$` + per-cohort uniqueness check), server-generated default suggestion endpoint, dismissable level-5 dashboard nudge (D-12 one-time) | 2 | 35-03 | GAME-04 | extends `src/components/dashboard/settings/SettingsPage.tsx`; handle-uniqueness RPC; nudge surfaced via dashboard widget |
| 35-11 | Notification engine — Monday-morning challenge kickoff push/in-app (D-21) + 24h-ahead streak-break warning at 6pm local (D-09 single notification per cycle, ETHICAL-only guardrail) + Friday-evening challenge nudge if no progress; planner enforces "max 1 notification per cycle" via Postgres unique-per-user-per-cycle constraint | 3 | 35-02, 35-05 | GAME-05, GAME-02 | new `pg_cron` jobs + `notifications_outbox` integration (Phase 24 server-side path); planner BLOCKS any 2nd-warning per cycle at design-time |
| 35-12 | Phase 24 + Phase 27 coordination patch — extend `src/lib/analytics/events.ts` with 6 new events (xp_earned, level_up, streak_milestone, freeze_token_granted, challenge_completed, badge_unlocked); confirm admin-shell manifest entries; bundle-budget script gamification-burst ceiling row | 1 | — (verification) | GAME-01..09 (analytics) | small read-write coordination plan; ensures Phase 24 server-side capture path is wired correctly before 35-04 ships |

**Wave shape:** Wave 1 has 5 plans (35-01, 02, 03, 04, 12 — DB + Edge Fn + matview foundation); Wave 2 has 6 plans (35-05, 06, 07, 08, 09, 10 — admin + dashboard + share-card + settings); Wave 3 has 1 plan (35-11 — notifications, depends on both streaks and challenges). Per [[feedback_parallel_chunked_planning]] this is the chunked-planning sweet spot — fire per-plan planners in parallel via `run_in_background` at top-level.

**Cross-cutting concerns the planner / checker MUST enforce:**

- [[reference_supabase_migration_filename_regex]] — strict `<14-digit>_name.sql`; new range starts `20270703000001` (after Phase 25 ceiling `20270702000009`); ensure no collision with Phase 33/34 migrations (verify via `ls supabase/migrations/2027*.sql` pre-plan-write)
- [[reference_migration_timestamp_collision_precheck]] — pre-merge glob `20270703*.sql >1` collision check between plans 35-01/02/03/05
- [[reference_supabase_migration_gotchas]] — append-only ledger RLS = deny UPDATE/DELETE; SECURITY DEFINER `set search_path = public, extensions`
- [[reference_postgres_dollar_quote_nesting_in_cron_body]] — streak/freeze cron uses `DO $$..$$` inside `cron.schedule(..., $$..$$)` → use named tags (`$cron$..$streak$`)
- [[reference_supabase_pg_cron_vault_service_role_pattern]] — pg_cron + SECDEF calling Edge Fns needs vault `decrypted_secret` pattern, hardcoded URL; NEVER `current_setting('app.service_role_key')`
- [[feedback_planner_missed_status_enum_widening]] — Plan 35-05 challenge status enum (active/completed/archived) needs CHECK widening in same plan
- [[feedback_status_machine_transition_owner]] — every challenge status value needs an owning plan+task or feature ships dead
- [[reference_vite_static_env_inlining]] — share-card path-detection must use enumerated ternaries, not dynamic dynamic-key access
- [[project_phase5_bundle_regression]] — canvas-confetti + framer-motion bursts MUST route through `sync-defer.ts`; direct static imports blocked by CI guard
- [[reference_rls_fixture_gotruechient_flake]] — RLS tests for `xp_ledger`, `freeze_tokens_ledger`, `leaderboard_matview` (via accessor RPC), `weekly_challenges` use admin.generateLink + /auth/v1/verify pattern (ES256-compat)
- [[reference_deno_test_discovery]] — all new Edge Fn tests named `<name>.test.ts` (NOT `<name>-test.ts`)
- [[feedback_planner_iter1_anti_patterns]] — 5 BLOCKER patterns to dodge (shared-file choreography, hedge instructions, VALIDATION flag flip-timing, defensive jsonb contracts, DDL tx safety)
- **Ethical-only / privacy-default theme (CONTEXT specifics):** every plan's `must_haves.truths` MUST include "no dark patterns" (single notification per cycle; opt-in default; no monetization of XP/tokens; transparent freeze-token auto-apply; admin-curated leaderboards only); plan-checker should grep for and BLOCK any pattern matching: timer-based FOMO, color-shift escalation, surprise-deplete tokens, opt-out leaderboards, real-name display, paid XP boosts, sold freeze tokens, level-gated features.
- **Bundle ceilings (Phase 24 D-18..20):** gamification-burst ≤8 kB gz (hard ceiling); index ≤50 kB gz; admin-shell ≤30 kB (Plan 35-06 admin module fits inside); plans 35-07 + 35-08 must include bundle-budget CI assertion rows.

**Risks the planner / checker must surface:**

- **D-05 server-side XP capture** — XP-earning events fire from Edge Fns processing qualifying-action inserts. Plan 35-04 must integrate at the right call site (injection-log, weight-log, symptom-log, workout-log Edge Fns or trigger RPCs); verify the call sites exist before planning (some may be DB triggers, not Edge Fns).
- **D-08 freeze-token max stockpile = 3 with overflow drop** — planner needs explicit pseudocode handling for: token granted when stockpile=3 → log warning event + drop on floor; admin grant respects same cap. Don't let plans default to "extend stockpile" silently.
- **D-11 leaderboard_enabled per cohort** — admin owns the responsibility per CONTEXT.md "ethical-only positioning"; planner must produce a doc/runbook under `docs/admin/` describing criteria ("don't enable for early-stage / newly-diagnosed cohorts"). Plan 35-06 should include this docfile in `files_modified`.
- **D-14 leaderboard top-10 + ±5 neighborhood** — matview query needs careful pagination; planner should specify the query shape (CTE with rank window) so plan-checker can verify it doesn't fan out per-user-request (15-min matview must be pre-computed for ALL users, then sliced per request).
- **D-20 A/B variant scope** — Phase 34 D-20 pattern (cohort-scoped PostHog Experiments + Ship-Winner write-new-version + flip flag). Plan 35-06 must mirror this exactly; planner-iter-1 anti-pattern: "experiments handle the gate" without write-new-version + flag-flip mechanics.
- **canvas-confetti 1.9.3 stack-lock** — already in v1.3 stack additions per STATE.md (line 128 region); do NOT upgrade. Plan 35-08 must lazy-load via `sync-defer.ts` to stay under 8 kB gz.
- **Onboarding-burst chunk audit** — confetti from Phase 34 onboarding completion (if any) shares the gamification-burst chunk OR sits in its own chunk; planner-checker should verify there's exactly one canvas-confetti import path.
- **Vercel Function for OG image** — Plan 35-09 lives OUTSIDE `leanshot/src` (at Vercel project root `api/og/level-up.png.ts` per [[reference_vercel_project]] `leanshot-marketing`). Per [[reference_minisite_monorepo_layout]] plan `files_modified` paths are relative to git root (`/Users/karstenhaldan/minisite`), NOT `/leanshot/`.
- **35-12 coordination plan** — small but load-bearing; ensures `src/lib/analytics/events.ts` has the 6 new event names BEFORE 35-04 tries to fire them server-side. If 35-12 ships in Wave 1 alongside 35-04, the planner must enforce file-level ownership (events.ts may be edited by both — pathspec commit pattern per [[feedback_parallel_executor_git_isolation]]).

**Manifest of pre-flight state (so resumer doesn't repeat work):**

- HEAD: `06eb777` `docs(42): capture phase context` (clean main, nothing staged at time of orchestrator entry).
- STATE.md frontmatter unchanged at orchestrator entry: `status: ready_to_plan`.
- ROADMAP.md Phase 35 entry: `[ ]` — Pending.
- No `.planning/phases/35-m3-gamification-engine/35-*` files besides CONTEXT.md + DISCUSSION-LOG.md.
- No worktree branches active for Phase 35.
- Migrations directory ceiling: highest existing `20270702*` (Phase 25 chain). Phase 35 should target `20270703*` to avoid collisions.

## Operator Next Steps (Phase 35 plan-phase resume)

- **PRIMARY:** Re-invoke `/gsd-plan-phase 35 --auto` from a top-level Claude Code session (NOT nested under `/gsd-manager` or any background dispatch). Top-level Claude Code has the `Task`/`Agent` tool and can dispatch researcher → planner → checker. The pre-computed planner outline above can be pasted into the planner prompt as an additional `<planner_outline_hint>` block to save one outline-discovery pass.
- **OPTIONAL UI-first:** If gamification surfaces warrant a UI-SPEC contract (admin form, leaderboard table styling, share-card template), run `/gsd-ui-phase 35 --auto` first, then `/gsd-plan-phase 35 --auto`. Otherwise pass `--skip-ui`.
- **PARALLEL:** No vendor lead-time blockers for Phase 35 — canvas-confetti, framer-motion, Resend (for streak-break warning emails if planner picks email channel), PostHog Experiments, Vercel Functions all already wired in v1.3 stack.
