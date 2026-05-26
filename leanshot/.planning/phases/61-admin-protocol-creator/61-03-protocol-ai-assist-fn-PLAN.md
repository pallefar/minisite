---
phase: 61-admin-protocol-creator
plan: 03
type: execute
wave: 0
depends_on:
  - 61-01-db-tables-rls
files_modified:
  - supabase/functions/protocol-ai-assist/index.ts
  - supabase/functions/protocol-ai-assist/handler.ts
  - supabase/functions/protocol-ai-assist/deno.json
  - supabase/functions/protocol-ai-assist/__tests__/handler.test.ts
autonomous: true
requirements:
  - PROTOCOL-02
  - PROTOCOL-03
must_haves:
  truths:
    - "POST to protocol-ai-assist returns `{ dose_mg, monitoring[], cited_chunk_ids[], refusal, refusal_reason? }`"
    - "Returns 429 + `{ error: 'rate_limit_exceeded', resets_at }` when caller has 50 admin_ai_assist_log rows for current UTC-day"
    - "Forces `refusal: true` when retrieved RAG chunks have 0 results"
    - "Calls OpenRouter `anthropic/claude-sonnet-4-5` via fetch with HTTP-Referer + X-Title headers per Phase 60 substitution pattern"
    - "Emits `$ai_generation` PostHog event via `_shared/posthog-rag-events.ts` `emitAiGeneration` with vendor='openrouter_anthropic'"
    - "Imports PHARMA-02 carveout helper from `_shared/pharma-02-carveout.ts` and forces refusal on gated topics"
    - "INSERTs row into `admin_ai_assist_log` on every call (success OR refusal); does NOT insert on rate-limit reject"
    - "`Deno.serve(...)` invocation guarded by `if (import.meta.main)` per Deno test top-level serve trap"
    - "handler.ts exports `handleAiAssist(req, deps)` testable in isolation (Vitest cannot import index.ts due to Deno.serve)"
    - "Returns 503 + Slack regulatory P1 alert when OPENROUTER_API_KEY missing or starts with 'placeholder'"
  artifacts:
    - path: "supabase/functions/protocol-ai-assist/index.ts"
      provides: "Deno.serve entrypoint that calls handleAiAssist; runtime/env wiring"
      contains: "if (import.meta.main)"
    - path: "supabase/functions/protocol-ai-assist/handler.ts"
      provides: "Pure handler function with HandlerDeps interface — testable without Deno.serve"
      exports: ["handleAiAssist", "HandlerDeps", "buildSystemPrompt"]
    - path: "supabase/functions/protocol-ai-assist/deno.json"
      provides: "Import map for _shared helpers"
      contains: "_shared"
    - path: "supabase/functions/protocol-ai-assist/__tests__/handler.test.ts"
      provides: "Vitest unit tests: refusal flow, rate limit, no-citation refusal, success path, PHARMA-02 gate"
      contains: "describe('handleAiAssist'"
  key_links:
    - from: "handleAiAssist"
      to: "_shared/rag-retrieve helper"
      via: "retrieveRagChunks({ query: ..., k: 5 })"
      pattern: "retrieveRagChunks"
    - from: "handleAiAssist"
      to: "_shared/pharma-02-carveout helper"
      via: "isPharma02GatedTopic check before OpenRouter call"
      pattern: "pharma-02-carveout|isPharma02"
    - from: "handleAiAssist"
      to: "OpenRouter chat completions"
      via: "fetch with model='anthropic/claude-sonnet-4-5'"
      pattern: "anthropic/claude-sonnet-4-5"
    - from: "handleAiAssist"
      to: "PostHog $ai_generation"
      via: "emitAiGeneration with vendor='openrouter_anthropic'"
      pattern: "openrouter_anthropic"
---

<objective>
Ship the `protocol-ai-assist` Edge Function with handler-separated-from-serve pattern (D-60-05-01) so Vitest can unit-test the handler without Deno.serve side-effects. Implements PROTOCOL-02 (AI-assist per-step Suggest action) and PROTOCOL-03 (RAG evidence integration).

