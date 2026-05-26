---
phase: 60-rag-knowledge-base-completion-waves-2-4
reviewed: 2026-05-26T14:30:00Z
depth: quick
files_reviewed: 95
files_reviewed_list:
  - supabase/migrations/20281201000001_phase60_kb_tables.sql
  - supabase/migrations/20281201000002_phase60_secdef_rpcs.sql
  - supabase/migrations/20281201000003_phase60_push_categories.sql
  - supabase/migrations/20281201000004_kb_tip_of_day_table.sql
  - supabase/migrations/20281201000010_match_external_kb_embeddings_fn.sql
  - supabase/migrations/20281201000011_rag_budget_caps.sql
  - supabase/migrations/20281201000020_federated_source_rpcs.sql
  - supabase/migrations/20281201000021_rag_chunks_public_hub_columns.sql
  - supabase/migrations/20281201000099_phase60_cron_schedules.sql
  - supabase/functions/_shared/deno.json
  - supabase/functions/_shared/posthog-rag-events.ts
  - supabase/functions/_shared/slack-guardrail-alert.ts
  - supabase/functions/_shared/rag-retrieve.ts
  - supabase/functions/_shared/pharma-02-carveout.ts
  - supabase/functions/_shared/federated-host-allowlist.ts
  - supabase/functions/_shared/federated-cache.ts
  - supabase/functions/_shared/newsletter-token.ts
  - supabase/functions/_shared/notification-types.ts
  - supabase/functions/rag-summarize-and-chunk/prompt.ts
  - supabase/functions/rag-summarize-and-chunk/anthropic.ts
  - supabase/functions/rag-summarize-and-chunk/chunker.ts
  - supabase/functions/rag-summarize-and-chunk/index.ts
  - supabase/functions/rag-embed-approved/openai.ts
  - supabase/functions/rag-embed-approved/handler.ts
  - supabase/functions/rag-embed-approved/index.ts
  - supabase/functions/rag-retrieve/index.ts
  - supabase/functions/rag-retrieve/merge.ts
  - supabase/functions/rag-retrieve/cohere-rerank.ts
  - supabase/functions/rag-retrieve/jina-rerank.ts
  - supabase/functions/rag-retrieve/refusal.ts
  - supabase/functions/rag-federated-pubmed/index.ts
  - supabase/functions/rag-federated-pubmed/handler.ts
  - supabase/functions/rag-federated-pubmed/client.ts
  - supabase/functions/rag-federated-pubmed/normalize.ts
  - supabase/functions/rag-federated-fda/index.ts
  - supabase/functions/rag-federated-fda/handler.ts
  - supabase/functions/rag-federated-fda/client.ts
  - supabase/functions/rag-federated-fda/normalize.ts
  - supabase/functions/rag-federated-dailymed/index.ts
  - supabase/functions/rag-federated-dailymed/handler.ts
  - supabase/functions/rag-federated-dailymed/client.ts
  - supabase/functions/rag-federated-dailymed/normalize.ts
  - supabase/functions/rag-tip-of-day-generate/index.ts
  - supabase/functions/rag-tip-of-day-generate/prompt.ts
  - supabase/functions/rag-tip-of-day-generate/push-payload.ts
  - supabase/functions/rag-newsletter-sender/index.ts
  - supabase/functions/rag-newsletter-sender/templates/rag-newsletter.html
  - supabase/functions/rag-newsletter-unsubscribe-1click/index.ts
  - supabase/functions/rag-cost-query/index.ts
  - leanshot/src/lib/rag/dompurify-config.ts
  - leanshot/src/lib/rag/sanitize.ts
  - leanshot/src/lib/rag/retrieve-client.ts
  - leanshot/src/lib/rag/remark-citations.ts
  - leanshot/src/lib/rag/server-rag-events-relay.ts
  - leanshot/src/lib/rag/newsletter-api.ts
  - leanshot/src/lib/rag/i18n.ts
  - leanshot/src/lib/knowledge/api.ts
  - leanshot/src/lib/knowledge/topics.ts
  - leanshot/src/lib/admin/rag/chunk-api.ts
  - leanshot/src/lib/admin/rag/cost-api.ts
  - leanshot/src/lib/admin/rag/federated-api.ts
  - leanshot/src/components/admin/rag/QueueDetailPane.tsx
  - leanshot/src/components/admin/rag/RagQueuePage.tsx
  - leanshot/src/components/admin/rag/RejectReasonSheet.tsx
  - leanshot/src/components/admin/rag/EditChunkModal.tsx
  - leanshot/src/components/admin/rag/RetractChunkModal.tsx
  - leanshot/src/components/admin/rag/RagCostPage.tsx
  - leanshot/src/components/admin/rag/FederatedSourceRow.tsx
  - leanshot/src/components/admin/rag/FederatedSourcesPage.tsx
  - leanshot/src/components/admin/rag/RagLayout.tsx
  - leanshot/src/components/dashboard/ai/AIChatPanel.tsx
  - leanshot/src/components/dashboard/ai/CitationMarker.tsx
  - leanshot/src/components/dashboard/ai/CitationPopover.tsx
  - leanshot/src/components/dashboard/ai/SourcesFooter.tsx
  - leanshot/src/components/dashboard/ai/RefusalCard.tsx
  - leanshot/src/components/dashboard/cards/TipOfTheDayCard.tsx
  - leanshot/src/components/knowledge/KnowledgeRoute.tsx
  - leanshot/src/components/knowledge/KnowledgeRootPage.tsx
  - leanshot/src/components/knowledge/KnowledgeTopicIndexPage.tsx
  - leanshot/src/components/knowledge/KnowledgeArticleDetailPage.tsx
  - leanshot/src/components/knowledge/KnowledgeBreadcrumb.tsx
  - leanshot/src/components/knowledge/SourcesPanel.tsx
  - leanshot/src/components/knowledge/KnowledgeTierBadge.tsx
  - leanshot/src/components/dashboard/settings/NewsletterSettings.tsx
  - leanshot/src/components/onboarding/steps/NewsletterOptInStep.tsx
  - leanshot/src/components/onboarding/OnboardingFlow.tsx
  - leanshot/public/locales/en/rag.json
  - leanshot/public/locales/es/rag.json
  - leanshot/src/App.tsx
