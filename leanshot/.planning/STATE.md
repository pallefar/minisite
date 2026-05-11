---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: milestone
status: executing
stopped_at: Phase 5 context gathered (14 decisions locked, 11 discretion items)
last_updated: "2026-05-11T20:02:00.244Z"
last_activity: 2026-05-11 -- Phase 05 execution started
progress:
  total_phases: 11
  completed_phases: 5
  total_plans: 30
  completed_plans: 27
  percent: 90
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-10)

**Core value:** Drug-level projection + injection-site rotation are the headline; everything else feeds context into that picture or interprets it.
**Current focus:** Phase 05 — patient-cloud-sync-slice-1-auth-injections

## Current Position

Phase: 05 (patient-cloud-sync-slice-1-auth-injections) — EXECUTING
Plan: 1 of 3
Status: Executing Phase 05
Last activity: 2026-05-11 -- Phase 05 execution started

Progress: [██████████] 100%

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

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 7 (Compliance Foundations) requires privacy-law counsel engagement — not engineering-only; treat as external dependency to start sourcing during Phase 1–2 so review is queued before broad public launch
- Phase 2 includes a hosting-target decision (Vercel / Cloudflare Pages / Netlify) that was deferred to deploy phase per PROJECT.md — surface during Phase 2 planning
- v2 codebase has zero tests (per CONCERNS.md); Phase 1 must wire Vitest + CI before Phase 3 can land the pharmacology test corpus
- Hardcoded `claude-sonnet-4-6` model ID in `src/lib/ai.ts:22` is bogus and 404s — Phase 4 fixes; if any user-facing AI work happens before Phase 4, surface a "AI temporarily unavailable" toast
- REQUIREMENTS.md footer claims 42 v1 requirements but actual count is 48 across the 8 categories — corrected during traceability mapping

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
| *(none — first milestone)* | | | |

## Session Continuity

Last session: 2026-05-11T19:03:06.722Z
Stopped at: Phase 5 context gathered (14 decisions locked, 11 discretion items)
Resume file: .planning/phases/05-patient-cloud-sync-slice-1-auth-injections/05-CONTEXT.md
