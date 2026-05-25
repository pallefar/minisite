# Phase 38 — Framework Selection

**Phase:** M5b AI Recommender (pgvector + Claude Digest)
**Date:** 2026-05-19
**Selector:** gsd-framework-selector
**Status:** RECOMMENDATION

---

## Project Signals (codebase scan)

- **Frontend stack:** Vite + React 19 + TS strict + Tailwind v4 + Zustand. SPA, no Node runtime in prod.
- **Backend stack:** Supabase Postgres + Supabase Edge Functions (Deno). Locked v1.1.
- **Existing AI surface:** `src/lib/ai.ts` — direct `fetch` wrapper around Anthropic Messages API (`anthropic-dangerous-direct-browser-access: true`). No framework. ~50 LOC.
- **AI proxy posture (Phase 19/25):** Vercel AI Gateway sits in front of Anthropic and OpenAI. Server-side calls only — no SDK in browser bundle.
- **Existing AI deps in `package.json`:** *none* (no `@anthropic-ai/sdk`, no `openai`, no `langchain`, no `llamaindex`, no `crewai`). The team has already rejected SDK-based AI layers in favor of thin `fetch` wrappers.
- **Compliance posture:** HIPAA-engineering controls locked Phase 25. BAA-scope guard, PHI lint, email-router. All AI calls server-side via Edge Fns.
- **Vector store:** pgvector on Supabase Pro+ — already provisioned (RECOMMEND-01 locked).
- **Embedding provider:** OpenAI `text-embedding-3-small` via Vercel AI Gateway — locked (RECOMMEND-02).
- **Scheduler:** Supabase `pg_cron` + Edge Fn — pattern already proven (Phase 25 subprocessor cron, Phase 33 ad-spend ETL).
- **Email:** Resend (non-PHI) / SES (PHI) via `_shared/email-router.ts` — locked Phase 25.

## System Type Classification

**Primary:** RAG (similarity retrieval over `content_embeddings`) + scheduled single-turn summarization.
**Secondary:** Lightweight recommender (cosine + business-rule scoring) + cron-triggered batch email digest.

This is **NOT**:
- An agent (no multi-turn tool use, no autonomous planning)
- A multi-agent system (one LLM call per digest, one Edge Fn per recommendation)
- A conversational system (Claude Digest is a one-shot summarization with structured output)
- A code-aware system

The decision matrix maps this to "RAG / Document Q&A" → **LlamaIndex** or **LangChain**. But there is a strong third option the matrix doesn't explicitly enumerate: **no framework** (direct provider calls).

## Hard Constraints

| Constraint | Source | Implication |
|---|---|---|
| Must run in Deno (Supabase Edge Functions) | Locked v1.1 stack | Eliminates Python-only frameworks (CrewAI, Haystack, Google ADK) |
| Must call OpenAI + Anthropic via Vercel AI Gateway | Phase 25 vendor-BAA chain | Framework must permit custom base URLs / proxy posture |
| Must integrate with pgvector (Supabase) | RECOMMEND-01 locked | Framework's vector-store abstraction is irrelevant — pgvector is direct SQL |
| Bundle / cold-start budget | Edge Fn cold start <500ms | Eliminates heavy frameworks (LangChain JS, LlamaIndex TS bring ~2-4MB deps) |
| No new infra | Project memory: CLI-over-paste preference, no new vendors | Eliminates frameworks requiring their own state stores / tracing backends |
| Server-side only AI (no SDK in browser bundle) | v1.2 bundle ceiling rules | Already enforced — does not constrain framework choice further |

## Eliminated Frameworks

- **CrewAI** — Python only; not a RAG framework.
- **Haystack** — Python only.
- **Google ADK** — Python/Java; Gemini-biased; team uses OpenAI + Anthropic.
- **OpenAI Agents SDK** — Agent-framing wrong for this surface; OpenAI used only for embeddings here, not generation.
- **Claude Agent SDK** — Code-agent framing wrong; weekly digest is a single-turn summarization, not an agent.
- **AutoGen / AG2** — Multi-agent; wrong shape; .NET-oriented.
- **LangGraph** — Stateful graph workflows; the recommender is stateless cosine + scoring, the digest is one shot. Overkill.