findings:
  critical: 4
  warning: 4
  info: 2
  total: 10
status: fixes_applied
---

# Phase 60: Code Review Report

**Reviewed:** 2026-05-26T14:30:00Z
**Depth:** quick (pattern-matching + targeted reads on flagged areas)
**Files Reviewed:** 95
**Status:** issues_found

## Summary

Phase 60 ships a substantial RAG knowledge base completion across 15 plans — 10 Edge Functions, 9 migrations, and full admin + consumer UI. Security fundamentals are largely sound: SECDEF RPCs have correct `is_staff()` guards and 2-person rule DB enforcement, the SSRF allowlist uses strict hostname equality, DOMPurify verbatim-quote config is tight, and the RFC 8058 unsubscribe token uses `constantTimeEqual`. No hardcoded secrets found.

Four critical defects were found: (1) a broken DOMPurify hook API in `sanitize.ts` that silently skips `afterSanitizeAttributes` enforcement, (2) a vendor string mismatch between `rag-summarize-and-chunk` and the cost dashboard that will cause the Anthropic summarizer card to show zero data, (3) a `stripControlChars` regex in `knowledge/api.ts` that strips printable ASCII (space, `!`, `"`, `-`, etc.) instead of control characters, defeating its stated security purpose, and (4) a non-constant-time comparison of the service role key in `rag-retrieve`'s `eval-sweep` mode. Four warnings cover: missing `vendor` field in `$ai_generation` events from the embed and rerank pipelines (cost dashboard cards dead), a CAN-SPAM physical-address placeholder that ships live in production email, a `emitAiGeneration` misuse for a non-AI event, and the QueueDetailPane admin source-text anchor sanitization lacking forced `target=_blank`.

---

## Critical Issues

### CR-01: `sanitize.ts` DOMPurify hook silently does nothing — links in public article bodies get no `target=_blank` / `rel=noopener` enforcement

**File:** `leanshot/src/lib/rag/sanitize.ts:79-83`

