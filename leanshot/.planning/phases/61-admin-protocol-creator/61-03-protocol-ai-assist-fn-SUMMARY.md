---
phase: 61-admin-protocol-creator
plan: "03"
subsystem: edge-functions
tags:
  - openrouter
  - ai-assist
  - pharma-02
  - rate-limiting
  - dependency-injection
  - vitest
dependency_graph:
  requires:
    - "61-01-db-tables-rls (admin_ai_assist_log table)"
    - "Phase 60 _shared/rag-retrieve.ts"
    - "Phase 60 _shared/posthog-rag-events.ts"
    - "Phase 60 _shared/pharma-02-carveout.ts"
    - "Phase 60 _shared/slack-guardrail-alert.ts"
  provides:
    - "supabase/functions/protocol-ai-assist/handler.ts (handleAiAssist, HandlerDeps, buildSystemPrompt)"
    - "supabase/functions/protocol-ai-assist/index.ts (Deno.serve entrypoint, serveHandler)"
    - "supabase/functions/protocol-ai-assist/deno.json (import map)"
  affects:
    - "Plan 05 (admin-editor-ui) — calls protocol-ai-assist via supabase.functions.invoke"
    - "Plan 08 (close-out) — deploys protocol-ai-assist Edge Fn"
tech_stack:
  added:
    - "supabase/functions/protocol-ai-assist/ (new Edge Fn)"
  patterns:
    - "handler/index split per reference_deno_test_top_level_serve_trap"
    - "full dependency injection via HandlerDeps (no Deno.* in handler.ts)"
    - "OpenRouter dotted model ID (anthropic/claude-sonnet-4-5)"
    - "PostHog vendor-prefixed model (openrouter/anthropic/claude-sonnet-4-5)"
    - "placeholder runtime guard → 503 + Slack P1 regulatory alert"
    - "UTC-day rate limit via Date.UTC() computation"
key_files:
  created:
    - supabase/functions/protocol-ai-assist/handler.ts
    - supabase/functions/protocol-ai-assist/index.ts
    - supabase/functions/protocol-ai-assist/deno.json
    - supabase/functions/protocol-ai-assist/__tests__/handler.test.ts
  modified:
    - leanshot/vite.config.ts (added protocol-ai-assist test to include list)
decisions:
  - "handler.ts uses duck-typed interfaces (SupabaseLike, RagChunk, etc.) instead of npm: imports so Vitest can import without Deno runtime resolution"
  - "HandlerDeps.ragRetrieve injectable returns RagRetrieveResultLike (with .chunks[]) matching rag-retrieve.ts RagRetrieveResult shape"
  - "supabaseClient injected via HandlerDeps (not created inside handler) to avoid @supabase/supabase-js import in handler.ts"
  - "node_modules symlinked from main checkout for Vitest to resolve packages in worktree"
metrics:
  duration_seconds: 513
  completed_date: "2026-05-26"
  task_count: 2
  file_count: 5
---

# Phase 61 Plan 03: protocol-ai-assist Edge Function Summary

**One-liner:** JWT-authenticated Edge Fn with OpenRouter `anthropic/claude-sonnet-4-5`, 50/day rate limit, PHARMA-02 carveout injection, server-side zero-citation refusal, and Vitest-testable handler/index.ts split.

## What Was Built

### handler.ts

Pure handler function with full dependency injection. Exports:
- `handleAiAssist(req: HandlerRequest, deps: HandlerDeps): Promise<HandlerResponse>` — core logic
- `buildSystemPrompt(compound, ragChunks)` — structured prompt with RAG chunk injection
- `HandlerDeps`, `HandlerRequest`, `HandlerResponse` — all types for caller integration
- `SupabaseLike`, `RagChunk`, `RagRetrieveResultLike` — duck-typed dep interfaces

Key invariants enforced:
1. **OPENROUTER_API_KEY guard** (T-61-03-05): empty/placeholder → 503 + Slack P1 `regulatory` channel
2. **Rate limit** (T-61-03-03): count admin_ai_assist_log for UTC-day window via `Date.UTC()`, 50/day cap → 429 without INSERT or OpenRouter call
3. **PHARMA-02 carveout** (T-61-03-01 Layer 2): `isPharma02GatedTopicFn(compound)` → INSERT log + refusal: true before RAG retrieve
4. **Zero-chunk refusal**: RAG returns 0 chunks → INSERT log + refusal: true, no OpenRouter call
5. **Server-side citation override**: model returns `cited_chunk_ids: []` → force `refusal: true, refusal_reason: 'No qualifying evidence cited by model'` (PHARMA-02 Layer 2)
6. **Monitoring filter**: only `['weight','glucose','bp','mood','gi-symptoms']` pass server-side filter (T-61-03-02)
7. **Dose clamp**: 0–500 mg server-side (T-61-03-02)

### index.ts

