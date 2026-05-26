---
phase: 60-rag-knowledge-base-completion-waves-2-4
plan: 02
type: execute
wave: 0
depends_on: ["60-01"]
files_modified:
  - supabase/functions/_shared/rag-retrieve.ts
  - supabase/functions/_shared/rag-retrieve.test.ts
  - supabase/functions/_shared/posthog-rag-events.ts
  - supabase/functions/_shared/posthog-rag-events.test.ts
  - supabase/functions/_shared/slack-guardrail-alert.ts
  - supabase/functions/_shared/slack-guardrail-alert.test.ts
  - supabase/functions/_shared/deno.json
autonomous: true
requirements: [RAG-04, RAG-05]
tags: [rag, edge-functions, observability, guardrails, slack, posthog]
must_haves:
  truths:
    - "Edge-Fn consumers (rag-synthesize / rag-tip-of-day-generate / rag-newsletter-sender) can call a single typed `retrieveRagChunks({ query, k, userJwt? })` helper instead of hand-rolling fetch boilerplate."
    - "Every Phase 60 typed RAG event (`$ai_generation`, `$ai_evaluation`, `rag_citation_validation_failed`, `rag_refusal_emitted`, `rag_cost_envelope_breach`, `rag_kanon_floor_dropped`, `rag_stale_evidence_flagged`, `rag_ai04_fence_breach`) is emitted via `_shared/posthog-rag-events.ts` typed emitters reusing the existing `_shared/posthog-server.ts` PostHog client + events_mirror dual-write infrastructure."
    - "Guardrail trips (PHARMA-02 G1, FDA-equivalence G9, cost-envelope-rolling-mean G6, cron-cap G7) route to Slack via `sendSlackGuardrailAlert(channel, payload)` which fetches the webhook URL from `vault.decrypted_secrets` at call-time (no plaintext webhook in source / no env var)."
    - "All three helpers + their per-Fn `deno.json` import map are unit-tested via `deno test --no-check` and pass without network access (mocked fetch + mocked Supabase admin client)."
    - "No `Deno.serve(...)` call exists at top level in any helper file — `[[reference_deno_test_top_level_serve_trap]]` cannot be reintroduced via this plan."
  artifacts:
    - path: "supabase/functions/_shared/rag-retrieve.ts"
      provides: "Typed server-to-server HTTP client for Phase 60 `rag-retrieve` Edge Fn (deployed in 60-06). Exports `retrieveRagChunks({ query, k?, userJwt?, filters? })` returning `Promise<RagRetrieveResult>`, typed refusal envelope, exponential-backoff retry on 5xx (cap 2), timeout via `AbortSignal.timeout(8000)`."
      min_lines: 80
    - path: "supabase/functions/_shared/posthog-rag-events.ts"
      provides: "Typed emitters: `emitAiGeneration`, `emitAiEvaluation`, `emitCitationValidationFailed`, `emitRefusalEmitted`, `emitCostEnvelopeBreach`, `emitKanonFloorDropped`, `emitStaleEvidenceFlagged`, `emitAi04FenceBreach`. Exports `Phase60RagEvent` discriminated-union type. Reuses `captureRagEvent` / `captureServer` from `_shared/posthog-server.ts`."
      min_lines: 100
    - path: "supabase/functions/_shared/slack-guardrail-alert.ts"
      provides: "`sendSlackGuardrailAlert(channel, payload)` — fetches webhook URL from `vault.decrypted_secrets WHERE name='slack_guardrail_webhook'` via service-role admin client, POSTs JSON `{ channel, attachments: [...] }`, vendor-gated no-op + one-time warning when vault row missing."
      min_lines: 50
    - path: "supabase/functions/_shared/deno.json"
      provides: "Per-directory deno.json import map for `_shared` helpers — `posthog-node`, `@supabase/supabase-js`, `zod`. Required per `[[reference_supabase_functions_deploy_import_map_flag]]` (CLI v2.101.0+ ignores legacy `--import-map`)."
      contains: '"imports"'
  key_links:
    - from: "supabase/functions/_shared/posthog-rag-events.ts"
      to: "supabase/functions/_shared/posthog-server.ts"
      via: "named import `captureRagEvent` + `captureServer` + `shutdownPostHog`"
      pattern: "from ['\"]\\./posthog-server\\.ts['\"]"
    - from: "supabase/functions/_shared/slack-guardrail-alert.ts"
      to: "vault.decrypted_secrets"
      via: "service-role admin client `select decrypted_secret from vault.decrypted_secrets where name='slack_guardrail_webhook'`"
      pattern: "slack_guardrail_webhook"
    - from: "supabase/functions/_shared/rag-retrieve.ts"
      to: "supabase/functions/rag-retrieve (deployed in 60-06)"
      via: "fetch POST to `${SUPABASE_URL}/functions/v1/rag-retrieve` with `Authorization: Bearer <user-jwt | service-role-key>`"
      pattern: "/functions/v1/rag-retrieve"
---

<objective>
Ship the three `_shared/` Deno helpers that downstream Phase 60 Edge Functions
(60-04 chunker, 60-05 embed, 60-06 retrieve+rerank, 60-07 federated adapters,
60-11 tip-of-day-generate, 60-12 newsletter-sender) MUST import to satisfy
AI-SPEC §6 guardrails (G1-G10) and §7 production-monitoring contracts without
each Fn rewriting fetch / PostHog / Slack boilerplate.

Purpose: enforce a single canonical surface for (a) calling the deployed
`rag-retrieve` Edge Fn server-to-server, (b) emitting typed Phase 60 RAG
PostHog events that reuse the events_mirror dual-write from `posthog-server.ts`,
(c) routing guardrail trips to Slack via vault-stored webhook URL. This plan is
the contract layer all Wave-1+ Fn plans depend on. RAG-04 (AI-coach citation
integration end-to-end depends on retrieveRagChunks helper) and RAG-05
(rerank precision delta logging depends on typed `$ai_evaluation` emitter) are
mapped here per outline coverage.

Output: 3 helper modules + 3 paired Deno test files + one `_shared/deno.json`
import map.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@leanshot/.planning/PROJECT.md
@leanshot/.planning/ROADMAP.md
@leanshot/.planning/STATE.md
@leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-AI-SPEC.md
@leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-CONTEXT.md
@leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-PLAN-OUTLINE.md