Purpose: Provides AI-assisted dose suggestion to step-builder UI (Plan 05). Enforces PHARMA-02 carveout (Layer 2 of 3-layer invariant), rate limit (50/day/admin), refusal when no RAG evidence cited. Calls OpenRouter (not direct Anthropic) per Phase 60.5 vendor decision.

Output: 4 files in `supabase/functions/protocol-ai-assist/` — index.ts, handler.ts, deno.json, __tests__/handler.test.ts. Function NOT deployed in this plan — Plan 08 close-out runs `supabase functions deploy protocol-ai-assist --import-map supabase/functions/_shared/deno.json` (see RESEARCH.md note on `reference_supabase_functions_deploy_import_map_flag` — use per-Fn `deno.json` not global flag).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-CONTEXT.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-RESEARCH.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-PATTERNS.md

# Verbatim OpenRouter client template (mirror this shape):
@/Users/karstenhaldan/minisite/supabase/functions/rag-tip-of-day-generate/index.ts
@/Users/karstenhaldan/minisite/supabase/functions/rag-summarize-and-chunk/anthropic.ts

# Required shared helpers (already deployed by Phase 60):
@/Users/karstenhaldan/minisite/supabase/functions/_shared/rag-retrieve.ts
@/Users/karstenhaldan/minisite/supabase/functions/_shared/posthog-rag-events.ts
@/Users/karstenhaldan/minisite/supabase/functions/_shared/pharma-02-carveout.ts
@/Users/karstenhaldan/minisite/supabase/functions/_shared/slack-guardrail-alert.ts
@/Users/karstenhaldan/minisite/supabase/functions/_shared/supabase-server.ts

# TS types shared with browser callers (provided by Plan 01):
@/Users/karstenhaldan/minisite/leanshot/src/types/protocols.ts

<interfaces>
<!-- Shape exposed from handler.ts for unit-test import: -->

export interface HandlerDeps {
  openrouterApiKey: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
  posthogKey?: string;
  slackWebhookUrl?: string;
  // Injectable for tests:
  fetchImpl?: typeof fetch;
  ragRetrieve?: (query: string, k: number) => Promise<RagChunk[]>;
  now?: () => Date;
}

export interface HandlerRequest {
  protocol_id: string | null;
  step_week: number;
  compound: string;
  prior_steps_context: string;  // serialized JSON of prior steps for prompt injection
  actor_id: string;             // auth.uid() extracted from JWT in index.ts
}

export interface HandlerResponse {
  status: 200 | 429 | 503;
  body:
    | { dose_mg: number; monitoring: string[]; cited_chunk_ids: string[]; refusal: boolean; refusal_reason?: string }
    | { error: 'rate_limit_exceeded'; resets_at: string }
    | { error: 'service_unavailable'; reason: string };
}

export async function handleAiAssist(req: HandlerRequest, deps: HandlerDeps): Promise<HandlerResponse>;

export function buildSystemPrompt(compound: string, ragChunks: RagChunk[]): string;
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Write handler.ts with HandlerDeps seam + RED tests</name>
  <files>supabase/functions/protocol-ai-assist/handler.ts, supabase/functions/protocol-ai-assist/__tests__/handler.test.ts, supabase/functions/protocol-ai-assist/deno.json</files>
  <behavior>
    - Test 1: When `deps.ragRetrieve` returns 0 chunks → response is `{ status: 200, body: { refusal: true, refusal_reason: /no.*evidence/i, dose_mg: 0, monitoring: [], cited_chunk_ids: [] } }`. No fetch to OpenRouter occurred.
    - Test 2: When PHARMA-02 carveout flags the compound as gated → response is `{ status: 200, body: { refusal: true, refusal_reason: /gated|carveout/i } }`. No fetch to OpenRouter occurred.
    - Test 3: When today's admin_ai_assist_log count (queried via supabase service client) ≥ 50 for actor_id → response is `{ status: 429, body: { error: 'rate_limit_exceeded', resets_at: ISO_8601_string_midnight_UTC_tomorrow } }`. No fetch to OpenRouter occurred. No log row INSERTed.
    - Test 4: Successful path — ragRetrieve returns 3 chunks, OpenRouter mock returns valid JSON `{dose_mg, monitoring, cited_chunk_ids}` → response is `{ status: 200, body: { dose_mg: 5, monitoring: ['weight'], cited_chunk_ids: ['<uuid>', '<uuid>'], refusal: false } }`. INSERTs row into admin_ai_assist_log via supabase mock. emitAiGeneration called once with `vendor: 'openrouter_anthropic'`, `model: 'openrouter/anthropic/claude-sonnet-4-5'`, `userId: actor_id`.
    - Test 5: Missing OPENROUTER_API_KEY (empty/'placeholder') → response is `{ status: 503, body: { error: 'service_unavailable', reason: /api.*key/i } }`. Slack webhook called once (if configured) with severity 'regulatory' P1.
    - Test 6: OpenRouter returns 200 but JSON has `cited_chunk_ids: []` (model failed to cite) → server-side override: response forces `refusal: true, refusal_reason: /no qualifying evidence/i`. INSERT into admin_ai_assist_log with refusal=true, cited_chunk_count=0.
  </behavior>
  <action>
