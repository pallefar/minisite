---
phase: 60-rag-knowledge-base-completion-waves-2-4
plan: "05"
subsystem: rag-embed-approved
tags: [rag, embeddings, openrouter, pgvector, edge-fn, wave-1]
dependency_graph:
  requires: [60-01, 60-02]
  provides: [rag-embed-approved Edge Fn, external_kb_embeddings population]
  affects: [60-06 (rag-retrieve consumes external_kb_embeddings), 60-15 (deploy + cron)]
tech_stack:
  added:
    - "supabase/functions/rag-embed-approved/ — new Edge Fn (handler.ts + openai.ts + index.ts)"
  patterns:
    - "Dependency-injected handler (handler.ts) separated from Deno entry-point (index.ts) for Vitest testability"
    - "OpenRouter vendor routing for embeddings (single key for chat + embed in Phase 60)"
    - "OpenAIEmbedBatchClient with injectable fetch + sleepImpl for deterministic tests"
    - "LIVE_DB=true gate on Deno integration tests (CI-safe skip)"
key_files:
  created:
    - supabase/functions/rag-embed-approved/openai.ts
    - supabase/functions/rag-embed-approved/handler.ts
    - supabase/functions/rag-embed-approved/index.ts
    - supabase/functions/rag-embed-approved/deno.json
    - supabase/functions/rag-embed-approved/__tests__/openai.test.ts
    - supabase/functions/rag-embed-approved/__tests__/embed-pipeline.test.ts
    - supabase/functions/rag-embed-approved/__tests__/integration.test.ts
  modified:
    - leanshot/vite.config.ts (extended test.include for supabase/functions/rag-embed-approved/__tests__)
decisions:
  - "Vendor: OpenRouter (override) instead of Vercel AI Gateway per operator direction 2026-05-26"
  - "handler.ts separated from index.ts so Vitest (Node) can import the handler without hitting npm: specifiers"
  - "emitAiGeneration userId = 'rag-system' (canonical system actor D-13 for cron-attributed events)"
  - "Deno.serve guarded by import.meta.main per reference_deno_test_top_level_serve_trap"
  - "Per-Fn deno.json with explicit imports map (no reliance on repo-root import_map.json)"
  - "deploy deferred to 60-15 per feedback_fn_deploy_before_cron_db_push ordering rule"
metrics:
  duration: "~30 minutes"
  completed: "2026-05-26"
  tasks_completed: 3
  tasks_total: 3
  test_files_created: 3
  source_files_created: 7
---

# Phase 60 Plan 05: rag-embed-approved Edge Function Summary

One-liner: OpenRouter-routed batch embed pipeline persisting 1536-dim pgvector embeddings from approved rag_chunks into external_kb_embeddings with 3-attempt backoff, ON CONFLICT idempotency, per-batch cost telemetry, and injectable test seams.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | OpenAI batch-embed client (TDD GREEN) | cb8ee9c6 | openai.ts, deno.json, __tests__/openai.test.ts, vite.config.ts |
| 2 | rag-embed-approved handler (TDD GREEN) | 5823290c | handler.ts, index.ts, __tests__/embed-pipeline.test.ts |
| 3 | LIVE_DB-gated integration test | 723c22cc | __tests__/integration.test.ts |

## Test Outcomes

- **Vitest (openai.test.ts):** 8/8 tests green
- **Vitest (embed-pipeline.test.ts):** 13/13 tests green
- **Total Vitest:** 21/21 passing
- **Deno check:** handler.ts + openai.ts + index.ts + integration.test.ts — all clean
- **Deno integration:** `LIVE_DB unset` skip message; exits 0 under CI defaults

## Files Created

| File | Lines | Description |
|------|-------|-------------|
| supabase/functions/rag-embed-approved/openai.ts | 281 | OpenAIEmbedBatchClient: 3-attempt backoff, Retry-After honor, 4 typed error classes |
| supabase/functions/rag-embed-approved/handler.ts | 345 | Pure dependency-injected handler; selection query, batch loop, upsert, cost guardrails |
| supabase/functions/rag-embed-approved/index.ts | 102 | Deno entry-point: prod wiring + Deno.serve guarded by import.meta.main |
| supabase/functions/rag-embed-approved/deno.json | 18 | Per-Fn import map (npm:@supabase/supabase-js@^2.105, npm:zod@^3, shared helpers) |
| supabase/functions/rag-embed-approved/__tests__/openai.test.ts | 203 | T1-T7 client unit tests (Vitest) |
| supabase/functions/rag-embed-approved/__tests__/embed-pipeline.test.ts | 501 | T1-T10 handler unit tests (Vitest) |
| supabase/functions/rag-embed-approved/__tests__/integration.test.ts | 296 | LIVE_DB-gated Deno integration tests (T2-T4) |

## Verification Gate Results

- `grep -c "OPENROUTER_API_KEY" supabase/functions/rag-embed-approved/openai.ts` → 4 (≥1 required)
- `grep -c "openrouter.ai/api/v1/embeddings" supabase/functions/rag-embed-approved/openai.ts` → 2 (≥1 required)
- `grep -c "'openai/text-embedding-3-small'" supabase/functions/rag-embed-approved/openai.ts` → 1 (≥1 required)
- No `AI_GATEWAY_*` env reads in this Fn's source (confirmed 0)
- `grep -c "import.meta.main" supabase/functions/rag-embed-approved/index.ts` → 3 (≥1 required)
- No cron migration file: `find supabase/migrations -name "*phase60*embed*cron*"` → empty (correct)