**Issue:** `sanitizeRagMarkdown` passes `HOOK: 'afterSanitizeAttributes'` and `afterSanitizeAttributes(node)` as keys in the DOMPurify config object. DOMPurify's `sanitize(source, config)` method does **not** support hooks via the config parameter — hooks must be registered via `DOMPurify.addHook()`. These keys are silently ignored (the TypeScript cast `as Parameters<typeof DOMPurify.sanitize>[1]` suppresses the type error). The consequence is that `<a>` elements in article bodies render with whatever `target` and `rel` the source text provides, defeating the stated T-60-13-XSS-1 link-safety invariant. The existing `community/dompurify-config.ts` file (written by a prior phase) uses the correct `DOMPurify.addHook()` API; this file forked from it but dropped the call form. Note: because `KnowledgeArticleDetailPage` renders via `<ReactMarkdown>` (no `rehype-raw`), raw HTML anchor tags in markdown source are currently escaped — so XSS is not currently exploitable via this rendering path. However the hook is dead code and the stated safety invariant is not enforced. Any future addition of `rehype-raw` to the component or use of `sanitizeRagMarkdown` with `dangerouslySetInnerHTML` would immediately become exploitable.

**Fix:**
```typescript
// In leanshot/src/lib/rag/sanitize.ts — replace the sanitize() call with:

let _hookRegistered = false;

export function sanitizeRagMarkdown(html: string): string {
  // Register hook once per module load (mirrors community/dompurify-config.ts pattern)
  if (!_hookRegistered) {
    _hookRegistered = true;
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if ('tagName' in node && (node as Element).tagName === 'A') {
        (node as Element).setAttribute('target', '_blank');
        (node as Element).setAttribute('rel', 'noopener noreferrer');
        const href = (node as Element).getAttribute('href') ?? '';
        if (!href.startsWith('http://') && !href.startsWith('https://')) {
          (node as Element).removeAttribute('href');
        }
      }
    });
  }

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: RAG_ARTICLE_ALLOWED_TAGS,
    FORBID_TAGS: RAG_ARTICLE_FORBID_TAGS,
    ALLOWED_ATTR: RAG_ARTICLE_ALLOWED_ATTR,
    FORCE_BODY: false,
    ADD_ATTR: ['target', 'rel'],
  });
}
```
Remove the `HOOK` and `afterSanitizeAttributes` keys from the config object.

---

### CR-02: `stripControlChars` regex strips printable ASCII characters, NOT control characters

**File:** `leanshot/src/lib/knowledge/api.ts:63-66`

**Issue:** The function is documented as stripping control characters from search queries (`eslint-disable no-control-regex` comment makes the intent explicit). However, the regex `/[ --]/g` is a character class ranging from ASCII `0x20` (space) to `0x2D` (hyphen), which strips: space, `!`, `"`, `#`, `$`, `%`, `&`, `'`, `(`, `)`, `*`, `+`, `,`, `-`. Actual control characters (`\x00`–`\x1F`) pass through untouched. This means: (1) the stated security purpose (strip control chars before PostgREST) is not achieved — null bytes, ETX, ESC etc. are forwarded, and (2) normal search queries are mangled (the word "side effects" becomes "sideeffects", "GLP-1" becomes "GLP1"). The SQLMetaPattern guard still catches `--` sequences, but control characters are no longer caught at all.

Verified by runtime test:
```
input:  'hello world! abc-def\x00\x01\x1f'
output: 'helloworldabcdef\x00\x01\x1f'   // control chars survive, space/!/-/,/etc stripped
```

**Fix:**
```typescript
// Replace the regex with the correct Unicode control-character range
function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1F\x7F]/g, '');
}
```

---

### CR-03: Vendor string `'anthropic_summary'` (emitter) vs `'anthropic_summarize'` (cost dashboard `ALLOWED_VENDORS`) — Anthropic summarizer cost card always shows zero

**File:** `supabase/functions/rag-summarize-and-chunk/index.ts:324` and `supabase/functions/rag-cost-query/index.ts:42`

**Issue:** `rag-summarize-and-chunk` emits `vendor: 'anthropic_summary'` both in the `rag_cost_ledger` row and in the `rag_cost_envelope_breach` event, and the `RagVendor` enum in `cost-ledger.ts` (line 25) lists `'anthropic_summary'`. However the cost dashboard's `ALLOWED_VENDORS` array at `rag-cost-query/index.ts:42` lists `'anthropic_summarize'` — with a trailing `e`. The HogQL query filters `properties.vendor = {vendor:String}` so the `anthropic_summarize` card will forever return empty data because no emitter ever sends that string. The AI-SPEC (line 771) also documents `'anthropic_synthesis'` as a third variant, meaning there are three different strings in play for one concept. The cost dashboard's Anthropic summarizer card is non-functional on day one.

