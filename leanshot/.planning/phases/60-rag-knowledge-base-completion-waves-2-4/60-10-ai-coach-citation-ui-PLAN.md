---
phase: 60-rag-knowledge-base-completion-waves-2-4
plan: 10
type: execute
wave: 2
depends_on: [60-01, 60-02, 60-06]
files_modified:
  - leanshot/src/lib/rag/i18n.ts
  - leanshot/src/lib/rag/retrieve-client.ts
  - leanshot/src/lib/rag/remark-citations.ts
  - leanshot/src/lib/rag/server-rag-events-relay.ts
  - leanshot/src/lib/rag/dompurify-config.ts
  - leanshot/src/components/dashboard/ai/CitationMarker.tsx
  - leanshot/src/components/dashboard/ai/CitationPopover.tsx
  - leanshot/src/components/dashboard/ai/SourcesFooter.tsx
  - leanshot/src/components/dashboard/ai/RefusalCard.tsx
  - leanshot/src/components/dashboard/ai/AIChatPanel.tsx
  - leanshot/public/locales/en/rag.json
  - leanshot/public/locales/es/rag.json
  - leanshot/src/components/dashboard/ai/__tests__/CitationMarker.test.tsx
  - leanshot/src/components/dashboard/ai/__tests__/CitationPopover.test.tsx
  - leanshot/src/components/dashboard/ai/__tests__/SourcesFooter.test.tsx
  - leanshot/src/components/dashboard/ai/__tests__/RefusalCard.test.tsx
  - leanshot/src/lib/rag/__tests__/remark-citations.test.ts
  - leanshot/src/lib/rag/__tests__/retrieve-client.test.ts
  - leanshot/src/lib/rag/__tests__/dompurify-config.test.ts
  - leanshot/tests/e2e/60-ai-coach-citation.spec.ts
autonomous: true
requirements: [RAG-04]
must_haves:
  truths:
    - "Assistant message text containing inline `[chunk_id]` markers (UUID form, emitted by 60-06 rag-retrieve synthesis) renders [N] superscript markers in numeric order per message, with ≥24px invisible tap-hitbox per UI-SPEC §3 invariant 10 exception."
    - "Tapping/clicking a [N] marker opens CitationPopover on ≥md (anchored, 320px max width) or bottom Sheet on <md, displaying source title, TierBadge, verbatim_quote (DOMPurify-sanitized + 280-char truncation + 'Read full chunk'), freshness strip ('As of YYYY-MM-DD' mono + optional 'May be outdated' warning pill when >2yr), `leanshot_research` disclosure (`k≥5 cohort, DP-ε noise applied`) when source_type matches, 'Open source ↗' ghost button to canonical_url (target=_blank rel=noopener noreferrer), and disclaimer line."
    - "Popover has role=dialog + aria-modal=true + focus trap + return-focus-to-marker on close; ESC closes; ←/→ cycle between siblings when present (UI-SPEC §4 a11y contract)."
    - "Refusal messages (G1 PHARMA-02 / G3-G4 out-of-corpus / G5 citation-validation-failed) render via RefusalCard with AlertTriangle/Info/AlertCircle icon, ZERO [N] markers, ZERO 'Sources (N)' footer per UI-SPEC §5 invariant 2. PHARMA-02 copy is the EXACT locked string from Phase 39 39-02 D-06: 'That topic requires clinician guidance — please ask your doctor.' (UI-SPEC invariant 3)."
    - "AIChatPanel.tsx augmented ADDITIVELY: existing Bubble component branches on m.role==='assistant' + presence of citation/refusal markers to render via new render path; messages without markers render unchanged (regression-safe). The existing user_context ctx string composition for callAIChat is unchanged — AI-04 fence is preserved (AI-SPEC §6 G2)."
    - "Verbatim quote rendered through DOMPurify with explicit ALLOWED_TAGS allowlist (no img/script/iframe/style/object/embed/base/form); javascript: and data: hrefs stripped; anchors forced target=_blank rel=noopener noreferrer (T-60-XSS-1 mitigation)."
    - "PostHog server-side events `rag_citation_clicked` (on popover open) routed via `supabase.functions.invoke('server-rag-event-relay', ...)` per AI-SPEC §6 — ad-block immune; client receives anonymous JWT, server forwards with captureRagEvent."
    - "i18n keys `rag.attribution`, `rag.disclaimer`, `rag.tier.A.label`, `rag.tier.B.label`, `rag.tier.C.label`, `rag.popover.open_source`, `rag.popover.read_full_chunk`, `rag.popover.may_be_outdated`, `rag.popover.last_reviewed`, `rag.popover.close_aria`, `rag.popover.leanshot_research_disclosure`, `rag.sources_footer.label`, `rag.sources_footer.aria`, `rag.refusal.out_of_corpus`, `rag.refusal.pharma_02`, `rag.refusal.citation_validation_failed`, `rag.citation_marker.aria` defined in `public/locales/{en,es}/rag.json` and loaded via existing Phase 32 i18next HttpBackend (file-load namespace `rag`)."
    - "Sources footer is collapsible (default collapsed); shows 'Sources ({N})' with chevron icon; expands to numbered list of [N] source-name TierBadge truncated-URL entries; auto-expands under screen-reader navigation via aria-live='polite' on expanding region (UI-SPEC §4)."
    - "Vitest unit suites + Playwright E2E pass: marker counts/order, popover content + a11y (ESC + focus trap + return focus), refusal-no-marker invariant, AIChatPanel marker-free regression."
  artifacts:
    - path: leanshot/src/lib/rag/i18n.ts
      provides: "Typed `useRagTranslation()` hook wrapper + raw key constants for non-React contexts (e.g. remark plugin error strings)"
    - path: leanshot/src/lib/rag/retrieve-client.ts
      provides: "ragChunkById(chunkId): Promise<RagChunkResult|null> via supabase.functions.invoke('rag-retrieve', { body: { mode: 'lookup', chunk_id } }) AND ragRetrieve(args) wrapper. RagChunkResult zod-validated."
    - path: leanshot/src/lib/rag/remark-citations.ts
      provides: "remark plugin: scans message text for inline `[<uuid>]` tokens, maps to per-message numeric index, returns ordered citations array + ReactNode renderer hook. Pure (no React import in core)."
    - path: leanshot/src/lib/rag/server-rag-events-relay.ts
      provides: "captureRagEventBrowser(event, properties) — POST to /functions/v1/server-rag-event-relay; non-blocking fire-and-forget; uses existing supabase.functions.invoke pattern."
    - path: leanshot/src/lib/rag/dompurify-config.ts
      provides: "sanitizeVerbatimQuote(html: string): string — RAG-specific DOMPurify config FORKED from community/dompurify-config.ts; ALLOWED_TAGS=[strong em b i br], NO links / lists / headings (quote text only)."
    - path: leanshot/src/components/dashboard/ai/CitationMarker.tsx
      provides: "<CitationMarker refIndex={n} chunkId={uuid} onActivate={fn} /> — Badge tone=info, [N] superscript text-micro semibold, ≥24px hitbox via padding p-[5px]."
    - path: leanshot/src/components/dashboard/ai/CitationPopover.tsx
      provides: "<CitationPopover chunkId anchorEl siblings={chunkIds} onClose /> — floating Popover ≥md / bottom Sheet <md; fetches chunk via ragChunkById; renders per UI-SPEC §4; fires rag_citation_clicked via server-rag-events-relay on mount."
    - path: leanshot/src/components/dashboard/ai/SourcesFooter.tsx
      provides: "<SourcesFooter citations={CitationRef[]} /> collapsible footer (default collapsed) with aria-expanded + aria-live region."
    - path: leanshot/src/components/dashboard/ai/RefusalCard.tsx
      provides: "<RefusalCard kind='pharma_02'|'out_of_corpus'|'citation_validation_failed' /> — Card variant=flat with AlertTriangle/Info/AlertCircle. Pulls copy from i18n. ZERO marker render path."
    - path: leanshot/src/components/dashboard/ai/AIChatPanel.tsx
      provides: "AUGMENTED Bubble component: detects refusal sentinel envelope (first-line `[[REFUSAL:<kind>]]`) → RefusalCard; otherwise renders renderWithCitations() to interleave CitationMarker around plain text + SourcesFooter below. AI-04 ctx composition unchanged."
    - path: leanshot/public/locales/en/rag.json
      provides: "EN i18n namespace per key list above."
    - path: leanshot/public/locales/es/rag.json
      provides: "ES i18n namespace per key list above (mirror EN; copy reviewed by Phase 58 process — verbatim translation acceptable at MVP)."
  key_links:
    - from: leanshot/src/components/dashboard/ai/AIChatPanel.tsx Bubble
      to: leanshot/src/lib/rag/remark-citations.ts
      via: renderWithCitations(content, onMarkerActivate) on assistant messages
      pattern: "remark-citations.*parseCitations|renderWithCitations"
    - from: leanshot/src/components/dashboard/ai/CitationPopover.tsx
      to: supabase/functions/rag-retrieve (Phase 60-06)
      via: ragChunkById -> supabase.functions.invoke('rag-retrieve', { body: { mode:'lookup', chunk_id }})
      pattern: "supabase\\.functions\\.invoke\\(['\"]rag-retrieve['\"]"
    - from: leanshot/src/components/dashboard/ai/CitationPopover.tsx
      to: supabase/functions/server-rag-event-relay (Phase 60-02)
      via: captureRagEventBrowser('rag_citation_clicked', {...})
      pattern: "captureRagEventBrowser\\(['\"]rag_citation_clicked"
    - from: leanshot/src/components/dashboard/ai/CitationPopover.tsx
      to: leanshot/src/lib/rag/dompurify-config.ts
      via: sanitizeVerbatimQuote(quote) before dangerouslySetInnerHTML
      pattern: "sanitizeVerbatimQuote\\("
    - from: leanshot/src/components/dashboard/ai/AIChatPanel.tsx
      to: leanshot/src/components/dashboard/ai/RefusalCard.tsx
      via: refusal sentinel `[[REFUSAL:<kind>]]` first-line detection in Bubble
      pattern: "\\[\\[REFUSAL:"
