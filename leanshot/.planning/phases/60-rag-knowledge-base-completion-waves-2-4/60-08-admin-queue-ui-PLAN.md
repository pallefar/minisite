---
phase: 60-rag-knowledge-base-completion-waves-2-4
plan: 08
type: execute
wave: 1
depends_on: [60-01, 60-02]
files_modified:
  - src/components/admin/rag/RagQueuePage.tsx
  - src/components/admin/rag/QueueDetailPane.tsx
  - src/components/admin/rag/RejectReasonSheet.tsx
  - src/components/admin/rag/EditChunkModal.tsx
  - src/components/admin/rag/RetractChunkModal.tsx
  - src/components/admin/rag/QueueKeyboardHelpModal.tsx
  - src/components/admin/rag/RagLayout.tsx
  - src/lib/admin/rag/chunk-api.ts
  - src/lib/admin/rag/__tests__/chunk-api.test.ts
  - src/components/admin/rag/__tests__/RagQueuePage.test.tsx
  - src/components/admin/rag/__tests__/QueueDetailPane.test.tsx
  - src/components/admin/rag/__tests__/RejectReasonSheet.test.tsx
  - src/components/admin/rag/__tests__/two-person-rule.test.tsx
  - tests/e2e/admin/rag-queue.spec.ts
autonomous: true
requirements: [RAG-03]
must_haves:
  truths:
    - "D-15 / D-AdminQueue-01 (CONTEXT.md §Admin Curation Queue): admin reviewer can land on /admin/rag/queue and see a two-column queue (left list, right detail) populated from kb_chunks_queue rows where status='queued' via list_rag_review_queue() SECDEF RPC shipped in 60-01"
    - "D-AdminQueue-02 / 2-person rule UI layer (per [[feedback_3_layer_must_never_invariant_pattern]]; DB layer in 60-01 approve_rag_chunk RPC, CI layer in 60-03 eval --suite=safety): when the currently authenticated reviewer's auth.uid() equals chunk.created_by, the row renders a warning Badge with copy `You created this — needs a different reviewer` and the per-row + sticky-action-row `Approve chunk` button is disabled (aria-disabled='true' + visually muted). Reject / Retract / Edit & approve remain enabled because they are not the 2-person-gated action."
    - "D-AdminQueue-03 (UI-SPEC §1 + Surface 1): the QueueDetailPane renders side-by-side SOURCE TEXT (left, bg-surface-soft) vs EXTRACTED QUOTE blocks (right, kind badges dose|indication|contraindication|adverse-event) — react-markdown + DOMPurify allowlist `p a ul ol li code pre strong em blockquote mark h2 h3 h4` ONLY (no img/script/iframe/inline-style). At <lg the two halves stack vertically."
    - "D-AdminQueue-04 (CONTEXT.md §Admin Curation Queue specific ideas): tier (A|B|C) and topic_tag are editable inline in the detail pane via a TierSelect + TopicTagSelect; saving routes through queue_rag_chunk RPC (60-01 — re-queues with updated tier/topic_tag); used to demote federated tier-A chunks when admin spots low quality."
    - "D-AdminQueue-05 (CONTEXT.md §Admin Curation Queue + UI-SPEC Surface 1): 6 reject reasons (Off-topic | Factually wrong | Off-label | Low quality | Duplicate | Safety concern) selectable in a bottom RejectReasonSheet (role=radiogroup with arrow-key cycling); danger-toned: Factually wrong, Off-label, Safety concern. Single tap = immediate reject_rag_chunk RPC + close + Toast `Rejected`."
    - "D-AdminQueue-06 (CONTEXT.md §Admin Curation Queue — 'hard delete'): reject_rag_chunk RPC (60-01) hard-deletes from kb_chunks_queue and writes kb_chunk_rejections(chunk_id, reason, actor_id, at). The UI shows immediate optimistic removal + 5s Undo Toast `Approved · Undo` / `Rejected`."
    - "D-AdminQueue-07 (UI-SPEC §1 keyboard contract): A = approve, R = open RejectReasonSheet, E = open EditChunkModal, J/K = next/prev queue row, Shift+? = open keyboard help modal; all shortcuts inert when an overlay (Sheet/Modal) is open or focus is inside an editable field."
    - "D-AdminQueue-08 (UI-SPEC §1 retract): from a previously-approved chunk's detail pane the reviewer can open RetractChunkModal — title `Retract this chunk?` body verbatim from UI-SPEC copywriting contract; reason textarea is REQUIRED; submit calls retract_rag_chunk RPC."
    - "D-AdminQueue-09 (UI-SPEC §1 empty state): when the queue list returns 0 rows, the LEFT column renders EmptyState primitive with CheckCheck icon + heading `Queue clear` + body `Nothing to review. Tier-A chunks auto-publish; new Tier-B/C items will appear here for review.` Right column is hidden / null at empty state."
    - "D-AdminQueue-10 (UI-SPEC Critical Invariant #11): typography across all surfaces in this plan uses ONLY 11/13/18 px (no 28px on admin surfaces — text-heading is reserved for /knowledge Fraunces only); no text-base / text-md / text-2xl usage."
    - "D-AdminQueue-11 (UI-SPEC §3 Color invariant #6 + Critical Invariant #6): tier badges use TierBadge primitive (neutral-only palette — Tier A bg-surface-elevated, Tier B bg-surface-soft, Tier C bg-cream-200). NO green=approved or red=danger tier coloring."
    - "D-AdminQueue-12 (UI-SPEC §a11y baseline): role=dialog + aria-modal=true on RejectReasonSheet (Sheet primitive) + EditChunkModal + RetractChunkModal + QueueKeyboardHelpModal; aria-label on icon-only Reject button; aria-pressed on filter pills; role=radiogroup on RejectReasonSheet pills; aria-busy on Approve button during in-flight RPC; useReducedMotion() gates row-removal collapse animation; focus trap + return-focus-to-trigger on every overlay close."
    - "D-AdminQueue-13 ([[reference_react_router_consumer_admin_split]] / RagLayout pattern): mount path is `/admin/rag/queue` — wire by replacing the QueuePlaceholder Component reference in `src/components/admin/rag/RagLayout.tsx` SUB_ROUTES with the new `RagQueuePage` import. NO react-router introduction; NO new AdminRoutes.tsx file (rag sub-section uses imperative pathname routing per existing pattern in RagLayout.tsx lines 161-167)."
    - "D-AdminQueue-14 (CONTEXT.md §Telemetry): each successful approve / reject / retract / edit emits a client-side `posthog.capture('rag_chunk_reviewed', { chunk_id, source_tier, action, reject_reason?, queue_age_hours })` event. 2-person-rule-blocked clicks (which should not be possible because the button is disabled) emit defensive `posthog.capture('rag_2person_rule_ui_block_attempted', {chunk_id, attempted_by})` if the disabled state is bypassed via DOM hack — defensive only; primary defense is DB SECDEF in 60-01."
    - "D-AdminQueue-15 (Vitest 4.x trap [[reference_vitest_4_projects_config_masks_default]]): all vitest runs use `npx vitest run --config vite.config.ts` to bypass the projects: block in vitest.config.ts that masks the default test config."
  artifacts:
    - path: "src/lib/admin/rag/chunk-api.ts"
      provides: "Typed wrappers over 5 SECDEF RPCs from 60-01 + queue list query"
      exports: ["ragApproveChunk", "ragRejectChunk", "ragRetractChunk", "ragQueueChunk", "ragListReviewQueue", "RejectReason", "ReviewQueueRow"]
    - path: "src/components/admin/rag/RagQueuePage.tsx"
      provides: "Two-column queue page mounted at /admin/rag/queue (replaces QueuePlaceholder)"
      contains: "lg:grid-cols-[7fr_5fr]"
    - path: "src/components/admin/rag/QueueDetailPane.tsx"
      provides: "Side-by-side SOURCE TEXT vs EXTRACTED QUOTE pane + sticky action row + tier/topic_tag edit"
      contains: "SOURCE TEXT"
    - path: "src/components/admin/rag/RejectReasonSheet.tsx"
      provides: "Bottom Sheet with 6-reason radiogroup"
      contains: "role=\"radiogroup\""
    - path: "src/components/admin/rag/EditChunkModal.tsx"
      provides: "Inline edit summary + quote_blocks JSON, save via queue_rag_chunk (re-queues for second reviewer)"
      contains: "role=\"dialog\""
    - path: "src/components/admin/rag/RetractChunkModal.tsx"
      provides: "Retract confirmation modal with required reason textarea"
      contains: "Retract this chunk?"
    - path: "src/components/admin/rag/QueueKeyboardHelpModal.tsx"
      provides: "Shift+? help overlay listing A/R/E/J/K shortcuts"
      contains: "Keyboard shortcuts"
    - path: "tests/e2e/admin/rag-queue.spec.ts"
      provides: "Playwright E2E covering all 5 RPCs + happy/sad + 2-person-rule disabled-Approve assertion"
  key_links:
    - from: "src/components/admin/rag/RagQueuePage.tsx"
      to: "src/lib/admin/rag/chunk-api.ts"
      via: "named imports ragApproveChunk / ragRejectChunk / ragRetractChunk / ragQueueChunk / ragListReviewQueue"
      pattern: "ragApproveChunk|ragRejectChunk|ragRetractChunk|ragQueueChunk|ragListReviewQueue"
    - from: "src/lib/admin/rag/chunk-api.ts"
      to: "supabase RPCs from 60-01"
      via: "supabase.rpc('approve_rag_chunk' | 'reject_rag_chunk' | 'retract_rag_chunk' | 'queue_rag_chunk' | 'list_rag_review_queue')"
      pattern: "supabase\\.rpc\\('(approve|reject|retract|queue|list)_rag_(chunk|review_queue)"
    - from: "src/components/admin/rag/RagLayout.tsx"
      to: "src/components/admin/rag/RagQueuePage.tsx"
      via: "SUB_ROUTES entry { key: 'queue', path: 'queue', Component: RagQueuePage }"
      pattern: "Component:\\s*RagQueuePage"
    - from: "src/components/admin/rag/QueueDetailPane.tsx"
      to: "react-markdown + dompurify"
      via: "DOMPurify.sanitize(html, { ALLOWED_TAGS: [...], ALLOWED_ATTR: [...] }) before render"
      pattern: "DOMPurify\\.sanitize"
    - from: "src/components/admin/rag/RagQueuePage.tsx"
      to: "posthog-js"
      via: "posthog.capture('rag_chunk_reviewed', { chunk_id, source_tier, action, reject_reason?, queue_age_hours })"
      pattern: "rag_chunk_reviewed"
