---
phase: 60-rag-knowledge-base-completion-waves-2-4
plan: 07
type: execute
wave: 1
depends_on: [60-01, 60-02]
files_modified:
  - supabase/functions/rag-federated-pubmed/index.ts
  - supabase/functions/rag-federated-pubmed/client.ts
  - supabase/functions/rag-federated-pubmed/normalize.ts
  - supabase/functions/rag-federated-pubmed/deno.json
  - supabase/functions/rag-federated-pubmed/__tests__/client.test.ts
  - supabase/functions/rag-federated-pubmed/__tests__/normalize.test.ts
  - supabase/functions/rag-federated-fda/index.ts
  - supabase/functions/rag-federated-fda/client.ts
  - supabase/functions/rag-federated-fda/normalize.ts
  - supabase/functions/rag-federated-fda/deno.json
  - supabase/functions/rag-federated-fda/__tests__/client.test.ts
  - supabase/functions/rag-federated-fda/__tests__/normalize.test.ts
  - supabase/functions/rag-federated-dailymed/index.ts
  - supabase/functions/rag-federated-dailymed/client.ts
  - supabase/functions/rag-federated-dailymed/normalize.ts
  - supabase/functions/rag-federated-dailymed/deno.json
  - supabase/functions/rag-federated-dailymed/__tests__/client.test.ts
  - supabase/functions/rag-federated-dailymed/__tests__/normalize.test.ts
  - supabase/functions/_shared/federated-host-allowlist.ts
  - supabase/functions/_shared/federated-cache.ts
  - supabase/functions/_shared/__tests__/federated-host-allowlist.test.ts
  - supabase/functions/_shared/__tests__/federated-cache.test.ts
autonomous: true
requirements: [RAG-06]
user_setup:
  - service: pubmed-eutils
    why: "Optional API key relaxes rate limit from 3 req/s to 10 req/s"
    env_vars:
      - name: PUBMED_API_KEY
        source: "https://account.ncbi.nlm.nih.gov/ -> Account Settings -> API Key Management"
        required: false
    dashboard_config: []
  - service: openfda
    why: "Optional API key relaxes rate limit (240 req/min unauth -> 240k req/day with key)"
    env_vars:
      - name: OPENFDA_API_KEY
        source: "https://open.fda.gov/apis/authentication/ -> Request API Key"
        required: false
    dashboard_config: []

must_haves:
  truths:
    - "Admin enabling `pubmed` toggle (60-09) triggers `rag-federated-pubmed` Fn to fetch last-30-days PubMed E-utilities articles matching enabled topic_tags and write them to `kb_chunks_queue` with `tier='A'` and `status='queued'`"
    - "Admin enabling `openfda` toggle triggers `rag-federated-fda` Fn to fetch last-30-days drug-label and drug-event records and write them to `kb_chunks_queue` with `tier='A'` and `status='queued'`"
    - "Admin enabling `dailymed` toggle triggers `rag-federated-dailymed` Fn to fetch last-30-days SPL label updates and write them to `kb_chunks_queue` with `tier='A'` and `status='queued'`"
    - "Federated chunks land in the same `kb_chunks_queue` reviewed in 60-08 — NO auto-publish regardless of tier-A authority (per CONTEXT.md decision: ALL pass admin queue)"
    - "Each adapter refuses to fetch from any host NOT in `{api.ncbi.nlm.nih.gov, api.fda.gov, dailymed.nlm.nih.gov}` (SSRF guardrail; fail-closed)"
    - "Each adapter respects per-source rate limits via exponential backoff (PubMed 3/10 req/s, OpenFDA 240 req/min, DailyMed observed throttle)"
    - "Identical `(source, query_hash)` queries within 24h hit `federated_source_cache` (no upstream fetch) — cost guardrail per AI-SPEC §6 G7 federated cap $2/hour"
    - "Each REST response is zod-validated to a canonical shape BEFORE insertion (silent truncation under rate-limit is rejected per AI-SPEC §3 Pitfall #8)"
    - "Each adapter writes `federated_sources.last_sync_at = now()` on success and `last_error = <message>` on failure (admin UI surfaces this in 60-09)"
    - "PHARMA-02 carveout still applies — federated chunks DO NOT bypass the 3-layer invariant even though source is NLM/FDA authoritative (per `[[feedback_3_layer_must_never_invariant_pattern]]` + AI-SPEC §1b regulatory)"
  artifacts:
    - path: "supabase/functions/rag-federated-pubmed/index.ts"
      provides: "PubMed E-utilities adapter Edge Fn entry point"
      contains: "Deno.serve guarded by import.meta.main"
    - path: "supabase/functions/rag-federated-pubmed/client.ts"
      provides: "PubMed REST client (esearch + efetch) with rate-limit backoff and SSRF host allowlist"
      contains: "esearchByDateRange, efetchByPmids"
    - path: "supabase/functions/rag-federated-pubmed/normalize.ts"
      provides: "PubMed XML/JSON -> kb_chunks_queue row normalizer with zod validation"
      contains: "PubMedArticleSchema, normalizePubMedArticle"
    - path: "supabase/functions/rag-federated-pubmed/deno.json"
      provides: "Per-Fn import map (CLI v2.101.0+ ignores --import-map)"
    - path: "supabase/functions/rag-federated-fda/index.ts"
      provides: "OpenFDA adapter Edge Fn entry point"
      contains: "Deno.serve guarded by import.meta.main"
    - path: "supabase/functions/rag-federated-fda/client.ts"
      provides: "OpenFDA REST client (drug/label + drug/event) with rate-limit backoff and SSRF host allowlist"
    - path: "supabase/functions/rag-federated-fda/normalize.ts"
      provides: "OpenFDA -> kb_chunks_queue row normalizer with zod validation"
      contains: "OpenFDADrugLabelSchema, OpenFDADrugEventSchema, normalizeOpenFDA"
    - path: "supabase/functions/rag-federated-fda/deno.json"
      provides: "Per-Fn import map"
    - path: "supabase/functions/rag-federated-dailymed/index.ts"
      provides: "DailyMed adapter Edge Fn entry point"
      contains: "Deno.serve guarded by import.meta.main"
    - path: "supabase/functions/rag-federated-dailymed/client.ts"
      provides: "DailyMed REST client (SPL search + detail) with rate-limit backoff and SSRF host allowlist"
    - path: "supabase/functions/rag-federated-dailymed/normalize.ts"
      provides: "DailyMed SPL -> kb_chunks_queue row normalizer with zod validation"
      contains: "DailyMedSPLSchema, normalizeDailyMed"
    - path: "supabase/functions/rag-federated-dailymed/deno.json"
      provides: "Per-Fn import map"
    - path: "supabase/functions/_shared/federated-host-allowlist.ts"
      provides: "Shared SSRF host allowlist enforcer (https-only + explicit-host registry; fail-closed)"
      contains: "FEDERATED_ALLOWED_HOSTS, assertAllowedHost"
    - path: "supabase/functions/_shared/federated-cache.ts"
      provides: "24h cache reader/writer over federated_source_cache table keyed by (source, query_hash)"
      contains: "readCachedFetch, writeCachedFetch, hashQuery"
  key_links:
    - from: "supabase/functions/rag-federated-pubmed/index.ts"
      to: "supabase/functions/_shared/federated-host-allowlist.ts"
      via: "assertAllowedHost(url) called before every fetch"
      pattern: "assertAllowedHost"
    - from: "supabase/functions/rag-federated-fda/index.ts"
      to: "supabase/functions/_shared/federated-host-allowlist.ts"
      via: "assertAllowedHost(url) called before every fetch"
      pattern: "assertAllowedHost"
    - from: "supabase/functions/rag-federated-dailymed/index.ts"
      to: "supabase/functions/_shared/federated-host-allowlist.ts"
      via: "assertAllowedHost(url) called before every fetch"
      pattern: "assertAllowedHost"
    - from: "supabase/functions/rag-federated-{pubmed,fda,dailymed}/index.ts"
      to: "federated_source_cache table (from 60-01)"
      via: "readCachedFetch / writeCachedFetch in _shared/federated-cache.ts"
      pattern: "federated_source_cache"
    - from: "supabase/functions/rag-federated-{pubmed,fda,dailymed}/index.ts"
      to: "kb_chunks_queue table (Phase 50 Wave 1)"
      via: "supabase service-role client insert with tier='A', status='queued'"
      pattern: "kb_chunks_queue"
    - from: "supabase/functions/rag-federated-{pubmed,fda,dailymed}/index.ts"
      to: "federated_sources table (from 60-01)"
      via: "UPDATE last_sync_at / last_error on success / failure"
      pattern: "federated_sources"
    - from: "supabase/functions/rag-federated-{pubmed,fda,dailymed}/index.ts"
      to: "_shared/posthog-rag-events.ts (from 60-02)"
      via: "emit $ai_generation (cost) + rag_cost_envelope_breach (G7) events"
      pattern: "posthog-rag-events"
    - from: "supabase/functions/rag-federated-{pubmed,fda,dailymed}/index.ts"
      to: "_shared/slack-guardrail-alert.ts (from 60-02)"
      via: "Slack alert on G7 federated $2/hour cap breach + host-allowlist trip"
      pattern: "slack-guardrail-alert"