Step 1 — Write `supabase/functions/protocol-ai-assist/deno.json` at `/Users/karstenhaldan/minisite/supabase/functions/protocol-ai-assist/deno.json`:

```json
{
  "imports": {
    "_shared/": "../_shared/",
    "zod": "npm:zod@^3"
  }
}
```

Step 2 — Write `__tests__/handler.test.ts` FIRST (RED). Use Vitest since this is a TS-Node-compatible handler that imports from `_shared` via relative paths but DOES NOT import `Deno.*` at top-level (the seam). Import:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { handleAiAssist, type HandlerDeps, type HandlerRequest } from '../handler';
```

Build a fake `HandlerDeps` with:
- `fetchImpl: vi.fn()` for OpenRouter mock
- `ragRetrieve: vi.fn()` returning canned RagChunk arrays
- `supabaseServiceKey: 'test-key'`, `supabaseUrl: 'http://localhost'`
- Mock the supabase-js client by using `vi.mock('@supabase/supabase-js')` and returning a chainable client whose `.from('admin_ai_assist_log').select(...).gte(...)` returns `{ count: <test_value>, data: [], error: null }` and `.insert(...).select()` returns inserted row.
- Mock PostHog emitter via `vi.mock('../../_shared/posthog-rag-events', () => ({ emitAiGeneration: vi.fn(), shutdownPostHog: vi.fn() }))`.
- Mock Slack webhook via `vi.mock('../../_shared/slack-guardrail-alert', () => ({ sendSlackGuardrailAlert: vi.fn() }))`.
- Mock pharma-02 carveout via `vi.mock('../../_shared/pharma-02-carveout', () => ({ isPharma02GatedTopic: vi.fn((compound) => compound === 'cabergoline') }))`.

Write the 6 tests above. Run them — they MUST fail (RED). Commit:
`test(61-03): RED handler.test.ts for protocol-ai-assist refusal/rate-limit/PHARMA-02/success paths`

Step 3 — Implement `handler.ts` at `/Users/karstenhaldan/minisite/supabase/functions/protocol-ai-assist/handler.ts`:

Imports:
```typescript
import { createClient } from '@supabase/supabase-js';
import { emitAiGeneration, shutdownPostHog } from '../_shared/posthog-rag-events.ts';
import { sendSlackGuardrailAlert } from '../_shared/slack-guardrail-alert.ts';
import { isPharma02GatedTopic } from '../_shared/pharma-02-carveout.ts';
import { retrieveRagChunks, type RagChunk } from '../_shared/rag-retrieve.ts';
```

(Note: when run under Vitest the `.ts` extensions are tolerated due to `allowImportingTsExtensions`; when run under Deno they are required. Verify the existing `_shared/posthog-rag-events.ts` import style in `rag-tip-of-day-generate/index.ts` and mirror it exactly.)

Constants:
```typescript
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const MODEL = 'anthropic/claude-sonnet-4-5';
const POSTHOG_MODEL = 'openrouter/anthropic/claude-sonnet-4-5';
const POSTHOG_VENDOR = 'openrouter_anthropic';
const SURFACE = 'protocol_ai_assist';
const RATE_LIMIT_PER_DAY = 50;
const PLACEHOLDER_KEY_PATTERN = /^(placeholder|TODO|REPLACE_ME)/i;  // per Phase 60 WR-02 placeholder runtime guard pattern
```

`buildSystemPrompt(compound, ragChunks)`:
- Returns a structured prompt: "You are a clinical dose-suggestion assistant. The administrator is building a titration step for {compound}. Below are {N} retrieved RAG chunks; cite at least one by chunk_id in `cited_chunk_ids`. If no chunk supports a safe dose for this step, return refusal:true. Output JSON only: { dose_mg: number, monitoring: string[] subset of ['weight','glucose','bp','mood','gi-symptoms'], cited_chunk_ids: string[] }. Do not include prose."
- Then "RAG CHUNKS:\n" + `ragChunks.map(c => `[${c.chunk_id}] ${c.text}`).join('\n')`.

`handleAiAssist(req, deps)`:
1. `if (!deps.openrouterApiKey || PLACEHOLDER_KEY_PATTERN.test(deps.openrouterApiKey))` → `await sendSlackGuardrailAlert?({ severity: 'regulatory', priority: 'P1', title: 'protocol-ai-assist OPENROUTER_API_KEY missing/placeholder', context: { surface: SURFACE } })` (best-effort, swallow errors); return `{ status: 503, body: { error: 'service_unavailable', reason: 'OPENROUTER_API_KEY missing or placeholder' } }`.
2. Build supabase client `const sb = createClient(deps.supabaseUrl, deps.supabaseServiceKey)`.
3. Rate-limit check: `const utcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); const { count } = await sb.from('admin_ai_assist_log').select('id', { count: 'exact', head: true }).eq('actor_id', req.actor_id).gte('created_at', utcMidnight.toISOString());` — if `count >= RATE_LIMIT_PER_DAY` → return `{ status: 429, body: { error: 'rate_limit_exceeded', resets_at: nextUtcMidnight.toISOString() } }`. No INSERT, no PostHog emit.
4. PHARMA-02 carveout: `if (isPharma02GatedTopic(req.compound))` → INSERT log row `{ actor_id, protocol_id, step_week, compound, refusal: true, cited_chunk_count: 0 }`; return `{ status: 200, body: { dose_mg: 0, monitoring: [], cited_chunk_ids: [], refusal: true, refusal_reason: 'PHARMA-02 carveout — compound is gated' } }`.
5. RAG retrieve: `const chunks = await (deps.ragRetrieve ?? retrieveRagChunks)({ query: \`Safe dose for ${req.compound} step ${req.step_week} given prior context: ${req.prior_steps_context}\`, k: 5, filters: { surface: 'coach' } });`. If `chunks.length === 0` → INSERT log row `refusal: true, cited_chunk_count: 0`; return refusal payload `refusal_reason: 'No qualifying RAG evidence'`.
6. Build system prompt + user message. POST to OpenRouter:
```typescript
const fetchFn = deps.fetchImpl ?? fetch;
const resp = await fetchFn(`${OPENROUTER_BASE}/chat/completions`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${deps.openrouterApiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://leanshot.app',
    'X-Title': 'LeanShot',
  },
  body: JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Suggest a safe titration step for week ${req.step_week} of ${req.compound}.` },
    ],
    max_tokens: 512,
    response_format: { type: 'json_object' },
  }),
  signal: AbortSignal.timeout(30_000),
});
```
7. Parse OpenRouter JSON. Extract `dose_mg` (clamp to a sane numeric range 0–500 server-side), `monitoring[]` (filter to allowed set), `cited_chunk_ids[]` (filter to UUIDs that appear in `chunks.map(c => c.chunk_id)`).
8. Server-side refusal override per RESEARCH.md Pitfall: if `cited_chunk_ids.length === 0` → set `refusal=true, refusal_reason='No qualifying evidence cited'`. (PHARMA-02 Layer 2 — model failed to cite even when chunks available.)
9. INSERT log row with final `refusal` + `cited_chunk_count = cited_chunk_ids.length`.
10. `await emitAiGeneration({ userId: req.actor_id, model: POSTHOG_MODEL, prompt_tokens: usage.prompt_tokens ?? 0, completion_tokens: usage.completion_tokens ?? 0, trace_id: crypto.randomUUID(), surface: SURFACE, vendor_field: POSTHOG_VENDOR })`. Wrap PostHog in try/catch (best-effort telemetry).
11. Return `{ status: 200, body: { dose_mg, monitoring, cited_chunk_ids, refusal, refusal_reason } }`.

GREEN — re-run tests, expect all 6 passing. Commit:
`feat(61-03): GREEN handleAiAssist with refusal + rate-limit + PHARMA-02 + OpenRouter integration`

Constraints:
  - DO NOT import `Deno.*` anywhere in handler.ts (test-isolation seam per D-60-05-01).
  - Model ID string is the OpenRouter DOTTED form. Do NOT use the hyphenated `claude-sonnet-4-5` (that's for direct Anthropic). Suspended CI grep gate per planning_directives.
  - PostHog `model` field MUST include vendor prefix per Phase 60 CR-01 — value `openrouter/anthropic/claude-sonnet-4-5`.
  - PostHog `vendor` field MUST be `openrouter_anthropic`.
  - Placeholder runtime guard pattern per `feedback_placeholder_string_runtime_guard_pattern` (NOT a TODO comment — actual 503 + Slack P1 at request time).
  - Rate limit query MUST use `date_trunc`-equivalent JS computation (UTC midnight via `Date.UTC(year, month, date)`).
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npx vitest run --config vite.config.ts ../supabase/functions/protocol-ai-assist/__tests__/handler.test.ts 2>&1 | tail -30 | grep -E "passed|✓"</automated>
  </verify>
  <done>All 6 handler tests pass under Vitest. handler.ts exports `handleAiAssist`, `HandlerDeps`, `buildSystemPrompt`. No Deno.* imports in handler.ts.</done>
</task>

<task type="auto">
  <name>Task 2: Write index.ts Deno.serve wrapper</name>
  <files>supabase/functions/protocol-ai-assist/index.ts</files>
  <action>
Write `supabase/functions/protocol-ai-assist/index.ts` at `/Users/karstenhaldan/minisite/supabase/functions/protocol-ai-assist/index.ts`. Mirror `rag-tip-of-day-generate/index.ts` shape but guarded:

```typescript
// Phase 61 Plan 03 — protocol-ai-assist Edge Fn entrypoint.
// Handler in handler.ts is unit-tested under Vitest; this file wires Deno runtime.

