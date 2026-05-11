# Phase 04 — ADDENDUM: Model Provider Pivot to Moonshot Kimi K2

**Decided:** 2026-05-11 (mid-execution, between Plan 04-01 Task 2 and Task 3)
**Status:** SUPERSEDES Anthropic references in 04-CONTEXT.md (D-06, D-01 proxy skeleton spec, in-scope list), 04-RESEARCH.md (§2 Edge Function streaming pattern, §12 model catalog), 04-PATTERNS.md (Edge Function analog), 04-VALIDATION.md (model-ID acceptance commands), 04-01-PLAN.md (Task 3 secrets), 04-02-PLAN.md (Edge Function call + browser SSE parser shape), 04-03-PLAN.md (only system-prompt fence references — refusal logic + corpus stay model-agnostic).

**Authority:** User decision (verbatim: *"lets add this key later, also allow to use moonshot kimi k2.6"*; then in clarification: "Switch entirely to Moonshot (drop Anthropic)" and "Inline-patch now, keep executing" and "Let researcher pick the current latest at Plan 04-02 time"). Phase 4 plans must read this addendum before applying any task that references `ANTHROPIC_*` env vars, the Anthropic Messages API, or `claude-sonnet-*` model IDs.

---

## What changed

### Provider
- **Drop:** Anthropic Messages API (`api.anthropic.com/v1/messages`).
- **Adopt:** Moonshot AI's OpenAI-compatible Chat Completions API. Researcher MUST resolve the correct base URL at Plan 04-02 execution time — candidates are `https://api.moonshot.ai/v1` (international) and `https://api.moonshot.cn/v1` (China). Pick the one that matches the user's account region; document the pick in the eventual Edge Function source.

### Function secrets (Plan 04-01 Task 3)
| Old (Anthropic) | New (Moonshot) | Initial value (Plan 04-01) |
|-----------------|----------------|----------------------------|
| `ANTHROPIC_API_KEY` | `MOONSHOT_API_KEY` | `placeholder-set-before-04-02-deploy` |
| `ANTHROPIC_MODEL` | `MOONSHOT_MODEL` | `kimi-k2-latest` (researcher resolves to real ID at Plan 04-02 time — e.g., `kimi-k2-0905-preview` or whatever is current/recommended) |

The placeholder approach is the user's explicit choice ("Set placeholder + defer"). Real values pushed before Plan 04-02's curl-smoke verification step.

### D-06 (model ID strategy) — RESTATED
**D-06 (Moonshot):** Env var `MOONSHOT_MODEL` with default `kimi-k2-latest` (placeholder). Edge Function reads `Deno.env.get('MOONSHOT_MODEL') ?? 'kimi-k2-latest'`. Settable via `supabase secrets set MOONSHOT_MODEL=…` without code change. CI integration test asserts the response carries the configured model ID. At Plan 04-02 execution, the researcher must query Moonshot's `/v1/models` endpoint (or scrape the public docs page if the endpoint requires auth) to resolve `kimi-k2-latest` → the canonical current model ID, then either (a) update this addendum + the in-code default to the canonical ID, or (b) keep the `-latest` alias if Moonshot's docs document it as a stable pointer. The current `src/lib/ai.ts:22` `DEFAULT_MODEL = 'claude-sonnet-4-5'` was the original target of replacement — that file is still being deleted, just replaced with a Moonshot wrapper now.

### D-05 (streaming protocol) — STILL APPLIES, shape differs
The SSE pass-through pattern (`response.body.tee()` + `EdgeRuntime.waitUntil(captureAndPersist(...))`) is unchanged. What changes is the **wire format of the deltas**:

- **Anthropic shape (no longer used):** `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"…"}}\n\n`
- **Moonshot/OpenAI shape (used):** `data: {"id":"…","choices":[{"index":0,"delta":{"content":"…"},"finish_reason":null}]}\n\n` followed by `data: [DONE]\n\n` at end.

Browser-side SSE parser in the rewritten `src/lib/ai.ts` MUST consume the OpenAI delta format. The `eventsource-parser` library (RESEARCH §2 recommendation) handles either shape since it's just the SSE framing — the difference is how the JSON `data` payload is interpreted in our handler.

`captureAndPersist` (the assistant-message DB persister wired in Plan 04-03 Task 3) consumes the SSE branch from `tee()` and must also be updated to extract `choices[0].delta.content` strings instead of `delta.text` strings.

### Vercel envs (Plan 04-01 Task 5)
Unchanged — `SUPABASE_URL` and `SUPABASE_ANON_KEY` (plus their `VITE_` mirrors) are the only browser-side public envs Phase 4 needs. No `MOONSHOT_*` ever touches Vercel — those stay server-side as Supabase Function secrets.

### Decision record (Plan 04-01 Task 6)
`.planning/decisions/supabase.md` must include a "Model provider" section pointing at this addendum, with the rationale ("user picked Moonshot Kimi K2 over Anthropic Claude Sonnet 4.6"), the secret names + retrieval command (`supabase secrets list --linked`), and the model-ID-resolution checkpoint at Plan 04-02 time.

### Edge Function (Plan 04-02)
- File path unchanged: `/Users/karstenhaldan/minisite/supabase/functions/ai-chat/index.ts`.
- API call shape changes from Anthropic Messages → OpenAI-compatible Chat Completions.
- Request payload shape:
  - Anthropic: `{model, max_tokens, system: "…", messages: [{role, content}], stream: true}`
  - Moonshot: `{model, messages: [{role: "system", content: "…"}, {role: "user", content: "…"}, …], stream: true, temperature?}`