---

<objective>
Ship 3 NEW Edge Functions — `rag-federated-pubmed` (NLM E-utilities), `rag-federated-fda` (OpenFDA drug/label + drug/event), `rag-federated-dailymed` (DailyMed SPL REST) — that fetch last-30-days authoritative biomedical content on admin-toggle and write zod-validated, rate-limit-respected, cache-deduplicated, tier-A chunks into `kb_chunks_queue` for admin review (RAG-06).

Purpose: Externalize curation effort by ingesting trusted NLM/FDA sources daily (cron in 60-15) without ever auto-publishing — every federated chunk still passes the 2-person admin review queue (60-08) per CONTEXT.md decision. PHARMA-02 3-layer invariant still applies regardless of source authority.

Output: 3 deployed Edge Fns + 2 shared helpers (SSRF host allowlist + 24h cache) + zod schemas for each REST API. NO cron registration (deferred to 60-15 BLOCKING per `[[feedback_fn_deploy_before_cron_db_push]]`). Manual one-shot invocation via 60-09 admin UI "Pull historical" button validates end-to-end before cron lights up.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-AI-SPEC.md
@.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-CONTEXT.md
@.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-PLAN-OUTLINE.md

<!-- Plans 60-01 and 60-02 provide the data layer + shared helpers we depend on -->
@.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-01-data-layer-migrations-PLAN.md
@.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-02-shared-edge-helpers-PLAN.md

<!-- Reuse target: Phase 50 Wave 1 scrape adapter precedent for kb_chunks_queue insertion shape -->
@supabase/functions/kb-scrape-url/index.ts

<interfaces>
<!-- Tables provided by 60-01 (data layer migrations) -->

federated_sources (from 60-01):
```sql
CREATE TABLE federated_sources (
  name text PRIMARY KEY,           -- 'pubmed' | 'openfda' | 'dailymed'
  enabled boolean NOT NULL DEFAULT false,
  sync_cron text NOT NULL,         -- e.g. '0 3 * * *' (informational; cron lives in 60-15 not here)
  last_sync_at timestamptz,
  last_error text,
  initial_seed_completed boolean NOT NULL DEFAULT false,
  topic_tags text[] NOT NULL DEFAULT '{}',   -- per-source topic filters (e.g. ['GLP-1','tirzepatide','semaglutide'])
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

federated_source_cache (from 60-01):
```sql
CREATE TABLE federated_source_cache (
  source text NOT NULL,             -- 'pubmed' | 'openfda' | 'dailymed'
  query_hash text NOT NULL,         -- sha256(JSON.stringify({endpoint, params}))
  response_jsonb jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (source, query_hash)
);
CREATE INDEX idx_federated_source_cache_expires ON federated_source_cache(expires_at);
```

kb_chunks_queue (Phase 50 Wave 1 — existing):
```sql
-- Verified fields used by this plan's insert payload:
-- id uuid PRIMARY KEY DEFAULT gen_random_uuid()
-- source_url text NOT NULL           -- e.g. https://pubmed.ncbi.nlm.nih.gov/<pmid>/
-- source_type text NOT NULL          -- 'pubmed' | 'fda_label' | 'fda_event' | 'dailymed_spl'
-- title text NOT NULL
-- source_text_excerpt text NOT NULL  -- the chunk passage (NOT summary)
-- summary text                       -- optional ~100 token summary
-- topic_tag text NOT NULL            -- mapped from federated_sources.topic_tags
-- tier text NOT NULL                 -- 'A' (federated NLM/FDA always tier A)
-- status text NOT NULL DEFAULT 'queued'
-- created_by uuid NOT NULL           -- service-role: use a dedicated 'system_federated' uuid constant
-- evidence_date date                 -- PubMed pub_date / FDA effective_time / DailyMed updated
-- external_id text                   -- pmid | set_id | spl_id (for idempotent re-insert avoidance)
-- created_at timestamptz NOT NULL DEFAULT now()
```

Shared helpers from 60-02:
```typescript
// supabase/functions/_shared/posthog-rag-events.ts
export function emitAiGeneration(opts: {
  trace_id: string;
  model: string;
  usage_total_cost: number;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  surface: 'rag-federated-pubmed' | 'rag-federated-fda' | 'rag-federated-dailymed';
}): Promise<void>;