import { handleAiAssist, type HandlerRequest } from './handler.ts';

async function serveHandler(req: Request): Promise<Response> {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405 });
  }

  // Extract actor_id from Authorization Bearer JWT
  const authHeader = req.headers.get('authorization') ?? '';
  const jwt = authHeader.replace(/^bearer\s+/i, '');
  // Use supabase server client to verify + extract user id; reuse _shared/supabase-server.ts pattern
  // (See rag-tip-of-day-generate/index.ts for the exact extraction code; mirror lines that pull user.id from JWT.)

  const body = await req.json();
  const handlerReq: HandlerRequest = {
    protocol_id: body.protocol_id ?? null,
    step_week: Number(body.step_week),
    compound: String(body.compound ?? '').trim(),
    prior_steps_context: String(body.prior_steps_context ?? ''),
    actor_id: <extracted user id>,
  };

  const deps = {
    openrouterApiKey: Deno.env.get('OPENROUTER_API_KEY') ?? '',
    supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
    supabaseServiceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    posthogKey: Deno.env.get('POSTHOG_PROJECT_KEY'),
    slackWebhookUrl: Deno.env.get('SLACK_GUARDRAIL_WEBHOOK_URL'),
  };

  const result = await handleAiAssist(handlerReq, deps);
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

// Guard per reference_deno_test_top_level_serve_trap — Deno.serve must NOT execute at import time
// to allow Vitest to import handler.ts without spawning a real server.
if (import.meta.main) {
  Deno.serve(serveHandler);
}