## Final Three

| Option | Fit | Risk |
|---|---|---|
| **No framework (direct fetch wrappers in Deno)** | Excellent — mirrors existing `src/lib/ai.ts` pattern, zero new deps, Deno-native, trivially typed against Vercel AI Gateway OpenAI-compatible endpoint | Team owns retries/timeouts/observability — but Phase 24 server-side PostHog + Sentry already cover this |
| **LlamaIndex TS** | RAG-purpose-built; LlamaParse not needed (content is already markdown); the vector-store abstraction is wasted on pgvector | Bundle bloat in Edge Fn; framework abstractions hide what is fundamentally 2 SQL queries + 2 fetch calls; npm-on-Deno via `npm:` specifier is slow cold-start |
| **LangChain JS** | Widest integrations | Heaviest; explicitly anti-patterned in the decision matrix for simple well-defined use cases ("Using LangChain for simple chatbots — direct SDK call is less code, faster, and easier to debug"); same Deno cold-start risk |

---

## Recommendation

### Primary: **No framework — direct fetch wrappers** (extend `_shared/` pattern in `supabase/functions/`)

**Rationale:**
1. The entire surface decomposes to **4 mechanical operations** that no framework adds value to:
   - `POST /v1/embeddings` (OpenAI via Vercel AI Gateway) → 1 fetch call
   - `INSERT INTO content_embeddings ... ON CONFLICT` → 1 SQL statement
   - `SELECT ... ORDER BY embedding <=> $1 LIMIT 3` (pgvector cosine) → 1 SQL statement
   - `POST /v1/messages` (Anthropic via Vercel AI Gateway) → 1 fetch call
2. Vercel AI Gateway exposes **OpenAI-compatible** endpoints — a `fetch` with a base URL is the entire integration layer. Frameworks add abstractions that obscure the proxy posture HIPAA Phase 25 explicitly engineered.
3. The codebase has **already established** the pattern (`src/lib/ai.ts`, `_shared/email-router.ts`, `_shared/refusal/`, `_shared/posthog-server.ts`). Continuing it preserves cognitive consistency.
4. Edge Function **cold-start budget** is incompatible with npm-on-Deno framework imports (LangChain JS pulls ~40 transitive deps; LlamaIndex TS ~25).
5. The "framework" the matrix would pick (LlamaIndex) addresses ingestion, parsing, and retrieval-strategy mixing — **all three are non-issues here**: content is already markdown in Supabase tables, retrieval is one cosine query, no reranker is in scope for v1.
6. Anti-pattern #1 in the reference doc applies almost verbatim: "Using LangChain for simple chatbots — direct SDK call is less code, faster, and easier to debug." Substitute "summarization Edge Fn" for "chatbot".
7. Observability is already wired: Sentry (Phase 25 PHI-scrub) + server-side PostHog (Phase 24) + structured Edge Fn logs. No tracing framework needed.

**Concrete deliverables (no framework):**
- `supabase/functions/_shared/openai-embed.ts` — fetch wrapper, retry-on-429, returns `vector(1536)` as `number[]`.
- `supabase/functions/_shared/anthropic-summarize.ts` — fetch wrapper, JSON-mode prompt with action schema, returns typed `{ narrative, actions[] }`.
- `supabase/functions/embed-content-nightly/index.ts` — pg_cron-triggered; queries new rows; batch-embeds; bulk insert.
- `supabase/functions/recommend-next-best-action/index.ts` — user_id + recent events → SQL cosine query + business-rule re-ranker → top-3.
- `supabase/functions/weekly-digest/index.ts` — pg_cron-triggered per user timezone; pulls recent activity; calls Claude; routes via `_shared/email-router.ts`.
- `supabase/functions/personalize-offer/index.ts` — called from PAYWALL + SAVE (RECOMMEND-09).
- `supabase/functions/winback-scorer/index.ts` — nightly cron computing `days-since × declining-streak × paywall-dismissals`; auto-fires SAVE-engine row (RECOMMEND-10).