**Fix:** Choose one canonical string across all three artifacts and align them. The `rag_vendor` enum in the DB uses `'anthropic_summary'` (per 60-15 D-60-15-03), so the cost dashboard should match:
```typescript
// supabase/functions/rag-cost-query/index.ts
const ALLOWED_VENDORS = [
  'firecrawl',
  'openai_embed',
  'anthropic_summary',   // was 'anthropic_summarize' — align with rag_vendor enum + emitter
  'cohere_rerank',
  'jina_rerank',
  'federated_fetch',
] as const;
```

---

### CR-04: `rag-retrieve` eval-sweep mode compares service role key with `!==` (non-constant-time) — timing oracle for secret enumeration

**File:** `supabase/functions/rag-retrieve/index.ts:126`

**Issue:**
```typescript
if (!authHeader.replace('Bearer ', '') || authHeader.replace('Bearer ', '') !== serviceRoleKey) {
```
The `!==` operator performs a short-circuit string comparison that exits on the first non-matching byte. For a 219-character secret (confirmed in 60-15 SUMMARY), an attacker with network access to the Supabase Edge can use timing differences to enumerate the key character by character. The `/healthz` endpoint on any other Fn confirms reachability. This endpoint is not guarded by Edge Middleware rate-limiting (the carry-over in 60-15 says rate-limit applies to `/knowledge/*`; eval-sweep is at the fn root).

Additionally, the `replace('Bearer ', '')` form is case-sensitive and does not strip additional whitespace — a header like `Bearer  key` (double space) would fail to match even with a valid key.

**Fix:**
```typescript
import { constantTimeEqual } from '../_shared/newsletter-token.ts';

// In the eval-sweep auth block:
const presented = authHeader.startsWith('Bearer ')
  ? authHeader.slice(7)
  : authHeader;

if (!presented || !constantTimeEqual(presented, serviceRoleKey)) {
  return jsonResp({ error: 'eval_sweep_requires_service_role' }, 401);
}
```

---

## Warnings

### WR-01: `rag-embed-approved` and `rag-retrieve` `$ai_generation` events omit `vendor` field — `openai_embed`, `cohere_rerank`, `jina_rerank` cost-dashboard cards always empty

**Files:**
- `supabase/functions/rag-embed-approved/index.ts:49-62` (wiring)
- `supabase/functions/rag-retrieve/index.ts:174-184` (embed call)
- `supabase/functions/rag-retrieve/index.ts:272-283` (rerank call)

**Issue:** The cost dashboard's HogQL query filters `WHERE event = '$ai_generation' AND properties.vendor = {vendor:String}`. Three of the four live production cost-emitting pipelines never set a `vendor` property in their `$ai_generation` events:
- `rag-embed-approved` index.ts wiring maps `model`/`provider`/`inputTokens`/`costUsd`/`latencyMs` into `emitAiGeneration` properties but not `vendor`. The `provider` field is `'openrouter'` (the routing layer), not the vendor string the cost dashboard expects (`'openai_embed'`).
- `rag-retrieve` emits `$ai_generation` at lines 174 and 272 with no `vendor` field. The rerank call uses `action: 'rerank_cohere'/'rerank_jina'` instead of `vendor: 'cohere_rerank'/'jina_rerank'`.

`60-14` SUMMARY acknowledges "DRIFT" for `openai_embed` and `anthropic_summarize` (their word), but the fix landed only in the cost dashboard's label text — not by adding the `vendor` field to the emitters.

**Fix:** Add `vendor` to each emitter's properties:
```typescript
// rag-embed-approved/index.ts wiring (line 53-62):
properties: {
  model: args.model,
  vendor: 'openai_embed',       // add this
  prompt_tokens: args.inputTokens,
  usage_total_cost: args.costUsd,
  latency_ms: args.latencyMs,
  trace_id: crypto.randomUUID(),
},

// rag-retrieve/index.ts rerank emit (line 274-282):
properties: {
  model: rerankResp.model,
  vendor: provider === 'cohere' ? 'cohere_rerank' : 'jina_rerank',  // add this
  ...
},
```

---

### WR-02: CAN-SPAM physical-address placeholder ships live in production newsletter email with no runtime guard

**File:** `supabase/functions/rag-newsletter-sender/index.ts:274`