export { serveHandler };
```

Constraints:
  - The `import.meta.main` guard is MANDATORY per Deno test top-level serve trap reference. Without it, `deno test` triggers a real HTTP server and tests abort.
  - The JWT extraction code mirrors existing Edge Fns — read `rag-tip-of-day-generate/index.ts` for the exact pattern and copy verbatim.
  - CORS headers ARE included (admin browser will call this Fn directly via supabase.functions.invoke).
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && test -f supabase/functions/protocol-ai-assist/index.ts && grep -q "import.meta.main" supabase/functions/protocol-ai-assist/index.ts && grep -q "Deno.serve" supabase/functions/protocol-ai-assist/index.ts && grep -q "handleAiAssist" supabase/functions/protocol-ai-assist/index.ts && ! grep -q "^Deno.serve" supabase/functions/protocol-ai-assist/index.ts</automated>
  </verify>
  <done>index.ts exists with import.meta.main-guarded Deno.serve, CORS headers, JWT extraction, deps wiring from Deno.env, and a single call to handleAiAssist.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Admin browser → protocol-ai-assist Edge Fn | JWT-authenticated POST; rate-limit + PHARMA-02 carveout + RAG-required-citation guards |
| Edge Fn → OpenRouter | Bearer API key (env var); never exposed to browser |
| Edge Fn → admin_ai_assist_log | Service-role INSERT; row tracks every call for rate limiting |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-61-03-01 | Information disclosure | Off-label dose suggestion without RAG citation (PHARMA-02 violation) | mitigate | Layer 2: server-side `if (cited_chunk_ids.length === 0) refusal = true`; Layer 1 (Plan 02 RPC) gates publication 2-person; Layer 3 (CI eval test) verifies refusal contract |
| T-61-03-02 | Tampering | Prompt injection via compound name field | mitigate | Server-side trim + structured JSON message format (system / user separation); model output validated against fixed `monitoring` enum subset |
| T-61-03-03 | Denial of service | Spam AI-assist requests | mitigate | 50/UTC-day per actor_id rate limit via admin_ai_assist_log COUNT; 429 returned without OpenRouter call |
| T-61-03-04 | Spoofing | Caller bypasses rate limit via account cycling | accept | Per CONTEXT.md design: each admin account has separate counter; org-level abuse is out of scope for v1.4 (admin accounts are vetted) |
| T-61-03-05 | Tampering | Edge Fn deployed with placeholder/missing OPENROUTER_API_KEY | mitigate | Runtime guard: PLACEHOLDER_KEY_PATTERN check → 503 + Slack P1 regulatory alert (per Phase 60 WR-02 placeholder runtime guard pattern) |
| T-61-03-SC | Tampering | npm/pip/cargo installs | accept | Zero new packages installed — all dependencies are existing _shared helpers verified deployed in Phase 60 |
</threat_model>

<verification>
- `npx vitest run --config vite.config.ts supabase/functions/protocol-ai-assist/__tests__/handler.test.ts` — all 6 tests pass
- `grep "import.meta.main" supabase/functions/protocol-ai-assist/index.ts` returns 1 match
- `grep "anthropic/claude-sonnet-4-5" supabase/functions/protocol-ai-assist/handler.ts` matches (dotted, OpenRouter format)
- `grep -v "^#" supabase/functions/protocol-ai-assist/handler.ts | grep -c "openrouter_anthropic"` returns ≥1 (per Phase 60 CR-01 vendor field)
- No `Deno.*` symbol referenced in handler.ts (`grep "Deno\\." supabase/functions/protocol-ai-assist/handler.ts` returns nothing)
</verification>

<success_criteria>
- [ ] Handler.ts unit-testable under Vitest; all 6 RED tests pass after GREEN implementation
- [ ] index.ts has `if (import.meta.main)` Deno.serve guard
- [ ] OpenRouter model = `anthropic/claude-sonnet-4-5` (dotted); PostHog model = `openrouter/anthropic/claude-sonnet-4-5`; vendor = `openrouter_anthropic`
- [ ] Refusal forced when `cited_chunk_ids.length === 0` (server-side, even if model returned text)
- [ ] Rate limit returns 429 without OpenRouter call or log INSERT
- [ ] PHARMA-02 carveout integration via `isPharma02GatedTopic`
- [ ] Placeholder key runtime guard returns 503 + Slack P1
</success_criteria>

<output>
Create `.planning/phases/61-admin-protocol-creator/61-03-SUMMARY.md` documenting handler shape, OpenRouter pattern, rate-limit window calculation, and how Plan 05 admin UI invokes this Fn.
</output>