### Alternative: **LlamaIndex TS** (if framework is mandated downstream)

**Alternative reason:** If a future phase introduces multi-modal retrieval (e.g., adding a graph store, a reranker, hybrid BM25+vector, or multi-document fusion), LlamaIndex TS becomes the natural upgrade path — its retrieval-strategy mixing is its core strength. For Phase 38 alone, it is overkill, but the migration cost from "direct fetch + SQL" to "LlamaIndex with pgvector storage adapter" is low (~1 day) because we wouldn't have leaked LangChain-shaped abstractions.

---

## Eval Concerns (this system type)

Primary eval dimensions to instrument from day one:

1. **Retrieval precision @3** — does the cosine query surface relevant content? Manual labeled set of 50 (user_state → expected_recommendation) tuples; CI gate ≥0.8.
2. **Context faithfulness** of weekly digest — does Claude's narrative cite only data in the input prompt, no hallucinated metrics? RAGAS-style faithfulness or LLM-as-judge.
3. **Action validity** — are the 1–3 suggested actions in the weekly digest within the whitelist (RECOMMEND-07 guardrails)? Schema validation + admin spot-check queue.
4. **Recommendation CTR** — RECOMMEND-06: Sentry/PostHog event tracking; admin dashboard slice.
5. **Cost adherence** — embeddings cost per user per month; digest tokens per user per week. Vercel AI Gateway provides per-tenant metering.
6. **Latency** — Next-Best-Action Edge Fn P95 <800ms (1 SQL cosine + optional Claude call); weekly-digest async (no user-facing latency).
7. **Safety / PHI scope** — every Anthropic call must pass through BAA-scope guard (Phase 25 HIPAA-01); CI lint enforces.

---

## Orchestrator Handoff

```yaml
FRAMEWORK_RECOMMENDATION:
  primary: "No framework — direct fetch wrappers in Supabase Edge Functions (Deno) extending the existing _shared/* pattern"
  rationale: |
    The Phase 38 surface decomposes to 4 mechanical operations (1 embed call,
    1 SQL insert, 1 cosine SELECT, 1 summarize call) wrapped in pg_cron
    schedulers. The Vercel AI Gateway exposes OpenAI-compatible endpoints
    that a fetch wrapper handles natively, and the existing _shared/email-router,
    _shared/refusal, and _shared/posthog-server pattern already establishes
    this idiom. Framework abstractions (LangChain/LlamaIndex) would obscure
    the BAA-scope-guard proxy posture engineered in Phase 25 and bloat
    Edge Fn cold-start beyond budget.
  alternative: "LlamaIndex TS"
  alternative_reason: |
    If a future phase adds reranking, hybrid BM25+vector, graph stores, or
    multi-document fusion, LlamaIndex's retrieval-strategy mixing becomes
    the natural upgrade path with low migration cost since we won't have
    leaked framework-shaped abstractions in Phase 38.
  system_type: "RAG"
  model_provider: "Model-agnostic via Vercel AI Gateway (OpenAI embeddings + Anthropic summarization)"
  eval_concerns: "retrieval precision @3, context faithfulness, action validity, recommendation CTR, cost adherence, latency P95, PHI/BAA-scope compliance"
  hard_constraints:
    - "Deno runtime (Supabase Edge Functions)"
    - "Vercel AI Gateway proxy posture (HIPAA Phase 25)"
    - "Edge Fn cold-start <500ms"
    - "No new vendors / infra"
    - "Server-side only (no AI SDK in browser bundle)"
  existing_ecosystem:
    - "Supabase Edge Functions (Deno) with _shared/email-router, _shared/refusal, _shared/posthog-server"
    - "pgvector on Supabase Pro+"
    - "Vercel AI Gateway in front of OpenAI + Anthropic"
    - "Resend / SES split via _shared/email-router.ts (Phase 25)"
    - "Sentry (PHI-scrub) + server-side PostHog (Phase 24)"
    - "pg_cron pattern (Phase 25 subprocessor cron, Phase 33 ad-spend ETL)"
    - "Browser AI wrapper at src/lib/ai.ts — pattern to mirror server-side"
```