export function emitRagCostEnvelopeBreach(opts: {
  trace_id: string;
  surface: string;
  cap_kind: 'per-cron' | 'per-request';
  cap_usd: number;
  actual_usd: number;
}): Promise<void>;

// supabase/functions/_shared/slack-guardrail-alert.ts
export function slackAlert(opts: {
  channel: 'alerts-rag' | 'alerts-cost' | 'alerts-pharma02';
  severity: 'P1' | 'P2' | 'P3';
  title: string;
  body: string;
}): Promise<void>;
```

PostHog event names this plan emits (registered in 60-02):
- `$ai_generation` (per fetch — cost = 0 for REST adapters but track latency_ms + bytes_fetched as custom props)
- `rag_cost_envelope_breach` (G7 federated cap $2/hour)
- `federated_host_allowlist_blocked` (SSRF guardrail trip — block + Slack)
- `federated_zod_validation_failed` (silent rate-limit truncation interception)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Shared SSRF host allowlist + 24h cache helpers</name>
  <files>
    supabase/functions/_shared/federated-host-allowlist.ts,
    supabase/functions/_shared/federated-cache.ts,
    supabase/functions/_shared/__tests__/federated-host-allowlist.test.ts,
    supabase/functions/_shared/__tests__/federated-cache.test.ts
  </files>
  <behavior>
    federated-host-allowlist.ts:
    - Test 1: `assertAllowedHost('https://api.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi')` → returns void (no throw)
    - Test 2: `assertAllowedHost('https://api.fda.gov/drug/label.json')` → returns void
    - Test 3: `assertAllowedHost('https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json')` → returns void
    - Test 4: `assertAllowedHost('http://api.ncbi.nlm.nih.gov/...')` → throws `SSRFHostBlockedError` (http not allowed; https-only)
    - Test 5: `assertAllowedHost('https://evil.example.com/...')` → throws `SSRFHostBlockedError` + emits `federated_host_allowlist_blocked` PostHog event + Slack alert (mocked)
    - Test 6: `assertAllowedHost('https://api.ncbi.nlm.nih.gov.evil.com/...')` → throws (suffix-match defense; uses URL.hostname strict-equality not includes)
    - Test 7: `assertAllowedHost('https://127.0.0.1/...')` → throws (no IP literals)
    - Test 8: `assertAllowedHost('https://169.254.169.254/...')` → throws (metadata endpoint; explicit deny)
    - Exports `FEDERATED_ALLOWED_HOSTS = ['api.ncbi.nlm.nih.gov', 'api.fda.gov', 'dailymed.nlm.nih.gov'] as const`

    federated-cache.ts:
    - Test 1: `hashQuery({endpoint, params})` is deterministic — same input → same sha256 hex
    - Test 2: `readCachedFetch('pubmed', queryHash)` returns null when no row exists
    - Test 3: `readCachedFetch('pubmed', queryHash)` returns response_jsonb when row exists and `expires_at > now()`
    - Test 4: `readCachedFetch('pubmed', queryHash)` returns null when row exists but `expires_at <= now()` (treats expired as miss)
    - Test 5: `writeCachedFetch('pubmed', queryHash, {data: 'x'})` upserts via `INSERT ... ON CONFLICT (source, query_hash) DO UPDATE SET response_jsonb = EXCLUDED.response_jsonb, fetched_at = now(), expires_at = now() + interval '24 hours'`
    - Test 6: `writeCachedFetch` does NOT mutate response_jsonb after insert (deep-copy semantics verified)
  </behavior>
  <action>
    Create `supabase/functions/_shared/federated-host-allowlist.ts` exporting `FEDERATED_ALLOWED_HOSTS` const-array of exactly the 3 hosts named in AI-SPEC §6 and `assertAllowedHost(url: string): void`. Use `new URL(url).hostname` strict-equality lookup against the allowlist; reject if protocol !== 'https:'. On rejection, emit `federated_host_allowlist_blocked` PostHog event via the 60-02 helper and fire Slack P1 alert to `#alerts-pharma02` (host-allowlist trip = potential SSRF attack path) THEN throw `SSRFHostBlockedError`. Fail-closed: any URL.hostname parse error throws.

    Create `supabase/functions/_shared/federated-cache.ts` exporting `hashQuery(input: {endpoint: string; params: Record<string, unknown>}): string` (sha256 hex via `crypto.subtle.digest`), `readCachedFetch(source: 'pubmed'|'openfda'|'dailymed', queryHash: string): Promise<unknown | null>` (SELECT from federated_source_cache where expires_at > now()), and `writeCachedFetch(source, queryHash, response: unknown): Promise<void>` (INSERT ... ON CONFLICT (source, query_hash) DO UPDATE — per `[[reference_postgres_no_insert_on_conflict_do_delete]]`). Use the existing `_shared/supabase-client.ts` service-role client convention.

    Vitest tests live at `supabase/functions/_shared/__tests__/federated-host-allowlist.test.ts` + `federated-cache.test.ts`. Mock `posthog-rag-events` + `slack-guardrail-alert` modules. Mock supabase client for cache tests. Run with `npx vitest run --config vite.config.ts` per `[[reference_vitest_4_projects_config_masks_default]]`.

    Do NOT include `Deno.serve()` in either helper (these are pure modules, not Fn entry points).
  </action>
  <verify>
    <automated>cd leanshot && npx vitest run --config vite.config.ts supabase/functions/_shared/__tests__/federated-host-allowlist.test.ts supabase/functions/_shared/__tests__/federated-cache.test.ts</automated>
  </verify>
  <done>
    Both `__tests__/federated-host-allowlist.test.ts` (8 cases) and `__tests__/federated-cache.test.ts` (6 cases) pass. `npx tsc -p leanshot/tsconfig.app.json --noEmit` exits 0 with no new errors related to these files. `grep -E "(127\.0\.0\.1|169\.254|localhost|metadata)" supabase/functions/_shared/federated-host-allowlist.ts` matches the explicit deny test (rejected IPs documented in code).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: rag-federated-pubmed Fn (E-utilities client + normalizer + entry)</name>
  <files>
    supabase/functions/rag-federated-pubmed/client.ts,
    supabase/functions/rag-federated-pubmed/normalize.ts,
    supabase/functions/rag-federated-pubmed/index.ts,
    supabase/functions/rag-federated-pubmed/deno.json,
    supabase/functions/rag-federated-pubmed/__tests__/client.test.ts,
    supabase/functions/rag-federated-pubmed/__tests__/normalize.test.ts
  </files>
  <behavior>
    client.ts:
    - Test 1: `esearchByDateRange({topicTag: 'GLP-1', mindate: '2026/04/26', maxdate: '2026/05/26'})` calls `https://api.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=...&mindate=...&maxdate=...&retmode=json` (and `&api_key=<PUBMED_API_KEY>` when env var set)
    - Test 2: Same call goes through `assertAllowedHost` before fetch (mock host-allowlist throwing → call rejects without network)
    - Test 3: Rate-limit: when fetch returns 429 + `Retry-After: 1`, client retries after backoff (max 3 retries; exponential 1s/2s/4s); test uses fake timers
    - Test 4: When response body is HTML (rate-limit page disguise), client throws `RateLimitTruncationError` (response shape zod-validates as JSON, not HTML)
    - Test 5: `efetchByPmids(['12345','67890'])` batches into a single POST to `efetch.fcgi` with `id=12345,67890&db=pubmed&rettype=abstract&retmode=xml`
    - Test 6: Cache hit short-circuits — `readCachedFetch` returning data prevents network call

    normalize.ts:
    - Test 1: `PubMedArticleSchema` parses a fixture XML-converted-to-object (pmid + title + abstract + authors + journal + year + doi + mesh_terms) → ok
    - Test 2: Missing required `title` → zod throws `TypeValidationError` (silent rate-limit truncation rejected)
    - Test 3: `normalizePubMedArticle(article, topicTag)` returns a `kb_chunks_queue` insert payload with: `source_type='pubmed'`, `source_url='https://pubmed.ncbi.nlm.nih.gov/<pmid>/'`, `tier='A'`, `status='queued'`, `external_id=pmid`, `topic_tag` from arg, `evidence_date=year-12-31`, `source_text_excerpt = title + '\n\n' + abstract` (concat with double-newline)
    - Test 4: Article with `null` abstract → `source_text_excerpt = title` only (no trailing newlines)

    index.ts:
    - Test 1: POST `{topic_tags: ['GLP-1'], mode: 'incremental'}` → reads `federated_sources.last_sync_at` for 'pubmed' → fetches mindate = last_sync_at or `now() - 30d` if null → returns count of new chunks queued
    - Test 2: Same call when `federated_sources.enabled = false` → returns 403 `{error: 'source_disabled'}` (no fetch)
    - Test 3: POST `{topic_tags: ['GLP-1'], mode: 'historical-seed'}` → respects same 30-day clamp on initial seed per CONTEXT.md cost guardrail (NOT full historical without explicit `mode: 'full-historical'` + admin auth)
    - Test 4: Duplicate `external_id` (pmid already in `kb_chunks_queue` OR `kb_chunks` published) → skipped (no duplicate insert; counted as `skipped_duplicate`)
    - Test 5: On success → updates `federated_sources.last_sync_at = now()` + clears `last_error`
    - Test 6: On any error → updates `federated_sources.last_error = <message>` + emits Slack P2 alert to `#alerts-rag` if rate-limit-truncation OR P1 to `#alerts-pharma02` if SSRF-host-block
    - Test 7: `Deno.serve` is guarded by `if (import.meta.main) Deno.serve(handler)` per `[[reference_deno_test_top_level_serve_trap]]`
    - Test 8: Cost guardrail G7 — when aggregated fetch latency * rate * count would exceed $2 federated cap (REST is free but we track wall-clock to detect runaway), emits `rag_cost_envelope_breach` + halts further fetches in same run
  </behavior>
  <action>
    Create `supabase/functions/rag-federated-pubmed/client.ts` exporting `esearchByDateRange(opts: {topicTag: string; mindate: string; maxdate: string; retmax?: number}): Promise<{pmids: string[]}>` and `efetchByPmids(pmids: string[]): Promise<unknown[]>`. Each function: (1) build URL, (2) call `assertAllowedHost(url)` from `_shared/federated-host-allowlist.ts` (Task 1), (3) `hashQuery` + `readCachedFetch('pubmed', hash)` short-circuit, (4) `fetch(url)` with `User-Agent: leanshot-rag-federated/1.0 (<contact-email>)` header per E-utilities ToS, (5) handle 429 with `Retry-After` exponential backoff (max 3 retries), (6) zod-validate response shape, (7) `writeCachedFetch('pubmed', hash, response)`, (8) return parsed payload. Reads `PUBMED_API_KEY` env var; appends `&api_key=...` when present (relaxes rate limit 3→10 req/s).

    Create `supabase/functions/rag-federated-pubmed/normalize.ts` exporting `PubMedArticleSchema` (zod schema per AI-SPEC §4b code excerpt) and `normalizePubMedArticle(article: PubMedArticle, topicTag: string): KbChunksQueueInsert`. Map PubMed fields to the `kb_chunks_queue` insert shape declared in `<interfaces>` above. `evidence_date = ${year}-12-31` (PubMed pub_date precision is year only). `created_by = '00000000-0000-0000-0000-000000000060'` (reserved system_federated uuid; reserve via 60-01 seed if not already).

    Create `supabase/functions/rag-federated-pubmed/index.ts`:
    - Import `client.ts`, `normalize.ts`, `_shared/federated-host-allowlist.ts`, `_shared/federated-cache.ts`, `_shared/posthog-rag-events.ts`, `_shared/slack-guardrail-alert.ts`, `_shared/supabase-client.ts`
    - Handler: POST body `{topic_tags: string[]; mode: 'incremental' | 'historical-seed' | 'full-historical'}` (zod-validated)
    - Read `federated_sources` row for `name='pubmed'`; bail 403 if `enabled=false`
    - Compute mindate: `mode='historical-seed'` → `now() - 30d` (per CONTEXT.md "Initial seed: last-30-days only on enable"); `mode='incremental'` → `coalesce(last_sync_at, now() - 30d)`; `mode='full-historical'` → require `request.headers['x-admin-action-token']` header + verify via SECDEF RPC `is_admin_action_authorized(token)` (one-shot button from 60-09)
    - For each topic_tag: `esearchByDateRange` → `efetchByPmids` → for each article: zod-parse via `PubMedArticleSchema` → check `external_id` not already in `kb_chunks_queue` OR `kb_chunks` (skip if exists) → `normalizePubMedArticle` → INSERT INTO `kb_chunks_queue`
    - Track wall-clock + bytes_fetched; if elapsed > 1 hour OR running estimated cost > $2 (G7 federated cap), emit `rag_cost_envelope_breach` + halt loop
    - On any catch: `UPDATE federated_sources SET last_error = $1, updated_at = now() WHERE name='pubmed'`; emit Slack alert with severity per error type
    - On success: `UPDATE federated_sources SET last_sync_at = now(), last_error = null, initial_seed_completed = (mode='historical-seed' OR initial_seed_completed) WHERE name='pubmed'`
    - Return `{queued: <count>, skipped_duplicate: <count>, errors: <list>}`
    - Wrap `Deno.serve` in `if (import.meta.main) Deno.serve(handler)` per `[[reference_deno_test_top_level_serve_trap]]`

    Create `supabase/functions/rag-federated-pubmed/deno.json` with per-Fn import map covering `_shared/*` + `zod` + `@supabase/supabase-js` per `[[reference_supabase_functions_deploy_import_map_flag]]` (CLI v2.101.0+ ignores `--import-map` flag — must be per-fn).

    Vitest tests mock `fetch` (no real network) + supabase client + posthog + slack helpers. Cover all 8 index.ts test cases + 6 client.ts + 4 normalize.ts.

    DO NOT register a cron schedule in this plan (cron lives in 60-15 BLOCKING per `[[feedback_fn_deploy_before_cron_db_push]]`).
    DO NOT deploy the Fn yet (deploy + cron-push happen atomically in 60-15).
  </action>
  <verify>
    <automated>cd leanshot && npx vitest run --config vite.config.ts supabase/functions/rag-federated-pubmed/__tests__/</automated>
  </verify>
  <done>
    All 18 vitest cases pass (8 index + 6 client + 4 normalize). `grep -c "assertAllowedHost" supabase/functions/rag-federated-pubmed/client.ts` ≥ 2 (one per public fn). `grep -q "import.meta.main" supabase/functions/rag-federated-pubmed/index.ts` matches. `grep -q "cron" supabase/functions/rag-federated-pubmed/` returns nothing (no cron registration; 60-15 owns).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: rag-federated-fda Fn (OpenFDA drug/label + drug/event + normalizer + entry)</name>
  <files>
    supabase/functions/rag-federated-fda/client.ts,
    supabase/functions/rag-federated-fda/normalize.ts,
    supabase/functions/rag-federated-fda/index.ts,
    supabase/functions/rag-federated-fda/deno.json,
    supabase/functions/rag-federated-fda/__tests__/client.test.ts,
    supabase/functions/rag-federated-fda/__tests__/normalize.test.ts
  </files>
  <behavior>
    client.ts:
    - Test 1: `searchDrugLabels({topicTag: 'tirzepatide', effective_time_gte: '20260426', effective_time_lte: '20260526'})` calls `https://api.fda.gov/drug/label.json?search=openfda.generic_name:tirzepatide+AND+effective_time:[20260426+TO+20260526]&limit=100`
    - Test 2: `searchDrugEvents({topicTag: 'semaglutide', receivedate_gte: '20260426', receivedate_lte: '20260526'})` calls `https://api.fda.gov/drug/event.json?search=patient.drug.openfda.generic_name:semaglutide+AND+receivedate:[20260426+TO+20260526]&limit=100`
    - Test 3: Each call goes through `assertAllowedHost` (mock throw → no network)
    - Test 4: Rate limit 240 req/min — client tracks request timestamps in a sliding window and pauses when ≥ 240 in last 60s; test uses fake timers
    - Test 5: When 429 returned, exponential backoff (3 retries; 2s/4s/8s — OpenFDA recommends ≥2s base)
    - Test 6: When `results` array is empty (no matches), returns `{results: []}` (NOT an error)
    - Test 7: Cache hit short-circuits via `readCachedFetch('openfda', ...)`

    normalize.ts:
    - Test 1: `OpenFDADrugLabelSchema` parses a fixture (openfda.brand_name + openfda.generic_name + indications_and_usage + boxed_warning + warnings + dosage_and_administration + effective_time + set_id + version) → ok
    - Test 2: Missing `effective_time` → zod throws (drift detection requires this field per AI-SPEC §1b stale-label drift failure mode)
    - Test 3: `normalizeOpenFDADrugLabel(label, topicTag)` returns insert payload: `source_type='fda_label'`, `source_url='https://nctr-crs.fda.gov/fdalabel/services/spl/set-ids/<set_id>/spl-doc?hl=...'`, `tier='A'`, `external_id=<set_id>:<version>` (set_id alone is insufficient; multiple versions per set_id), `evidence_date=parseFdaEffectiveTime(effective_time)`, `source_text_excerpt = boxed_warning + '\n\n' + warnings + '\n\n' + indications_and_usage + '\n\n' + dosage_and_administration` (each section labeled with `## <name>\n` heading; missing sections omitted)
    - Test 4: `OpenFDADrugEventSchema` parses a fixture (patient.drug + patient.reaction + receivedate + safetyreportid)
    - Test 5: `normalizeOpenFDADrugEvent(event, topicTag)` returns insert payload with: `source_type='fda_event'`, `source_url='https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=<...>'`, `external_id=<safetyreportid>`, `source_text_excerpt` = aggregated reaction terms + relevant patient.drug fields. **PII guard**: NEVER include `patient.patientonsetage`, `patient.patientweight`, `patient.patientonsetagegroup`, or `patient.patientsex` in the excerpt (T-60-DOS-1 PII threat — AI-SPEC §1b regulatory does not classify these as PHI but adverse-event reports can contain identifying narrative; we strip fields to fail safe).

    index.ts:
    - Test 1: POST `{topic_tags: ['tirzepatide', 'semaglutide'], mode: 'incremental'}` → fetches BOTH drug/label + drug/event for each topic in last-30-days → queues all
    - Test 2: `enabled=false` → 403
    - Test 3: PII-leak regression — manually-crafted fixture event with `patientweight=85` in narrative → after normalize, excerpt does NOT contain the literal string `85` from that field (PII guard works in payload assembly)
    - Test 4: Duplicate `external_id` deduplication (same set_id + version OR same safetyreportid)
    - Test 5: `last_sync_at` / `last_error` flow same as PubMed Task 2
    - Test 6: `Deno.serve` guarded by `import.meta.main`
    - Test 7: G7 cost-cap halt (same as PubMed)
  </behavior>
  <action>
    Create `supabase/functions/rag-federated-fda/client.ts` exporting `searchDrugLabels(opts)` and `searchDrugEvents(opts)`. Same structure as PubMed client (Task 2): `assertAllowedHost` → cache short-circuit → fetch with `User-Agent` header → 429 backoff → zod-validate → cache write. Reads `OPENFDA_API_KEY` env var; appends `&api_key=...` when present (relaxes rate limit). Sliding-window rate-limit tracker in a module-level ring buffer (240-slot capped at 60s).

    Create `supabase/functions/rag-federated-fda/normalize.ts` exporting `OpenFDADrugLabelSchema`, `OpenFDADrugEventSchema`, `normalizeOpenFDADrugLabel`, `normalizeOpenFDADrugEvent`, and `parseFdaEffectiveTime(s: string): Date` (YYYYMMDD → Date). PII guard in `normalizeOpenFDADrugEvent` is explicit field-pluck: only `patient.drug[].medicinalproduct`, `patient.drug[].drugindication`, `patient.reaction[].reactionmeddrapt`, `receivedate`, `safetyreportid` make it into the excerpt — explicit allowlist, not denylist (per AI-SPEC §6 G2 PII fence pattern). Boxed-warning preservation per AI-SPEC §1b regulatory ("OpenFDA SPL Boxed Warnings sections...the federated adapter MUST preserve at chunk granularity").

    Create `supabase/functions/rag-federated-fda/index.ts` mirroring PubMed entry (Task 2) — same `mode` semantics, same dedup, same last_sync_at/last_error flow, same G7 cost cap, same `import.meta.main` guard. Iterates BOTH endpoints (drug/label, drug/event) per topic_tag.

    Create `supabase/functions/rag-federated-fda/deno.json` per-fn import map.

    Vitest covers all listed behaviors with mocked fetch + supabase + posthog + slack.

    DO NOT register cron. DO NOT deploy (60-15 owns).
  </action>
  <verify>
    <automated>cd leanshot && npx vitest run --config vite.config.ts supabase/functions/rag-federated-fda/__tests__/</automated>
  </verify>
  <done>
    All vitest cases pass (7 index + 7 client + 5 normalize = 19). PII-guard regression test verifies stripped fields. `grep -q "patientonsetage\|patientweight\|patientonsetagegroup\|patientsex" supabase/functions/rag-federated-fda/normalize.ts | grep -v '^//' | grep -v '^*'` returns ONLY denylist comments / no field reads in payload assembly (use `grep -v '^[[:space:]]*//' supabase/functions/rag-federated-fda/normalize.ts | grep -c 'patientweight'` = 0 — defeats `[[feedback_negation_grep_defeated_by_comment_string]]` by stripping comments first).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: rag-federated-dailymed Fn (SPL REST client + normalizer + entry)</name>
  <files>
    supabase/functions/rag-federated-dailymed/client.ts,
    supabase/functions/rag-federated-dailymed/normalize.ts,
    supabase/functions/rag-federated-dailymed/index.ts,
    supabase/functions/rag-federated-dailymed/deno.json,
    supabase/functions/rag-federated-dailymed/__tests__/client.test.ts,
    supabase/functions/rag-federated-dailymed/__tests__/normalize.test.ts
  </files>
  <behavior>
    client.ts:
    - Test 1: `searchSPLs({topicTag: 'tirzepatide', published_date_gte: '2026-04-26', published_date_lte: '2026-05-26'})` calls `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?drug_name=tirzepatide&published_date_gte=...&published_date_lte=...&pagesize=100`
    - Test 2: `getSPLDetail(setId)` calls `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/<setId>.json`
    - Test 3: Each call goes through `assertAllowedHost`
    - Test 4: Conservative rate limit — DailyMed has no documented limit but observed IP throttle (community); cap client at 5 req/s via token bucket
    - Test 5: 429 OR 503 → exponential backoff (3 retries; 4s/8s/16s — slower because DailyMed throttle is opaque)
    - Test 6: Cache short-circuit via `readCachedFetch('dailymed', ...)`

    normalize.ts:
    - Test 1: `DailyMedSPLSchema` parses a fixture (setid + spl_version + title + published_date + sections array)
    - Test 2: Missing `setid` OR `spl_version` → zod throws
    - Test 3: `normalizeDailyMed(spl, topicTag)` returns insert payload: `source_type='dailymed_spl'`, `source_url='https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=<setid>'`, `tier='A'`, `external_id=<setid>:<spl_version>`, `evidence_date=published_date`, `source_text_excerpt` = concat of section.text for sections where `section.code` matches the boxed-warning / warnings / indications / dosage LOINC codes (preserve per AI-SPEC §1b regulatory)
    - Test 4: SPL with `spl_version=2` vs `spl_version=1` for same setid → different `external_id` → both queueable (drift detection: G10 stale-evidence depends on this)

    index.ts:
    - Test 1: POST `{topic_tags: ['tirzepatide'], mode: 'incremental'}` → searchSPLs → for each setid: getSPLDetail → normalize → INSERT
    - Test 2: `enabled=false` → 403
    - Test 3: Dedup on `external_id` (setid:version)
    - Test 4: `last_sync_at` / `last_error` flow
    - Test 5: `Deno.serve` guarded by `import.meta.main`
    - Test 6: G7 cost-cap halt
  </behavior>
  <action>
    Create `supabase/functions/rag-federated-dailymed/client.ts` mirroring PubMed/FDA client patterns. Token-bucket rate limiter at 5 req/s. No API-key env var (DailyMed is unauthenticated public REST).

    Create `supabase/functions/rag-federated-dailymed/normalize.ts` with section-code filter using LOINC codes (planner research note: 34066-1 boxed warning, 34071-1 warnings, 34067-9 indications, 34068-7 dosage — verify against fixture during execute; if codes differ in v2 API response, fall back to section.title fuzzy-match on 'BOXED WARNING' | 'WARNINGS' | 'INDICATIONS' | 'DOSAGE AND ADMINISTRATION' uppercase). Document the filter strategy in code comment so admin curation queue (60-08) reviewer understands what's chunked vs dropped.

    Create `supabase/functions/rag-federated-dailymed/index.ts` mirroring PubMed/FDA entry. Same `mode` semantics, dedup, last_sync_at/last_error, G7 cost cap, `import.meta.main` guard.

    Create `supabase/functions/rag-federated-dailymed/deno.json`.

    Vitest covers all listed behaviors.

    DO NOT register cron. DO NOT deploy (60-15 owns).
  </action>
  <verify>
    <automated>cd leanshot && npx vitest run --config vite.config.ts supabase/functions/rag-federated-dailymed/__tests__/</automated>
  </verify>
  <done>
    All vitest cases pass (6 index + 6 client + 4 normalize = 16). `grep -q "import.meta.main" supabase/functions/rag-federated-dailymed/index.ts` matches. `grep -q "cron" supabase/functions/rag-federated-dailymed/` returns nothing.
  </done>