---

<objective>
Ship the **user-facing payoff** of Phase 60 Wave 2: every AI-coach answer that came back with `[chunk_id]` markers from 60-06 `rag-retrieve` now renders **inline numeric citations**, an **expandable popover with verbatim-quoted evidence** (sanitized + tier-badged + freshness-stamped + canonical-URL-linked), a **collapsible Sources footer**, and **distinct refusal UX** for G1 PHARMA-02 / G3-G4 out-of-corpus / G5 citation-validation-failed paths. This is the visible counterpart to the server-side citation contract — the load-bearing UI control against citation fraud (UI-SPEC §3 invariant 1).

**Reuse-verbatim targets** (per `[[feedback_planner_prompt_explicit_reuse_targets]]`): Phase 50-08 Tasks 1-4 (citation marker, popover, remark plugin, AIChatPanel augment). The Phase 60 plan ports those file-by-file with Phase 60 schema:
- Move from `[^cid:UUID]^` markdown sentinel (50-08) → plain `[<uuid>]` token (60-06 synthesis output per AI-SPEC §4).
- Add **verbatim_quote display** (50-08 omitted; AI-SPEC §4 G5 makes it load-bearing).
- Add **refusal UX surface** (50-08 was MVP-only; UI-SPEC §5 mandates).
- Add **ES locale parity** (50-08 was EN-only; Phase 58 i18n is live now).
- Move file paths from `src/lib/i18n/rag-strings.ts` → `public/locales/{en,es}/rag.json` (Phase 32 i18next HttpBackend convention).

Output: 5 lib files + 4 components + 1 augmented AIChatPanel + 2 locale files + 7 unit suites + 1 Playwright E2E.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-CONTEXT.md
@.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-AI-SPEC.md
@.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md
@.planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-08-PLAN.md

@leanshot/src/components/dashboard/ai/AIChatPanel.tsx
@leanshot/src/components/admin/rag/TierBadge.tsx
@leanshot/src/lib/community/dompurify-config.ts
@leanshot/src/lib/i18n/init.ts
@leanshot/public/locales/en/patient.json

<interfaces>
<!-- Contracts the executor MUST use verbatim. Extracted directly from codebase + AI-SPEC §4. -->

From 60-AI-SPEC.md §4 (CitedAnswerSchema — server-side, mirrors here for browser shape parity):
```typescript
// browser-side mirror — keep field names IDENTICAL to AI-SPEC §4
export const CitationSchema = z.object({
  chunk_id: z.string().uuid(),
  verbatim_quote: z.string().min(1).max(500),
  char_offset_start: z.number().int().nonnegative(),
  char_offset_end: z.number().int().positive(),
});

export const RagChunkResultSchema = z.object({
  chunk_id: z.string().uuid(),
  source_name: z.string(),            // human-readable, e.g. "FDA Ozempic Label"
  source_type: z.enum(['fda_label','peer_reviewed','clinical_guideline','leanshot_curated','leanshot_research','community']),
  source_tier: z.enum(['A','B','C']),
  canonical_url: z.string().url(),
  topic_tag: z.string(),
  summary: z.string(),
  verbatim_quote: z.string(),         // server returns full quote; popover truncates at 280 for display
  scraped_at: z.string(),             // ISO-8601
  last_reviewed_at: z.string().nullable(), // ISO-8601 or null
  stale: z.boolean(),                 // computed server-side: >2yr since last_reviewed
  public_visibility: z.boolean(),
});
export type RagChunkResult = z.infer<typeof RagChunkResultSchema>;
```

From Phase 32 i18n init pattern (existing convention):
```typescript
// public/locales/{en,es}/<namespace>.json files are auto-loaded by i18next-http-backend
// Components use: const { t } = useTranslation('rag');
// then: t('rag.disclaimer') OR t('attribution', { source_name, date, tier })
```

From src/components/dashboard/ai/AIChatPanel.tsx (existing Bubble — line 294-324):
```typescript
function Bubble({ role, content, hasRef }: {
  role: 'user' | 'assistant';
  content: string;
  hasRef?: boolean;
}) {
  // EXISTING render path — AUGMENT, do NOT replace.
  // Add: if (role==='assistant') { detect refusal sentinel OR parse citations } else render existing whitespace-pre-wrap
}
```

From src/components/admin/rag/TierBadge.tsx (REUSE verbatim — already in codebase):
- Props: `{ tier: 'A'|'B'|'C'; size?: 'sm'|'md' }`. Returns `<Badge>` with neutral palette per UI-SPEC §3 medical-safety rule (no traffic-light coloring).

From src/lib/community/dompurify-config.ts (FORK pattern — do NOT import directly; new RAG config is stricter):
- The community config allows `h2 h3 h4 p strong em b i ul ol li a code pre blockquote br` for post bodies.
- RAG verbatim_quote config is STRICTER: only `strong em b i br` (quote text only — no anchors, no lists, no headings).