**Issue:**
```typescript
const footerAddress = deps?.footerAddress ??
  '[LeanShot address — CAN-SPAM placeholder; replace before first live send]';
```
There is no guard that prevents `handleSend()` from proceeding when `footerAddress` is the placeholder string. The pg_cron job `phase60_newsletter_weekly` (Sunday 13:00 UTC) was registered in migration `20281201000099` and is live. The first Sunday after deployment will send emails with the literal placeholder text in the CAN-SPAM footer, which is (a) non-compliant with CAN-SPAM 15 U.S.C. § 7704(a)(5) and (b) visually broken for subscribers.

**Fix:** Add a pre-flight guard at the top of the sender handler:
```typescript
const footerAddress = deps?.footerAddress
  ?? Deno.env.get('NEWSLETTER_PHYSICAL_ADDRESS')
  ?? null;

if (!footerAddress || footerAddress.startsWith('[')) {
  console.error('[rag-newsletter-sender] BLOCKED: NEWSLETTER_PHYSICAL_ADDRESS not set');
  return new Response(
    JSON.stringify({ error: 'can_spam_address_not_configured' }),
    { status: 500, headers: { 'Content-Type': 'application/json' } },
  );
}
```
Set `NEWSLETTER_PHYSICAL_ADDRESS` as a Supabase Function Secret before the first cron fires.

---

### WR-03: `emitAiGeneration` misused for `newsletter_unsubscribed` telemetry — event lands in wrong PostHog table

**File:** `supabase/functions/rag-newsletter-unsubscribe-1click/index.ts:208-219`

**Issue:** The unsubscribe Fn uses `emitAiGeneration({ userId, properties: { model: 'none', event_type: 'newsletter_unsubscribed', ... } })` to track unsubscribe events. `emitAiGeneration` emits the PostHog event `$ai_generation` — a reserved PostHog LLM Analytics event that populates the cost/usage dashboard. Emitting a non-AI event as `$ai_generation` with `model: 'none'` pollutes the LLM analytics table and may corrupt cost aggregations. The `posthog-rag-events.ts` file already exposes `captureRagEvent` for custom event names.

**Fix:**
```typescript
// Replace emitAiGeneration with captureRagEvent:
import { captureRagEvent, shutdownPostHog } from '../_shared/posthog-server.ts';

captureRagEvent({
  distinctId: userId,
  name: 'newsletter_unsubscribed',
  properties: {
    trace_id: `unsub-${userId}-${Date.now()}`,
    via: req.method === 'POST' ? 'one-click' : 'manual-click',
    was_rotation_update: wasUpdated,
  },
});
```

---

### WR-04: QueueDetailPane admin source-text sanitization allows `href` attribute without forced `target=_blank` — admin tab-napping risk

**File:** `leanshot/src/components/admin/rag/QueueDetailPane.tsx:24-28`

**Issue:** The DOMPurify config for admin source-text rendering allows `ALLOWED_ATTR: ['href', 'target', 'rel']`. Source markdown rendered with `rehypeRaw` (line 183) passes anchor elements through. Because there is no `addHook('afterSanitizeAttributes', ...)` call, anchor tags in scraped source text retain whatever `target` and `rel` the source provides — which for external scraped content is typically neither. Any links in a `source_markdown` body render as plain `<a href="https://...">` with no `target=_blank` — an admin user clicking them navigates away from the queue, and the opened page can use `window.opener` to read the admin origin (tab-napping). This is the admin surface only, but it's the primary curation workflow.

**Fix:** Add a `DOMPurify.addHook` call for this config (same pattern as community/dompurify-config.ts), or use `ADD_ATTR: ['target', 'rel']` with a post-sanitize DOM walk in the React component to force `target='_blank'` and `rel='noopener noreferrer'` on all rendered anchors.

---

## Info

### IN-01: `rag-summarize-and-chunk` `$ai_generation` event lacks required `trace_id` field

**File:** `supabase/functions/rag-summarize-and-chunk/index.ts:331-341`

**Issue:** The `captureRagEvent` call that emits `$ai_generation` for the summarizer omits `trace_id`. The `AiGenerationProperties` interface in `posthog-rag-events.ts:57` declares `trace_id: string` as a required (non-optional) field. The `[key: string]: unknown` index signature on the interface allows this to pass TypeScript without error via the `captureRagEvent` path (which does not type-check the properties). PostHog LLM Analytics trace linking will not work for summarizer calls — they cannot be correlated back to the originating scrape run.