## Env Vars Consumed

| Var | Source | Required? | Default |
|-----|--------|-----------|---------|
| OPENROUTER_API_KEY | Supabase secrets (set 2026-05-26 via Phase 60.5) | YES | — |
| SUPABASE_URL | Supabase platform auto-inject | YES | — |
| SUPABASE_SERVICE_ROLE_KEY | Supabase platform auto-inject | YES | — |
| POSTHOG_PROJECT_KEY | Existing Supabase secret | NO | no-op telemetry |
| RAG_PER_BATCH_BUDGET_USD | Supabase secret or env | NO | 0.05 |
| RAG_DAILY_BUDGET_USD | Supabase secret or env | NO | 50 |

## Deploy Status

**NOT deployed in this plan.** Deployment of all Phase 60 Edge Fns is the exclusive responsibility of **60-15** (atomic deploy-then-cron-push per `[[feedback_fn_deploy_before_cron_db_push]]`).

Deploy command (operator-runnable when 60-15 executes):
```
supabase functions deploy rag-embed-approved --no-verify-jwt --linked --project-ref <ref>
```

## Deviations from Plan

### Vendor Override Applied

**Override (operator direction 2026-05-26):** Routes via OpenRouter instead of Vercel AI Gateway.
- URL: `https://openrouter.ai/api/v1/embeddings`
- Auth: `OPENROUTER_API_KEY`
- Model: `openai/text-embedding-3-small` (OpenRouter provider-prefixed)
- PostHog event: `model='openrouter/openai/text-embedding-3-small'`, `provider='openrouter'`
- No `AI_GATEWAY_*` env vars used in this Fn

### Structural Deviation: handler.ts separated from index.ts

**[Rule 3 - Blocking]** The plan specified a single `index.ts` file, but Vitest (Node) cannot resolve Deno-specific `npm:` specifiers at module top-level. To keep the handler unit-testable under Vitest as the plan requires, `handleRequest` + `HandlerDeps` were moved to `handler.ts` (no Deno-specific imports), and `index.ts` becomes the thin Deno entry-point wrapper. The `files_modified` list gains `handler.ts`; all plan behaviors are preserved.

### emitAiGeneration userId = 'rag-system'

**[Rule 2 - Correctness]** `emitAiGeneration` in `posthog-rag-events.ts` is a `USER_ATTRIBUTED_EVENT` requiring a non-empty `userId` (D-13 invariant). Since this is a cron-attributed system event with no user context, `'rag-system'` (the canonical system actor from posthog-server.ts Phase 50 D-34 comment) is used.

### Test count: 21 Vitest (not 17 as planned)

The plan specified 7 (openai) + 10 (embed-pipeline) = 17. Implementation shipped 8 + 13 = 21 tests because additional edge cases were needed for full coverage: T5b (upsert opts verification), T7 split into 502 path, T8b (healthz 503 path), T9b (daily budget abort path), T10 (import guard).

## Carry-overs for Downstream Plans

- **60-06 (rag-retrieve):** Consumes `external_kb_embeddings` rows this Fn writes. Schema unchanged from Phase 50. No carry-overs.
- **60-15 (deploy + cron):** Must deploy `rag-embed-approved` BEFORE running `db push` for cron migration per `[[feedback_fn_deploy_before_cron_db_push]]`.
- **OpenRouter embedding catalog risk:** If OpenRouter's `/embeddings` endpoint rejects `openai/text-embedding-3-small` at runtime, surface as `## EXECUTION BLOCKED` per the override contingency. Operator will set `OPENAI_API_KEY` + patch URL explicitly. Model was NOT tested live in this plan.

## Threat Surface

No new network endpoints or auth paths introduced beyond what the plan's threat model covers. All T-60-05-* mitigations are implemented:
- T-60-05-01: Bearer token stripped from all error messages
- T-60-05-02: Embed input = summary + quote_blocks (admin-curated KB; no user PHI)
- T-60-05-03: chunk_ids UUID validated with regex before SQL
- T-60-05-04: per-batch + daily cost guardrails wired
- T-60-05-05: `openai/text-embedding-3-small` model pinned in constant
- T-60-05-06: PostHog $ai_generation emitted per batch (cost dashboard)
- T-60-05-07: 3-attempt backoff; Retry-After honored; max wait ≤30s/attempt

## Self-Check: PASSED

- [x] `supabase/functions/rag-embed-approved/openai.ts` — exists, 281 lines
- [x] `supabase/functions/rag-embed-approved/handler.ts` — exists, 345 lines
- [x] `supabase/functions/rag-embed-approved/index.ts` — exists, 102 lines
- [x] `supabase/functions/rag-embed-approved/deno.json` — exists, 18 lines
- [x] `supabase/functions/rag-embed-approved/__tests__/openai.test.ts` — exists, 203 lines
- [x] `supabase/functions/rag-embed-approved/__tests__/embed-pipeline.test.ts` — exists, 501 lines
- [x] `supabase/functions/rag-embed-approved/__tests__/integration.test.ts` — exists, 296 lines
- [x] cb8ee9c6 — feat(60-05): OpenAIEmbedBatchClient via OpenRouter
- [x] 5823290c — feat(60-05): handler + embed-pipeline tests
- [x] 723c22cc — test(60-05): LIVE_DB-gated integration test