Deno.serve entrypoint. Key features:
- `if (import.meta.main) Deno.serve(serveHandler)` guard — mandatory per `reference_deno_test_top_level_serve_trap`
- JWT extraction via `admin.auth.getUser(jwt)` — mirrors push-subscribe/notification-snooze pattern
- CORS preflight (OPTIONS) support for admin browser calls
- Full `Deno.env` wiring for all secrets: `OPENROUTER_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `POSTHOG_PROJECT_KEY`, `SLACK_GUARDRAIL_WEBHOOK_URL`
- Exports `{ serveHandler }` for optional integration test use

### OpenRouter integration shape

```
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer ${OPENROUTER_API_KEY}
HTTP-Referer: https://leanshot.app
X-Title: LeanShot
model: anthropic/claude-sonnet-4-5  ← dotted OpenRouter convention
response_format: { type: 'json_object' }
max_tokens: 512
signal: AbortSignal.timeout(30_000)
```

PostHog $ai_generation fields:
- `model: 'openrouter/anthropic/claude-sonnet-4-5'` (vendor-prefixed per Phase 60 CR-01)
- `vendor_field: 'openrouter_anthropic'`

### Rate limit window calculation

```typescript
const utcMidnight = new Date(Date.UTC(
  now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()
));
// Query: .gte('created_at', utcMidnight.toISOString())
// Reset: utcMidnight + 24h → returned in 429 body as resets_at
```

### How Plan 05 admin UI invokes this Fn

```typescript
const { data, error } = await supabase.functions.invoke('protocol-ai-assist', {
  body: {
    protocol_id: string | null,
    step_week: number,
    compound: string,
    prior_steps_context: string,  // JSON-serialized prior steps
  },
});
// Response: { dose_mg, monitoring[], cited_chunk_ids[], refusal, refusal_reason? }
// Or: { error: 'rate_limit_exceeded', resets_at }
// Or: { error: 'service_unavailable', reason }
```

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED | `dbede1ef` | PASS — 6 tests failed (handler.ts missing) |
| GREEN | `98169720` | PASS — 6/6 tests passing |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Deviation] Handler uses duck-typed interfaces instead of npm: imports**

- **Found during:** Task 1 GREEN implementation
- **Issue:** The plan showed `import { createClient } from '@supabase/supabase-js'` in handler.ts, but Vitest resolves this without the `npm:` prefix while Deno requires it. The existing rag-embed-approved/handler.ts pattern shows the correct approach: duck-typed `SupabaseLike` interface with supabase client injected via `HandlerDeps`. Without this, Vite would fail to resolve `@supabase/supabase-js`.
- **Fix:** Removed all npm: and external package imports from handler.ts. Added `SupabaseLike`, `RagChunk`, `RagRetrieveResultLike`, `RagRetrieveRequestLike`, `AiGenerationArgs`, `SlackAlertArgs` duck-typed interfaces. All deps injected via `HandlerDeps`. Index.ts owns all `npm:@supabase/supabase-js@2` and `_shared/*.ts` imports.
- **Files modified:** `handler.ts`, `handler.test.ts` (updated to use new dep injection pattern)
- **Commit:** `98169720`

**2. [Rule 3 - Blocking] node_modules symlink required for worktree Vitest**

- **Found during:** Task 1 RED test run
- **Issue:** Worktree leanshot has no `node_modules` (gitignored). `npx vitest` from worktree leanshot fails with `ERR_MODULE_NOT_FOUND: vite-plugin-pwa`.
- **Fix:** Created symlink `leanshot/node_modules → /Users/karstenhaldan/minisite/leanshot/node_modules`. Per `reference_npm_install_worktree_main_drift` this is the expected workaround.
- **Commit:** None (symlink is gitignored)

**3. [Rule 1 - Deviation] HandlerDeps.ragRetrieve signature uses RagRetrieveRequestLike (object) not (query, k) tuple**

- **Found during:** Task 1 GREEN implementation  
- **Issue:** Plan's interface showed `ragRetrieve?: (query: string, k: number) => Promise<RagChunk[]>` but `retrieveRagChunks` actually takes `RagRetrieveRequest` (object) and returns `RagRetrieveResult` (with `.chunks[]`). The test mocks also return `{ chunks: [], ... }` shaped responses. Using the plan's signature would require an adapter wrapper.
- **Fix:** Changed `HandlerDeps.ragRetrieve` to `(req: RagRetrieveRequestLike) => Promise<RagRetrieveResultLike>` matching the actual `rag-retrieve.ts` interface. Test mocks updated to return `{ chunks, refused, refusal_reason, trace_id, ... }` shaped results.
- **Files modified:** `handler.ts`, `handler.test.ts`

## Known Stubs

None. The handler and all 4 output files are fully implemented. No placeholder data flows to UI rendering. The Fn is not deployed (Plan 08 owns deploy) which is intentional per the plan's constraint.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| (none) | — | No new network endpoints beyond the declared protocol-ai-assist Fn; all trust boundaries per plan's threat model are enforced |

## Self-Check: PASSED

Files created/modified:
- `supabase/functions/protocol-ai-assist/handler.ts` — FOUND
- `supabase/functions/protocol-ai-assist/index.ts` — FOUND
- `supabase/functions/protocol-ai-assist/deno.json` — FOUND
- `supabase/functions/protocol-ai-assist/__tests__/handler.test.ts` — FOUND
- `leanshot/.planning/phases/61-admin-protocol-creator/61-03-protocol-ai-assist-fn-SUMMARY.md` — FOUND

Commits verified:
- `dbede1ef` — test(61-03): RED handler.test.ts — FOUND
- `98169720` — feat(61-03): GREEN handleAiAssist — FOUND
- `44d7787e` — feat(61-03): index.ts Deno.serve wrapper — FOUND