- Authorization header: `Authorization: Bearer ${MOONSHOT_API_KEY}` (OpenAI convention; replaces Anthropic's `x-api-key: …` + `anthropic-version: 2023-06-01` headers).
- System prompt design (RESEARCH §7 + AI-04 structural separation): same fence-token pattern (`<user_data>...</user_data>`), but now the system prompt goes in the `messages[0]` slot with `role: "system"` instead of Anthropic's top-level `system:` field. The user-data fence still lives in `messages[N].content` for `role: "user"`.
- Refusal logic (D-04): UNCHANGED — `shared/refusal.ts` is model-agnostic.
- Rate-limit RPC (D-04 hardening): UNCHANGED.
- `ai_messages` schema + RLS: UNCHANGED — `role` enum still `'user'` / `'assistant'`.

### Plan 04-03 (Hardening) — minor surface changes
- Adversarial corpus (SC#3): UNCHANGED — still fires at the proxy; refusal pre-check still catches dose-change / prompt-injection / system-extraction attempts regardless of the downstream model.
- System-prompt fence (`<user_data>` markers): UNCHANGED in design; only relocated to `messages[0].content` (system role) per the Moonshot payload shape above.
- Cross-tenant RLS test: UNCHANGED.
- Rate-limit load test: UNCHANGED.
- pg_cron anon cleanup: UNCHANGED.
- CI deno-test job: UNCHANGED in shape; only the `--allow-net=...` allowlist needs to swap `api.anthropic.com` → `api.moonshot.ai` (or whichever endpoint the researcher resolves).

### Known risks of the pivot
1. **Moonshot SSE framing details may differ subtly from OpenAI canonical.** Researcher at Plan 04-02 time must verify with a real `curl` against Moonshot's API: send a `stream: true` request and inspect the raw SSE bytes. Document any framing quirks (e.g., does Moonshot emit `event:` lines? are `data:` chunks always single-line JSON? is there a `data: [DONE]` terminator?).
2. **Moonshot may rate-limit unauthenticated requests.** The placeholder period (between Plan 04-01 completion and Plan 04-02 deploy) means the Edge Function will return 401s or 500s if called. That's expected; Plan 04-02 Task 4 (curl smoke) requires the real `MOONSHOT_API_KEY` to be set first — either by re-running Task 3 with the real value or by `supabase secrets set` directly.
3. **Model name resolution risk.** `kimi-k2-latest` may not be a real Moonshot model alias. If Moonshot doesn't expose a stable "-latest" pointer, the researcher at Plan 04-02 time must pin a specific model ID (e.g., `kimi-k2-0905-preview`) and update both the addendum and the in-code default.
4. **Adversarial corpus assumed Anthropic refusal idioms.** Phase 3's CR-01/CR-02 corpus rows test against the refusal pre-check (browser-side regex), not against the model's own safety training. So the corpus stays valid. But any rows that depended on Anthropic-specific guardrail responses (none currently — Phase 3 corpus is input-side only) would need re-evaluation.

### Backout plan (if Moonshot pivot fails Plan 04-02 verification)
If Moonshot's SSE streaming, model availability, or response quality fails to meet SC#1/SC#2 at Plan 04-02 verification:
- Option A: switch to **Vercel AI Gateway** (was the Recommended Moonshot option in the question; user picked direct Moonshot instead). Gateway supports both Moonshot and Anthropic; pivot is a one-env-var change.
- Option B: temporarily fall back to **Anthropic** for v1 launch (re-instate the Anthropic adapter from git history). File "Moonshot integration v1.1" as a backlog item.
- Decision deferred until Plan 04-02 verification surfaces an actual problem.

---

## Files this addendum supersedes (read this BEFORE the source file when planning or executing Phase 4)

| File | Sections superseded |
|------|---------------------|
| `04-CONTEXT.md` | D-06 (Model ID strategy), D-01 proxy-skeleton bullet (`ai-chat` Edge Function spec), §"In scope" Anthropic references, §"BYO key fate" (D-03 still applies — BYO removal happens regardless of provider), §"Canonical refs" Anthropic docs entry (replace with Moonshot docs), §"Specifics" Anthropic-key bullet (still owned by user, just a different vendor) |
| `04-RESEARCH.md` | §1 (CLI bootstrap — only the `ANTHROPIC_*` secret names), §2 (Edge Function streaming — payload + headers + delta shape), §6 (refusal architecture — still model-agnostic, but cite Moonshot endpoint), §7 (system prompt — payload-shape only), §8 (Vercel env wiring — unaffected by pivot), §9 (CI test strategy — only `--allow-net` allowlist), §12 (model catalog — RESOLVED at Plan 04-02 time by researcher) |
| `04-PATTERNS.md` | Edge Function analog entry (current state described Anthropic direct fetch in `src/lib/ai.ts` — that file is being deleted regardless; the new pattern is "Moonshot OpenAI-compatible streaming") |
| `04-VALIDATION.md` | Acceptance commands that grep for `claude-sonnet-4-6` — change to grep for `kimi-k2-*` or whichever model ID the researcher resolves. The Per-Task Verification Map row for 04-02 model-ID check needs updating. |
| `04-01-PLAN.md` | Task 3 (secrets push), Task 6 (decision record content) |
| `04-02-PLAN.md` | Sub-task 2A (Edge Function authoring — payload + headers + delta consumer + browser SSE parser), Task 4 (curl-smoke acceptance — model ID assertion) |
| `04-03-PLAN.md` | Task 3 (Edge Function wiring — `captureAndPersist` delta-extraction shape only; refusal pre-check + rate-limit RPC + ai_messages persist all unchanged), Task 6 (CI deno-test job `--allow-net` allowlist) |

**Rule:** Any task that mentions `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `claude-sonnet-*`, `api.anthropic.com`, or "Anthropic Messages API" reads through this addendum's "What changed" section before executing. Plans were authored before the pivot; this addendum is the authoritative override.