**Fix:** Thread the chunk's `id` or a per-batch UUID as `trace_id` in the event:
```typescript
captureRagEvent({
  name: '$ai_generation',
  properties: {
    function: FN_NAME,
    model,
    trace_id: `summarize-${chunk.id}`,  // add trace_id
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    usage_total_cost: usd,
    vendor: 'anthropic_summary',        // add vendor for cost dashboard (see CR-03)
    chunk_id: chunk.id,
    topic_tag: chunk.topic_tag,
  },
});
```

---

### IN-02: Three federated cron jobs all fire at `0 3 * * *` UTC simultaneously — concurrent cache writes

**File:** `supabase/migrations/20281201000099_phase60_cron_schedules.sql:58-101`

**Issue:** `phase60_federated_pubmed_sync`, `phase60_federated_fda_sync`, and `phase60_federated_dailymed_sync` all use the same cron expression `0 3 * * *`. All three write to `federated_source_cache` (which uses `ON CONFLICT DO UPDATE`) and to `rag_chunks` (dedup via content_hash). With three concurrent writers at the same moment, you get three simultaneous Edge Fn cold starts competing on Postgres connections, and the G7 wall-clock cap (1-hour per Fn) means all three saturate simultaneously. Not a correctness bug (ON CONFLICT handles the dedup), but a noisy daily load pattern.

**Fix:** Stagger by 20 minutes: PubMed at `0 3 * * *`, OpenFDA at `20 3 * * *`, DailyMed at `40 3 * * *`.

---

## Appendix: Confirmed Clean

The following high-priority patterns from the review brief were checked and found clean:

- **No hardcoded secrets or API keys** in any reviewed file.
- **SSRF allowlist (`federated-host-allowlist.ts`)** uses strict `URL.hostname` equality (not `includes`/`startsWith`) against the 3-host list — correct.
- **RFC 8058 unsubscribe token** uses `constantTimeEqual` for primary auth comparison — correct.
- **2-person rule DB layer** in `approve_rag_chunk` and `retract_rag_chunk` uses `SELECT FOR UPDATE` + `auth.uid() <> created_by/reviewed_by` — correct.
- **`auth.users` join** in `list_rag_review_queue` (not `public.profiles`) — correct.
- **No `ON CONFLICT DO DELETE`** anti-pattern in any migration.
- **All 9 migrations** use future-dated `2028-12-01` timestamps — no back-dating issues.
- **`import.meta.main` guards** present on all 10 deployed Edge Functions (per 60-15 Task 1 verification).
- **OpenRouter model IDs** use dotted convention (`anthropic/claude-haiku-4.5`) — no direct-Anthropic hyphenated leakage in Phase 60 Fns.
- **`profiles.email` anti-pattern** not present in any Phase 60 migration or Edge Fn.
- **DOMPurify verbatim-quote config (`dompurify-config.ts`)** uses tight allowlist `[strong, em, b, i, br]` + zero attributes — correct.
- **PHARMA-02 Layer 2 (`pharma-02-carveout.ts`)** coverage confirmed in rag-summarize-and-chunk, rag-tip-of-day-generate, rag-newsletter-sender — three surfaces covered.
- **Named dollar-quote tags** (`$cron$...$cron$`) used in all 7 pg_cron job bodies — no `$$` nesting collision.
- **No `console.log` debug artifacts** in any deployed Edge Function.
- **No empty catch blocks** that silently swallow errors.

---

---

## Fixes Applied

| Finding | Commit | Status |
|---------|--------|--------|
| CR-01 | `afd3709a` | fixed |
| CR-02 | `27bb80bf` | fixed |
| CR-03 | `62766294` | fixed |
| CR-04 | `f9433e3b` | fixed |
| WR-01 | `7a8d04a6` | fixed |
| WR-02 | `e076f9f7` | fixed |
| WR-03 | `799e39e1` | fixed |
| WR-04 | `9bfc4765` | fixed |
| IN-01 | — | skipped (info — out of scope) |
| IN-02 | — | skipped (info — out of scope) |

_Reviewed: 2026-05-26T14:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: quick (with targeted reads on security-sensitive paths)_
_Fixes applied: 2026-05-26T15:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