---

<objective>
Ship the admin curation queue UI surface at `/admin/rag/queue` — the highest-density human-in-the-loop surface in Phase 60. This is where Karsten and the clinical reviewer spend their RAG-curation time. Reuse the 50-06 PLAN structure verbatim where applicable (Tasks 2-4 + 6 of `.planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-06-PLAN.md`) but bind to the v1.4 Phase 60 5-RPC state-machine shipped in 60-01 (`approve_rag_chunk`, `reject_rag_chunk`, `retract_rag_chunk`, `queue_rag_chunk`, `list_rag_review_queue`) and wire the UI layer of the 2-person rule.

Purpose: without this surface, the chunker (60-04) + embedder (60-05) + federated adapters (60-07) all back up at `status='queued'` and the retrieval Edge Fn (60-06) has nothing tier-A-approved to surface. UI-SPEC marks this surface "highest UX scrutiny" (Surface 1 + Critical Invariants #1, #4, #6, #10, #11). Per `[[feedback_3_layer_must_never_invariant_pattern]]`, this plan owns the UI layer of the 2-person rule MUST-NEVER invariant; the DB layer is owned by 60-01 (SECDEF `approve_rag_chunk` rejects when `auth.uid() = created_by`); the CI layer is owned by 60-03 (eval `--suite=safety` includes a constructed 2-person-bypass adversarial payload). All three layers ship independently and are independently tested.

Output:
- 6 React component files (RagQueuePage + QueueDetailPane + RejectReasonSheet + EditChunkModal + RetractChunkModal + QueueKeyboardHelpModal)
- 1 typed RPC wrapper (chunk-api.ts)
- 1 RagLayout.tsx surgical edit (replace QueuePlaceholder Component reference)
- 4 vitest suites (chunk-api, RagQueuePage, QueueDetailPane, RejectReasonSheet, two-person-rule)
- 1 Playwright E2E (covers all 5 RPCs + happy/sad + 2-person disabled-Approve)
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
@.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md
@.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-AI-SPEC.md
@.planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-06-PLAN.md
@src/components/admin/rag/RagLayout.tsx
@src/components/admin/rag/TierBadge.tsx
@src/components/admin/rag/RagSourcesPage.tsx
@src/components/ui/Card.tsx
@src/components/ui/Modal.tsx
@src/components/ui/Sheet.tsx
@src/components/ui/Toast.tsx
@src/components/ui/Pill.tsx
@src/components/ui/Badge.tsx
@src/components/ui/EmptyState.tsx
@src/admin/modules/helpdesk/KBEditorPage.tsx
@src/hooks/useReducedMotion.ts

<interfaces>
<!-- Key contracts extracted from the codebase + sibling plans so the executor does NOT need to re-explore. -->

## From 60-01 (data layer, shipped in Wave 0)

The 5 SECDEF RPCs this UI binds to (signatures per the 60-01 outline row — executor should re-read 60-01 PLAN for the exact final signatures, but the shape is locked):

```sql
-- All take auth.uid() implicitly via SECDEF + public.is_staff() guard.
public.approve_rag_chunk(p_chunk_id uuid) RETURNS void
  -- RAISES when auth.uid() = (SELECT created_by FROM kb_chunks_queue WHERE id = p_chunk_id)
  -- Sets status='approved', published_at=now(), reviewed_by=auth.uid(), reviewed_at=now()
public.reject_rag_chunk(p_chunk_id uuid, p_reason text) RETURNS void
  -- Validates p_reason IN ('off-topic','factually-wrong','off-label','low-quality','duplicate','safety-concern')
  -- Hard-DELETEs from kb_chunks_queue + INSERTs to kb_chunk_rejections
public.retract_rag_chunk(p_chunk_id uuid, p_reason text) RETURNS void
  -- Requires chunk currently status='approved'
  -- Sets status='retracted', retracted_at=now(), retracted_reason=p_reason
public.queue_rag_chunk(p_chunk_id uuid, p_summary text, p_quote_blocks jsonb, p_tier text, p_topic_tag text) RETURNS void
  -- Edit-and-re-queue path (UI uses for inline tier/topic_tag edits OR EditChunkModal full edit)
  -- Re-queues with updated fields; per D-AdminQueue-04 this re-queue resets reviewed_by so a SECOND reviewer must approve (matches 2-person rule intent)
public.list_rag_review_queue(p_tier text DEFAULT NULL, p_topic_tag text DEFAULT NULL, p_source_id uuid DEFAULT NULL, p_limit int DEFAULT 50, p_offset int DEFAULT 0)
  RETURNS TABLE(id uuid, source_id uuid, source_name text, source_tier text, topic_tag text, summary text, quote_blocks jsonb, source_markdown text, created_by uuid, queued_at timestamptz, queue_age_hours numeric, canonical_url text)
```

## From the existing codebase

`src/components/admin/rag/RagLayout.tsx` (the mount point — surgical edit only):

```typescript
// lines 161-167 (current state - QueuePlaceholder is the placeholder to replace):
const SUB_ROUTES: readonly SubRoute[] = [
  { key: 'topics',    label: 'Topics',    path: 'topics',    Component: RagTopicsPage },
  { key: 'sources',   label: 'Sources',   path: 'sources',   Component: RagSourcesPage },
  { key: 'queue',     label: 'Queue',     path: 'queue',     Component: QueuePlaceholder },  // ← REPLACE with RagQueuePage
  { key: 'telemetry', label: 'Telemetry', path: 'telemetry', Component: RagTelemetryPage },
  { key: 'cost',      label: 'Cost',      path: 'cost',      Component: CostPlaceholder },
] as const;
```

The rag sub-section uses imperative pathname routing (no react-router). Per `[[reference_react_router_consumer_admin_split]]` the new page slots in by replacing the Component reference — DO NOT introduce react-router for this sub-section.

`src/components/admin/rag/TierBadge.tsx` — neutral tier badge primitive (already exists from Phase 50 Wave 1). Reuse verbatim; do not re-implement.

`src/components/ui/Card.tsx` — span={4|6|7|8|12} + variants `default | elevated | interactive | hero | flat`. Use `Card variant="interactive" span={12}` for queue rows.

`src/components/ui/Sheet.tsx` + `src/components/ui/Modal.tsx` — both ship `role="dialog"` + `aria-modal="true"` + focus trap + return-focus-on-close out of the box. Bottom Sheet is the correct primitive for RejectReasonSheet; full Modal for EditChunkModal / RetractChunkModal / QueueKeyboardHelpModal.

`src/components/ui/Toast.tsx` — `role="status"` + `aria-live="polite"`; supports an optional Undo action (used by 5s `Approved · Undo` affordance per UI-SPEC §1 Interaction Contract).

`src/components/ui/EmptyState.tsx` — used for "Queue clear" empty state.

`src/components/ui/Pill.tsx` — used for filter pills (active = accent bg, inactive = surface-soft) and reject-reason radiogroup options.

`src/admin/modules/helpdesk/KBEditorPage.tsx` lines 23 + 238 — canonical reference for the project's react-markdown + DOMPurify rendering pattern. QueueDetailPane MUST follow the same `DOMPurify.sanitize(..., { ALLOWED_TAGS: [...], ALLOWED_ATTR: [...] })` shape; allowlist per UI-SPEC §1: `p a ul ol li code pre strong em blockquote mark h2 h3 h4` only; ALLOWED_ATTR: `href target rel` only; no img/script/iframe/style.

`src/hooks/useReducedMotion.ts` — call before any framer-motion variant that animates the row-removal collapse.

## Supabase client + posthog

`@/lib/supabase` exports `supabase` (already used elsewhere in `src/components/admin/rag/RagSourcesPage.tsx`). posthog-js is already initialized in App.tsx; import `posthog` from `'posthog-js'` per Phase 50-03 convention.

## Auth identity for 2-person rule

The 2-person rule UI layer needs `currentUserId` to compare against `chunk.created_by`. Use the existing auth context — `useStore((s) => s.user?.id)` is the v1.4 wiring (Zustand store hydrated from Supabase session at App boot). DO NOT fetch `supabase.auth.getUser()` per render; read once from the store. If the project has a dedicated `useCurrentUserId()` hook (grep `src/hooks/` and `src/lib/auth/` at execute-time), prefer it; otherwise the store selector is the project pattern.
</interfaces>
</context>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser (admin reviewer) → PostgREST `/rest/v1/rpc/*` | Authenticated admin's JWT crosses here; SECDEF RPCs in 60-01 enforce `public.is_staff()` + 2-person rule at the DB layer. |
| Scraped source markdown (in `kb_chunks_queue.source_markdown` jsonb/text) → DOM render | Untrusted third-party HTML/markdown crosses into the reviewer's browser DOM. |
| Reviewer textarea input (Reject reason, Retract reason, Edit summary, Edit quote_blocks JSON) → RPC argv | Trusted-actor input but still passes through PostgREST; relying on server-side parameterization. |
| Disabled-Approve-button → DOM mutation bypass | An admin who developer-tools their own `disabled` attribute MIGHT attempt to bypass the 2-person rule client-side. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-60-08-XSS-1 | Tampering | QueueDetailPane SOURCE TEXT render | mitigate | Render via react-markdown then DOMPurify.sanitize with EXPLICIT allowlist `p a ul ol li code pre strong em blockquote mark h2 h3 h4` + ALLOWED_ATTR `href target rel`; FORBID img/script/iframe/style/on*. Grep gate in vitest asserts allowlist literals. UI-SPEC Critical Invariant #1 + §3 invariant. |
| T-60-08-XSS-2 | Tampering | QueueDetailPane EXTRACTED QUOTE render (verbatim_quote text + kind badge) | mitigate | quote_blocks render as PLAIN TEXT (no markdown, no innerHTML); kind badge is from controlled enum `dose|indication|contraindication|adverse-event` — reject anything else with a TypeScript exhaustive switch. |
| T-60-08-AUTHN-1 | Spoofing / Elevation of Privilege | 2-person rule client bypass | mitigate | UI badge `You created this — needs a different reviewer` + button `disabled` + `aria-disabled='true'` are the UI layer. The DB SECDEF RPC in 60-01 is the authoritative defense (RAISES when `auth.uid() = created_by`). Defensive client-side posthog event `rag_2person_rule_ui_block_attempted` fires if a click somehow reaches the handler. Per `[[feedback_3_layer_must_never_invariant_pattern]]` — UI layer is the SOFT defense; DB layer is the HARD defense. |
| T-60-08-CSRF-1 | Tampering | Action RPCs (approve/reject/retract/edit) from cross-origin | accept | PostgREST + supabase-js use bearer-token auth not cookie auth → no CSRF surface. (Same disposition as Phase 50-06 50-06-PLAN.md.) |
| T-60-08-IDOR-1 | Information Disclosure | `list_rag_review_queue()` + per-chunk RPCs | mitigate | All 5 RPCs are SECDEF + gated by `public.is_staff()` (60-01); a non-staff JWT receives a RAISE 'not authorized'. UI does not need to filter further — RPC is the gate. |
| T-60-08-DOS-1 | Denial of Service | Reviewer pastes huge edit_summary or huge quote_blocks JSON | mitigate | Client-side length cap: summary ≤ 2000 chars + quote_blocks JSON ≤ 16KB before submit; server-side cap is owned by 60-01 RPC validation (planner pre-check: confirm 60-01 enforces). |
| T-60-08-JSON-1 | Tampering | quote_blocks textarea (JSON edited by hand) | mitigate | Parse with `JSON.parse` in a try/catch BEFORE invoking `queue_rag_chunk` RPC; on parse failure show inline error and do NOT submit. Validate shape with a runtime zod schema before send. |
| T-60-08-A11Y-1 | Information Disclosure (effectively) | Keyboard-only reviewer cannot complete workflow | mitigate | All shortcuts (A/R/E/J/K/Shift+?) are visible in QueueKeyboardHelpModal; all overlays have focus trap + ESC close + return-focus-to-trigger; tap targets ≥44px (queue row Approve button); role=radiogroup on reject pills with arrow-key cycling. |
| T-60-08-SC | Tampering | npm/pip/cargo installs | N/A | This plan installs ZERO new packages. All deps (react, supabase-js, react-markdown, dompurify, posthog-js, framer-motion, lucide-react) already in package.json. No legitimacy gate needed. |
</threat_model>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Write chunk-api.ts typed wrapper over 5 SECDEF RPCs (RED → GREEN)</name>
  <files>src/lib/admin/rag/chunk-api.ts, src/lib/admin/rag/__tests__/chunk-api.test.ts</files>
  <read_first>.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-01-data-layer-migrations-PLAN.md (or 60-01-PLAN.md — whichever exists at execute-time) for exact RPC signatures; src/components/admin/rag/RagSourcesPage.tsx for the project's supabase.rpc() invocation + error-handling convention</read_first>
  <behavior>
    - Test 1: `ragListReviewQueue({})` resolves to `{ data: ReviewQueueRow[], error: null }` shape when supabase.rpc returns rows.
    - Test 2: `ragListReviewQueue({ tier: 'B' })` forwards p_tier='B' to supabase.rpc args.
    - Test 3: `ragApproveChunk('uuid')` calls `supabase.rpc('approve_rag_chunk', { p_chunk_id: 'uuid' })`.
    - Test 4: `ragRejectChunk('uuid', 'off-topic')` calls `supabase.rpc('reject_rag_chunk', { p_chunk_id, p_reason })`; throws TS compile error if reason is not in the 6-value RejectReason union.
    - Test 5: `ragRetractChunk('uuid', 'source URL retracted')` calls `supabase.rpc('retract_rag_chunk', ...)`.
    - Test 6: `ragQueueChunk('uuid', {summary, quoteBlocks, tier, topicTag})` calls `supabase.rpc('queue_rag_chunk', { p_chunk_id, p_summary, p_quote_blocks, p_tier, p_topic_tag })`.
    - Test 7: On successful approve/reject/retract, `posthog.capture('rag_chunk_reviewed', { chunk_id, source_tier, action, reject_reason?, queue_age_hours })` is called with correctly-shaped properties (vi.mock posthog-js).
    - Test 8: On RPC error, the wrapper returns `{ data: null, error: PostgrestError }` and does NOT throw (project convention; matches RagSourcesPage.tsx pattern).
  </behavior>
  <action>
    Create `src/lib/admin/rag/chunk-api.ts` and `src/lib/admin/rag/__tests__/chunk-api.test.ts` together. Vitest first (RED): write all 8 test cases with `vi.mock('@/lib/supabase')` + `vi.mock('posthog-js')`. Then implement the wrapper (GREEN).

    Exports:
    - `export type RejectReason = 'off-topic' | 'factually-wrong' | 'off-label' | 'low-quality' | 'duplicate' | 'safety-concern'`
    - `export interface ReviewQueueRow { id: string; source_id: string; source_name: string; source_tier: 'A'|'B'|'C'; topic_tag: string; summary: string; quote_blocks: QuoteBlock[]; source_markdown: string; created_by: string; queued_at: string; queue_age_hours: number; canonical_url: string }`
    - `export interface QuoteBlock { text: string; kind: 'dose'|'indication'|'contraindication'|'adverse-event'; gloss?: string }`
    - `export async function ragListReviewQueue(opts: { tier?: 'A'|'B'|'C'; topicTag?: string; sourceId?: string; limit?: number; offset?: number }): Promise<{ data: ReviewQueueRow[] | null; error: PostgrestError | null }>`
    - `export async function ragApproveChunk(chunkId: string, ctx: { sourceTier: ReviewQueueRow['source_tier']; queueAgeHours: number }): Promise<{ data: null; error: PostgrestError | null }>`
    - `export async function ragRejectChunk(chunkId: string, reason: RejectReason, ctx: { sourceTier; queueAgeHours }): Promise<{ data: null; error: PostgrestError | null }>`
    - `export async function ragRetractChunk(chunkId: string, reason: string, ctx: { sourceTier; queueAgeHours }): Promise<{ data: null; error: PostgrestError | null }>`
    - `export async function ragQueueChunk(chunkId: string, fields: { summary: string; quoteBlocks: QuoteBlock[]; tier: 'A'|'B'|'C'; topicTag: string }, ctx: { sourceTier; queueAgeHours }): Promise<{ data: null; error: PostgrestError | null }>`

    Every successful call emits `posthog.capture('rag_chunk_reviewed', { chunk_id, source_tier, action, reject_reason?, queue_age_hours })` BEFORE returning. If the RPC errored, emit nothing (keeps PostHog clean).

    Convention from RagSourcesPage.tsx: `const { data, error } = await supabase.rpc('name', args); return { data: data ?? null, error: error ?? null }`. Do NOT throw on RPC errors. Per D-AdminQueue-14 + 60-01 PLAN frontmatter.

    Implements: D-AdminQueue-01, D-AdminQueue-04, D-AdminQueue-05, D-AdminQueue-06, D-AdminQueue-08, D-AdminQueue-14.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npx vitest run --config vite.config.ts src/lib/admin/rag/__tests__/chunk-api.test.ts && npm run typecheck && npm run lint -- src/lib/admin/rag/chunk-api.ts</automated>
  </verify>
  <done>
    - chunk-api.ts exports the 5 wrappers + RejectReason type + ReviewQueueRow + QuoteBlock; vitest green; typecheck + lint clean.
    - posthog.capture invoked with the exact event name `rag_chunk_reviewed` and the 5 expected property keys.
    - `grep -c "supabase.rpc('\\(approve\\|reject\\|retract\\|queue\\|list\\)_rag_" src/lib/admin/rag/chunk-api.ts` returns 5.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Build QueueDetailPane.tsx (side-by-side SOURCE TEXT vs EXTRACTED QUOTE + sticky action row + tier/topic_tag inline edit)</name>
  <files>src/components/admin/rag/QueueDetailPane.tsx, src/components/admin/rag/__tests__/QueueDetailPane.test.tsx</files>
  <read_first>.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md (Surface 1 full spec + Critical Invariants #1, #6, #10, #11 + Accessibility Baseline), src/admin/modules/helpdesk/KBEditorPage.tsx (canonical react-markdown + DOMPurify pattern, especially the `DOMPurify.sanitize(..., { ALLOWED_TAGS, ALLOWED_ATTR })` call shape), src/components/admin/rag/TierBadge.tsx (existing primitive)</read_first>
  <behavior>
    - Test 1: Renders header strip with source name, TierBadge, `Scraped {date}`, canonical URL link (external).
    - Test 2: Renders two-half side-by-side block at lg breakpoint (assert `lg:grid-cols-2` class present); stacks at <lg (assert presence of base `grid-cols-1`).
    - Test 3: SOURCE TEXT half label `SOURCE TEXT` (uppercase eyebrow 11px/600 text-text-tertiary); background bg-surface-soft; renders via react-markdown but only after passing through DOMPurify.sanitize.
    - Test 4: DOMPurify allowlist asserts: ALLOWED_TAGS includes only `['p','a','ul','ol','li','code','pre','strong','em','blockquote','mark','h2','h3','h4']`; ALLOWED_ATTR includes only `['href','target','rel']`. Test passes a malicious chunk `source_markdown` containing `<script>alert(1)</script><img src=x onerror=1>` and asserts no `<script>` / no `<img>` in rendered DOM.
    - Test 5: EXTRACTED QUOTE half renders one entry per quote_block; each shows verbatim text (plain text, NO markdown) + Badge with the kind enum value + optional gloss.
    - Test 6: Renders a kind Badge with `tone="danger"` for kind='contraindication' or kind='adverse-event'; neutral for dose/indication.
    - Test 7: Summary block renders chunk.summary as plain text below the side-by-side block.
    - Test 8: Sticky action row contains `Reject chunk` (secondary), `Edit & approve` (ghost), `Approve chunk` (primary) + kbd chips for A/R/E/J/K.
    - Test 9: When `currentUserId === chunk.created_by`, sticky-action Approve button has `disabled` + `aria-disabled='true'` AND a Badge with copy `You created this — needs a different reviewer` renders adjacent to the action row.
    - Test 10: Tier select renders 3 options (A/B/C); changing it triggers a "pending save" state — Save button calls `ragQueueChunk` with the new tier; topic_tag input is editable inline; both edits are batched into a single `ragQueueChunk` call (NOT one per field).
    - Test 11: Tier select uses neutral TierBadge palette only — no green/red traffic-light coloring (assert via class allowlist).
    - Test 12: useReducedMotion is honored — when true, no framer-motion transition on action row entry.
  </behavior>
  <action>
    Create `src/components/admin/rag/QueueDetailPane.tsx`. Vitest RTL spec file first (RED) with the 12 tests above using @testing-library/react + vi.mock for `'@/lib/admin/rag/chunk-api'`.

    Component props:
    ```typescript
    interface QueueDetailPaneProps {
      chunk: ReviewQueueRow;
      currentUserId: string | null;
      onApprove: () => Promise<void>;     // calls ragApproveChunk and triggers optimistic removal in parent
      onReject: () => void;                // opens RejectReasonSheet in parent
      onEdit: () => void;                  // opens EditChunkModal in parent
      onRetract?: () => void;              // shown only when chunk was previously approved (status='approved') — D-AdminQueue-08
      onQueueWithEdits: (edits: { tier: 'A'|'B'|'C'; topicTag: string }) => Promise<void>; // inline tier/topic_tag save
    }
    ```

    Layout:
    - Outer: `<aside className="grid gap-4 lg:sticky lg:top-4 lg:self-start">` (sticky on desktop right column).
    - Header strip: flex row — source name (13px/600 as `<a target="_blank" rel="noopener noreferrer">` to canonical_url) + TierBadge + `Scraped {format(queued_at)}` (11px/400) + external link icon.
    - Inline edit row: TierSelect (3 buttons in a Pill row, role=radiogroup with `aria-checked`) + TopicTagInput (text input) + `Save edits` ghost Button. Submit calls `onQueueWithEdits({tier, topicTag})` then resets to current values from props on success.
    - Side-by-side block: `<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">`.
      - Left `<div className="bg-surface-soft p-4 rounded-md">`: eyebrow `<p className="text-micro font-semibold uppercase text-text-tertiary">SOURCE TEXT</p>` then `<ReactMarkdown rehypePlugins={[rehypeRaw]}>{DOMPurify.sanitize(chunk.source_markdown, { ALLOWED_TAGS: [...], ALLOWED_ATTR: [...] })}</ReactMarkdown>`. Per UI-SPEC §1.
      - Right `<div>`: eyebrow `EXTRACTED QUOTE` accent-toned; map over chunk.quote_blocks → for each, render plain-text verbatim + Badge with `tone={kind === 'contraindication' || kind === 'adverse-event' ? 'danger' : 'neutral'}` + gloss in `text-text-secondary` 11px.
    - Summary block (full-width below): `<p className="text-sm">{chunk.summary}</p>`.
    - Sticky action row: `<div className="sticky bottom-0 bg-surface border-t border-border p-3 flex items-center gap-2 justify-between">`.
      - Left: keyboard hint chips — `<kbd>A</kbd>`, `<kbd>R</kbd>`, `<kbd>E</kbd>`, `<kbd>J/K</kbd>`.
      - Right: Reject (secondary, onClick=onReject, aria-label="Reject chunk") + Edit & approve (ghost, onClick=onEdit) + Approve chunk (primary, onClick=onApprove, disabled when currentUserId===chunk.created_by, aria-busy when in-flight).
    - When `currentUserId === chunk.created_by`: render `<Badge tone="warning">You created this — needs a different reviewer</Badge>` immediately above the action row.
    - When `onRetract` is passed (only when previously approved): include Retract button (`variant="ghost"`, danger-text) in the action row.

    DOMPurify allowlist (per UI-SPEC §1 + KBEditorPage.tsx precedent):
    ```typescript
    const SANITIZE_CONFIG: DOMPurifyConfig = {
      ALLOWED_TAGS: ['p','a','ul','ol','li','code','pre','strong','em','blockquote','mark','h2','h3','h4'],
      ALLOWED_ATTR: ['href','target','rel'],
      FORBID_TAGS: ['img','script','iframe','style','svg','math','form','input'],
      FORBID_ATTR: ['style','onerror','onload','onclick','on*'],
    };
    ```

    Typography: every text element uses ONLY text-micro (11px) / text-sm (13px) / text-lg (18px). No text-base. No text-heading. Per D-AdminQueue-10 + UI-SPEC Critical Invariant #11.

    Animations gated by `useReducedMotion()`. Implements D-AdminQueue-02, D-AdminQueue-03, D-AdminQueue-04, D-AdminQueue-10, D-AdminQueue-11, D-AdminQueue-12.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npx vitest run --config vite.config.ts src/components/admin/rag/__tests__/QueueDetailPane.test.tsx && npm run typecheck && npm run lint -- src/components/admin/rag/QueueDetailPane.tsx && grep -E "(text-base|text-md|text-2xl|text-3xl|text-heading)" src/components/admin/rag/QueueDetailPane.tsx | grep -v '^[[:space:]]*//' | grep -v '^[[:space:]]*\*' | (! grep -c . >/dev/null) && grep -c "DOMPurify.sanitize" src/components/admin/rag/QueueDetailPane.tsx | (read n; [ "$n" -ge 1 ])</automated>
  </verify>
  <done>
    - QueueDetailPane.tsx exists; 12 vitest cases green; typecheck + lint clean.
    - Grep gate: 0 forbidden typography tokens (text-base / text-md / text-2xl / text-3xl / text-heading), ≥1 DOMPurify.sanitize call.
    - 2-person rule disabled-Approve assertion passes in test 9.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Build RejectReasonSheet.tsx + EditChunkModal.tsx + RetractChunkModal.tsx + QueueKeyboardHelpModal.tsx</name>
  <files>src/components/admin/rag/RejectReasonSheet.tsx, src/components/admin/rag/EditChunkModal.tsx, src/components/admin/rag/RetractChunkModal.tsx, src/components/admin/rag/QueueKeyboardHelpModal.tsx, src/components/admin/rag/__tests__/RejectReasonSheet.test.tsx</files>
  <read_first>src/components/ui/Sheet.tsx (role=dialog + focus trap baseline), src/components/ui/Modal.tsx (same baseline), src/components/ui/Pill.tsx (for radiogroup pattern), .planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md (Surface 1 §RejectReasonSheet / §RetractChunkModal copy contract), .planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-06-PLAN.md (Task 4 — verbatim copy where applicable)</read_first>
  <behavior>
    RejectReasonSheet:
    - Test 1: Renders 6 Pill components with labels `Off-topic`, `Factually wrong`, `Off-label`, `Low quality`, `Duplicate`, `Safety concern` (verbatim from UI-SPEC §Copywriting Contract — Admin Curation Queue).
    - Test 2: Container has `role="radiogroup"` and each Pill has `role="radio"` + `aria-checked`.
    - Test 3: ArrowDown / ArrowRight cycles to next pill; ArrowUp / ArrowLeft cycles to previous (looping at endpoints).
    - Test 4: Single click on a pill calls onSelect with the corresponding RejectReason enum value ('off-topic' | 'factually-wrong' | 'off-label' | 'low-quality' | 'duplicate' | 'safety-concern') AND closes the sheet.
    - Test 5: Danger-toned pills are `Factually wrong`, `Off-label`, `Safety concern` (assert via tone="danger" prop or className containing danger token).
    - Test 6: ESC key closes the sheet without calling onSelect.
    - Test 7: aria-modal="true" + role="dialog" on the Sheet container (inherited from Sheet primitive).

    EditChunkModal:
    - Test 8: Renders Modal with title `Edit chunk` + summary textarea (default chunk.summary, 4 rows) + quote_blocks JSON textarea (monospace, default JSON.stringify(chunk.quote_blocks, null, 2)).
    - Test 9: Invalid JSON in quote_blocks textarea → inline error message `Invalid JSON` shown + Save button disabled.
    - Test 10: Valid JSON + click Save → calls onSave({summary, quoteBlocks}) which triggers `queue_rag_chunk` re-queue.
    - Test 11: summary >2000 chars → inline error `Summary too long (max 2000)` + Save disabled.
    - Test 12: quote_blocks JSON >16KB → inline error + Save disabled.

    RetractChunkModal:
    - Test 13: Title `Retract this chunk?` (verbatim per UI-SPEC §Copywriting); body verbatim `Chunk removes from RAG retrieval immediately. Already-sent newsletter inclusions stay sent. Action is logged.`; actions `Keep chunk` (secondary) + `Retract chunk` (danger).
    - Test 14: Reason textarea is REQUIRED — Retract button disabled until at least 1 non-whitespace char.

    QueueKeyboardHelpModal:
    - Test 15: Renders 5 shortcut rows: `A — Approve selected`, `R — Reject selected`, `E — Edit & approve`, `J / K — Next / Previous`, `Shift + ? — Show/hide this help`.
    - Test 16: Triggered by Shift+? from any non-input context within the queue page (this test lives in RagQueuePage.test.tsx Task 4 — here we just unit-test the modal renders correctly when `isOpen={true}`).
  </behavior>
  <action>
    Create the 4 overlay components. The RejectReasonSheet test file (`__tests__/RejectReasonSheet.test.tsx`) is the explicit TDD scaffold; the other 3 components share unit-test coverage via the RagQueuePage integration test in Task 4 + the Playwright E2E in Task 6 (do not under-test, but vitest unit specs for RejectReasonSheet are the load-bearing case since it owns the 6-reason taxonomy and arrow-key cycling logic).

    **RejectReasonSheet.tsx** — uses `Sheet` primitive (bottom slide-up). 6 Pills in a flex-wrap row inside a `role="radiogroup"` div. Arrow-key handler computes nextIndex with modulo length. Tap = onSelect(reason) + onClose(). Danger pills via `tone="danger"`.

    **EditChunkModal.tsx** — Modal with controlled inputs for `summary` (textarea) and `quoteBlocksJson` (monospace textarea). JSON.parse in a useEffect → setParseError. Save disabled when parseError !== null OR summary.length > 2000 OR quoteBlocksJson.length > 16 * 1024. Save calls `onSave({summary, quoteBlocks: parsed})`.

    **RetractChunkModal.tsx** — Modal with verbatim UI-SPEC copy (case-sensitive grep gate enforces this). Reason textarea (required, ≥1 non-whitespace char). Submit disabled until valid.

    **QueueKeyboardHelpModal.tsx** — Modal listing the 5 shortcut rows in a simple `<dl>` or two-column grid. Closed by ESC or Shift+? toggle.

    All four overlays inherit `role="dialog"` + `aria-modal="true"` + focus trap + return-focus-to-trigger from the Sheet/Modal primitives. Per UI-SPEC §a11y baseline.

    Implements D-AdminQueue-05, D-AdminQueue-07, D-AdminQueue-08, D-AdminQueue-12.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npx vitest run --config vite.config.ts src/components/admin/rag/__tests__/RejectReasonSheet.test.tsx && npm run typecheck && npm run lint -- src/components/admin/rag/RejectReasonSheet.tsx src/components/admin/rag/EditChunkModal.tsx src/components/admin/rag/RetractChunkModal.tsx src/components/admin/rag/QueueKeyboardHelpModal.tsx && grep -q "Chunk removes from RAG retrieval immediately. Already-sent newsletter inclusions stay sent. Action is logged." src/components/admin/rag/RetractChunkModal.tsx</automated>
  </verify>
  <done>
    - 4 files exist; vitest green; typecheck + lint clean.
    - Grep gate: RetractChunkModal contains the verbatim UI-SPEC body copy.
    - RejectReasonSheet renders exactly 6 pills with the 6-enum taxonomy + role=radiogroup + arrow-key cycling.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Build RagQueuePage.tsx (two-column layout + filter pills + 2-person rule wiring + optimistic UI + keyboard shortcuts + posthog wiring)</name>
  <files>src/components/admin/rag/RagQueuePage.tsx, src/components/admin/rag/__tests__/RagQueuePage.test.tsx, src/components/admin/rag/__tests__/two-person-rule.test.tsx</files>
  <read_first>.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md (Surface 1 complete spec + Copywriting Contract + a11y baseline + Critical Invariants 1/4/6/10/11), src/components/admin/rag/RagSourcesPage.tsx (sibling page pattern for layout + supabase data fetch + admin pathname), src/components/ui/EmptyState.tsx, src/components/ui/Pill.tsx, src/components/ui/Toast.tsx (Undo-action pattern), .planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-06-PLAN.md (Task 3 verbatim where applicable)</read_first>
  <behavior>
    RagQueuePage.test.tsx:
    - Test 1: On mount calls `ragListReviewQueue({})` once; while loading shows Skeleton placeholders.
    - Test 2: Renders header `Curation Queue` (18px/600) + backlog badge `Backlog: 3 items` for 3 returned rows.
    - Test 3: Backlog badge turns warning-toned when count > 100 (assert via className or tone prop).
    - Test 4: Renders 5 filter pills: `All`, `Tier B`, `Tier C`, `by tag`, `by source` with role + aria-pressed; clicking `Tier B` re-fetches with `{tier: 'B'}`.
    - Test 5: Each queue row is a `Card variant="interactive" span={12}` with source name + TierBadge + topic tag Pill + 1-line summary (`line-clamp-1`) + `queued {relative-time}` + per-row Approve Button + reject IconButton with aria-label `Reject chunk`.
    - Test 6: Clicking a row sets the active chunk → QueueDetailPane renders in the right column with that chunk's data.
    - Test 7: Pressing `A` key (when no overlay open + focus not in input) approves the active chunk: calls ragApproveChunk + optimistically removes the row + shows Toast `Approved · Undo` with 5s undo affordance.
    - Test 8: Pressing `R` opens RejectReasonSheet; pressing `E` opens EditChunkModal; pressing `J`/`K` moves activeChunkIndex +/-1 with bounds clamping; pressing `Shift+?` opens QueueKeyboardHelpModal.
    - Test 9: Keyboard shortcuts are INERT when a Sheet/Modal is open (assert: with RejectReasonSheet open, pressing `A` does NOT trigger approve).
    - Test 10: Keyboard shortcuts are INERT when focus is inside `<input>` / `<textarea>` / `[contenteditable]`.
    - Test 11: Empty state (0 rows) renders EmptyState with `Queue clear` heading + the verbatim body copy; right column hidden.
    - Test 12: Error state (rpc returned error) renders `Failed to load queue. Refresh to try again.` per UI-SPEC §Error States.

    two-person-rule.test.tsx (dedicated suite — UI layer of the 3-layer invariant per [[feedback_3_layer_must_never_invariant_pattern]]):
    - Test A: When list_rag_review_queue returns a row where `created_by === currentUserId`, the row's Approve Button has `disabled` + `aria-disabled='true'`.
    - Test B: That row renders an inline Badge with verbatim copy `You created this — needs a different reviewer`.
    - Test C: Clicking the (disabled) Approve Button does NOT call ragApproveChunk (asserted via vi.fn mock call count === 0).
    - Test D: Reject / Retract / Edit buttons on that same row remain enabled (2-person rule applies ONLY to approve, per 60-01 SECDEF semantics).
    - Test E: When QueueDetailPane is opened for that row, the sticky-action-row Approve button is ALSO disabled + the warning Badge renders above the action row (mirror of Task 2 test 9, exercised at integration level).
    - Test F: Pressing `A` keyboard shortcut on a 2-person-blocked chunk is a no-op (defensive — keyboard should not bypass the UI rule).
  </behavior>
  <action>
    Create `src/components/admin/rag/RagQueuePage.tsx`. Write the two vitest spec files first (RED).

    Component structure:
    ```typescript
    export default function RagQueuePage() {
      const currentUserId = useStore((s) => s.user?.id ?? null);
      const reducedMotion = useReducedMotion();
      const [rows, setRows] = useState<ReviewQueueRow[]>([]);
      const [activeId, setActiveId] = useState<string | null>(null);
      const [filter, setFilter] = useState<{ tier?: 'A'|'B'|'C'; topicTag?: string; sourceId?: string }>({});
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState<string | null>(null);
      const [rejectOpen, setRejectOpen] = useState(false);
      const [editOpen, setEditOpen] = useState(false);
      const [helpOpen, setHelpOpen] = useState(false);
      // useEffect: fetch ragListReviewQueue({...filter}) on mount + filter change.
      // useEffect: window keydown handler — gate on no-overlay + focus-not-in-input; map keys to handlers.
      // Optimistic remove: setRows(rows.filter(r => r.id !== id)) then call API; Toast with onUndo handler that re-inserts.
    }
    ```

    Layout:
    - `<div className="grid gap-6 lg:grid-cols-[7fr_5fr]">` — UI-SPEC §1 exact ratio.
    - Left column: sticky header (title `Curation Queue` + backlog badge), filter pill row, then `<ul>` of queue rows.
    - Right column: `<QueueDetailPane>` with currentUserId prop + handlers. Hidden at <lg (handled by parent grid stacking).

    Each queue row:
    ```tsx
    <Card variant="interactive" span={12} onClick={() => setActiveId(row.id)} aria-pressed={activeId === row.id}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><span className="text-sm font-semibold truncate">{row.source_name}</span><TierBadge tier={row.source_tier}/><Pill>{row.topic_tag}</Pill></div>
          <p className="text-sm line-clamp-1 text-text-secondary mt-1">{row.summary}</p>
          {row.created_by === currentUserId && <Badge tone="warning" className="mt-1">You created this — needs a different reviewer</Badge>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-micro text-text-tertiary">queued {formatRelative(row.queued_at)}</span>
          <Button size="sm" onClick={(e) => { e.stopPropagation(); handleApprove(row); }} disabled={row.created_by === currentUserId} aria-disabled={row.created_by === currentUserId}>Approve chunk</Button>
          <IconButton aria-label="Reject chunk" onClick={(e) => { e.stopPropagation(); setActiveId(row.id); setRejectOpen(true); }}><X/></IconButton>
        </div>
      </div>
    </Card>
    ```

    Backlog badge: `<Badge tone={rows.length > 100 ? 'warning' : 'neutral'}>Backlog: {rows.length} items</Badge>` per UI-SPEC §Copywriting.

    Filter pills: 5 Pill components mapped to a `filterPills` array; clicking a pill updates `filter` state which triggers refetch.

    Optimistic remove pattern (Approve/Reject path):
    ```typescript
    const handleApprove = async (row: ReviewQueueRow) => {
      if (row.created_by === currentUserId) return; // 2-person rule UI guard (defensive — button is also disabled)
      const removed = row;
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      const { error } = await ragApproveChunk(row.id, { sourceTier: row.source_tier, queueAgeHours: row.queue_age_hours });
      if (error) {
        setRows((rs) => [removed, ...rs]); // rollback
        showToast({ message: 'Approve failed', tone: 'danger' });
        return;
      }
      showToast({ message: 'Approved', tone: 'success', undo: { label: 'Undo', onClick: () => { /* there's no real undo at the RPC layer — the Undo affordance is a 5s soft buffer that prevents auto-next; semantics per UI-SPEC §1 + 50-06 Task 6 — implement as: keep the row hidden but expose 5s window where Undo restores it locally + calls queue_rag_chunk to re-queue with same fields */ } }});
    };
    ```

    Keyboard handler (single window-level listener):
    ```typescript
    useEffect(() => {
      const overlayOpen = rejectOpen || editOpen || helpOpen || retractOpen;
      if (overlayOpen) return;
      const handler = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement;
        if (t.matches('input, textarea, [contenteditable="true"]')) return;
        const active = rows.find((r) => r.id === activeId);
        if (!active) return;
        switch (e.key) {
          case 'a': case 'A': handleApprove(active); break;
          case 'r': case 'R': setRejectOpen(true); break;
          case 'e': case 'E': setEditOpen(true); break;
          case 'j': case 'J': moveActive(+1); break;
          case 'k': case 'K': moveActive(-1); break;
          case '?': if (e.shiftKey) setHelpOpen(true); break;
        }
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }, [activeId, rows, rejectOpen, editOpen, helpOpen]);
    ```

    All UI-SPEC copywriting strings used VERBATIM. No "for now" / "v1" / "placeholder" language anywhere.

    Implements D-AdminQueue-01, D-AdminQueue-02, D-AdminQueue-05, D-AdminQueue-06, D-AdminQueue-07, D-AdminQueue-09, D-AdminQueue-12, D-AdminQueue-14.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npx vitest run --config vite.config.ts src/components/admin/rag/__tests__/RagQueuePage.test.tsx src/components/admin/rag/__tests__/two-person-rule.test.tsx && npm run typecheck && npm run lint -- src/components/admin/rag/RagQueuePage.tsx && grep -q "lg:grid-cols-\[7fr_5fr\]" src/components/admin/rag/RagQueuePage.tsx && grep -q "You created this — needs a different reviewer" src/components/admin/rag/RagQueuePage.tsx</automated>
  </verify>
  <done>
    - RagQueuePage.tsx exists; both vitest suites green; typecheck + lint clean.
    - 2-person rule UI layer verified by dedicated two-person-rule.test.tsx (tests A-F all green).
    - Grep gate: `lg:grid-cols-[7fr_5fr]` exact string present; verbatim 2-person Badge copy present.
  </done>
</task>

<task type="auto">
  <name>Task 5: Wire RagQueuePage into RagLayout.tsx SUB_ROUTES (replace QueuePlaceholder)</name>
  <files>src/components/admin/rag/RagLayout.tsx</files>
  <read_first>src/components/admin/rag/RagLayout.tsx (lines 1-50 for imports, lines 143-167 for QueuePlaceholder + SUB_ROUTES)</read_first>
  <action>
    Surgical 3-line edit to `src/components/admin/rag/RagLayout.tsx`:

    1. Add import at the top of the imports block: `import RagQueuePage from './RagQueuePage';`.
    2. In the `SUB_ROUTES` array (currently at lines 161-167), replace `Component: QueuePlaceholder` with `Component: RagQueuePage` on the `key: 'queue'` row.
    3. Delete the `QueuePlaceholder` function definition (currently lines 143-150) — it is no longer referenced anywhere else (verify with grep before deleting).

    Do NOT touch:
    - The other 4 SUB_ROUTES entries (topics/sources/telemetry/cost).
    - `CostPlaceholder` (Phase 60-14 owns the cost replacement; not this plan).
    - The `resolveActive` function or pathname tracking — the existing imperative routing handles `/admin/rag/queue` without modification.

    Per `[[reference_react_router_consumer_admin_split]]` and the existing pattern: the rag sub-section uses imperative pathname routing (lines 179-189 of RagLayout.tsx). Do NOT introduce react-router. Do NOT create a separate AdminRoutes.tsx file (the outline mentioned it but the existing code pattern is a SUB_ROUTES array on this file — follow what's actually there).

    Implements D-AdminQueue-13.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && grep -n "QueuePlaceholder" src/components/admin/rag/RagLayout.tsx | grep -v "^[[:space:]]*//" | (! grep -c . >/dev/null) && grep -q "Component: RagQueuePage" src/components/admin/rag/RagLayout.tsx && grep -q "import RagQueuePage from './RagQueuePage'" src/components/admin/rag/RagLayout.tsx && npm run typecheck && npm run lint -- src/components/admin/rag/RagLayout.tsx</automated>
  </verify>
  <done>
    - QueuePlaceholder is GONE from RagLayout.tsx (grep returns 0 non-comment hits).
    - `Component: RagQueuePage` appears exactly once in SUB_ROUTES.
    - RagQueuePage import line present.
    - Typecheck + lint clean.
    - Visiting `/admin/rag/queue` in the dev server now renders the new RagQueuePage (manual smoke — verified via E2E in Task 6).
  </done>
</task>

<task type="auto">
  <name>Task 6: Playwright E2E covering all 5 RPCs + happy/sad paths + 2-person rule disabled-Approve</name>
  <files>tests/e2e/admin/rag-queue.spec.ts</files>
  <read_first>tests/e2e/ (existing playwright config + fixtures), .planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-06-PLAN.md (Task 6 e2e/admin-rag-queue.spec.ts pattern + `[[reference_playwright_state_seeding]]` + `[[reference_playwright_conditional_project_argv]]` references)</read_first>
  <action>
    Create `tests/e2e/admin/rag-queue.spec.ts`. Follow the existing project Playwright pattern (check `tests/e2e/` or `playwright.config.ts` at execute-time to align with the project's actual fixture/auth conventions; the file path follows the convention used by sibling admin specs).

    Gate the whole spec with an env flag per `[[reference_playwright_conditional_project_argv]]`:
    ```typescript
    test.skip(!process.env.PLAYWRIGHT_RUN_RAG_QUEUE, 'Set PLAYWRIGHT_RUN_RAG_QUEUE=1 to run');
    ```

    Seed:
    - Authenticated super-admin user (via `addInitScript` to inject the supabase session into localStorage — per the project's state-seeding pattern).
    - 4 queued kb_chunks_queue rows: 2 tier-B (one created_by=current admin, one created_by=other admin), 1 tier-C, 1 previously-approved tier-A (for the retract path).

    Tests (each one exercises a distinct RPC end-to-end):

    1. **approve_rag_chunk happy path**: visit `/admin/rag/queue` → see 3 queued rows in the left list (the approved tier-A is NOT in the queue list — it's only visible via the retract entry point). Click the row created_by=other admin → QueueDetailPane renders → press `A` → assert row disappears + Toast `Approved · Undo` appears.

    2. **2-person rule sad path**: identify the row where created_by=current admin → assert Approve button has `aria-disabled='true'` + warning Badge `You created this — needs a different reviewer` is visible → click the (disabled) Approve button → assert row STAYS in list (no removal) and Toast does NOT appear → assert no `posthog.capture('rag_chunk_reviewed', { action: 'approve' })` event fired (intercept via window.posthog mock if available, otherwise assert DOM state only).

    3. **reject_rag_chunk happy path**: click reject IconButton on a row → RejectReasonSheet opens → click `Off-topic` pill → sheet closes → row disappears → Toast `Rejected`.

    4. **queue_rag_chunk inline tier/topic edit happy path**: select a tier-C row → open QueueDetailPane → change tier select from C → B → change topic_tag from `peptide-research` → `glp-1` → click `Save edits` → assert ragQueueChunk RPC called with new values (intercept network) → row re-fetches.

    5. **retract_rag_chunk happy path**: navigate to a separate `retracted=false` admin view (or directly to the chunk detail by URL — depends on project routing; pragmatic alternative: seed a kb_chunks_queue row with `status='approved'` AND surface a Retract button in the detail pane only when status is approved) → click Retract → RetractChunkModal opens → enter reason `Source URL was retracted by FDA` → click `Retract chunk` (danger) → modal closes → Toast.

    6. **list_rag_review_queue filter happy path**: click `Tier B` filter pill → assert only 2 tier-B rows visible (the current-admin one + other-admin one). Click `All` → all 3 queued rows visible again.

    7. **a11y smoke**: tab through filter pills → assert focus indicator visible. Open RejectReasonSheet via `R` key → press ArrowRight → assert focus moves to next pill (aria-checked updates). Press ESC → sheet closes → focus returns to the Reject IconButton.

    8. **DOMPurify XSS smoke**: seed a queued chunk with `source_markdown` containing `<script>window.__pwned=true</script><img src=x onerror="window.__pwned2=true">`; click the row → open QueueDetailPane → assert `await page.evaluate(() => (window as any).__pwned)` is `undefined` AND `window.__pwned2` is `undefined`. Confirms DOMPurify allowlist holds.

    Implements all 5 RPCs + 2-person rule UI + DOMPurify hardening end-to-end.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npx playwright install --with-deps chromium 2>/dev/null; PLAYWRIGHT_RUN_RAG_QUEUE=1 npx playwright test tests/e2e/admin/rag-queue.spec.ts --reporter=line</automated>
  </verify>
  <done>
    - All 8 Playwright tests green when `PLAYWRIGHT_RUN_RAG_QUEUE=1`.
    - Spec skipped by default (no env var) so CI doesn't break on machines without seeded Supabase.
    - All 5 RPC paths exercised (approve, reject, retract, queue, list).
    - 2-person rule UI disabled-Approve verified by E2E test 2.
    - DOMPurify allowlist verified by E2E test 8.
  </done>
</task>

</tasks>

<verification>
Whole-plan gates (executor MUST run all five before declaring PLAN COMPLETE):

1. **TypeScript + Lint:**
   ```
   cd /Users/karstenhaldan/minisite/leanshot && npm run typecheck && npm run lint -- src/lib/admin/rag/ src/components/admin/rag/
   ```

2. **Vitest (per `[[reference_vitest_4_projects_config_masks_default]]`):**
   ```
   cd /Users/karstenhaldan/minisite/leanshot && npx vitest run --config vite.config.ts src/lib/admin/rag/__tests__/ src/components/admin/rag/__tests__/
   ```
   All 5 suites green (chunk-api, RagQueuePage, QueueDetailPane, RejectReasonSheet, two-person-rule).

3. **Typography gate (UI-SPEC Critical Invariant #11):**
   ```
   cd /Users/karstenhaldan/minisite/leanshot && grep -rE "(text-base|text-md|text-2xl|text-3xl|text-heading)" src/components/admin/rag/RagQueuePage.tsx src/components/admin/rag/QueueDetailPane.tsx src/components/admin/rag/RejectReasonSheet.tsx src/components/admin/rag/EditChunkModal.tsx src/components/admin/rag/RetractChunkModal.tsx src/components/admin/rag/QueueKeyboardHelpModal.tsx | grep -v "^[[:space:]]*//" | grep -v "^[[:space:]]*\*"
   ```
   MUST return zero matches (filtered for comments per `[[feedback_negation_grep_defeated_by_comment_string]]`).

4. **DOMPurify allowlist gate (UI-SPEC Critical Invariant #1):**
   ```
   cd /Users/karstenhaldan/minisite/leanshot && grep -c "DOMPurify.sanitize" src/components/admin/rag/QueueDetailPane.tsx
   ```
   MUST return ≥1. AND:
   ```
   cd /Users/karstenhaldan/minisite/leanshot && grep -E "ALLOWED_TAGS|ALLOWED_ATTR" src/components/admin/rag/QueueDetailPane.tsx
   ```
   MUST show explicit allowlist with the 14 tags + 3 attrs from this PLAN.

5. **Mount-point gate:**
   ```
   cd /Users/karstenhaldan/minisite/leanshot && grep -q "Component: RagQueuePage" src/components/admin/rag/RagLayout.tsx && ! grep -E "^[^/]*QueuePlaceholder" src/components/admin/rag/RagLayout.tsx
   ```
   RagQueuePage replaces QueuePlaceholder.

6. **Playwright E2E (gated):**
   ```
   PLAYWRIGHT_RUN_RAG_QUEUE=1 npx playwright test tests/e2e/admin/rag-queue.spec.ts
   ```
   All 8 tests green (or skipped cleanly if Supabase seeding unavailable — but at least the spec file must compile and the gate must work).
</verification>

<success_criteria>
- All 6 files exist; 5 vitest suites + 1 Playwright spec green.
- `/admin/rag/queue` (via RagLayout pathname routing) renders the new RagQueuePage instead of the placeholder.
- 2-person rule UI layer present: disabled Approve + warning Badge when `currentUserId === chunk.created_by`. UI is the SOFT defense; DB SECDEF in 60-01 is the HARD defense; CI eval in 60-03 is the THIRD layer — all three independent per `[[feedback_3_layer_must_never_invariant_pattern]]`.
- DOMPurify allowlist enforced on SOURCE TEXT render — no `img`/`script`/`iframe`/`style`/`on*` attrs survive.
- All 5 SECDEF RPCs invoked via the typed wrapper in chunk-api.ts: `approve_rag_chunk`, `reject_rag_chunk`, `retract_rag_chunk`, `queue_rag_chunk`, `list_rag_review_queue`.
- UI-SPEC verbatim copy used for: page title, backlog badge, empty state heading + body, approve/reject/edit/retract CTAs, toast labels, 2-person Badge, retract modal body, 6 reject reasons.
- Typography 4-size ceiling enforced (only text-micro / text-sm / text-lg — no text-base / text-2xl / text-heading on admin surfaces).
- Tier badge palette is neutral-only (TierBadge primitive reused — no green/red traffic-light).
- Keyboard shortcuts wired (A/R/E/J/K/Shift+?) and inert under overlays + inside editable fields.
- posthog `rag_chunk_reviewed` events emitted on every successful approve/reject/retract/edit-and-queue.
- All overlays inherit role=dialog + aria-modal + focus trap + return-focus from Sheet/Modal primitives.
- useReducedMotion() respected for row-removal collapse animation.
</success_criteria>

<output>
Create `.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-08-admin-queue-ui-SUMMARY.md` when done.
</output>