</task>

<task type="auto">
  <name>Task 5: Cross-Fn integration test + post-plan sweeps</name>
  <files>
    supabase/functions/_shared/__tests__/federated-integration.test.ts
  </files>
  <action>
    Create one cross-Fn integration test that exercises the shared contracts end-to-end (mock-only — no live network, no live DB):
    - Mock the supabase client to back `federated_sources` + `federated_source_cache` + `kb_chunks_queue` in-memory
    - Mock `fetch` to return fixture responses for PubMed esearch/efetch, OpenFDA drug/label, DailyMed spls.json + spls/<id>.json
    - Import each Fn's handler directly (not via Deno.serve)
    - Test: enable all 3 sources via direct table writes → POST each Fn with `mode: 'historical-seed'` → assert (a) `federated_source_cache` has 3 rows (one per source's first response), (b) `kb_chunks_queue` has rows from all 3 sources tagged `tier='A'` `status='queued'`, (c) `federated_sources.last_sync_at` updated for all 3, (d) every queued row's `external_id` is unique
    - Test: re-run same calls → `kb_chunks_queue` row count UNCHANGED (dedup via external_id works across runs)
    - Test: flip one `federated_sources.enabled=false` mid-test → that Fn returns 403 and does NOT update `last_sync_at`
    - Test: inject a fixture where PubMed response is HTML rate-limit page (not JSON) → Fn catches `TypeValidationError` → writes `last_error` → emits Slack P2 to `#alerts-rag`
    - Test: inject a fixture where one of the 3 Fns is asked to fetch `https://evil.example.com/x` (manually constructed via mocked client param injection) → `assertAllowedHost` blocks + emits `federated_host_allowlist_blocked` PostHog event + Slack P1 to `#alerts-pharma02`

    Run final post-plan sweeps:
    - `cd leanshot && npx tsc -p tsconfig.app.json --noEmit` → must exit 0 with zero new errors
    - `cd leanshot && npx vitest run --config vite.config.ts supabase/functions/` → all federated Fn suites pass
    - `cd leanshot && grep -rln "cron" supabase/functions/rag-federated-pubmed supabase/functions/rag-federated-fda supabase/functions/rag-federated-dailymed` → must return EMPTY (no cron registration — 60-15 owns; per `[[feedback_fn_deploy_before_cron_db_push]]`)
    - `cd leanshot && grep -rln "Deno.serve" supabase/functions/rag-federated-pubmed supabase/functions/rag-federated-fda supabase/functions/rag-federated-dailymed | xargs -I {} sh -c "grep -L 'import.meta.main' {} && echo MISSING: {}"` → must report no MISSING (every Deno.serve is guarded)
    - PHARMA-02 carveout regression: `cd leanshot && grep -rE "auto.publish|skip.review|bypass.queue|tier.A.*publish" supabase/functions/rag-federated-pubmed supabase/functions/rag-federated-fda supabase/functions/rag-federated-dailymed | grep -v '__tests__' | grep -v '//'` → must return EMPTY (no auto-publish for federated tier-A; per CONTEXT.md decision + AI-SPEC §6 G1)
    - Locale gate: `cd leanshot && npx vitest run --config vite.config.ts src/lib/i18n` (if exists) → no regressions

    All evidence collected for the SUMMARY.md. Append a "Carry-over to 60-15" note listing the 3 Fns that need atomic deploy + cron registration.
  </action>
  <verify>
    <automated>cd leanshot && npx vitest run --config vite.config.ts supabase/functions/_shared/__tests__/federated-integration.test.ts && npx tsc -p tsconfig.app.json --noEmit && [ -z "$(grep -rln 'cron' supabase/functions/rag-federated-pubmed supabase/functions/rag-federated-fda supabase/functions/rag-federated-dailymed)" ]</automated>
  </verify>
  <done>
    Integration test (6 cases) passes. `tsc --noEmit` exits 0. No cron strings in any rag-federated-* Fn dir. Every Deno.serve guarded. No auto-publish strings. SUMMARY.md notes carry-over to 60-15 with exact deploy command:
    `supabase functions deploy rag-federated-pubmed rag-federated-fda rag-federated-dailymed --project-ref <ref>`.
  </done>
</task>

</tasks>

<threat_model>

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Edge Fn → external REST (NLM/FDA/DailyMed) | Outbound traffic from Supabase Edge runtime; URL-builder receives admin-controllable params (topic_tag) — SSRF vector via URL injection if allowlist is bypassed |
| External REST response → kb_chunks_queue | Untrusted JSON/XML/HTML from public APIs; silent rate-limit truncation can corrupt the corpus |
| Federated tier-A chunk → admin review (60-08) → published kb_chunks | Even authoritative NLM/FDA sources MUST pass admin queue (no auto-publish per CONTEXT.md + AI-SPEC §1b regulatory) |
| OpenFDA drug/event narrative → source_text_excerpt | Adverse-event reports CAN contain identifying narrative (age, weight, sex); PII fence required at normalize layer |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-60-07-01 | Spoofing/Tampering (SSRF) | All 3 federated Fns (client URL builder) | mitigate | `_shared/federated-host-allowlist.ts` — https-only + explicit 3-host allowlist via `URL.hostname` strict-equality (NOT `includes`, NOT regex — defeats `api.ncbi.nlm.nih.gov.evil.com` suffix attack); explicit IP-literal + metadata-endpoint deny (`127.0.0.1`, `169.254.169.254`); fail-closed on URL parse error; emits PostHog `federated_host_allowlist_blocked` + Slack P1 to `#alerts-pharma02` on trip. Per AI-SPEC §6 G3+ high-severity SSRF. |
| T-60-07-02 | Tampering (silent rate-limit truncation) | PubMed/OpenFDA/DailyMed clients | mitigate | zod-validate every response shape; HTML response when JSON expected → throws `RateLimitTruncationError` (per AI-SPEC §3 Pitfall #8); writes `federated_sources.last_error`; PostHog `federated_zod_validation_failed`; Slack P2 to `#alerts-rag`. |
| T-60-07-03 | Information Disclosure (PII in FDA adverse events) | rag-federated-fda/normalize.ts | mitigate | Explicit field allowlist (NOT denylist) in `normalizeOpenFDADrugEvent` — only `medicinalproduct`, `drugindication`, `reactionmeddrapt`, `receivedate`, `safetyreportid` pluck through; `patient.patientonsetage`, `patient.patientweight`, `patient.patientsex`, `patient.patientonsetagegroup` NEVER touched. Test 3 of Task 3 is the regression. |
| T-60-07-04 | Information Disclosure (PHARMA-02 regression) | All 3 Fns + normalize layers | mitigate | All federated chunks land `tier='A'` `status='queued'` — NO auto-publish path exists. Phase 39 39-02 D-06 3-layer invariant (ESLint AST rule covers `src/lib/rag/*` — these are `supabase/functions/rag-federated-*` so the ESLint layer does NOT auto-cover them; the RUNTIME layer applies at synthesis (rag-retrieve / coach) NOT at ingestion; the CI grep gate IS active here — Task 5 sweep greps for `auto.publish|skip.review|bypass.queue|tier.A.*publish`). Disposition note: ingestion is upstream of synthesis; PHARMA-02 enforcement is at synthesis (G1 in `rag-retrieve` + `rag-synthesize`) not at ingestion. Federated tier-A label is informational metadata; admin in 60-08 can demote to B/C. |
| T-60-07-05 | Denial of Service (rate-limit-induced runaway cost / throttle) | All 3 Fns | mitigate | Per-source backoff (PubMed exp 1s/2s/4s; OpenFDA exp 2s/4s/8s + 240/min sliding window; DailyMed token-bucket 5/s + exp 4s/8s/16s); 24h cache deduplicates repeat queries; G7 federated cap $2/hour enforced via wall-clock + bytes_fetched tracking → emits `rag_cost_envelope_breach` + halts loop. Phase 67 OPS-08 (Edge Middleware) will further rate-limit caller side. |
| T-60-07-06 | Denial of Service (initial seed cost explosion) | All 3 Fn entry handlers | mitigate | `mode: 'historical-seed'` clamped to last-30-days per CONTEXT.md decision ("Initial seed: last-30-days only on enable"); `mode: 'full-historical'` requires admin-action-token header (one-shot button from 60-09; rate-limited via 60-08 admin RPC). |
| T-60-07-07 | Tampering (cache poisoning / cross-source bleed) | _shared/federated-cache.ts | mitigate | Cache key is `(source, query_hash)` composite PRIMARY KEY (per 60-01 schema); `source` enum-constrained `'pubmed'\|'openfda'\|'dailymed'`; `query_hash` is sha256 of canonical-stringified `{endpoint, params}` — defense against param-order collision. INSERT ... ON CONFLICT DO UPDATE pattern (per `[[reference_postgres_no_insert_on_conflict_do_delete]]`). |
| T-60-07-08 | Repudiation (which Fn-call wrote which chunk?) | All 3 Fn → kb_chunks_queue insert | accept | `kb_chunks_queue.created_by = '00000000-0000-0000-0000-000000000060'` reserved system_federated uuid + `external_id = pmid\|setid:version\|safetyreportid` per chunk make every federated chunk traceable back to upstream record. No human actor on ingestion; admin actor recorded at approve/reject in 60-08. |
| T-60-07-SC | Tampering (supply chain — npm/deno deps) | Per-Fn deno.json import maps | mitigate | No new npm packages added in this plan (zod + @supabase/supabase-js already in 60-02 _shared/deno.json convention); per-Fn deno.json pins versions; supply-chain audit deferred to phase-level legitimacy gate (no installs in this plan = no `[ASSUMED]`/`[SUS]` checkpoint needed). |

</threat_model>

<verification>

**Per-task `<automated>` blocks above. Aggregated phase-level checks:**

1. `cd leanshot && npx tsc -p tsconfig.app.json --noEmit` — exits 0 with no new errors
2. `cd leanshot && npx vitest run --config vite.config.ts supabase/functions/_shared/__tests__/federated-host-allowlist.test.ts supabase/functions/_shared/__tests__/federated-cache.test.ts supabase/functions/_shared/__tests__/federated-integration.test.ts supabase/functions/rag-federated-pubmed/__tests__/ supabase/functions/rag-federated-fda/__tests__/ supabase/functions/rag-federated-dailymed/__tests__/` — all suites pass (estimated ~57 cases across 8 files)
3. `cd leanshot && grep -rln 'cron' supabase/functions/rag-federated-pubmed supabase/functions/rag-federated-fda supabase/functions/rag-federated-dailymed` — empty (no cron in this plan)
4. `cd leanshot && for d in supabase/functions/rag-federated-{pubmed,fda,dailymed}; do test -f "$d/deno.json" || { echo "MISSING $d/deno.json"; exit 1; }; done` — exit 0
5. `cd leanshot && grep -rL 'import.meta.main' supabase/functions/rag-federated-pubmed/index.ts supabase/functions/rag-federated-fda/index.ts supabase/functions/rag-federated-dailymed/index.ts` — empty (every index.ts has the guard)
6. PHARMA-02 carveout regression: `cd leanshot && grep -rE 'auto.publish|skip.review|bypass.queue|tier.A.*publish' supabase/functions/rag-federated-pubmed supabase/functions/rag-federated-fda supabase/functions/rag-federated-dailymed | grep -v '__tests__' | grep -v -E '^[^:]+:[[:space:]]*//'` — empty (rejected-alt names defended via comment-stripping per `[[feedback_negation_grep_defeated_by_comment_string]]`)
7. SSRF host allowlist sanity: `cd leanshot && grep -c 'FEDERATED_ALLOWED_HOSTS' supabase/functions/_shared/federated-host-allowlist.ts` ≥ 2 (definition + export); allowlist contents = `api.ncbi.nlm.nih.gov api.fda.gov dailymed.nlm.nih.gov` (exact 3 hosts per AI-SPEC §6)
8. No back-dated migrations introduced (this plan adds zero migration files — 60-01 owns them; verify `git status leanshot/supabase/migrations/` shows no new files from this plan)

</verification>

<success_criteria>

- All 3 federated Edge Fns (`rag-federated-pubmed`, `rag-federated-fda`, `rag-federated-dailymed`) compile cleanly, pass their respective vitest suites, and have `Deno.serve` guarded by `import.meta.main` per `[[reference_deno_test_top_level_serve_trap]]`.
- Cross-Fn integration test (Task 5) verifies enable→fetch→queue→dedup→last_sync_at flow against mocked DB + mocked fetch.
- SSRF host allowlist enforced at every outbound fetch via `_shared/federated-host-allowlist.ts`; non-allowed host blocked + Slack P1 to `#alerts-pharma02`.
- 24h cache via `_shared/federated-cache.ts` deduplicates identical queries (cost guardrail).
- PII guard in `rag-federated-fda/normalize.ts` strips `patient.patientonsetage`, `patient.patientweight`, `patient.patientsex`, `patient.patientonsetagegroup` via explicit allowlist field-pluck (regression test in Task 3).
- All federated chunks land `tier='A'` `status='queued'` in `kb_chunks_queue` — no auto-publish path exists.
- Initial seed clamped to last-30-days per CONTEXT.md decision; `mode: 'full-historical'` requires admin-action-token.
- Zero cron registrations in this plan — 60-15 BLOCKING owns Fn-deploy + cron-push atomic sequence per `[[feedback_fn_deploy_before_cron_db_push]]`.
- Carry-over to 60-15 documented in SUMMARY: deploy command `supabase functions deploy rag-federated-pubmed rag-federated-fda rag-federated-dailymed --project-ref <ref>` MUST run before any cron migration touches these endpoints.
- Vendor secret pre-flight: `PUBMED_API_KEY` + `OPENFDA_API_KEY` are OPTIONAL (Fns work without; relaxed rate limits when present); operator-set via `supabase secrets set` before live cron (60-15) — surface in execute-phase dispatch confirmation per `[[feedback_vendor_secret_preflight_surface]]`.

</success_criteria>

<output>
Create `.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-07-federated-adapters-SUMMARY.md` when done. SUMMARY must include:
- Files created (with line counts)
- Vitest case count per Fn
- Carry-over note: "60-15 MUST deploy `rag-federated-pubmed rag-federated-fda rag-federated-dailymed` BEFORE any cron migration registers schedules against these Fns. Initial cron cadence per CONTEXT.md = daily 03:00 UTC. Operator-supplied env vars (optional, relax rate limits): `PUBMED_API_KEY`, `OPENFDA_API_KEY`."
- Any deviations from the plan (e.g., LOINC code drift in DailyMed normalizer → fallback to section.title fuzzy-match)
- Threat-model dispositions verified (T-60-07-01..08 + T-60-07-SC)
</output>