From supabase.functions.invoke pattern (existing src/lib/ai.ts):
```typescript
import { supabase } from '@/lib/supabase';
const { data, error } = await supabase.functions.invoke('rag-retrieve', {
  body: { mode: 'lookup', chunk_id: '<uuid>' },
});
// Authenticated automatically via the existing session JWT.
```

From AI-SPEC §6 G5 refusal envelope (sentinel pattern — synthesis Fn emits in SSE):
- Phase 60-06 synthesis Fn (NOT in this plan's scope) emits refusals as the FIRST line of the assistant message:
  - `[[REFUSAL:pharma_02]]` (then optionally newline + reason text for telemetry)
  - `[[REFUSAL:out_of_corpus]]`
  - `[[REFUSAL:citation_validation_failed]]`
- AIChatPanel Bubble component detects this sentinel BEFORE running renderWithCitations and renders RefusalCard instead.
- If 60-06 contract changes the sentinel format, this plan's RefusalCard detection regex MUST be updated synchronously — flag in iter-1 plan-check.

</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: rag i18n namespace + locale files (EN + ES)</name>
  <files>leanshot/public/locales/en/rag.json, leanshot/public/locales/es/rag.json, leanshot/src/lib/rag/i18n.ts, leanshot/src/lib/rag/__tests__/i18n.test.ts</files>
  <read_first>leanshot/public/locales/en/patient.json (existing namespace format reference), leanshot/src/lib/i18n/init.ts (HttpBackend file-load pattern), .planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md §Copywriting Contract</read_first>
  <behavior>
    - Test 1: `RAG_I18N_KEYS` (exported const string[] from `src/lib/rag/i18n.ts`) lists EVERY key the UI references; iterating finds each in both `en/rag.json` and `es/rag.json` (no missing keys, no orphan keys).
    - Test 2: `rag.refusal.pharma_02` EN value is EXACTLY `"That topic requires clinician guidance — please ask your doctor."` (UI-SPEC invariant 3 — locked from Phase 39 39-02 D-06; failing this fails the 3-layer invariant).
    - Test 3: `rag.disclaimer` EN value is EXACTLY `"Not medical advice — consult your clinician."` (UI-SPEC §3).
    - Test 4: `rag.attribution` is an ICU-format string accepting `{source_name}`, `{date}`, `{tier}` params; rendered via i18next `t('rag.attribution', { source_name, date, tier })` interpolates correctly.
    - Test 5: ES file has the same key set as EN (structural parity; values may differ).
    - Test 6: `useRagTranslation()` hook returns the same shape as `useTranslation('rag')` from `react-i18next` (thin wrapper that pins the namespace).
  </behavior>
  <action>
    Create `public/locales/en/rag.json` and `public/locales/es/rag.json` with the full key set listed under must_haves.truths (i18n keys bullet). Values per UI-SPEC §Copywriting Contract:
    - `disclaimer`: "Not medical advice — consult your clinician." (EN); Spanish translation in ES (mirror at MVP — verbatim acceptable per CONTEXT.md ES-newsletter-deferred-but-UI-strings-live convention).
    - `attribution`: ICU "{{source_name}} · As of {{date}} · Tier {{tier}}" (i18next double-brace interpolation, NOT single-brace).
    - `popover.open_source`: "Open source ↗".
    - `popover.read_full_chunk`: "Read full chunk".
    - `popover.may_be_outdated`: "May be outdated".
    - `popover.last_reviewed`: "Last reviewed {{date}}".
    - `popover.close_aria`: "Close citation".
    - `popover.leanshot_research_disclosure`: "LeanShot Research (k≥5 cohort, DP-ε noise applied)".
    - `sources_footer.label`: "Sources ({{count}})".
    - `sources_footer.aria`: "Sources section — {{count}} citations".
    - `citation_marker.aria`: "Open citation {{n}}".
    - `refusal.out_of_corpus`: "I don't have evidence for that in our knowledge base. Please consult your clinician or ask about a related topic I do have information on." (UI-SPEC §5).
    - `refusal.pharma_02`: "That topic requires clinician guidance — please ask your doctor." (UI-SPEC invariant 3 — DO NOT modify; copy is locked by Phase 39 39-02 D-06 3-layer invariant).
    - `refusal.citation_validation_failed`: "I'm not confident in the supporting evidence — please rephrase your question." (UI-SPEC §5).
    - `tier.A.label`: "Tier A". `tier.B.label`: "Tier B". `tier.C.label`: "Tier C".
    - `tier.A.aria`: "Tier A source (highest trust — FDA label or NLM)". (per UI-SPEC §3 tier definitions). Similar for B / C.

    Create `src/lib/rag/i18n.ts`:
    - Export `useRagTranslation()` — thin wrapper around `useTranslation('rag')` from react-i18next so consumers don't type the namespace literal repeatedly.
    - Export `RAG_I18N_KEYS: readonly string[]` listing every key (used by Task 1's exhaustiveness test).
    - Export `RAG_REFUSAL_KIND_TO_KEY: Record<'pharma_02'|'out_of_corpus'|'citation_validation_failed', string>` mapping refusal sentinel kinds to i18n keys (consumed by RefusalCard).

    Write `src/lib/rag/__tests__/i18n.test.ts` covering all 6 tests above. Load locale JSON via `fs.readFileSync` in the test (vitest runs in Node — JSON.parse the file).

    Per `[[feedback_planner_silent_scope_reduction_patterns]]`: the locale JSON keys list is the source of truth for "what UI ships"; if any component file later references a key not in the JSON, it's a planner-failure signal. CI catches missing keys via the existing Phase 32 `installMissingKeyHandler`.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npx vitest run src/lib/rag/__tests__/i18n.test.ts --config vite.config.ts</automated>
  </verify>
  <done>EN + ES rag namespaces exist with every UI-SPEC §Copywriting key; PHARMA-02 + disclaimer values are byte-exact; `useRagTranslation()` resolves correctly under Phase 32 i18next init.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: retrieve-client.ts + server-rag-events-relay browser wrapper</name>
  <files>leanshot/src/lib/rag/retrieve-client.ts, leanshot/src/lib/rag/server-rag-events-relay.ts, leanshot/src/lib/rag/__tests__/retrieve-client.test.ts</files>
  <read_first>.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-AI-SPEC.md §4 (CitedAnswerSchema + RagChunkResult shape), leanshot/src/lib/ai.ts (existing supabase.functions.invoke pattern), .planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-PLAN-OUTLINE.md row 60-02 (server-rag-event-relay Fn it depends on)</read_first>
  <behavior>
    - Test 1: `ragChunkById(uuid)` calls `supabase.functions.invoke('rag-retrieve', { body: { mode: 'lookup', chunk_id: uuid } })` and zod-parses the result via `RagChunkResultSchema`.
    - Test 2: When the Edge Fn returns 404 (chunk soft-deleted or retracted), `ragChunkById` resolves to `null` (not throws — popover renders an error state).
    - Test 3: When zod-parse fails (schema drift between server + client), `ragChunkById` resolves to `null` AND fires `captureRagEventBrowser('rag_chunk_schema_violation', { chunk_id })` for observability.
    - Test 4: `ragRetrieve({ query, k, filters })` calls `supabase.functions.invoke('rag-retrieve', { body: { mode: 'query', query, k, filters }})` and validates response.results: RagChunkResult[].
    - Test 5: `captureRagEventBrowser(event, properties)` POSTs to `/functions/v1/server-rag-event-relay` via `supabase.functions.invoke('server-rag-event-relay', { body: { event, properties }})`; returns a promise that resolves on send OR on a 5s timeout (fire-and-forget; never blocks UI).
    - Test 6: Network error from invoke is caught and logged via `console.warn`; does NOT throw to caller (per AI-SPEC §6 — telemetry MUST NOT block UX).
  </behavior>
  <action>
    Create `src/lib/rag/retrieve-client.ts`:
    - Export `RagChunkResultSchema` (zod) matching the AI-SPEC §4 RagChunkResult shape from the `<interfaces>` block above.
    - Export `type RagChunkResult = z.infer<typeof RagChunkResultSchema>`.
    - Export `async function ragChunkById(chunkId: string): Promise<RagChunkResult | null>` — invoke `rag-retrieve` in `lookup` mode; if 404 OR parse fails return null + telemetry; otherwise return validated result.
    - Export `async function ragRetrieve(args: { query: string; k?: number; filters?: { topic_tag?: string; source_tier?: ('A'|'B'|'C')[] }}): Promise<{ results: RagChunkResult[]; count: number }>`.
    - Per `[[feedback_planner_silent_scope_reduction_patterns]]`: do NOT add a "stub" or "v1 returns mock data" path — Wave 2 dispatch presumes 60-06 is live OR mocked in tests. If 60-06 is unavailable in dev, the popover renders the in-flight skeleton then the error state — never silent-pass with fake data.

    Create `src/lib/rag/server-rag-events-relay.ts`:
    - Export `async function captureRagEventBrowser(event: 'rag_citation_clicked' | 'rag_chunk_schema_violation' | 'rag_sources_footer_expanded', properties: Record<string, unknown>): Promise<void>` — uses `supabase.functions.invoke('server-rag-event-relay', { body: { event, properties } })`; catches all errors; 5s `AbortSignal.timeout(5000)` cap.
    - Event-name allowlist enforced at the TypeScript layer (literal-union arg) so misspellings fail at compile-time (per AI-SPEC §6 D-08 telemetry-event-naming-discipline).

    Write `__tests__/retrieve-client.test.ts` covering all 6 tests. Mock `supabase.functions.invoke` via vi.mock on `@/lib/supabase`.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npx vitest run src/lib/rag/__tests__/retrieve-client.test.ts --config vite.config.ts && npx tsc -p tsconfig.app.json --noEmit</automated>
  </verify>
  <done>retrieve-client.ts + server-rag-events-relay.ts compile, zod-validate responses, fire fire-and-forget telemetry. No mock fallback hidden in production code path.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: dompurify-config.ts (RAG-strict) + remark-citations.ts (UUID parser)</name>
  <files>leanshot/src/lib/rag/dompurify-config.ts, leanshot/src/lib/rag/remark-citations.ts, leanshot/src/lib/rag/__tests__/dompurify-config.test.ts, leanshot/src/lib/rag/__tests__/remark-citations.test.ts</files>
  <read_first>leanshot/src/lib/community/dompurify-config.ts (FORK pattern — but stricter allowlist), .planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md §3 invariant 1 + 10 + dompurify rules, .planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-AI-SPEC.md §4 CitationSchema</read_first>
  <behavior>
    DOMPurify config tests:
    - Test 1: `sanitizeVerbatimQuote('<script>alert(1)</script>')` returns empty string OR text-only with no script tag (T-60-XSS-1 mitigation).
    - Test 2: `sanitizeVerbatimQuote('<a href="javascript:alert(1)">x</a>')` strips href OR strips the entire anchor (RAG quotes do not need anchors — config FORBIDS `a` tag entirely).
    - Test 3: `sanitizeVerbatimQuote('<img src=x onerror=alert(1)>')` strips img completely (no inline images in verbatim quotes).
    - Test 4: `sanitizeVerbatimQuote('<strong>Bold</strong> <em>italic</em>')` preserves `<strong>` and `<em>` (allowlist members).
    - Test 5: `sanitizeVerbatimQuote('<iframe src="evil.com"></iframe>')` strips iframe.
    - Test 6: `sanitizeVerbatimQuote('<p>hello</p>')` strips `<p>` tag but preserves `hello` text (no block tags in quote display).

    remark-citations tests:
    - Test 7: `parseCitations("Tirzepatide is dosed weekly [a1b2c3d4-e5f6-7890-abcd-ef0123456789] starting at 2.5mg.")` returns `{ segments: [text, marker, text], citations: [{ chunkId: 'a1b2...', refIndex: 1 }] }`.
    - Test 8: Multiple distinct UUIDs in one message → numeric refIndex assigned in order of first appearance (1, 2, 3...).
    - Test 9: Repeated UUID → same refIndex on subsequent occurrences (e.g., `[uuid-A] foo [uuid-A]` → both markers refIndex=1).
    - Test 10: Non-UUID `[text]` tokens (e.g., `[1]` literal, `[citation needed]`) are NOT parsed as citations (left as plain text).
    - Test 11: `parseCitations` is pure — no React imports; returns plain data structures.
    - Test 12: Edge: input with zero citations returns `{ segments: [{type:'text', text: input}], citations: [] }`.
  </behavior>
  <action>
    Create `src/lib/rag/dompurify-config.ts`, FORKED from `src/lib/community/dompurify-config.ts` (read the original to mirror the hook-registration discipline) but with a STRICTER allowlist:
    ```
    const RAG_VERBATIM_ALLOWED_TAGS = ['strong', 'em', 'b', 'i', 'br'];
    const RAG_VERBATIM_FORBID_TAGS = ['a', 'img', 'iframe', 'script', 'style', 'object', 'embed', 'base', 'form', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote'];
    ```
    Export `sanitizeVerbatimQuote(html: string): string` calling `DOMPurify.sanitize(html, { ALLOWED_TAGS: RAG_VERBATIM_ALLOWED_TAGS, FORBID_TAGS: RAG_VERBATIM_FORBID_TAGS, ALLOWED_ATTR: [] })`.

    Create `src/lib/rag/remark-citations.ts`:
    - The "remark plugin" framing in the outline is somewhat inherited from 50-08; we do NOT need a full remark AST plugin since the AIChatPanel renders plain text (not markdown). Implement as a pure parser instead, named `parseCitations(text: string): ParseResult` returning the structure in test 7.
    - UUID regex: `/\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi` (case-insensitive, matches AI-SPEC §4 `z.string().uuid()`).
    - Export `type ParseResult = { segments: Array<{type:'text'; text: string} | {type:'citation'; chunkId: string; refIndex: number}>; citations: Array<{chunkId: string; refIndex: number}> }`.
    - Order-preserving assignment: first-occurrence chunkId gets refIndex=1, second distinct chunkId gets refIndex=2, etc. Subsequent repeats reuse the existing index.

    Write both test files covering all 12 tests above.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npx vitest run src/lib/rag/__tests__/dompurify-config.test.ts src/lib/rag/__tests__/remark-citations.test.ts --config vite.config.ts</automated>
  </verify>
  <done>XSS-stripping verified across 6 attack vectors; UUID-citation parser handles repeat + non-UUID + zero-citation edge cases; both modules are React-free pure functions.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: CitationMarker.tsx + CitationPopover.tsx components</name>
  <files>leanshot/src/components/dashboard/ai/CitationMarker.tsx, leanshot/src/components/dashboard/ai/CitationPopover.tsx, leanshot/src/components/dashboard/ai/__tests__/CitationMarker.test.tsx, leanshot/src/components/dashboard/ai/__tests__/CitationPopover.test.tsx</files>
  <read_first>.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md §4 (Surface 4 popover contract verbatim), leanshot/src/components/admin/rag/TierBadge.tsx (REUSE — props {tier, size}), leanshot/src/components/ui/Badge.tsx, leanshot/src/components/ui/Sheet.tsx (bottom Sheet for <md), leanshot/src/lib/rag/retrieve-client.ts (ragChunkById), leanshot/src/lib/rag/dompurify-config.ts (sanitizeVerbatimQuote), leanshot/src/lib/rag/server-rag-events-relay.ts (captureRagEventBrowser), leanshot/src/lib/rag/i18n.ts</read_first>
  <behavior>
    CitationMarker tests:
    - Test 1: Renders `<button>` with `aria-label="Open citation 3"` when `refIndex=3` (i18n-keyed).
    - Test 2: Renders text content `[3]` (the bracketed number).
    - Test 3: Click → invokes `onActivate(chunkId, anchorEl)` callback.
    - Test 4: Visible badge is ≤14px; hitbox padding p-[5px] makes effective tap area ≥24px (UI-SPEC §3 invariant 10 exception). Assert via `getBoundingClientRect()` height ≥24.

    CitationPopover tests:
    - Test 5: On mount, calls `ragChunkById(chunkId)`; renders skeleton during fetch.
    - Test 6: On success, renders: source title (linked to canonical_url with target=_blank rel=noopener noreferrer), TierBadge with correct tier, verbatim_quote (DOMPurify-sanitized via sanitizeVerbatimQuote), `As of {scraped_at}` mono freshness strip.
    - Test 7: When `stale === true`, renders `May be outdated` warning Pill.
    - Test 8: When `source_type === 'leanshot_research'`, renders the disclosure line `LeanShot Research (k≥5 cohort, DP-ε noise applied)`.
    - Test 9: When verbatim_quote.length > 280, displays truncated quote + ellipsis + `Read full chunk` link to canonical_url.
    - Test 10: Has `role="dialog"` + `aria-modal="true"`.
    - Test 11: Pressing `ESC` calls `onClose`.
    - Test 12: Focus trap — Tab cycles within popover; Shift+Tab cycles backward.
    - Test 13: On unmount, focus returns to the marker element passed via `anchorEl`.
    - Test 14: When `siblings: string[]` prop is provided, `←` / `→` keys cycle through sibling chunkIds (calls onClose then opens next).
    - Test 15: On mount, fires `captureRagEventBrowser('rag_citation_clicked', { chunk_id, source_tier, source_type, topic_tag, surface: 'coach' })`.
    - Test 16: When ragChunkById returns null (chunk soft-deleted), popover renders an error state `Couldn't load source details. Try again.` (UI-SPEC §Error States) — does NOT crash.
    - Test 17: On <md viewport (window.matchMedia mocked), renders inside a bottom `<Sheet>` instead of floating Popover (UI-SPEC §4 mobile contract).
  </behavior>
  <action>
    Create `src/components/dashboard/ai/CitationMarker.tsx`:
    - Props: `{ refIndex: number; chunkId: string; onActivate: (chunkId: string, anchorEl: HTMLElement) => void }`.
    - Renders a `<button>` (use existing `<Badge tone="info" as="button">` if Badge supports `as="button"`; otherwise wrap a bare button with Badge-equivalent classes from `src/components/ui/Badge.tsx`).
    - Visible badge: rounded-full, `h-[14px] w-[14px]`, `text-micro` (11px) font-semibold, teal-700 text on `bg-primary-soft` background.
    - Padding `p-[5px]` to expand tap target to ≥24px (UI-SPEC §3 invariant 10 — explicit exception to 4-scale).
    - `aria-label={t('citation_marker.aria', { n: refIndex })}`.
    - On click: `onActivate(chunkId, e.currentTarget)`.

    Create `src/components/dashboard/ai/CitationPopover.tsx`:
    - Props: `{ chunkId: string; anchorEl: HTMLElement | null; siblings?: string[]; onClose: () => void }`.
    - On mount: `ragChunkById(chunkId)` → setState (loading | loaded | error). Fire `captureRagEventBrowser('rag_citation_clicked', {...})` AFTER successful load.
    - Use `window.matchMedia('(min-width: 768px)')` to pick floating Popover (≥md) vs bottom Sheet (<md). Wrap branch in `useReducedMotion`-aware animation per UI-SPEC §Animation Contract.
    - Floating Popover: position via `anchorEl.getBoundingClientRect()` — top-right of the marker by default; flip to top-left if it would overflow viewport. Width 320px max.
    - Render structure per UI-SPEC §4 Surface 4 (desktop):
      - Header: source title `<a href={canonical_url} target="_blank" rel="noopener noreferrer">{source_name}</a>` (text-lg/600) + TierBadge inline-right.
      - Verbatim quote block: `<div className="text-sm border-l-2 border-primary bg-surface-soft px-3 py-2" dangerouslySetInnerHTML={{ __html: sanitizeVerbatimQuote(displayedQuote) }} />`. Truncate at 280 chars + ellipsis + `Read full chunk` link (i18n key `popover.read_full_chunk`).
      - Freshness strip: `<span className="font-mono text-micro">{t('popover.last_reviewed', { date: scraped_at_yyyy_mm_dd })}</span>` + if `stale`, append warning Pill `{t('popover.may_be_outdated')}`.
      - leanshot_research disclosure line (when source_type matches): `text-micro text-text-tertiary` line via `t('popover.leanshot_research_disclosure')`.
      - `Open source ↗` ghost Button (text-sm accent) opening `canonical_url` in new tab.
      - Disclaimer line: `text-micro text-text-tertiary` via `t('disclaimer')`.
    - a11y: `role="dialog"`, `aria-modal="true"`, focus-trap via existing utility (or roll inline: capture initial focus, restore on close, redirect Tab cycles). Use `aria-labelledby` pointing to a hidden source-name element.
    - Keyboard: ESC → `onClose()`. When `siblings` provided, `←` and `→` invoke `onClose()` and notify parent to open next chunk (parent passes `onCycle?: (nextChunkId: string) => void` — extension prop; for this plan, surface only the keydown handler, parent wires).
    - Error state: when fetch resolves null, render the error copy from UI-SPEC §Error States.

    Write `__tests__/CitationMarker.test.tsx` + `__tests__/CitationPopover.test.tsx` covering all 17 tests. Mock retrieve-client via vi.mock; mock server-rag-events-relay; mock i18next via existing test util OR thin in-file mock.

    Per `[[feedback_3_layer_must_never_invariant_pattern]]`: the popover sanitization (Layer 1 UI) complements server-side validateCitations (Layer 2 runtime helper from 60-06) + CI grep (Layer 3 — Phase 60-03 eval-harness G5 suite). Do NOT skip sanitization on the theory that "server validates verbatim_quote is a substring of source text" — if the source itself contains HTML, that HTML is still XSS surface area until sanitized.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npx vitest run src/components/dashboard/ai/__tests__/CitationMarker.test.tsx src/components/dashboard/ai/__tests__/CitationPopover.test.tsx --config vite.config.ts && npx tsc -p tsconfig.app.json --noEmit</automated>
  </verify>
  <done>Both components compile + pass 17 unit tests; XSS sanitization confirmed; a11y dialog/focus-trap/ESC verified; ragChunkById null path renders error state without crash.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 5: SourcesFooter.tsx + RefusalCard.tsx</name>
  <files>leanshot/src/components/dashboard/ai/SourcesFooter.tsx, leanshot/src/components/dashboard/ai/RefusalCard.tsx, leanshot/src/components/dashboard/ai/__tests__/SourcesFooter.test.tsx, leanshot/src/components/dashboard/ai/__tests__/RefusalCard.test.tsx</files>
  <read_first>.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md §4 (Sources footer) + §5 (Refusal UX) + invariants 2/3, leanshot/src/components/ui/Card.tsx, leanshot/src/components/admin/rag/TierBadge.tsx</read_first>
  <behavior>
    SourcesFooter tests:
    - Test 1: Default state — collapsed; renders `Sources (3)` label + ChevronDown icon; `aria-expanded="false"`.
    - Test 2: Click chevron → expanded; renders ChevronUp; `aria-expanded="true"`.
    - Test 3: When expanded, list contains one row per citation: numbered [N] + source_name + TierBadge + truncated canonical_url.
    - Test 4: Expanding region has `aria-live="polite"` so screen readers narrate (UI-SPEC §4 auto-expand-under-SR rule).
    - Test 5: On expansion, fires `captureRagEventBrowser('rag_sources_footer_expanded', { count })` once per expansion.
    - Test 6: When citations array is empty, returns null (does not render an empty footer).

    RefusalCard tests:
    - Test 7: `<RefusalCard kind="pharma_02" />` renders the EXACT locked string `That topic requires clinician guidance — please ask your doctor.` (UI-SPEC invariant 3). Failing this test is the UI-layer breach of the 3-layer PHARMA-02 invariant.
    - Test 8: `<RefusalCard kind="out_of_corpus" />` renders the out-of-corpus copy from UI-SPEC §5 with `Info` icon (UI-SPEC §5 visual distinction).
    - Test 9: `<RefusalCard kind="citation_validation_failed" />` renders G5 copy + `AlertCircle` icon.
    - Test 10: `<RefusalCard kind="pharma_02" />` uses `AlertTriangle` icon AND does NOT render the disclaimer line (UI-SPEC §5 — "the refusal IS the safety intervention").
    - Test 11: NO `[N]` markers anywhere in any RefusalCard render output (UI-SPEC invariant 2). Assert via `screen.queryByText(/\[\d+\]/)` returns null.
    - Test 12: NO `Sources (N)` footer anywhere (UI-SPEC invariant 2). Assert via `screen.queryByText(/Sources \(\d+\)/)` returns null.
  </behavior>
  <action>
    Create `src/components/dashboard/ai/SourcesFooter.tsx`:
    - Props: `{ citations: Array<{ chunkId: string; refIndex: number; sourceName: string; sourceTier: 'A'|'B'|'C'; canonicalUrl: string }> }`.
    - useState `expanded: false` default.
    - On expand toggle, call `captureRagEventBrowser('rag_sources_footer_expanded', { count: citations.length })` ONLY on the false→true transition.
    - Render `<button aria-expanded={expanded}>` with `Sources ({citations.length})` + ChevronDown/Up.
    - When expanded, render `<ul aria-live="polite">` with each citation row.
    - URL truncation: show last path segment + ellipsis if >32 chars.

    Create `src/components/dashboard/ai/RefusalCard.tsx`:
    - Props: `{ kind: 'pharma_02' | 'out_of_corpus' | 'citation_validation_failed' }`.
    - Pull copy via `t(RAG_REFUSAL_KIND_TO_KEY[kind])` from `i18n.ts`.
    - Icon mapping: `pharma_02` → `AlertTriangle` (lucide), `out_of_corpus` → `Info`, `citation_validation_failed` → `AlertCircle`.
    - Render as `<Card variant="flat">` with icon left-accent + body text-sm.
    - When kind !== `pharma_02`, append disclaimer line (UI-SPEC §5 — "for out-of-corpus only").
    - CRITICAL: render NO citation markers + NO sources footer (UI-SPEC invariant 2). Tests 11+12 enforce this structurally.

    Write both unit test files (7+12 = 12 tests total — keep numbering distinct).
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npx vitest run src/components/dashboard/ai/__tests__/SourcesFooter.test.tsx src/components/dashboard/ai/__tests__/RefusalCard.test.tsx --config vite.config.ts</automated>
  </verify>
  <done>SourcesFooter collapses/expands with telemetry on first expansion; RefusalCard renders locked PHARMA-02 copy + zero-markers + zero-footer invariants verified.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 6: Augment AIChatPanel.tsx additively (preserve AI-04 fence + regression-safe)</name>
  <files>leanshot/src/components/dashboard/ai/AIChatPanel.tsx, leanshot/src/components/dashboard/ai/__tests__/AIChatPanel.test.tsx</files>
  <read_first>leanshot/src/components/dashboard/ai/AIChatPanel.tsx (existing 347-line file — augment, do NOT rewrite), .planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-AI-SPEC.md §6 G2 (AI-04 fence invariant), .planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md §5 refusal envelope + invariants 1+2+3</read_first>
  <behavior>
    - Test 1: Existing messages WITHOUT citation markers and WITHOUT refusal sentinel render via the existing Bubble path unchanged (regression-safe — assert text appears verbatim, no extra DOM nodes vs baseline snapshot).
    - Test 2: Assistant message containing `[a1b2c3d4-e5f6-7890-abcd-ef0123456789] Tirzepatide is dosed weekly.` renders the marker as `[1]` superscript followed by the text "Tirzepatide is dosed weekly." plus a Sources footer with 1 entry.
    - Test 3: Clicking the [1] marker opens CitationPopover with that chunkId.
    - Test 4: Assistant message starting with `[[REFUSAL:pharma_02]]` (sentinel from 60-06) renders RefusalCard kind=pharma_02 — NOT a Bubble with citation rendering. Assert: NO [1] markers, NO Sources footer, exact PHARMA-02 copy.
    - Test 5: Assistant message starting with `[[REFUSAL:out_of_corpus]]` renders RefusalCard kind=out_of_corpus.
    - Test 6: Assistant message starting with `[[REFUSAL:citation_validation_failed]]` renders RefusalCard kind=citation_validation_failed.
    - Test 7: The existing `ctx` string composition (line 90 of AIChatPanel.tsx) is UNCHANGED — `callAIChat({ userContext: ctx })` still passes the same fenced-in-Edge-Fn payload (AI-SPEC §6 G2 AI-04 invariant). Assert via spy on callAIChat that the userContext arg matches the baseline format string structure.
    - Test 8: User messages (role='user') render via the existing right-aligned Bubble path unchanged — citation rendering applies ONLY to role='assistant'.
    - Test 9: When the same UUID appears 3 times in one assistant message, only ONE Sources footer entry is rendered (deduplication via remark-citations refIndex reuse).
  </behavior>
  <action>
    Surgical edit of `src/components/dashboard/ai/AIChatPanel.tsx`:

    1. **Imports — add only:**
       ```typescript
       import { CitationMarker } from './CitationMarker';
       import { CitationPopover } from './CitationPopover';
       import { SourcesFooter } from './SourcesFooter';
       import { RefusalCard } from './RefusalCard';
       import { parseCitations } from '@/lib/rag/remark-citations';
       ```

    2. **Augment `Bubble`** (currently lines 294-324):
       - For `role === 'assistant'`, BEFORE rendering existing whitespace-pre-wrap content, detect refusal sentinel via regex `^\[\[REFUSAL:(pharma_02|out_of_corpus|citation_validation_failed)\]\]`. If matched, return `<RefusalCard kind={kind} />` instead of the Bubble — skip the entire existing Bubble div.
       - Else, run `parseCitations(content)` and render: interleave plain-text segments with `<CitationMarker refIndex={s.refIndex} chunkId={s.chunkId} onActivate={openPopover} />` per segment. After the bubble, append `<SourcesFooter citations={...} />` when citations.length > 0.
       - For `role === 'user'`, leave the existing Bubble code path untouched.

    3. **Add popover state to `AIChatPanel`:**
       ```typescript
       const [popoverState, setPopoverState] = useState<{ chunkId: string; anchorEl: HTMLElement; siblings: string[] } | null>(null);
       ```
       Pass `openPopover` callback into `Bubble` via prop (extend Bubble props with `onCitationClick?: (chunkId: string, anchorEl: HTMLElement, siblings: string[]) => void`).

    4. **Mount the popover at panel root** (just before the closing `</motion.div>` of the inner panel), conditionally:
       ```tsx
       {popoverState && (
         <CitationPopover
           chunkId={popoverState.chunkId}
           anchorEl={popoverState.anchorEl}
           siblings={popoverState.siblings}
           onClose={() => setPopoverState(null)}
         />
       )}
       ```

    5. **DO NOT TOUCH:**
       - Line 82-90: `ctx` string composition (AI-04 fence — preserve byte-for-byte; line 90's `User context: Name:...` template stays exactly as is).
       - Lines 101-144: `send()` function and its `callAIChat({ userContext: ctx, ... })` invocation.
       - The `TierGate` model selector block (lines 181-191) — Phase 14 wiring TODO is out of scope.
       - The `KEYWORDS_FOR_DATA_REF` array and `detectDataRef` function (unrelated Phase 7 personalization badge).

    6. **The `hasRef` "Personalized" badge** (line 314-318): leave intact. It is independent of citation rendering — both can coexist (a personalized answer can also have citations).

    Per `[[feedback_planner_silent_scope_reduction_patterns]]`: no "static citations for v1" path. The marker rendering is wired to the actual parseCitations parser from Task 3; if 60-06 doesn't emit markers yet at test time, the assistant text simply has none → renders unchanged (regression test 1 covers this). Wave-2 dispatch presumes 60-06 (Wave 1) is live OR test-mocked.

    Write `__tests__/AIChatPanel.test.tsx` covering all 9 tests above. Reuse existing test helpers from the leanshot test setup (Zustand `useStore` reset between tests; mock `callAIChat` from `@/lib/ai`). Snapshot baseline used for regression-safety test 1.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npx vitest run src/components/dashboard/ai/__tests__/AIChatPanel.test.tsx --config vite.config.ts && npx tsc -p tsconfig.app.json --noEmit && grep -n "User context: Name:" src/components/dashboard/ai/AIChatPanel.tsx</automated>
  </verify>
  <done>AIChatPanel augmented additively; ctx string composition byte-identical (grep gate confirms); 9 unit tests pass including regression baseline + AI-04 fence preservation + refusal-sentinel branching.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 7: Playwright E2E — citation render + popover + refusal distinct</name>
  <files>leanshot/tests/e2e/60-ai-coach-citation.spec.ts</files>
  <read_first>leanshot/playwright.config.ts, leanshot/tests/e2e/_helpers (existing helpers — likely `seedAuth`, `seedStore`), leanshot/src/components/dashboard/ai/AIChatPanel.tsx (test by interaction not implementation)</read_first>
  <behavior>
    - Test 1: Seed authenticated user + Zustand `aiHistory` containing an assistant message with text `Tirzepatide titration begins at 2.5mg weekly [a1b2c3d4-e5f6-7890-abcd-ef0123456789].` Open AIChatPanel via FAB / Topbar. Expect: visible `[1]` superscript marker + Sources footer collapsed showing `Sources (1)`.
    - Test 2: Click the `[1]` marker. Mock the rag-retrieve invoke via Playwright `route.fulfill` returning a valid RagChunkResult. Expect: CitationPopover renders with source title text, TierBadge, verbatim quote text, `As of` freshness, and `Open source ↗` link with correct href.
    - Test 3: Press Escape. Expect: popover closes, focus returns to the `[1]` marker.
    - Test 4: Seed assistant message starting with `[[REFUSAL:pharma_02]]`. Expect: RefusalCard renders with the EXACT locked copy `That topic requires clinician guidance — please ask your doctor.` AND no `[N]` element visible AND no `Sources (` text visible.
    - Test 5: Seed assistant message starting with `[[REFUSAL:out_of_corpus]]`. Expect: refusal copy + Info icon (data-testid or aria-label discriminator) — visually distinct from PHARMA-02 (different icon).
    - Test 6: a11y check — Popover has `role="dialog"` + `aria-modal="true"` (use `@axe-core/playwright` if available, else `getByRole('dialog')` assertion).
    - Test 7: Sanitization smoke — seed verbatim_quote containing `<img src=x onerror="window.__pwned__=true">`; open popover; assert `await page.evaluate(() => (window as any).__pwned__)` is undefined AND the popover renders without the img tag (T-60-XSS-1 verified end-to-end).
  </behavior>
  <action>
    Create `tests/e2e/60-ai-coach-citation.spec.ts`:
    - Use existing `tests/e2e/_helpers` patterns (find via `ls` first; reuse `seedAuth` / `seedStore` / `gotoDashboard`).
    - Mock `rag-retrieve` invoke via `page.route('**/functions/v1/rag-retrieve', route => route.fulfill({ status: 200, body: JSON.stringify({ ... }) }))`.
    - Mock `server-rag-event-relay` invoke to return 200 (telemetry must not block UI even if mocked away).
    - Gate the suite behind `PLAYWRIGHT_RUN_P60_COACH_CITATION=1` env var (per existing Phase 50-08 gate pattern) so it doesn't run in the default suite. Document this gate in the test file header comment.
    - For Test 7 XSS sanitization, seed the chunk's verbatim_quote with `<img src=x onerror="window.__pwned__=true">malignant<strong>bold</strong>` and assert (a) the popover DOM contains `<strong>bold</strong>` but NOT `<img`, (b) `window.__pwned__` is never set after a 500ms wait.
    - Use `expect(page.getByRole('dialog', { name: /source/i })).toBeVisible()` for popover assertion; key tests on aria-labels not implementation classes.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && PLAYWRIGHT_RUN_P60_COACH_CITATION=1 npx playwright test tests/e2e/60-ai-coach-citation.spec.ts</automated>
  </verify>
  <done>All 7 Playwright assertions pass under the gated env var; XSS smoke confirms no script execution end-to-end; ESC + focus-return interaction works against the real React render path.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Server → Browser (verbatim_quote payload) | RagChunkResult fields originate in admin-curated chunks; chunks may have been scraped from arbitrary external HTML. Untrusted content enters the browser DOM via `dangerouslySetInnerHTML` in CitationPopover. |
| Server → Browser (refusal sentinel) | The `[[REFUSAL:...]]` envelope is emitted by 60-06 synthesis Fn; AIChatPanel branches on its presence. A tampered/replayed assistant message string from the Zustand store could spoof a refusal. |
| Browser → Server (telemetry relay) | `server-rag-event-relay` accepts event + properties from any authenticated client; no validation of `chunk_id` provenance. |
| Inline citation marker → user input | A malicious `[<uuid>]` token authored by the user (typing into the chat) would NOT be parsed because remark-citations runs on `role='assistant'` content only. Verified by Test 8 of Task 6. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-60-10-XSS-1 | Tampering | `CitationPopover.tsx` verbatim_quote render | mitigate | `sanitizeVerbatimQuote()` from `src/lib/rag/dompurify-config.ts` (Task 3) with strict allowlist `[strong em b i br]` + FORBID `a img iframe script style object embed base form` and friends. Tested at unit (6 attack vectors, Task 3) + E2E smoke (img-onerror payload, Task 7). Layer 1 of 3-layer XSS defense; Layer 2 is server-side validateCitations (60-06); Layer 3 is CSP report-uri (Phase 67). |
| T-60-10-XSS-2 | Tampering | `CitationPopover.tsx` canonical_url anchor href | mitigate | DOMPurify config forbids `<a>` tag entirely INSIDE verbatim_quote (quote text only). The popover's `Open source ↗` anchor is rendered via React JSX `href={canonical_url}` — zod-validated as `.url()` at parse time (RagChunkResultSchema); also forces `target="_blank" rel="noopener noreferrer"`. Non-https URLs rejected at zod parse. |
| T-60-10-AI04-1 | Information Disclosure | `AIChatPanel.tsx` `ctx` composition (line 90) | mitigate | Task 6 grep gate `grep -n "User context: Name:"` confirms the exact AI-04 fence template is unchanged byte-for-byte. The augmentation only adds rendering paths AFTER `callAIChat` completes; the request payload pipeline is unmodified. AI-04 fence invariant (Phase 4 D-02 + AI-SPEC §6 G2) preserved. |
| T-60-10-FRAUD-1 | Spoofing | Citation marker rendering | mitigate | Markers parsed from assistant text are clickable buttons that fetch chunk metadata from the SERVER (`ragChunkById`) — they cannot fabricate evidence client-side. If a chunkId doesn't exist server-side, the popover renders the error state. Server-side validateCitations (60-06) is the load-bearing G5 enforcement; this plan is the UI-layer surface that EXPOSES the validated evidence to users (and never invents it). |
| T-60-10-FRAUD-2 | Spoofing | Refusal sentinel detection | mitigate | The `[[REFUSAL:<kind>]]` regex is anchored to the START of the assistant message (`^\[\[REFUSAL:`). User content (role='user') is never parsed for refusal sentinels (Task 6 Test 8). A tampered Zustand state can spoof a refusal in the LOCAL render only — there is no security boundary inside the user's own client; the threat is "user fools themselves" which is not in scope. Accept. |
| T-60-10-DOS-1 | Denial of Service | `captureRagEventBrowser` telemetry posts | mitigate | 5s AbortSignal.timeout on every invoke; all errors silenced; fire-and-forget pattern. A flood of marker clicks cannot stall the UI. Sources footer expansion event fires once per false→true transition (debounced by state). |
| T-60-10-PHARMA-02 | Information Disclosure | `RefusalCard.tsx` kind='pharma_02' copy | mitigate | i18n key `rag.refusal.pharma_02` value is BYTE-EXACT to Phase 39 39-02 D-06 locked string (Task 1 Test 2). Test 7 of Task 5 enforces at the component level. If copy diverges, the unit test fails CI — this is the UI-layer enforcement of the 3-layer invariant (Layer 1=ESLint AST, Layer 2=runtime helper in synthesis Fn, Layer 3=CI grep; Phase 60 60-10 adds a 4th UI-layer test for the *rendered* copy specifically). |
| T-60-10-TAP-1 | Spoofing (touch-target accessibility) | `CitationMarker.tsx` mobile tap hitbox | mitigate | UI-SPEC §3 invariant 10 requires ≥24px tap area despite ≤14px visible badge. Achieved via `p-[5px]` padding around an h-[14px] w-[14px] badge (5+14+5 = 24px). Task 4 Test 4 enforces via getBoundingClientRect ≥24. |
| T-60-10-SR-1 | Accessibility (information disclosure to assistive tech) | `SourcesFooter.tsx` collapsed-by-default | mitigate | UI-SPEC §4 mandates `aria-live="polite"` on the expanding region so screen readers narrate citations when navigating to the message. Task 5 Test 4 enforces. Also `aria-expanded` on the toggle button (Test 1+2). |
</threat_model>

<verification>
- All 7 vitest test files pass under `npx vitest run --config vite.config.ts` (per `[[reference_vitest_4_projects_config_masks_default]]`).
- `npx tsc -p tsconfig.app.json --noEmit` is clean (per `[[reference_supabase_v2_aal_api]]` — gate via `--noEmit`, never `tsc -b` alone).
- Playwright suite passes under `PLAYWRIGHT_RUN_P60_COACH_CITATION=1` (gated; does not run in default CI sweep).
- Grep gate confirms `ctx` composition unchanged: `grep -n "User context: Name:" leanshot/src/components/dashboard/ai/AIChatPanel.tsx` returns exactly 1 hit at the original line, AI-04 fence preserved.
- Grep gate confirms PHARMA-02 copy is exact in `public/locales/en/rag.json`: `grep -F 'That topic requires clinician guidance — please ask your doctor.' leanshot/public/locales/en/rag.json` returns exactly 1 hit.
- No new top-level dependencies added (DOMPurify, react-i18next, lucide-react, zod, framer-motion all pre-existing).
- Bundle delta: AIChatPanel + new ai/* components ≤ +6 kB gz vs pre-60-10 baseline (per Phase 50-08 verification convention).
- Manual smoke (operator runs locally): start dev server, seed an assistant message with a real UUID + valid chunk, open AIChatPanel — confirm marker renders + popover opens + ESC closes + refusal envelope shows distinct card.
</verification>

<success_criteria>
1. Assistant messages with inline `[<uuid>]` markers render numbered `[N]` superscripts + working CitationPopover + collapsible SourcesFooter.
2. The popover displays verbatim_quote (DOMPurify-sanitized), TierBadge, freshness strip, leanshot_research disclosure (when applicable), canonical_url link, and disclaimer — every UI-SPEC §4 element accounted for.
3. Refusal envelopes render via RefusalCard with kind-distinct iconography and ZERO citation markers / sources footer (UI-SPEC §5 + invariants 2+3 verified by unit + E2E).
4. AI-04 fence preserved byte-for-byte in `ctx` composition; existing AIChatPanel behavior regression-safe for non-citation, non-refusal messages.
5. XSS attack vectors (script / iframe / img-onerror / javascript: href) stripped at both unit (Task 3) and E2E (Task 7) layers.
6. PHARMA-02 refusal copy is byte-exact to Phase 39 39-02 D-06 locked string, enforced by Task 1 Test 2 + Task 5 Test 7 + Task 7 Test 4.
7. i18n EN + ES locale files have structural parity; no missing keys.
</success_criteria>

<output>
Create `.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-10-SUMMARY.md` when done, documenting:
- Files created vs augmented (with line-count deltas for AIChatPanel.tsx augmentation).
- Test counts per suite (unit + Playwright).
- Bundle delta measurement (AIChatPanel chunk gz before/after).
- Confirmation that AI-04 fence ctx template is unchanged (grep evidence).
- Confirmation that PHARMA-02 refusal copy is byte-exact (grep evidence).
- Any deviations from this PLAN.md (should be zero — flag if any).
</output>
