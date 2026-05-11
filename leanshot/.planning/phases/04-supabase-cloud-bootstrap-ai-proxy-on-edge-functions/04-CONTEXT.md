# Phase 4: Supabase Cloud Bootstrap + AI Proxy on Edge Functions - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Provision the Supabase cloud project (region, CLI init, env wiring across Vercel projects, Anthropic Function secret, magic-link auth provider stub), then deploy the `ai-chat` Edge Function — replacing browser-direct Anthropic calls. The function fixes the stale model ID, gates AI on Supabase anonymous auth, enforces per-user rate limits, structurally separates user content from system prompts, refuses prompt-injection + dose-change requests, and stores AI history in an RLS-scoped `ai_messages` table — all verified by an adversarial corpus run in CI under both vitest (browser side) and `deno test` (Edge Function side).

**In scope (from ROADMAP SC#0..SC#5):** Supabase project creation, `supabase init`, repo `supabase/` directory committed, `SUPABASE_URL`/`SUPABASE_ANON_KEY` in Vercel envs (both `leanshot-app` and `leanshot-marketing`), `ANTHROPIC_API_KEY` as Function secret, magic-link auth provider toggled on, `ai-chat` Edge Function deployed and serving streamed responses, structural separation of user content from system prompts, refusal-list integration, per-user rate-limit table, `ai_messages` table with RLS, BYO-key path removed, adversarial corpus in CI.

**Out of scope (deferred to later phases):**
- Email/password sign-up + verification UI (Phase 5 AUTH-01..05)
- First sync table `injections` (Phase 5 SYNC slice 1)
- Other data-type tables, migration, photos, offline queue (Phase 6 SYNC slice 2)
- HIPAA BAA Team-tier upgrade (Phase 7)
- Privacy policy + compliance copy (Phase 7)
- Doctor read-share + clinic surfaces (Phases 8-10)
- Pricing-tier rate limits (post-v1)

</domain>

<decisions>
## Implementation Decisions

### Plan structure + Supabase tooling (D-01)

- **D-01:** Phase 4 is **3 plans driven by Supabase CLI** — no MCP, all provisioning steps reproducible from the repo.
  - **04-01 — Bootstrap.** `supabase init` at repo root (creates `supabase/config.toml`), `supabase link --project-ref <ref>`, `supabase secrets set ANTHROPIC_API_KEY=…`, `supabase secrets set ANTHROPIC_MODEL=claude-sonnet-4-6` (see D-06), Vercel env push of `SUPABASE_URL` + `SUPABASE_ANON_KEY` across production+preview+development for both `leanshot-app` and `leanshot-marketing` projects, magic-link auth provider toggled on in Supabase dashboard (no UI wiring — Phase 5 owns that), `.planning/decisions/supabase.md` records project ID + region + Vercel project IDs. `.gitignore` confirms `.env*` excluded. **Acceptance: `supabase functions list` shows zero functions; `curl <project-url>/auth/v1/settings` returns provider config.**
  - **04-02 — Proxy skeleton.** `supabase/functions/ai-chat/index.ts` (Deno runtime), reads `ANTHROPIC_MODEL` from env with `claude-sonnet-4-6` default, calls Anthropic Messages API with `stream: true`, pipes SSE pass-through (D-05) to the browser. Replaces `src/lib/ai.ts` with a thin proxy-call wrapper (no key handling). Wires Supabase anonymous auth gate (D-02): `AIChatPanel.send()` calls `supabase.auth.signInAnonymously()` on first use if no session. Rewrites `AIChatPanel.tsx` and `NutritionTab.tsx` call sites; rewrites missing-key error path. Removes BYO UI (D-03). CORS configured for app domain + preview. **Acceptance: SC#1 + SC#2 verifiable — chat works without a pasted key, network tab shows browser → `/functions/v1/ai-chat`, Edge logs show real Anthropic call with `claude-sonnet-4-6`.**
  - **04-03 — Hardening.** Extracts refusal logic to `shared/refusal.ts` (D-04). Adds structural separation of user content from system prompts (AI-04): system prompt is a fixed template; user-supplied symptom logs/notes flow into a separate `<user_data>` block fenced by tokens the model is instructed never to emit (no string-concat into the system prompt). Adds `rate_limit_counters` Supabase table (PK: `user_id` + `bucket_start`) and proxy logic to increment + short-circuit (AI-02). Adds `ai_messages` table with RLS policy `auth.uid() = user_id`, default-deny on insert/select/update/delete (AI-05). Adds 50+ adversarial test corpus in `shared/refusal.ts` exercised by `vitest` (browser) and `supabase/functions/ai-chat/refusal.test.ts` (deno test) — both gated in CI. **Acceptance: SC#3 + SC#4 + SC#5 verifiable.**

### Auth dependency for AI chat in Phase 4 (D-02)

- **D-02:** **Supabase anonymous auth gates AI chat.** First call to `AIChatPanel.send()` runs `supabase.auth.signInAnonymously()` if no session exists; subsequent calls reuse the anonymous JWT. The Edge Function's `Authorization: Bearer <anon JWT>` header gives the function a real `auth.uid()`, which anchors the rate-limit table (AI-02) and the `ai_messages` RLS (AI-05). Phase 5's email/password sign-up uses `supabase.auth.linkIdentity({email, password})` so the anonymous UID is promoted in place — all existing rate-limit + AI history rows carry over without backfill or duplicate accounts.
  - Trade-off accepted: ~50ms latency on first chat session for the silent anonymous sign-in. Subsequent chats reuse the cached JWT (no added latency).
  - Trade-off accepted: anonymous rows need a cleanup policy (anon users who never sign up will accumulate). Cleanup mechanism deferred to Claude's discretion (cron-style scheduled deletion of anon rows older than 90 days is the obvious default; researcher should propose during research phase).

### BYO key fate (D-03)

- **D-03:** **Remove BYO entirely.** No "Advanced toggle" escape hatch.
  - `src/components/dashboard/settings/SettingsPage.tsx` — delete the entire "AI" Card section (currently lines ~224-262 with the api-key input, Save/Clear buttons, and the console.anthropic.com link). Drop the `apiKeyStorage` import.
  - `src/components/marketing/Landing.tsx` — rewrite line 474 (FAQ "what about my data") to say AI calls go through "our server using your account, never your own key"; rewrite line 486 (FAQ pricing) to drop the BYO-key sales pitch.
  - `src/lib/storage.ts` — delete `API_KEY_STORAGE` constant and `apiKeyStorage` helper. Bump STORAGE_VERSION to **7** if any persisted state references the field (likely not — the key was only in localStorage, not in the persisted Zustand slice — verify in research).
  - `src/lib/ai.ts` — REPLACED entirely with a thin wrapper around `/functions/v1/ai-chat`. No more `anthropic-dangerous-direct-browser-access`. Exports `callAIChat(messages, ctx)` (signature TBD by planner).
  - `src/components/dashboard/ai/AIChatPanel.tsx` — update missing-key empty state to a generic "AI is unavailable right now" state (only fires on proxy 5xx or rate-limit 429); current `MissingAPIKeyError` path goes away.
  - `src/components/dashboard/tabs/NutritionTab.tsx` — same treatment for the macro estimator's error path.
  - Migration cleanup: Phase 5 onboarding (or storage migration if STORAGE_VERSION bumps) silently runs `localStorage.removeItem('leanshot_anthropic_key')` on first sign-in to clean up stale pasted keys. No UI surface — the key is gone, nothing to communicate.

### Refusal-list reuse strategy (D-04)

- **D-04:** **Extract to project-root `shared/refusal.ts`.** Pure TS module, zero runtime deps, no Node built-ins, no `.ts` extension issues (Deno-friendly).
  - `shared/refusal.ts` exports `STEM_PATTERN`, `MED_NOUNS`, `isDoseChangeAdvice(text: string)`, and the `ADVERSARIAL_CORPUS` (50+ rows for SC#3 + the existing 53 rows from Phase 3 `insights-refusal.test.ts`).
  - `shared/refusal.test.ts` is the canonical test corpus, run by `vitest` from the browser side.
  - `src/lib/insights-refusal.ts` becomes a re-export wrapper: `export { isDoseChangeAdvice, ADVERSARIAL_CORPUS } from '../../shared/refusal'` plus the insights-specific glue (`scrubInsights`, `isInsightsDoseChange` if any wraps remain).
  - `supabase/functions/ai-chat/index.ts` imports via Deno-compatible relative path. Use `supabase/functions/import_map.json` with an entry like `{ "imports": { "shared/refusal": "../../shared/refusal.ts" } }` so the function code reads `import { isDoseChangeAdvice } from 'shared/refusal'`.
  - `supabase/functions/ai-chat/refusal.test.ts` uses Deno's built-in test runner to exercise the same `isDoseChangeAdvice` against the same corpus. **CI must run both vitest AND `supabase functions test` (or `deno test`) — single corpus, two runtimes.**
  - Phase 3 commits that already exist in `src/lib/insights-refusal.ts` (especially the CR-01 multi-occurrence walk and CR-02 expanded STEM_PATTERN) must move to `shared/refusal.ts` in their post-fix state. No regression of the Phase 3 fixes.

### Streaming protocol (D-05)

- **D-05:** **SSE pass-through.** Edge Function opens stream to Anthropic with `stream: true`, returns `text/event-stream` `ReadableStream` to the browser. Client-side SSE parser in the new `src/lib/ai.ts` decodes events into the same `AnthropicResponse`-shaped chunks `AIChatPanel`'s typing loop already consumes. Preserves the existing typing-effect UX from Phase 2 baseline (which was the Anthropic SDK's `stream` mode). Researcher should confirm Supabase Edge Functions support holding a long-lived stream (Cloudflare Workers / Deno Deploy both do — Supabase runs Deno Deploy underneath).

### Model ID strategy (D-06)

- **D-06:** **Env var `ANTHROPIC_MODEL` with default `claude-sonnet-4-6`.** Edge Function reads `Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6'`. Settable via `supabase secrets set ANTHROPIC_MODEL=…` without code change. CI integration test asserts the response carries the configured model ID. Researcher should verify `claude-sonnet-4-6` is still Anthropic's recommended latest stable Sonnet at execution time (model catalog may have rotated by then) — bump to whatever is current. The default lives in code so a fresh `supabase secrets set` is not required to deploy a working function.
  - The current `src/lib/ai.ts:22` `DEFAULT_MODEL = 'claude-sonnet-4-5'` is stale and will be deleted with the file. The ROADMAP SC#2 reference to "bogus `claude-sonnet-4-6`" is itself stale — `4-6` is the real current latest, and the SC's intent is met by replacing the in-code default with a server-side env-driven value.

### Claude's Discretion

The following are deliberately not pre-decided — researcher and planner have flexibility:

- **Exact rate-limit thresholds** — SC#4 says "100 messages in 60 seconds is rate-limited". Daily caps, per-session caps, and burst-vs-sustained policy are planner/researcher discretion. A reasonable default to consider: 60/hour, 200/day, burst protection via fixed-window counters.
- **Anonymous-row cleanup policy** — Anon `auth.users` rows that never link to email accumulate. Default proposal: scheduled function or pg_cron job deletes anon users with no activity in 90 days. Researcher proposes; planner picks.
- **`ai_messages` table schema** — columns at minimum: `id uuid pk default gen_random_uuid()`, `user_id uuid references auth.users(id) on delete cascade`, `role text check role in ('user','assistant')`, `content text`, `created_at timestamptz default now()`. Indexing strategy on `(user_id, created_at desc)` for chat-history retrieval. Final schema is planner's to write.
- **`rate_limit_counters` table schema** — fixed-window vs sliding-window is researcher's call (fixed-window is simpler and survives cold starts trivially because state lives in Postgres, not in Function memory).
- **Marketing site Supabase env vars** — ROADMAP says wire `SUPABASE_URL`/`SUPABASE_ANON_KEY` into BOTH `leanshot-app` and `leanshot-marketing` Vercel projects. The marketing site doesn't currently call Supabase. Planner decides whether to provision the env vars anyway (cheap, matches ROADMAP literal text, future-proofs lead-capture forms in Landing.tsx) or skip them with a `.planning/decisions/` note explaining the deviation.
- **System-prompt content for the AI coach** — fixed template lives in `supabase/functions/ai-chat/system-prompt.ts` (or inline in index.ts). Exact wording, persona, refusal phrasing — planner's to author. Reuse Phase 3's PK disclaimers from `src/lib/disclaimers.ts` if helpful (shared/refusal exports could include disclaimer-related constants too, planner's call).
- **Existing `aiHistory` localStorage data** — Pre-Phase-4 users have AI chat history in `localStorage.leanshot_v4.aiHistory`. Phase 4 does NOT migrate this to the new `ai_messages` table (no signed-in identity to attach it to). Options: silently abandon (cleanest), warn user on next chat open, hold in localStorage in parallel for a release cycle. Planner picks; defer to researcher's risk read.
- **Adversarial corpus authoring style** — one big array vs grouped by attack pattern (prompt-injection, dose-change, emotional manipulation, system-prompt-extraction). Planner discretion; the corpus only needs to be ≥50 rows and cover the SC#3 attack families.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### ROADMAP + REQUIREMENTS source-of-truth

- `.planning/ROADMAP.md` §"Phase 4: Supabase Cloud Bootstrap + AI Proxy on Edge Functions" (lines 102-117) — phase goal, SC#0-5, the explicit "Bootstrap-vs-feature note" directing this 3-plan split.
- `.planning/REQUIREMENTS.md` §"AI Coach Hardening" — AI-01..AI-06.
- `.planning/REQUIREMENTS.md` §"Production Readiness" → PROD-04 — implicit "Supabase project exists in the cloud" requirement to be added during planning.

### Codebase maps that downstream agents should consult

- `.planning/codebase/INTEGRATIONS.md` §"Anthropic Messages API" — current direct-call pattern this phase replaces (endpoint, headers, model ID, BYO-key UX, call sites).
- `.planning/codebase/CONCERNS.md` §"Inline AI prompt construction is fragile to data drift" — flags the string-concat prompt pattern in `AIChatPanel.send` and `NutritionTab.aiEstimate` that AI-04's structural separation must fix.
- `.planning/codebase/STACK.md` — confirms Deno is the Supabase Edge runtime; React 19 + Vite + TS strict on the browser side.
- `.planning/codebase/CONVENTIONS.md` — naming, file-placement, import-alias rules to follow.

### Prior phase context that this phase builds on

- `.planning/phases/03-pharmacology-insights-hardening/03-CONTEXT.md` §"Insights refusal-list (D-05)" — refusal-list shape (STEM_PATTERN + MED_NOUNS + context-guard). Phase 4 extracts this from `src/lib/insights-refusal.ts` to `shared/refusal.ts`. The post-fix state (after CR-01 multi-occurrence walk + CR-02 expanded verbs) is the baseline.
- `.planning/phases/03-pharmacology-insights-hardening/03-02-SUMMARY.md` — exact implementation of insights-refusal that Phase 4 inherits.
- `.planning/phases/03-pharmacology-insights-hardening/03-REVIEW.md` (CR-01, CR-02 sections) — the safety bugs already fixed; downstream agents MUST NOT regress them when moving code to `shared/refusal.ts`.
- `.planning/phases/03-pharmacology-insights-hardening/03-VERIFICATION.md` — confirms Phase 3 final state (177/177 tests).

### Existing source files Phase 4 modifies or replaces

- `src/lib/ai.ts` — REPLACED entirely. Current state: direct-fetch to api.anthropic.com with x-api-key; will become thin wrapper around `/functions/v1/ai-chat`.
- `src/lib/storage.ts:32` (`API_KEY_STORAGE`) and `:121` (`apiKeyStorage`) — DELETED.
- `src/components/dashboard/settings/SettingsPage.tsx:224-262` — DELETED (BYO key card).
- `src/components/marketing/Landing.tsx:474, :486` — REWRITTEN (FAQ copy).
- `src/components/dashboard/ai/AIChatPanel.tsx:8-9, :108-110` — UPDATED (proxy call site + new error empty state).
- `src/components/dashboard/tabs/NutritionTab.tsx:10-14, :60-80` — UPDATED (proxy call site + error path).
- `src/lib/insights-refusal.ts` — RE-ROOTED as re-export wrapper around `shared/refusal.ts`.

### New files Phase 4 creates

- `supabase/config.toml` (created by `supabase init`).
- `supabase/functions/ai-chat/index.ts` — Deno proxy entry point.
- `supabase/functions/ai-chat/refusal.test.ts` — Deno test exercising shared corpus.
- `supabase/functions/import_map.json` — Deno import map exposing `shared/refusal.ts` and any other shared modules.
- `supabase/migrations/<timestamp>_ai_messages.sql` — RLS-scoped AI history table.
- `supabase/migrations/<timestamp>_rate_limit_counters.sql` — rate-limit table.
- `shared/refusal.ts` + `shared/refusal.test.ts` — extracted refusal logic + tests.
- `.planning/decisions/supabase.md` — recorded project ID, region, Vercel project IDs.

### External docs (researcher must verify current at execution time)

- Supabase Edge Functions docs (Deno runtime, SSE streaming patterns, secrets, function-level auth gates).
- Supabase `auth.signInAnonymously()` + `linkIdentity()` reference (Phase 5 hand-off depends on linkIdentity behavior).
- Supabase CLI reference for `supabase init`, `supabase link`, `supabase secrets set`, `supabase functions deploy`, `supabase db push`.
- Anthropic Messages API streaming reference (SSE format the Edge Function will pass through).
- Anthropic model catalog — confirm `claude-sonnet-4-6` is current latest stable Sonnet at execution time.
- Vercel CLI reference for pushing env vars across projects + targets (`vercel env add`).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/lib/insights-refusal.ts`** — post-Phase-3-fix refusal logic. Extracts cleanly to `shared/refusal.ts` (D-04). Existing 53 test rows + Phase 3 CR-01/CR-02 regressions become the seed of the 50+ adversarial corpus required by SC#3.
- **`src/lib/disclaimers.ts`** — Phase 3 shared PK disclaimer strings. The proxy's system prompt and any "refused — see your doctor" response template can pull these for consistency with the chart watermark + DoctorReport PDF text (single source of truth for disclaimer wording).
- **`AIChatPanel.tsx` typing-effect UX** — current SSE consumption loop. Survives D-05 (SSE pass-through) unchanged; only the underlying fetch target changes.
- **`apiKeyStorage` localStorage wrapper pattern in `storage.ts`** — soon deleted, but the try/catch + JSON-parse-with-fallback pattern is the convention for future Supabase-session-survives-private-mode handling.

### Established Patterns

- **Direct browser fetch with header dance** (current `src/lib/ai.ts:50-60`) — pattern being killed. New proxy call site uses a normal fetch to a same-origin (or `*.supabase.co`) URL with `Authorization: Bearer <anon JWT>`. CORS preflight handled by the Edge Function.
- **One-Zustand-store + persist middleware** — no architecture change here. Auth session is held by `@supabase/supabase-js` outside the Zustand store; selectors that depend on auth state should read from the Supabase client, not duplicate session into the store.
- **Lazy-loaded route-equivalents** — `AIChatPanel` is already in a `React.lazy(...)` boundary; the new proxy wrapper file (`src/lib/ai.ts` rewritten) stays in the existing import graph, no chunk-split changes needed.
- **`partialize` exclusion list in `src/lib/store.ts`** — `aiHistory` is currently partialized. After Phase 4 anonymous-auth gating, history is still kept in localStorage in parallel for the current chat session (D-03 migration cleanup section). Researcher should check whether to remove `aiHistory` from partialize once the `ai_messages` table is the source of truth, or keep it as offline-cache.
- **Phase 3 commit protocol — `feat`/`fix`/`test`/`docs` separated, RED→GREEN paired commits** — Phase 4 plans should follow the same protocol per phase repo's commit-style convention.

### Integration Points

- **`AIChatPanel.send()`** at `src/components/dashboard/ai/AIChatPanel.tsx:65` — primary call site that switches from `callAnthropic` to `callAIChat`. Also injects anonymous-sign-in on first use.
- **`NutritionTab.aiEstimate`** at `src/components/dashboard/tabs/NutritionTab.tsx:76` — secondary call site for the JSON-only macro estimator. Same proxy switch + anon-sign-in.
- **Vercel projects `leanshot-app` and `leanshot-marketing`** — env var targets per SC#0. `leanshot-app` definitely needs `SUPABASE_URL`/`SUPABASE_ANON_KEY`; `leanshot-marketing` is the Claude's-Discretion question.
- **Existing `package-lock.json`** — adding `@supabase/supabase-js` is the only browser-side dep change. Edge Function's deps live in `supabase/functions/ai-chat/import_map.json` (Deno style, not npm).
- **CI workflow at `/Users/karstenhaldan/minisite/.github/workflows/ci.yml`** (repo root, NOT in `leanshot/`) — must add a `supabase functions test` (or `deno test --allow-env --allow-net=api.anthropic.com`) step alongside the existing `vitest run` job. Phase 1 quirks (`gsd-verifier` and `gsd-phase-researcher` repo-root-vs-leanshot trap) apply — explicitly tell agents this file's absolute path.

</code_context>

<specifics>
## Specific Ideas

- The Supabase project will live under the user's existing Supabase org (account already exists per user's stated context). Free tier is fine for v1; the team-tier BAA upgrade tracks separately for Phase 7 and does NOT block Phase 4.
- Anthropic platform key (`ANTHROPIC_API_KEY`) is owned by the project; the user provisions it. Researcher must NOT bake an explicit recommended-rate-limit number based on a specific Anthropic spend cap — that's a runtime knob, not a design decision.
- `supabase init` creates `supabase/` at repo root. In this layout, "repo root" means `/Users/karstenhaldan/minisite/` (the git root), NOT `/Users/karstenhaldan/minisite/leanshot/`. Verify with the user before running the command — but the convention is: Supabase config sits at the same level as `.github/workflows/ci.yml`, which is the repo root. The `leanshot/` subdir is the React app; `supabase/` is its sibling.
- `import_map.json` for the Edge Function lets `import { isDoseChangeAdvice } from 'shared/refusal'` work in Deno. The relative path from `supabase/functions/ai-chat/index.ts` to `shared/refusal.ts` depends on whether `supabase/` is repo-root or `leanshot/`-root. Researcher should confirm before authoring the import map.
- The "anonymous-rows cleanup policy" (D-02 trade-off note) is a real concern — Supabase anonymous-auth UIDs are full `auth.users` rows. Over time, anon-only users that never sign up will accumulate. Researcher should propose either (a) pg_cron deletion of anon users inactive for 90 days, or (b) cleanup on schema migration. NOT a Phase 4 blocker — just record the proposal in Phase 4 research output.

</specifics>

<deferred>
## Deferred Ideas

- **Pricing-tier rate limits** (anonymous low cap, sign-in lifts cap, paid tier lifts further) — explicitly rejected for v1. Belongs in a post-v1 monetization phase, not Phase 4.
- **EHR integration / direct doctor portal API** — out of scope; CLAUDE.md project constraints rule out HIPAA-covered-entity features in v1.
- **Voice input / TTS for AI coach** — not requested; future phase.
- **AI coach memory across sessions (RAG over the user's full data set)** — out of scope. Current pattern of building per-call context inline from store snapshot stays. Researcher should NOT propose RAG-style retrieval for Phase 4.
- **Magic-link sign-in UI in Phase 4** — explicitly deferred to Phase 5. The Supabase magic-link provider is toggled ON in Phase 4 (SC#0), but no UI surfaces it.
- **Migrating existing `aiHistory` localStorage data to `ai_messages` table** — see Claude's Discretion. Default: silently abandon. Re-evaluate in Phase 5 alongside `leanshot_v4` migration (SYNC-02, SYNC-03).
- **BYO key as an Advanced toggle** — explicitly rejected for v1 (D-03). Could revisit post-v1 if power users complain.

</deferred>

---

*Phase: 04-supabase-cloud-bootstrap-ai-proxy-on-edge-functions*
*Context gathered: 2026-05-11*