# Existing project helpers this plan extends (read-first; do NOT modify):
@supabase/functions/_shared/posthog-server.ts
@supabase/functions/_shared/posthog-server.test.ts
@supabase/functions/_shared/sentry.ts

# Phase 60 dependency artifact (60-01 migration, must already exist on disk by Wave-0 execute order):
@supabase/migrations/20261201000001_phase60_kb_tables.sql

<interfaces>
<!-- Pinned contracts the executor must implement against. Do NOT explore. -->

From supabase/functions/_shared/posthog-server.ts (Phase 24 / 50-04):
```typescript
export type CaptureArgs = {
  userId: string;
  event: string;
  properties?: Record<string, unknown>;
};
export function captureServer(args: CaptureArgs): void;
export function captureRagEvent(args: {
  distinctId?: string;          // defaults to 'rag-system'
  name: string;
  properties?: Record<string, unknown>; // user_id / patient_id scrubbed defensively
}): void;
export async function shutdownPostHog(): Promise<void>;
```

From 60-AI-SPEC §3 + §4 (citation contract — what `rag-retrieve` Edge Fn returns):
```typescript
// One retrieved + reranked chunk
export interface RagRetrievedChunk {
  chunk_id: string;             // uuid
  source_id: string;            // uuid pointing at kb_sources row
  source_type: 'fda_label' | 'peer_reviewed' | 'leanshot_research' | 'community' | 'pubmed' | 'openfda' | 'dailymed';
  tier: 'A' | 'B' | 'C';
  topic_tag: string;            // e.g. 'tirzepatide.titration'
  source_text_excerpt: string;  // verbatim, used for citation offset validation
  summary: string;              // Haiku-generated, citation popover body
  similarity: number;           // cosine [0..1]
  rerank_score: number | null;  // null when reranker disabled / refused
  evidence_date: string;        // ISO date
  freshness_reweight_applied: boolean;
  public_visibility: boolean;
}

// Full envelope returned by the rag-retrieve Edge Fn
export interface RagRetrieveResult {
  refused: boolean;
  refusal_reason: 'out_of_corpus' | 'pharma_02_carveout' | 'safety' | null;
  chunks: RagRetrievedChunk[];
  trace_id: string;             // links to $ai_generation in PostHog
  reranker_provider: 'cohere' | 'jina' | 'none';
  // Cost telemetry (server-emitted; helpers re-emit via emitAiGeneration when retrieveRagChunks is wrapped):
  embed_cost_usd: number;
  rerank_cost_usd: number;
}
```

From 60-AI-SPEC §6 G6 + §7 (cost envelope thresholds):
- per-request envelope: `usage_total_cost > $0.04` → flag → emit `rag_cost_envelope_breach`
- rolling 10-request mean breach → block-60s + Slack `#alerts-cost`
- per-cron caps: tip-of-day $0.50, newsletter $5.00, federated-sync $2.00/hour

