# Phase 4: Supabase Cloud Bootstrap + AI Proxy on Edge Functions - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-11
**Phase:** 04-supabase-cloud-bootstrap-ai-proxy-on-edge-functions
**Areas discussed:** Plan structure + Supabase tooling, Auth dependency for AI, BYO key fate, Refusal-list reuse, Streaming protocol, Model ID strategy

---

## Plan structure + Supabase tooling

| Option | Description | Selected |
|--------|-------------|----------|
| 3 plans + Supabase CLI | 4-01 bootstrap, 4-02 proxy skeleton, 4-03 hardening; reproducible from repo | ✓ |
| 2 plans + Supabase CLI | 4-01 bootstrap, 4-02 proxy+hardening single big plan | |
| 1 plan + checkpoint + Supabase CLI | Single plan with autonomous:false human checkpoint between SC#0 and SC#1-5 | |
| MCP for bootstrap only, CLI thereafter | MCP one-shot create, CLI for ai-chat deploy + migrations | |

**User's choice:** 3 plans + Supabase CLI (Recommended)
**Notes:** User mentioned they have a Supabase account and asked about CLI vs MCP. Locked on CLI for reproducibility; ROADMAP explicitly flagged this as a discuss-phase item.

---

## Auth dependency for AI chat in Phase 4

| Option | Description | Selected |
|--------|-------------|----------|
| Supabase anonymous auth | signInAnonymously() silent gate; UID anchors AI-02 rate limit + AI-05 RLS; linkIdentity at Phase 5 | ✓ |
| Anonymous + IP-keyed rate limit | No sign-in; AI history stays in localStorage; defers ai_messages RLS table to Phase 5 | |
| Hybrid (anonymous low cap + sign-in higher cap) | Two code paths; pricing-tier preview | |
| Require magic-link sign-in now | Pulls Phase 5 AUTH-01 forward; fragments Phase 5 scope | |

**User's choice:** Require Supabase anonymous auth (Recommended)
**Notes:** Trade-off accepted: ~50ms first-chat latency for clean RLS path. Anon-row cleanup deferred to research recommendation.

---

## BYO key fate

| Option | Description | Selected |
|--------|-------------|----------|
| Remove BYO entirely | Delete Settings card + Landing FAQ; replace src/lib/ai.ts with proxy wrapper; drop apiKeyStorage | ✓ |
| Keep BYO as Advanced toggle | Move to `<details>` expander; doubles call-site code; undermines AI-02 enforcement | |
| Remove UI but keep apiKeyStorage helper | Dead code; flagged by lint | |

**User's choice:** Remove BYO entirely (Recommended)
**Notes:** Clean break. No migration overhead. Phase 5 onboarding will silently localStorage.removeItem('leanshot_anthropic_key').

---

## Refusal-list reuse strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Extract to project-root shared/refusal.ts | Pure TS module; browser + Deno via import_map.json; single test corpus | ✓ |
| Duplicate into supabase/functions/ai-chat/refusal.ts | Drift risk; two test runs against potentially diverging code | |
| Deno-compatible insights-refusal.ts in place | Refactor src/lib in place; Edge Function imports via relative path; couples client/server paths | |

**User's choice:** Extract to project-root shared/refusal.ts (Recommended)
**Notes:** Phase 3 fix commits (CR-01 multi-occurrence walk, CR-02 expanded STEM_PATTERN) move to shared/refusal.ts in their post-fix state. No regression of Phase 3 critical fixes.

---

## Streaming protocol

| Option | Description | Selected |
|--------|-------------|----------|
| SSE pass-through | Edge Function streams Anthropic SSE to browser; preserves typing UX; ~20 LOC stream wiring + client parser | ✓ |
| Buffered text response | Edge Function awaits full response; one JSON blob; simpler proxy, worse UX | |

**User's choice:** SSE pass-through (Recommended)
**Notes:** Preserves Phase-2-baseline typing-effect UX.

---

## Model ID strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Env var ANTHROPIC_MODEL with default claude-sonnet-4-6 | Settable via supabase secrets without redeploy; CI asserts | ✓ |
| Hard-pin claude-sonnet-4-6 in code | No env var; every model bump is a PR | |
| Hard-pin to a dated snapshot (e.g., claude-sonnet-4-6-20251001) | Max stability; eventual deprecation risk | |

**User's choice:** Env var ANTHROPIC_MODEL with default claude-sonnet-4-6 (Recommended)
**Notes:** Researcher should re-verify "current latest stable Sonnet" at execution time.

---

## Claude's Discretion

Items deferred to researcher/planner:
- Exact rate-limit thresholds (SC#4 mandates "100 messages in 60 seconds is rate-limited")
- Anonymous-row cleanup policy (recommended: 90-day pg_cron, but planner's call)
- `ai_messages` table schema (columns + indexing)
- `rate_limit_counters` table schema (fixed-window vs sliding-window)
- Whether `leanshot-marketing` Vercel project genuinely needs Supabase env vars
- System-prompt content + persona for the AI coach
- Whether to migrate or abandon existing `aiHistory` localStorage data
- Adversarial corpus authoring style (one big array vs grouped by attack pattern)

## Deferred Ideas

Moved to backlog / future phases:
- Pricing-tier rate limits (post-v1)
- EHR integration / direct doctor portal API (out of v1 scope per CLAUDE.md constraints)
- Voice input / TTS for AI coach (future)
- AI coach memory / RAG over user data set (out of v1)
- Magic-link sign-in UI (Phase 5)
- aiHistory localStorage migration (re-evaluate in Phase 5 with `leanshot_v4` migration)
- BYO key as Advanced toggle (rejected for v1; could revisit post-v1)
