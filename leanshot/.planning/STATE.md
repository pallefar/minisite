---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Platform Expansion — Revenue + Depth + B2B + HIPAA + M4 Community
status: planning
last_updated: "2026-05-17T12:00:00.000Z"
last_activity: 2026-05-17
progress:
  total_phases: 26
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-17 for v1.3 milestone)

**Core value:** Drug-level projection + injection-site rotation are the headline; everything else feeds context into that picture or interprets it.
**Current focus:** v1.3 roadmap created — Phase 24 (Foundation: Modular Admin Shell + Event Taxonomy + Server-side PostHog) is the next plan-phase target.

## Current Position

Phase: Not started (roadmap created; awaiting plan-phase on Phase 24)
Plan: —
Status: Roadmap created
Last activity: 2026-05-17 — v1.3 roadmap created (26 phases, 204 REQ-IDs across 24 workstreams)

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

Progress: [          ] 0%

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

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- v1.3 milestone open (2026-05-17): 26 phases at fine granularity, yolo mode; phase numbering continues from v1.2 (24-49, no reset)
- v1.3 stack additions (from `.planning/research/STACK.md`): react-i18next 15.7.4 + posthog-node 5.10.4 (Edge Fn) + pgvector + openai 6.13.0 (embeddings via AI Gateway) + @tanstack/react-query 5.x + react-table 8.x + react-virtual 3.x + react-markdown 9.x + remark-gfm + rehype-sanitize + dompurify 3.2.7 + canvas-confetti 1.9.3 + Resend Inbound + Better Stack + Meta/Google/TikTok ad SDKs + AWS SES (PHI path)
- v1.3 architecture: EXTENDS v1.2 (no rewrite); NEW org-context layer in `src/lib/org.ts`; NEW JWT `app_metadata.org_ids` claim with 336ms propagation window
- v1.3 hard constraints: HIPAA BAA chain (6 vendors) + Stripe never signs BAA (PHI lint) + dual Anthropic credentials + activation event locks PAYWALL/REVIEW/RECOMMEND + page-builder canonical-link discipline + App/Play native review-prompt unconditional + i18n via `?lang=es` query (not `/es/` path)
- v1.3 bundle: 50 kB gz index hard ceiling; per-chunk ceilings declared in P24 — admin-shell 30 kB, helpdesk-widget 25 kB, i18n-runtime 15 kB, gamification-burst 8 kB, community-feed 20 kB, course-player 30 kB
- v1.3 vendor cost when HIPAA chain activates: +$1,864-4,364/mo (Supabase Team+addon $924, Vercel Pro+addon $350, Sentry Business $80, Anthropic Enterprise $500-2K, PostHog Boost optional $0-2K, AWS SES ~$10)

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

Last session: 2026-05-17T12:00:00.000Z
Stopped at: v1.3 roadmap created
Resume file: None

## Operator Next Steps

- Run `/gsd-plan-phase 24 leanshot` to plan Phase 24 (Foundation — Modular Admin Shell + Event Taxonomy + Server-side PostHog)
- In PARALLEL: kick off Wave-0 vendor calls for Phase 25 BAA chain (Resend, Anthropic Enterprise, PostHog tier, Supabase Team+HIPAA, Vercel HIPAA, Sentry Business, Meta Ads App Review)