From 60-AI-SPEC §7 Slack channel routing:
- `#alerts-pharma02` (P1, G1)  ·  `#alerts-regulatory` (P1, G9)
- `#alerts-rag` (P2/P3, F1/F2/F3/F6)  ·  `#alerts-cost` (P2, G6/G7)
- `#alerts-research` (P3, F7 k-anonymity)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Per-Fn deno.json import map for _shared</name>
  <files>supabase/functions/_shared/deno.json</files>
  <read_first>
    - supabase/functions/_shared/posthog-server.ts (line 31-33 import specifiers — must match versions here)
    - supabase/functions/_shared/sentry.ts (npm: specifier pattern precedent)
    - 60-AI-SPEC §3 lines 199-211 (canonical per-Fn deno.json shape; Phase 60 imports)
  </read_first>
  <behavior>
    - File parses as valid JSON
    - `imports` map contains keys: `posthog-node`, `@supabase/supabase-js`, `zod`, `std/assert`
    - Versions match `_shared/posthog-server.ts` (posthog-node 5.10.4; @supabase/supabase-js 2)
    - `tasks.test` runs `deno test --no-check .`
    - `lint.rules.tags` includes `recommended`
  </behavior>
  <action>
    Create `supabase/functions/_shared/deno.json` per `[[reference_supabase_functions_deploy_import_map_flag]]` (CLI v2.101.0+ silently ignores root-level `--import-map`; every directory ships its own deno.json). Mirror the AI-SPEC §3 template lines 199-211 with Phase 60 specifics:
    - `imports`: `posthog-node` → `npm:posthog-node@5.10.4` (exact-match `posthog-server.ts` line 33), `@supabase/supabase-js` → `npm:@supabase/supabase-js@2`, `zod` → `npm:zod@^3`, `std/assert` → `https://deno.land/std@0.224.0/assert/mod.ts` (match `_shared/posthog-server.test.ts` line 18 exactly).
    - `tasks.test`: `"deno test --no-check ."` (per Deno-binary memory `[[reference_deno_binary_path]]` — `--no-check` required for cross-Fn test sweeps).
    - `lint.rules.tags`: `["recommended"]`.
    Do NOT include `@sentry/node` (sentry.ts is unrelated to this plan; do not re-export). Do NOT use `import_map.json` top-level filename — Supabase CLI looks for `deno.json` specifically.
  </action>
  <verify>
    <automated>node -e "JSON.parse(require('fs').readFileSync('supabase/functions/_shared/deno.json','utf8'))" &amp;&amp; grep -q '"posthog-node": "npm:posthog-node@5.10.4"' supabase/functions/_shared/deno.json &amp;&amp; grep -q '"deno test --no-check' supabase/functions/_shared/deno.json</automated>
  </verify>
  <done>
    `_shared/deno.json` exists, parses as valid JSON, imports map has 4 entries with versions exactly matching `_shared/posthog-server.ts` line 33 and `_shared/posthog-server.test.ts` line 18, `tasks.test` invokes `--no-check`.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: posthog-rag-events typed emitter helper</name>
  <files>
    supabase/functions/_shared/posthog-rag-events.ts,
    supabase/functions/_shared/posthog-rag-events.test.ts
  </files>
  <read_first>
    - supabase/functions/_shared/posthog-server.ts (full file — re-use `captureRagEvent` + `captureServer`; understand `Phase38Event` typed-union precedent)
    - supabase/functions/_shared/posthog-server.test.ts (full file — mirror Deno.test style + dynamic re-import pattern for env-gated isolation)
    - 60-AI-SPEC §7 lines 932-944 (canonical event-name list this file makes typed)
    - 60-AI-SPEC §6 lines 904-915 (which event each guardrail emits)
  </read_first>
  <behavior>
    - `Phase60RagEvent` typed-union exports the 8 event names from AI-SPEC §7 verbatim: `$ai_generation`, `$ai_evaluation`, `rag_citation_validation_failed`, `rag_refusal_emitted`, `rag_cost_envelope_breach`, `rag_kanon_floor_dropped`, `rag_stale_evidence_flagged`, `rag_ai04_fence_breach`.
    - Each emitter (`emitAiGeneration`, `emitAiEvaluation`, `emitCitationValidationFailed`, `emitRefusalEmitted`, `emitCostEnvelopeBreach`, `emitKanonFloorDropped`, `emitStaleEvidenceFlagged`, `emitAi04FenceBreach`) takes a typed `properties` payload + optional `userId` (when `userId` absent, falls back to `captureRagEvent({ distinctId: 'rag-system', ... })`; when present, calls `captureServer({ userId, event, properties })` so events_mirror dual-write fires for user-attributed events per `posthog-server.ts` line 117-154).
    - PHI scrub re-asserted: every emitter strips `user_id`, `patient_id`, `email`, `phone` from `properties` before forwarding (defense-in-depth atop `captureRagEvent`'s scrub).
    - When `userId` is empty string OR explicitly omitted AND event-name is in the user-attributed set (`$ai_generation`, `$ai_evaluation`, `rag_refusal_emitted`), helper throws `Error('userId required for user-attributed event ${name}')` — matches D-13 contract.
    - `emitCostEnvelopeBreach` payload schema: `{ scope: 'per_request' | 'per_cron', cron_kind?: 'tip_of_day' | 'newsletter' | 'federated_sync', cost_usd: number, envelope_usd: number, trace_id: string }`.
    - `emitRefusalEmitted` payload schema: `{ refusal_reason: 'out_of_corpus' | 'pharma_02_carveout' | 'safety', surface: 'coach' | 'tip_of_day' | 'newsletter', trace_id: string }`.
    - Test file exercises: (1) emitter routes to `captureRagEvent` when `userId` omitted, (2) emitter routes to `captureServer` when `userId` present, (3) PHI fields scrubbed before forward, (4) user-attributed emitter throws on empty `userId`.
  </behavior>
  <action>
    Implement `_shared/posthog-rag-events.ts` as a typed wrapper over `_shared/posthog-server.ts`. Define `Phase60RagEvent` as a discriminated-union string literal type pinning the exact 8 event names from 60-AI-SPEC §7 (lines 936-943). Define one typed payload interface per event mirroring §6/§7 wording (refusal_reason / cost_envelope_breach / kanon_floor / stale_evidence / ai04_fence_breach all enumerated per the AI-SPEC tables).

    Each emitter function:
    1. Defensively shallow-clones `properties` then deletes `user_id`, `patient_id`, `email`, `phone` keys (defense-in-depth — `captureRagEvent` already strips `user_id`/`patient_id`, this helper extends to `email`/`phone` since Phase 60 `email_subscribers` and federated PubMed author rows may carry these inadvertently).
    2. If `args.userId` is non-empty string → call `captureServer({ userId, event: <name>, properties: scrubbed })` (so events_mirror dual-write fires per `posthog-server.ts` lines 129-153).
    3. Else → call `captureRagEvent({ distinctId: 'rag-system', name: <name>, properties: scrubbed })`.
    4. For user-attributed events (`$ai_generation`, `$ai_evaluation`, `rag_refusal_emitted`) — throw `Error` when `userId` empty/missing (matches D-13).

    DO NOT introduce a new PostHog client instance — reuse the lazily-created one in `posthog-server.ts` via re-export. DO NOT add a `shutdownPostHog` wrapper here; consumers import it directly from `_shared/posthog-server.ts` per its existing contract (avoid name-collision drift).

    Re-export `shutdownPostHog` from `posthog-server.ts` so downstream Fns can `import { emitAiGeneration, shutdownPostHog } from '../_shared/posthog-rag-events.ts'` in a single line — convenience only; the actual function instance is the one in `posthog-server.ts`.

    Companion `posthog-rag-events.test.ts`:
    - Mirror `posthog-server.test.ts` line 1-30 header comment style and `Deno.test(...)` block structure.
    - Stub `captureServer` + `captureRagEvent` by exporting test seams: add to `posthog-server.ts`? NO — do not modify `posthog-server.ts`. Instead, in the test file dynamically import a thin local shim that re-implements emitters around stubs. Simpler approach: test the helper by setting `POSTHOG_PROJECT_KEY=''` (no-op path) + capturing `console.warn` via `globalThis.console.warn = ...` and asserting the scrub + routing logic by spying on the call chain. Use the same "delete env var → dynamic import → reset" pattern from `posthog-server.test.ts` lines 23-30.
    - Test 1: `emitAiGeneration({ userId: 'u1', model: 'claude-sonnet-4-6', ... })` does not throw when POSTHOG_PROJECT_KEY absent (no-op path).
    - Test 2: `emitAiGeneration({ userId: '' as string, ... })` throws with message containing `userId required`.
    - Test 3: `emitRefusalEmitted({ properties: { refusal_reason: 'out_of_corpus', user_id: 'leaked-pii', surface: 'coach', trace_id: 't1' }, userId: 'u1' })` — after call, intercept by spying on `getClient` returning null (no-op) but confirm the `properties` object passed to `captureServer` does NOT contain `user_id`. Achieve this by importing a `_testScrubProperties` exported-for-test helper that returns the scrubbed object (TS-only test seam, NOT a runtime concern).
    - Test 4: `emitCostEnvelopeBreach({ properties: { scope: 'per_cron', cron_kind: 'tip_of_day', cost_usd: 0.62, envelope_usd: 0.50, trace_id: 't2' } })` succeeds without `userId` (system-attributed event).
  </action>
  <verify>
    <automated>cd supabase/functions/_shared &amp;&amp; $HOME/.deno/bin/deno test --no-check ./posthog-rag-events.test.ts</automated>
  </verify>
  <done>
    `posthog-rag-events.ts` exports 8 typed emitters + `Phase60RagEvent` union + re-exports `shutdownPostHog`. Test file has 4 `Deno.test` blocks, all pass under `deno test --no-check` with no network access. PHI scrub strips email/phone/user_id/patient_id before forward. User-attributed emitters throw on empty userId.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: slack-guardrail-alert vault-fetched webhook helper</name>
  <files>
    supabase/functions/_shared/slack-guardrail-alert.ts,
    supabase/functions/_shared/slack-guardrail-alert.test.ts
  </files>
  <read_first>
    - supabase/functions/_shared/posthog-server.ts (lines 62-80 — `getMirrorAdmin()` lazy singleton pattern; mirror this for the vault admin client)
    - 60-AI-SPEC §7 lines 958-970 (canonical Slack channel routing table — pinned event-to-channel map)
    - `[[reference_supabase_pg_cron_vault_service_role_pattern]]` memory entry — `select decrypted_secret from vault.decrypted_secrets where name='<key>'` is the supported lookup (NOT `current_setting('app.<key>')`).
  </read_first>
  <behavior>
    - `sendSlackGuardrailAlert(channel, payload)` accepts typed `channel: 'pharma02' | 'regulatory' | 'rag' | 'cost' | 'research'` (mapped to actual `#alerts-<channel>` Slack channels in §7 routing table).
    - When `vault.decrypted_secrets` has no row `name='slack_guardrail_webhook'` → one-time `console.warn` + no-op return (`vendor-gated send` pattern from `[[reference_vendor_gated_send_health_check]]`; mirrors `posthog-server.ts` lines 44-49 missing-env behavior).
    - When vault row exists → POST `{ channel: '#alerts-<channel>', attachments: [{ color, title, text, fields }] }` to the webhook URL with `Content-Type: application/json`, `AbortSignal.timeout(5000)`.
    - HTTP failure (network / non-2xx) → `console.warn` with status code, NEVER throws back to caller (Slack delivery is best-effort; the guardrail block already fired).
    - Lazy singleton admin client (no instance until first call) — mirror `getMirrorAdmin()` from `posthog-server.ts` line 63-80.
    - `payload.severity` typed `'P1' | 'P2' | 'P3'` and maps to `attachments[].color` (`#FF0000` / `#FFA500` / `#FFFF00`).
    - Test file: (1) call with no `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` → no-op + warn, (2) stubbed vault response with valid URL → fetch called exactly once with right URL + body, (3) stubbed fetch returns 500 → no throw, console.warn emitted, (4) stubbed vault returns no row → no-op + warn, (5) `channel: 'pharma02'` resolves to Slack `'#alerts-pharma02'` in posted body.
  </behavior>
  <action>
    Implement `_shared/slack-guardrail-alert.ts`:

    1. Imports: `import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2'` (mirror `posthog-server.ts` line 31).
    2. Module-level lazy singleton: `let _vaultAdmin: SupabaseClient | null = null; let _vaultEnvWarned = false; let _vaultRowWarned = false;` — three independent one-time-warn flags so missing-env vs missing-row vs HTTP-failure are distinguishable in logs.
    3. `getVaultAdmin()` returns `_vaultAdmin` (lazy create from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; null + warn-once on first call when either missing). Body identical in shape to `posthog-server.ts` lines 63-80; do NOT export.
    4. `fetchWebhookUrl()` async → returns `string | null`: queries `vault.decrypted_secrets` filtered by `name='slack_guardrail_webhook'` (SECDEF read; service-role bypasses RLS). Cache the URL in a module-level `_cachedWebhook: string | null` so repeated guardrail trips in the same isolate don't re-query vault.
    5. `CHANNEL_MAP` const: `{ pharma02: '#alerts-pharma02', regulatory: '#alerts-regulatory', rag: '#alerts-rag', cost: '#alerts-cost', research: '#alerts-research' }` — pinned exactly to 60-AI-SPEC §7 channels.
    6. `SEVERITY_COLOR` const: `{ P1: '#FF0000', P2: '#FFA500', P3: '#FFFF00' }`.
    7. Exported `GuardrailAlertChannel`, `GuardrailAlertSeverity`, `GuardrailAlertPayload` types. `GuardrailAlertPayload = { severity: GuardrailAlertSeverity; title: string; text: string; fields?: Array<{ title: string; value: string; short?: boolean }>; trace_id?: string; }`.
    8. Exported `sendSlackGuardrailAlert(channel, payload): Promise<void>` — single async function:
       - `const url = await fetchWebhookUrl();` → null → log + return.
       - Build body: `{ channel: CHANNEL_MAP[channel], attachments: [{ color: SEVERITY_COLOR[payload.severity], title: payload.title, text: payload.text, fields: [...(payload.fields ?? []), ...(payload.trace_id ? [{ title: 'trace_id', value: payload.trace_id, short: true }] : [])] }] }`.
       - `await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) })`.
       - Wrap entire fetch in `try { ... } catch (err) { console.warn('[slack-guardrail-alert] send failed:', err) }`. NEVER re-throw.
       - On non-2xx response → `console.warn` with status + first 200 chars of response body, NEVER throw.
    9. Add a `setVaultAdminForTest` + `resetVaultAdminForTest` + `resetCachedWebhookForTest` triplet exported under `@internal` JSDoc — mirrors `posthog-server.ts` lines 82-91 test-seam pattern.

    Companion `_shared/slack-guardrail-alert.test.ts`:
    - Mirror `posthog-server.test.ts` header style + dynamic-import-per-test pattern.
    - Test 1 — "no-op when SUPABASE_URL missing": delete env, dynamic-import, call `sendSlackGuardrailAlert('pharma02', {...})`, assert no throw, restore env.
    - Test 2 — "POSTs to fetched webhook URL": stub `setVaultAdminForTest` with `{ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { decrypted_secret: 'https://hooks.slack.com/services/AAA/BBB/CCC' }, error: null }) }) }) }) }` — stub `globalThis.fetch` to capture the call. Assert URL exact-match, method `POST`, body parses as JSON with `channel === '#alerts-pharma02'`, `attachments[0].color === '#FF0000'`.
    - Test 3 — "no-throw on fetch 500": stub vault with URL, stub `globalThis.fetch` to return `new Response('Server error', { status: 500 })`. Call helper, assert no throw, assert `console.warn` was called containing `500`.
    - Test 4 — "no-op + warn when vault row absent": stub vault admin returning `{ data: null, error: null }` on maybeSingle. Call helper, assert fetch was NEVER called, assert warn was emitted exactly once on first call (second call within same isolate does NOT re-warn — verify via call-count).
    - Test 5 — "channel mapping": call with each of `pharma02`/`regulatory`/`rag`/`cost`/`research`, assert each posted body has the correct `#alerts-<channel>` channel string.
  </action>
  <verify>
    <automated>cd supabase/functions/_shared &amp;&amp; $HOME/.deno/bin/deno test --no-check ./slack-guardrail-alert.test.ts</automated>
  </verify>
  <done>
    `slack-guardrail-alert.ts` exports `sendSlackGuardrailAlert` + types + test seams. Vault lookup keyed on `slack_guardrail_webhook` row. 5 Slack channels mapped exactly per AI-SPEC §7. All 5 Deno.test blocks pass with mocked fetch + mocked vault admin. No top-level `Deno.serve(...)` (file is pure-helper).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: rag-retrieve typed server-to-server HTTP client</name>
  <files>
    supabase/functions/_shared/rag-retrieve.ts,
    supabase/functions/_shared/rag-retrieve.test.ts
  </files>
  <read_first>
    - 60-AI-SPEC §3 lines 222-342 (`rag-synthesize` Edge Fn entry pattern — RagRetrieveResult envelope shape sourced here)
    - 60-AI-SPEC §4 lines 460-498 (citation contract — `RagRetrievedChunk` summary/source_text_excerpt/topic_tag fields)
    - 60-PLAN-OUTLINE.md row 60-06 (the `rag-retrieve` Edge Fn being called is deployed in 60-06; this helper is the client surface against its eventual JSON response)
    - supabase/functions/_shared/posthog-server.ts (showing the `import 'jsr:@std/dotenv/load'` Deno-runtime pattern is NOT used in pure helpers — helpers stay pure-ESM-on-Deno)
  </read_first>
  <behavior>
    - Exports `RagRetrieveRequest`, `RagRetrievedChunk`, `RagRetrieveResult` types pinned exactly to the AI-SPEC §3/§4 envelope (see `<interfaces>` block above).
    - `retrieveRagChunks(req: RagRetrieveRequest): Promise<RagRetrieveResult>` — POSTs to `${SUPABASE_URL}/functions/v1/rag-retrieve` with body `{ query, k, filters }` and `Authorization` header (Bearer user-JWT when `req.userJwt` provided, else Bearer service-role-key).
    - Request schema: `RagRetrieveRequest = { query: string; k?: number; userJwt?: string; filters?: { topic_tag?: string; source_type?: RagRetrievedChunk['source_type']; surface?: 'coach' | 'tip_of_day' | 'newsletter' | 'public_knowledge_hub'; } }`. `k` defaults to 8 (per §3 line 284 default + §3 line 547 budget table).
    - Response Zod-parsed via `RagRetrieveResultSchema` (defined in same file). Schema-violation → throw `RagRetrieveSchemaError`.
    - 8s timeout via `AbortSignal.timeout(8000)`.
    - Retry on 5xx with exponential backoff (250ms → 500ms; max 2 attempts total — i.e., 1 retry); do NOT retry on 4xx (the Edge Fn refused — surface as-is).
    - Network/timeout error after retries → throw `RagRetrieveNetworkError` with cause attached.
    - Surface refusal: when `result.refused === true` → return the parsed result as-is (caller decides whether to render the refusal UI or fallback); do NOT throw — refusal is a valid response per AI-SPEC §6 G3/G4.
    - No PostHog emission inside this helper (callers are responsible for emitting `$ai_generation` themselves with their own `trace_id`; emitting twice would double-count cost). Documented in JSDoc.
    - Test file: (1) stub fetch returns valid envelope → typed result returned, (2) stub fetch returns refusal envelope → result.refused === true, no throw, (3) stub fetch returns 5xx then 200 → retry happens once, success, (4) stub fetch returns 5xx twice → throws `RagRetrieveNetworkError`, (5) stub fetch returns 4xx → throws immediately (no retry), (6) stub fetch returns malformed body → throws `RagRetrieveSchemaError`, (7) when `userJwt` provided → `Authorization: Bearer <jwt>`; when omitted → `Authorization: Bearer <service-role-key>`, (8) `k` defaults to 8 when omitted.
  </behavior>
  <action>
    Implement `_shared/rag-retrieve.ts`:

    1. Imports: `import { z } from 'npm:zod@^3';` only — do NOT import supabase-js (this is a bare fetch wrapper; Bearer-token in header is sufficient and avoids spinning up an unused admin client per call).
    2. Define zod schemas — `RagRetrievedChunkSchema` (mirror the typed interface in `<interfaces>` block, all fields required except `rerank_score` nullable), `RagRetrieveResultSchema` (`refused: boolean; refusal_reason: z.enum([...]).nullable(); chunks: z.array(RagRetrievedChunkSchema); trace_id: string; reranker_provider: z.enum(['cohere','jina','none']); embed_cost_usd: number; rerank_cost_usd: number;`). Apply `.refine((r) => r.refused === (r.refusal_reason !== null), { message: 'refused ⇔ refusal_reason populated' })` mirroring AI-SPEC §4 line 471.
    3. Inferred TS types via `z.infer<typeof ...>`.
    4. Custom error classes: `RagRetrieveNetworkError extends Error` (carries `cause: unknown` + `attempts: number`), `RagRetrieveSchemaError extends Error` (carries `issues: z.ZodIssue[]` + `rawBody: string`).
    5. `retrieveRagChunks(req)`:
       - `const url = Deno.env.get('SUPABASE_URL'); if (!url) throw new RagRetrieveNetworkError('SUPABASE_URL missing', { cause: null, attempts: 0 });` (same env-required contract as `posthog-server.ts` getMirrorAdmin).
       - `const token = req.userJwt ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'); if (!token) throw ...`.
       - Build `body = { query: req.query, k: req.k ?? 8, filters: req.filters ?? {} }`.
       - Loop with backoff: attempt = 1; while attempt <= 2 (max 2 attempts = 1 retry):
         - `const res = await fetch(\`\${url}/functions/v1/rag-retrieve\`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${token}\` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });`
         - If `res.ok` → parse JSON → `RagRetrieveResultSchema.safeParse(...)`. On schema fail → throw `RagRetrieveSchemaError(...)`. On schema pass → return.
         - If `res.status >= 400 && res.status < 500` → throw `RagRetrieveNetworkError('non-retryable client error', { cause: { status: res.status, body: await res.text() }, attempts })` (NO retry on 4xx).
         - If `res.status >= 500` AND `attempt < 2` → sleep `250 * attempt ** 2` ms (backoff: 250ms → 1000ms) → `attempt++` → continue loop.
         - If `res.status >= 500` AND `attempt === 2` → throw `RagRetrieveNetworkError('upstream 5xx after retries', { cause: ..., attempts })`.
       - Wrap entire loop in try/catch to convert `DOMException` (AbortError) → `RagRetrieveNetworkError('timeout', { cause, attempts })`.
    6. JSDoc note (3-line block): "Helper does NOT emit `$ai_generation` to PostHog — callers MUST do that with their own trace_id to avoid double-counting cost telemetry per AI-SPEC §7."
    7. NO `Deno.serve(...)` at top level (per `[[reference_deno_test_top_level_serve_trap]]`; this is a pure-helper module).

    Companion `_shared/rag-retrieve.test.ts`:
    - Mirror header + Deno.test style of `posthog-server.test.ts`.
    - Test 1 — "happy path returns typed result": set env, stub `globalThis.fetch` to return `new Response(JSON.stringify({ refused: false, refusal_reason: null, chunks: [{ chunk_id: '...uuid...', source_id: '...uuid...', source_type: 'fda_label', tier: 'A', topic_tag: 'tirzepatide.titration', source_text_excerpt: 'lorem', summary: 'ipsum', similarity: 0.82, rerank_score: 0.91, evidence_date: '2025-01-15', freshness_reweight_applied: false, public_visibility: true }], trace_id: 't1', reranker_provider: 'cohere', embed_cost_usd: 0.00002, rerank_cost_usd: 0.002 }), { status: 200 })`. Call `retrieveRagChunks({ query: 'q', userJwt: 'jwt' })`, assert `result.chunks.length === 1`, `result.refused === false`.
    - Test 2 — "refusal passes through, no throw": stub returns `{ refused: true, refusal_reason: 'out_of_corpus', chunks: [], trace_id: 't2', reranker_provider: 'none', embed_cost_usd: 0.00002, rerank_cost_usd: 0 }`. Assert `result.refused === true && result.refusal_reason === 'out_of_corpus'`, no throw.
    - Test 3 — "retry on 5xx then success": stub fetch with a counter — call 1 returns 500, call 2 returns 200 valid envelope. Assert: fetch called twice, helper returns valid result.
    - Test 4 — "throws RagRetrieveNetworkError after 2× 5xx": stub fetch to always return 500. Assert: thrown error is `instanceof RagRetrieveNetworkError`, fetch called exactly 2 times.
    - Test 5 — "4xx throws immediately, no retry": stub fetch returns 400. Assert: thrown error `RagRetrieveNetworkError`, fetch called exactly 1 time.
    - Test 6 — "malformed body throws RagRetrieveSchemaError": stub returns 200 with `{ refused: false, refusal_reason: null, chunks: 'NOT_AN_ARRAY' }`. Assert: thrown error `instanceof RagRetrieveSchemaError`.
    - Test 7 — "auth header switches on userJwt": call once with `userJwt: 'user-jwt-abc'`, capture the Bearer in request init → assert `'Bearer user-jwt-abc'`. Then call without `userJwt` (env `SUPABASE_SERVICE_ROLE_KEY=svc-key-xyz`) → assert `'Bearer svc-key-xyz'`.
    - Test 8 — "k defaults to 8": call without `k`, capture posted body → assert `JSON.parse(body).k === 8`.
  </action>
  <verify>
    <automated>cd supabase/functions/_shared &amp;&amp; $HOME/.deno/bin/deno test --no-check ./rag-retrieve.test.ts</automated>
  </verify>
  <done>
    `rag-retrieve.ts` exports `retrieveRagChunks` + `RagRetrieveRequest` / `RagRetrievedChunk` / `RagRetrieveResult` + 2 error classes. Zod schema mirrors AI-SPEC §3 + §4 envelope exactly. 8 Deno.test blocks all pass under `deno test --no-check`. Retry/backoff/timeout behavior verified via stubbed fetch.
  </done>
</task>

<task type="auto">
  <name>Task 5: Static invariant grep gates + cross-helper sweep</name>
  <files>
    supabase/functions/_shared/rag-retrieve.ts,
    supabase/functions/_shared/posthog-rag-events.ts,
    supabase/functions/_shared/slack-guardrail-alert.ts
  </files>
  <action>
    Run the static invariant gates that protect the contracts shipped here from regressing. This task adds NO new code — it's a post-implementation grep sweep run as the verification step. If any gate fails, fix the offending helper before declaring done.

    Per `[[feedback_batched_edits_verify_file_count]]` + `[[feedback_negation_grep_defeated_by_comment_string]]` — every grep filters `^#`/`^ *\*`/`^//` comment lines before counting, so commentary discussing rejected patterns does not self-invalidate gates.

    Gates to enforce:
    1. **No top-level Deno.serve in any new helper** (per `[[reference_deno_test_top_level_serve_trap]]`): `! grep -rn '^Deno.serve\|^\s*Deno\.serve' supabase/functions/_shared/{rag-retrieve,posthog-rag-events,slack-guardrail-alert}.ts` returns no matches.
    2. **No plaintext Slack webhook URL** in any helper: `! grep -v '^[[:space:]]*\(\*\|//\|#\)' supabase/functions/_shared/{rag-retrieve,posthog-rag-events,slack-guardrail-alert}.ts | grep -E 'hooks\.slack\.com'` returns no matches (test files allowed to contain stub URLs — gate excludes `.test.ts`).
    3. **Channel routing matches AI-SPEC §7 verbatim**: `grep -E "'#alerts-(pharma02|regulatory|rag|cost|research)'" supabase/functions/_shared/slack-guardrail-alert.ts | wc -l` returns exactly 5.
    4. **No duplicate PostHog client instantiation**: `! grep -E 'new PostHog\b' supabase/functions/_shared/posthog-rag-events.ts` returns no matches (reuse `posthog-server.ts`'s `getClient()` only).
    5. **Re-export of `shutdownPostHog`**: `grep -E "export \{[^}]*shutdownPostHog" supabase/functions/_shared/posthog-rag-events.ts` returns exactly 1 match.
    6. **rag-retrieve.ts targets correct path**: `grep -c '/functions/v1/rag-retrieve' supabase/functions/_shared/rag-retrieve.ts` returns ≥ 1.
    7. **Helpers have no top-level side-effects** (singleton-create + warn-once only on first call): `! grep -E '^(const|let)\s+\w+\s*=\s*(createClient|fetch)' supabase/functions/_shared/{rag-retrieve,posthog-rag-events,slack-guardrail-alert}.ts` returns no matches.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite &amp;&amp; \
      ! grep -rn -E '^\s*Deno\.serve' supabase/functions/_shared/rag-retrieve.ts supabase/functions/_shared/posthog-rag-events.ts supabase/functions/_shared/slack-guardrail-alert.ts &amp;&amp; \
      ! (grep -v '^[[:space:]]*\(\*\|//\|#\)' supabase/functions/_shared/rag-retrieve.ts supabase/functions/_shared/posthog-rag-events.ts supabase/functions/_shared/slack-guardrail-alert.ts | grep -E 'hooks\.slack\.com') &amp;&amp; \
      [ "$(grep -E \"'#alerts-(pharma02|regulatory|rag|cost|research)'\" supabase/functions/_shared/slack-guardrail-alert.ts | wc -l | tr -d ' ')" = "5" ] &amp;&amp; \
      ! grep -E 'new PostHog\b' supabase/functions/_shared/posthog-rag-events.ts &amp;&amp; \
      grep -qE "export \{[^}]*shutdownPostHog" supabase/functions/_shared/posthog-rag-events.ts &amp;&amp; \
      grep -qE '/functions/v1/rag-retrieve' supabase/functions/_shared/rag-retrieve.ts</automated>
  </verify>
  <done>
    All 7 static invariant gates pass. No top-level `Deno.serve`, no plaintext Slack webhook in source (only in test stubs), 5 channels mapped exactly, single PostHog client instance reused, `shutdownPostHog` re-exported, rag-retrieve.ts targets correct path, no top-level fetch/createClient side-effects.
  </done>
</task>

<task type="auto">
  <name>Task 6: Full helper test sweep + tsc lint pass</name>
  <files>
    supabase/functions/_shared/rag-retrieve.ts,
    supabase/functions/_shared/posthog-rag-events.ts,
    supabase/functions/_shared/slack-guardrail-alert.ts
  </files>
  <action>
    Run the full Deno test sweep for all 3 new helpers + existing `posthog-server.test.ts` to confirm no cross-helper regression (per `[[feedback_post_merge_deno_sweep_pattern]]`). Run with `--no-check` because v1.4 codebase has the project-wide top-level-Deno.serve trap on OTHER Fns — `--no-check` is the documented workaround.

    Also run a targeted vitest pass to confirm no Vite-side test got accidentally affected (this plan touches ZERO `leanshot/src/**` files — vitest should be fully passing on its existing baseline; this catches accidental import drift).

    Per `[[reference_vitest_4_projects_config_masks_default]]`: use `npx vitest run --config vite.config.ts` from `leanshot/` (NOT `npm test`).
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite &amp;&amp; $HOME/.deno/bin/deno test --no-check supabase/functions/_shared/posthog-server.test.ts supabase/functions/_shared/posthog-rag-events.test.ts supabase/functions/_shared/slack-guardrail-alert.test.ts supabase/functions/_shared/rag-retrieve.test.ts &amp;&amp; cd leanshot &amp;&amp; npx tsc -p tsconfig.app.json --noEmit</automated>
  </verify>
  <done>
    All 4 Deno test files pass under one cross-helper sweep; tsc emits zero new errors over the Phase 60 Wave-0 baseline (verifying no accidental drift into the Vite/browser bundle). Cross-helper sweep gates the END of Wave 0 per the post-merge sweep memory.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Edge Fn → `rag-retrieve` Edge Fn (via fetch) | server-to-server HTTPS within Supabase project; both ends inside trust zone, but body+headers cross the network — must use signed JWT and HTTPS only |
| Edge Fn → `vault.decrypted_secrets` | service-role admin client reads vault row; vault content is the trust root for outbound Slack webhook URL — leakage = full webhook compromise |
| Edge Fn → Slack webhook URL (via fetch) | outbound HTTPS to `hooks.slack.com`; payload may contain `trace_id` (low-sensitivity) but MUST NOT contain PHI |
| Edge Fn → PostHog (via posthog-node + events_mirror) | inherited from existing `_shared/posthog-server.ts` — already threat-modeled in Phase 24 D-11/D-13 (PHI scrub at capture time); this plan re-asserts the contract for Phase 60 events |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-60-02-01 | Spoofing | `rag-retrieve.ts` Bearer header | mitigate | When `userJwt` provided → forward user JWT (downstream Fn validates auth.uid()); when omitted → use service-role-key from `SUPABASE_SERVICE_ROLE_KEY` env (server-to-server only — cron contexts). Helper throws when both absent so anonymous calls are impossible. |
| T-60-02-02 | Tampering | `rag-retrieve.ts` response envelope | mitigate | Zod schema parse on every response; schema-violation → throw `RagRetrieveSchemaError` (fail-closed). `.refine()` enforces refused ⇔ refusal_reason populated per AI-SPEC §4 line 471. Schema mirrors AI-SPEC §3 exactly — caller cannot be tricked by malformed upstream body. |
| T-60-02-03 | Tampering | `slack-guardrail-alert.ts` webhook URL | mitigate | URL fetched from `vault.decrypted_secrets` at call-time, NEVER hardcoded. Cached per-isolate after first fetch (denial-of-vault during isolate lifetime not a concern). Static grep gate in Task 5 enforces no plaintext `hooks.slack.com` URL in source. |
| T-60-02-04 | Information Disclosure | `posthog-rag-events.ts` payloads | mitigate | Defense-in-depth PHI scrub in addition to `posthog-server.ts`'s existing scrub: strip `user_id`, `patient_id`, `email`, `phone` from `properties` before forward. Test 3 in Task 2 asserts the scrub. Phase 24 D-12 already covers the PostHog-side scrub; this layer covers Phase 60 callers that may pass federated-adapter or newsletter-subscriber rows inadvertently. |
| T-60-02-05 | Information Disclosure | `slack-guardrail-alert.ts` alert body | mitigate | Payload type pins `severity`/`title`/`text`/`fields`/`trace_id` — no free-form `payload.properties` passthrough that could leak full event body. Documented in JSDoc + enforced by TypeScript type narrow. |
| T-60-02-06 | Denial of Service | `rag-retrieve.ts` retry storm | mitigate | Retry cap of 2 attempts (1 retry) with exponential backoff (250ms → 1000ms). 8s `AbortSignal.timeout`. No retry on 4xx. Caller pays the full ~16s worst-case latency, NOT 30s+ retry-loop. Helper does NOT auto-circuit-break — Phase 60-15 cron schedules surface their own circuit-breaker via `rag_budget_caps`. |
| T-60-02-07 | Denial of Service | `slack-guardrail-alert.ts` fetch hangs | mitigate | 5s `AbortSignal.timeout` on outbound webhook POST. Helper NEVER throws back to caller (try/catch swallows + console.warn). Slack outage cannot block guardrail-tripping consumer Fns. |
| T-60-02-08 | Repudiation | Cost-envelope-breach attribution | mitigate | `emitCostEnvelopeBreach` payload schema requires `trace_id` (non-optional). Every breach event is correlatable back to the originating `coach_query` / `tip_of_day_cron_run` / `newsletter_cron_run` per AI-SPEC §7 line 936. PostHog `distinct_id` is `userId` (when user-attributed) or `rag-system` (when cron-emitted) — both auditable. |
| T-60-02-09 | Elevation of Privilege | Service-role-key bleed via `rag-retrieve.ts` | mitigate | When `userJwt` provided, helper uses ONLY that JWT — never forwards service-role-key alongside. Static control: helper does not log the Authorization header; failure traces show only the status code + first 200 chars of response body. |
| T-60-02-10 | Spoofing | `posthog-rag-events.ts` distinct_id swap | mitigate | User-attributed events (`$ai_generation`, `$ai_evaluation`, `rag_refusal_emitted`) throw when `userId` empty/missing per D-13 invariant. System-attributed events default `distinctId: 'rag-system'` via `captureRagEvent` — same canonical system actor id used in Phase 50-04. Test 2 in Task 2 enforces. |
| T-60-02-SC | Tampering | npm `posthog-node@5.10.4`, `@supabase/supabase-js@2`, `zod@^3` | accept | All three packages already in production via existing `_shared/posthog-server.ts` + `_shared/sentry.ts` patterns. Phase 24 + Phase 27 already vetted posthog-node 5.x; supabase-js 2.x is shipped in 100+ Edge Fns across phases 4-59; zod is industry-standard schema validator. RESEARCH `## Package Legitimacy Audit` (60-RESEARCH.md if present) treats these as `[VERIFIED]` via prior-phase usage — re-audit not required for this plan since no NEW packages are introduced. |
</threat_model>

<verification>
**Plan-level checks** (orchestrator runs after all 6 tasks complete):

1. `cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno test --no-check supabase/functions/_shared/posthog-server.test.ts supabase/functions/_shared/posthog-rag-events.test.ts supabase/functions/_shared/slack-guardrail-alert.test.ts supabase/functions/_shared/rag-retrieve.test.ts` → all pass.
2. `cd /Users/karstenhaldan/minisite/leanshot && npx tsc -p tsconfig.app.json --noEmit` → zero new errors over Phase 60 Wave-0 baseline (the helpers are Deno-runtime and do NOT enter the Vite bundle; tsc on `tsconfig.app.json` only verifies no accidental browser-side drift).
3. Static-invariant grep gates from Task 5 — all 7 gates pass.
4. `git diff --stat HEAD` → 7 files (3 helpers + 3 tests + 1 deno.json), zero files outside `supabase/functions/_shared/`.
5. `grep -l 'slack_guardrail_webhook' supabase/functions/_shared/slack-guardrail-alert.ts` → 1 match (vault key name pinned).

**Source audit gate**: Every line item in the 60-02 row of 60-PLAN-OUTLINE.md is realized in `files_modified` — `rag-retrieve.ts`, `posthog-rag-events.ts`, `slack-guardrail-alert.ts`, per-Fn `deno.json` import map, Deno.serve guards (N/A — helpers are pure, not Fns). All 8 PostHog events from AI-SPEC §7 emitted via typed wrappers. RAG-04 + RAG-05 frontmatter mapping confirmed.
</verification>

<success_criteria>
- 4 typed Deno helper modules + 3 Deno test files committed under `supabase/functions/_shared/`.
- `_shared/deno.json` import map ships with versions exact-match to `_shared/posthog-server.ts` line 33 dependency pins.
- All 8 Phase 60 typed PostHog events emit via canonical helpers (no consumer Fn in 60-04..60-12 has to hand-roll `captureServer({ event: 'rag_…' })` — they import the typed emitter).
- All Slack guardrail alerts route via the vault-fetched webhook (no plaintext URL in any source file under `supabase/functions/**`).
- All consumer Edge Fns in Wave 1+ can `import { retrieveRagChunks, emitAiGeneration, sendSlackGuardrailAlert, shutdownPostHog } from '../_shared/...'` and ship without any net-new boilerplate around HTTP / PostHog / Slack.
- Cross-helper Deno test sweep passes under `--no-check` (mirrors `[[feedback_post_merge_deno_sweep_pattern]]` at-plan-scope).
- Static invariants from Task 5 all green.
</success_criteria>

<output>
Create `.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-02-SUMMARY.md` when done.

SUMMARY must include:
- Exact paths of helpers + tests created
- Event-name → emitter-function mapping table (the 8 typed emitters)
- Channel → Slack-routing table (the 5 channels) — pinned to AI-SPEC §7
- Versions of `posthog-node` / `@supabase/supabase-js` / `zod` from `_shared/deno.json` (so downstream plan executors can confirm version-pin parity)
- Confirmation: no top-level `Deno.serve(...)` in any helper file (per `[[reference_deno_test_top_level_serve_trap]]`)
- Confirmation: no plaintext `hooks.slack.com` URL in any source file (test stubs excluded)
- Deferred-to-consumer-plan items: shutdownPostHog wrapping in try/finally inside each Wave-1+ consumer Fn (this plan does NOT enforce it — it's a per-Fn requirement documented in JSDoc of `posthog-rag-events.ts`).
</output>
