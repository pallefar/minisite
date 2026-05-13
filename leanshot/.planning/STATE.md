---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Polished Launch + Full Monetization + Ad Network
status: planning
last_updated: "2026-05-13T10:50:55.052Z"
last_activity: 2026-05-13
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-10)

**Core value:** Drug-level projection + injection-site rotation are the headline; everything else feeds context into that picture or interprets it.
**Current focus:** Phase 10 — clinic-operator-surface (ready to execute)

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-05-13 — Milestone v1.2 started

### Phase 9 close (2026-05-13)

All 11 plans landed on `origin/main` in 6 waves (Wave 1 schema + Wave-0 scaffolds → Wave 2 four parallel UI slices + patient-side scope → Wave 3 two Edge Functions + WorkspaceSwitcher → Wave 4 e2e + close). 14 migrations live on `ytnsipxxmzgaebkqmokp` (000000-000013); 16 SECURITY DEFINER RPCs + has_permission helper + Realtime broadcast trigger + realtime.messages RLS deployed. Bundle topology held: index 12.39 kB gz (Phase 9 working ceiling 24.5 kB); clinic 16.17 kB gz; clinic-settings 7.78 kB gz; clinic-invite ~4.84 kB gz; vendor-supabase 53 kB gz. 16 RTL files + 18 Deno tests + 15 Deno tests (clinic-photo) + 9 Playwright fixtures (Pitfall #8 + photo-access + role-grid) + 7 Playwright fixtures (revoke-latency + realtime negative-space) authored. Deferred items captured below.

Progress: [█████████░] 96%

## Performance Metrics

**Velocity:**

- Total plans completed: 6
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| — | — | — | — |
| 01 | 6 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 04 P01 | 30 | 6 tasks | 7 files |
| Phase 04 P03 | ~3.0h | 6 tasks | 16 files |
| Phase 07 P05 | 18min | 4 tasks | 4 files |
| Phase 07 P03 | 21 | 2 tasks | 4 files |
| Phase 07 P04 | 435 | 2 tasks | 5 files |
| Phase 07 P07 | 150min | - tasks | - files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Project init: Backend platform = Supabase (not Cloudflare Workers + Better Auth + Neon — supersedes research synthesis)
- Project init: Sync = Supabase Realtime + Zustand local cache + IndexedDB offline queue (NOT TanStack Query)
- Project init: Photos move to Supabase Storage in v1 (was v2 in synthesizer's plan)
- Project init: AI proxy runtime = Supabase Edge Functions (Deno) — same proxy pattern as research-recommended Cloudflare Worker, different runtime
- Project init: Vertical MVP phase mode (each phase = end-to-end user-visible slice)
- Roadmap: 10 phases at fine granularity; visible compliance copy lands Phase 2; legal-counsel-led compliance foundations sit at Phase 7 (parallelizable with cloud work)
- [Phase ?]: Phase 4 mid-execution pivot: Anthropic Claude Sonnet → Moonshot Kimi K2 (direct provider call, not Vercel AI Gateway); see 04-ADDENDUM-MOONSHOT.md
- [Phase ?]: Supabase project ytnsipxxmzgaebkqmokp provisioned in eu-west-1; rate-limit thresholds 30/60/200, anon cleanup pg_cron daily 03:00 UTC (30-day retention)
- [Phase ?]: Audit-trail ordering: refused user inputs persist to ai_messages BEFORE the refusal short-circuit fires; refusal also persisted as assistant turn with model='refusal-precheck' (T-04-01 evidence inspectable post-mortem)
- [Phase ?]: PostgreSQL reserved keyword 'window' requires double-quoting throughout the rate_limit_counters migration (column, PK, INSERT, ON CONFLICT); function parameter p_window is unaffected
- [Phase ?]: ESLint v9 flat-config refuses to lint files outside config base path; shared/ quality coverage delegated to typecheck + vitest + CI deno-test job
- [Phase ?]: 70-row adversarial corpus (vs 50 floor): 25 dose-change + 5 prompt-injection + 5 system-extraction + 5 emotional-manipulation + 30 benign-pass
- [Phase ?]: Plan 07-05: HBNR runbook + founder acknowledgement; ROADMAP SC#3 corrected (no FTC registration exists)
- [Phase ?]: 07-03 D-01: Hand-rolled WMHMDA CHDP from RCW 19.373.030 primary source per Researcher KF #7 (Termly/iubenda free outputs both fold §4 third parties); manifest-pinned drift gate in e2e/legal-pages.spec.ts
- [Phase ?]: 07-07 ships account-delete RPC + T+30 pg_cron; 4 deviation migrations handle Supabase quirks — search_path/digest, storage delete bypass, audit cascade FK via custom GUC
- [Phase ?]: RESTRICTIVE Storage RLS on photos-pending-shred/% — defense-in-depth: even original owner cannot read their pending-shred photos before T+30 hard-delete — D-03 crypto-shred guarantee on free-tier
- [Phase 9]: has_permission(user_id, org_id, permission_key) SECURITY DEFINER STABLE helper is the SINGLE RLS dispatch primitive for clinic-scoped tables; all RLS policies on memberships/roles/role_permissions/realtime.messages/storage delegate to it (no inline tenancy checks in policies)
- [Phase 9]: Realtime cross-tenant subscribe uses private channels + realtime.broadcast_changes trigger + realtime.messages RLS — supersedes postgres_changes for any cross-tenant subscription (operator org channel + patient user channel)
- [Phase 9]: org-deletion cascades require BOTH `app.suppress_audit` GUC + `storage.allow_delete_query` GUC; applied preventively in delete_org RPC (extends Phase 7 finalize_account_deletion gotcha pattern to org-scope)
- [Phase 9]: D-13 accepted tradeoff — clinic-photo signed URLs have 5-min TTL; revoke kills NEW mints immediately (Layer 2 DB check) but existing URLs stay valid until natural TTL expiry. UX overlay (Realtime broadcast) evicts the operator's open tab within 1s
- [Phase 9]: Pitfall #11 invariant — clinic-* Edge Functions use JWT-or-token-in-URL auth; NO cookies; CORS allow `*` Origin acceptable (no credentials means no SOP risk)
- [Phase 9]: Wave-0 ownership rule (B-5, plan-checker iter 1) — the plan that creates Wave-0 scaffolds (App.tsx routing + stub files + RLS proofs + migration push) ALSO flips wave_0_complete + nyquist_compliant in VALIDATION.md immediately after the scaffolds are verified present (Plan 09-01 Task 2). Phase-close plan only flips status: complete (Plan 09-11)
- [Phase 9]: D-02 anti-enumeration invariant (W-1 reinforcement) — universal `{ok: true, invite_id}` server response shape + universal "Invitation sent" UI copy at every send-invite surface. No branching on email-existence anywhere in the call chain. Source-scan tests + RTL invariant tests gate this
- [Phase 9]: Stub-overwrite ownership pattern (B-2, plan-checker iter 1) — Wave-1 plan creates App.tsx routing + 4 stub component files; Wave-2 plans OVERWRITE stub bodies in place (never touch App.tsx). Git-diff invariant verified at every Wave-2 plan close

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 7 (Compliance Foundations) requires privacy-law counsel engagement — not engineering-only; treat as external dependency to start sourcing during Phase 1–2 so review is queued before broad public launch
- Phase 2 includes a hosting-target decision (Vercel / Cloudflare Pages / Netlify) that was deferred to deploy phase per PROJECT.md — surface during Phase 2 planning
- v2 codebase has zero tests (per CONCERNS.md); Phase 1 must wire Vitest + CI before Phase 3 can land the pharmacology test corpus
- Hardcoded `claude-sonnet-4-6` model ID in `src/lib/ai.ts:22` is bogus and 404s — Phase 4 fixes; if any user-facing AI work happens before Phase 4, surface a "AI temporarily unavailable" toast
- REQUIREMENTS.md footer claims 42 v1 requirements but actual count is 48 across the 8 categories — corrected during traceability mapping
- Wave-2 cross-contamination: commit ee5ee5e bundled 07-02 sibling staged files into 07-05 Task 2 commit (single-repo checkout, no per-agent isolation). See 07-05-SUMMARY.md Deviations §1.
- **[2026-05-12] Phase 8 plan-phase BLOCKER (repeated):** Two consecutive background-runner spawns for `gsd-plan-phase 8 --auto` have now confirmed the runner lacks the `Task` (subagent-spawning) tool — only `mcp__plugin_mempalace_mempalace__mempalace_diary_write` matched an Agent/subagent ToolSearch. The plan-phase workflow requires spawning `gsd-phase-researcher`, `gsd-planner`, and `gsd-plan-checker` subagents — none can be invoked here. No `RESEARCH.md`, `VALIDATION.md`, or `PLAN.md` files were created on either attempt. **Resolution:** re-run `/gsd-plan-phase 8 --auto` from a foreground Claude Code session (or a runner with the Task tool enabled) so the orchestrator can spawn subagents. Phase 8 directory state at blocker time: `08-CONTEXT.md` + `08-DISCUSSION-LOG.md` present; `has_research=false`, `has_plans=false`. MVP mode is active (set via ROADMAP `**Mode:** mvp`); planner must honor MVP slice ordering when re-run. Stop spawning background runners for plan-phase until the runtime confirms `Task` tool availability.
- **[2026-05-12] Phase 9 plan-phase BLOCKER (same root cause):** Background-runner instance for `gsd-plan-phase 9 --auto` also lacks the `Task` (subagent-spawning) tool. `ToolSearch select:Task` returned "No matching deferred tools found"; no `Agent`/`Task` tool surfaced in the runner's catalog. The plan-phase workflow at `~/.claude/get-shit-done/workflows/plan-phase.md` requires spawning `gsd-phase-researcher` (step 5), `gsd-pattern-mapper` (step 7.8), `gsd-planner` (step 8), and `gsd-plan-checker` (verification loop in step 9) — none can be invoked. No `RESEARCH.md`, `PATTERNS.md`, `VALIDATION.md`, or `PLAN.md` files were created for Phase 9. **Resolution:** re-run `/gsd-plan-phase 9 --auto` from a foreground Claude Code session (or a runner with the Task tool enabled). Phase 9 directory state at blocker time: `09-CONTEXT.md` (18 locked decisions D-01..D-18; D-07 pulls full role system forward from Phase 10) + `09-DISCUSSION-LOG.md` present; `has_research=false`, `has_plans=false`. Phase 9 mode is `mvp` per orchestrator brief; planner must honor MVP/SPIDR slice ordering and the ROADMAP Phase 9/Phase 10 scope-shift (Phase 10 shrinks to roster ranking + drill-in + audit-log surface). ROADMAP.md Phase 9 + Phase 10 entries also need updating to reflect the D-07 scope expansion BEFORE finalizing plans. Stop spawning background runners for plan-phase until runtime confirms `Task` tool availability — pattern is now confirmed across two consecutive phases (8 and 9).

## Quick Tasks Completed

| Date | Slug | Summary |
|------|------|---------|
| 2026-05-11 | fix-focus-loop-and-console | FocusCard infinite render loop, PostHog placeholder init, deprecated mobile-web-app meta |
| 2026-05-11 | fix-insights-and-home-render-loop | InsightsTab + HomeTab infinite render loops (`generateInsights` as Zustand selector) |
| 2026-05-11 | eslint-guard-unstable-selectors | ESLint `no-restricted-syntax` rule blocking `useStore(generateInsights\|pickFocus)` |
| 2026-05-11 | add-dist-marketing-to-eslint-ignores | Added `dist-marketing/**` to ESLint global ignores — eliminates ~1378 spurious errors from `npx eslint .` |

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Phase 9 infra | Resend domain verification + RESEND_FROM swap (currently sandbox `onboarding@resend.dev` — clinic invites to real patients won't dispatch until domain verified) | Open — orchestrator/user action | 2026-05-13 (Plan 09-06 close) |
| Phase 9 CI | 6 RLS impersonation specs (rls-orgs/memberships/invites/roles/role-permissions/org-logos-storage) authored but not RUN against live DB — need SUPABASE_URL + SERVICE_ROLE_KEY env in CI | Open — CI infra | 2026-05-13 (Plan 09-01 close) |
| Phase 9 tests | OrgCreateFlow taken-slug test fixme'd (mockReturnValueOnce queue carry-over; fix: mockReset in beforeEach) | Open — Phase 9 verifier at v1.2 milestone close | 2026-05-13 (Plan 09-02 close, `deferred-tests.md`) |
| Phase 9 ops | bundle-budget script hash-hyphen glob fix landed Plan 09-03; verify it survives Phase 10 manualChunks additions | Resolved Plan 09-03; monitor | 2026-05-13 |
| Phase 9 CI gate | GitHub branch-protection job for `share-security-drill` (Phase 8 carry-over) | Open — Phase 10 entry | 2026-05-13 |
| Phase 9 hardening | Pre-existing 7 SharePage lint errors flagged in Phase 8 ship; clinic surfaces add 0 new lint errors | Open — hardening pass | 2026-05-13 |
| Phase 9 hardening | `s.user!` latent assertion audit (14 files / 15 occurrences from Phase 7 inventory) | Open — Phase 10+ hardening | 2026-05-13 |

## Session Continuity

Last session: 2026-05-13T12:00:00.000Z
Stopped at: Phase 9 close (11/11 plans + 09-SUMMARY.md + ROADMAP/REQUIREMENTS sync); Phase 10 plan-phase already complete in parallel — ready to execute
Resume file: .planning/phases/10-clinic-operator-surface/10-01-PLAN.md
