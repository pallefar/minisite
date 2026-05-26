---
phase: 61-admin-protocol-creator
plan: 05
type: execute
wave: 2
depends_on:
  - 61-01-db-tables-rls
  - 61-03-protocol-ai-assist-fn
  - 61-04-admin-core-ui
files_modified:
  - src/components/admin/protocols/ProtocolEditorPage.tsx
  - src/components/admin/protocols/ProtocolStepRow.tsx
  - src/components/admin/protocols/ProtocolReviewBanner.tsx
  - src/components/admin/protocols/EvidenceSearchSheet.tsx
  - src/components/admin/protocols/AiAssistModal.tsx
  - src/components/admin/protocols/__tests__/ProtocolEditorPage.test.tsx
  - src/components/admin/protocols/__tests__/EvidenceSearchSheet.test.tsx
  - src/components/admin/protocols/__tests__/AiAssistModal.test.tsx
  - src/components/admin/protocols/__tests__/ProtocolReviewBanner.test.tsx
autonomous: true
requirements:
  - PROTOCOL-02
  - PROTOCOL-03
  - PROTOCOL-04
  - PROTOCOL-05
must_haves:
  truths:
    - "ProtocolEditorPage renders two-column grid: step-builder grid on left, sticky metadata panel on right"
    - "Author NEVER sees Publish button in DOM (conditional render — not disabled): `current_user_id === protocol.created_by` blocks button entirely"
    - "Reviewer (current_user_id != created_by) sees Publish button when review_state='in_review'"
    - "On Publish RPC returning `SELF_REVIEW_REJECTED` (errcode 42501 + message substring) → toast 'Another admin must review this protocol before publish.'"
    - "ProtocolReviewBanner shows 'Pending review by another admin' for author, 'Review as: {name}' + Publish CTA for reviewer"
    - "Step rows render dose_mg (font-mono tabular-nums input), frequency select, monitoring multiselect pills, Cite evidence + Suggest buttons, Remove icon"
    - "EvidenceSearchSheet calls rag-retrieve Edge Fn via supabase.functions.invoke, renders top-10 chunks with checkboxes, attaches via INSERT into protocol_evidence (step_id NOT NULL)"
    - "AiAssistModal calls protocol-ai-assist Edge Fn; renders refusal state with warning + 'Go to RAG queue →' link; renders rate-limit 429 as toast; Apply writes dose_mg + monitoring back to step row"
    - "Step removal triggers undo Toast (6s) — not a confirm modal"
    - "Editing a published protocol creates a new version row (INSERT new row with version = max(version) + 1, review_state='draft') — old row stays published"
  artifacts:
    - path: "src/components/admin/protocols/ProtocolEditorPage.tsx"
      provides: "Two-column editor with state-machine actions"
      exports: ["ProtocolEditorPage"]
    - path: "src/components/admin/protocols/ProtocolStepRow.tsx"
      provides: "Per-week row with inputs + evidence chips + action buttons"
      exports: ["ProtocolStepRow"]
    - path: "src/components/admin/protocols/EvidenceSearchSheet.tsx"
      provides: "Right-side drawer wrapping rag-retrieve + checkbox multi-attach"
      exports: ["EvidenceSearchSheet"]
    - path: "src/components/admin/protocols/AiAssistModal.tsx"
      provides: "Modal posting to protocol-ai-assist + refusal + rate-limit + apply"
      exports: ["AiAssistModal"]
    - path: "src/components/admin/protocols/ProtocolReviewBanner.tsx"
      provides: "Warning banner with author/reviewer split"
      exports: ["ProtocolReviewBanner"]
  key_links:
    - from: "ProtocolEditorPage"
      to: "public.publish_protocol RPC"
      via: "supabase.rpc('publish_protocol', { p_protocol_id, p_version })"
      pattern: "publish_protocol"
    - from: "ProtocolEditorPage"
      to: "SELF_REVIEW_REJECTED handler"
      via: "error.message.includes('SELF_REVIEW_REJECTED') → toast"
      pattern: "SELF_REVIEW_REJECTED"
    - from: "EvidenceSearchSheet"
      to: "rag-retrieve Edge Fn"
      via: "supabase.functions.invoke('rag-retrieve', { body: { query, k: 10 } })"
      pattern: "rag-retrieve"
    - from: "AiAssistModal"
      to: "protocol-ai-assist Edge Fn"
      via: "supabase.functions.invoke('protocol-ai-assist', ...)"
      pattern: "protocol-ai-assist"
    - from: "ProtocolEditorPage Publish button"
      to: "DOM-level removal for authors"
      via: "{!isSelfCreated && reviewState === 'in_review' && <Button>...</Button>}"
      pattern: "isSelfCreated"
---

<objective>
Ship the full protocol editor experience: two-column editor with step-builder grid, evidence search drawer (calls Phase 60 RAG retriever), AI-assist modal (calls Plan 03 Edge Fn), and review banner enforcing the 2-person rule at the UI layer. Implements PROTOCOL-02, PROTOCOL-03, PROTOCOL-04 (UI Layer 2), PROTOCOL-05 (versioning behavior on edit).

Purpose: This is the primary admin authoring surface. Mirror QueueDetailPane.tsx structure (two-column, sticky metadata panel, conditional-render publish). The 2-person rule UI behavior is critical — author MUST NOT see Publish button in DOM (full removal, not disabled).

**Wave note (revision iter-1):** This plan was originally Wave 1 alongside Plan 04. Plan 04 Task 1 adds new `--color-rose-soft` and `--color-warning-soft` @theme tokens to `src/index.css` that this plan's ProtocolReviewBanner consumes. Phase 60 BLOCKER class taught us Tailwind v4 silently no-ops undefined tokens (renders invisible), so this plan now serializes AFTER 61-04 (Wave 2) to guarantee the tokens exist before any banner renders.

Output: 5 new components + 4 unit tests. depends_on Plan 03 (Edge Fn handler) for type imports + Plan 04 (@theme tokens) for color tokens.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-CONTEXT.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-UI-SPEC.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-PATTERNS.md

# Verbatim shape templates:
@/Users/karstenhaldan/minisite/leanshot/src/components/admin/rag/QueueDetailPane.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/admin/rag/RejectReasonSheet.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/admin/rag/AddSourceSheet.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/admin/rag/EditChunkModal.tsx

# Reuse VERBATIM (do NOT copy — import from original):
@/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/ai/CitationPopover.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/admin/rag/TierBadge.tsx

# Types:
@/Users/karstenhaldan/minisite/leanshot/src/types/protocols.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write ProtocolReviewBanner + EvidenceSearchSheet + AiAssistModal (leaf components)</name>
  <files>src/components/admin/protocols/ProtocolReviewBanner.tsx, src/components/admin/protocols/EvidenceSearchSheet.tsx, src/components/admin/protocols/AiAssistModal.tsx, src/components/admin/protocols/__tests__/ProtocolReviewBanner.test.tsx, src/components/admin/protocols/__tests__/EvidenceSearchSheet.test.tsx, src/components/admin/protocols/__tests__/AiAssistModal.test.tsx</files>
  <action>
Implement leaf components first (no inter-dependency on ProtocolEditorPage). Each renders independently.

**ProtocolReviewBanner.tsx** (per PATTERNS.md "Phase 61 banner pattern" + UI-SPEC Surface 3):

```typescript
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface ProtocolReviewBannerProps {
  isAuthor: boolean;
  reviewerName?: string;
  onPublish?: () => Promise<void>;
  publishing?: boolean;
}

export function ProtocolReviewBanner({ isAuthor, reviewerName, onPublish, publishing }: ProtocolReviewBannerProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-card bg-[var(--color-rose-soft)] mb-6">
      <Clock className="size-4 text-[var(--color-warning)] shrink-0" aria-hidden="true" />
      {isAuthor ? (
        <span className="text-[13px] font-semibold text-[var(--color-warning)]">
          Pending review by another admin
        </span>
      ) : (
        <>
          <span className="text-[13px] font-semibold text-[var(--color-warning)]">
            Review as: {reviewerName ?? 'reviewer'}
          </span>
          {onPublish && (
            <Button
              size="sm"
              variant="primary"
              loading={publishing}
              onClick={onPublish}
              className="ms-auto"
            >
              Publish Protocol
            </Button>
          )}
        </>
      )}
    </div>
  );
}
```

Test (`ProtocolReviewBanner.test.tsx`):
- Author view: renders 'Pending review by another admin', NO 'Publish Protocol' button anywhere in DOM (`expect(screen.queryByText('Publish Protocol')).toBeNull()`)
- Reviewer view with onPublish: renders 'Review as: Dr. Smith', renders 'Publish Protocol' button, clicking calls onPublish

**EvidenceSearchSheet.tsx** (per PATTERNS.md `RejectReasonSheet` analog):

Imports: useState, useCallback from react; Search from lucide-react; Sheet (DS), Input (DS), Button (DS), Skeleton (DS), EmptyState (DS), Badge (DS); TierBadge from `@/components/admin/rag/TierBadge`; supabase from `@/lib/supabase`.

Props:
```typescript
export interface EvidenceSearchSheetProps {
  open: boolean;
  onClose: () => void;
  protocolId: string;
  stepId: string;
  onAttached: (newCount: number) => void;
}
```

Behavior:
- State: `query`, `results: RagChunk[]`, `loading`, `error`, `checked: Set<string>`
- Debounce search by 300ms; call `supabase.functions.invoke('rag-retrieve', { body: { query, k: 10, filters: { surface: 'coach' } } })` on submit
- Render results as a list of rows: chunk title (text-[13px] font-semibold) + snippet (text-[13px] text-[var(--color-text-secondary)] line-clamp-2) + `<TierBadge tier={c.tier} />` + checkbox
- "Attach {N} sources" button (primary, accent) at bottom; disabled when checked.size === 0
- On Attach click: for each checked chunk_id, INSERT into `public.protocol_evidence` `{protocol_id, step_id, citation_text: chunk.text.slice(0,200), rag_source_id: chunk.chunk_id, verbatim_quote: chunk.text}`. Use `Promise.all` for parallel inserts (or a single `.insert([...])` batch if Supabase supports it). On success → call onAttached(checked.size); close sheet.
- Loading state: 3 × Skeleton rows; `aria-busy={loading}` on results container
- Empty state: `<EmptyState title="No evidence found" body="Try a different search term or add sources to the RAG queue." />`
- Sheet shell: `<Sheet open={open} onClose={onClose} title="Cite evidence">`; role=dialog inherited from DS primitive

Test (`EvidenceSearchSheet.test.tsx`):
- Mock supabase.functions.invoke with vi.fn returning `{ data: { chunks: [...3 chunks] }, error: null }`
- Render with open=true, type a query, click Search → 3 chunks render
- Click 2 checkboxes → 'Attach 2 sources' button enabled
- Click Attach → mock supabase.from('protocol_evidence').insert called with 2 rows; onAttached called with 2; onClose called

**AiAssistModal.tsx** (per PATTERNS.md `EditChunkModal` analog + UI-SPEC AI-Assist Modal section):

Imports: Modal (DS), Button (DS), Skeleton (DS); AlertTriangle from lucide-react; supabase from `@/lib/supabase`; useToast hook from `@/hooks/useToast`.

Props:
```typescript
export interface AiAssistModalProps {
  open: boolean;
  onClose: () => void;
  protocolId: string | null;
  stepWeek: number;
  compound: string;
  priorStepsContext: string;
  onApply: (suggestion: { dose_mg: number; monitoring: string[] }) => void;
}
```

Behavior:
- State machine per PATTERNS.md `AiAssistModal` pattern: `{ status: 'idle' | 'loading' | 'loaded' | 'refusal' | 'error', suggestion?, message? }`
- On open && status==='idle': call `supabase.functions.invoke('protocol-ai-assist', { body: { protocol_id, step_week, compound, prior_steps_context } })`
- If response status 429 (or response.body.error === 'rate_limit_exceeded'): showToast('AI assist limit reached for today. Resets at midnight UTC.'); close modal
- If response.body.refusal === true: setState `{ status: 'refusal' }`; render warning + 'Go to RAG queue →' link (href='/admin/rag')
- If success: setState `{ status: 'loaded', suggestion: { dose_mg, monitoring, cited_chunk_ids } }`
- Loaded view: suggestion output area `<div aria-live="polite" className="p-4 rounded-card border border-[var(--color-border)] bg-[var(--color-surface-elevated)] text-[13px]">` showing dose_mg + monitoring chips + cited_chunk_ids count
- Footer: Cancel (secondary) + Apply (primary accent, aria-label=`Apply AI suggestion for week ${stepWeek}`)
- On Apply: call onApply({ dose_mg, monitoring }); close modal
- Loading: Skeleton in output area; aria-busy on Apply button

Test (`AiAssistModal.test.tsx`):
- Mock invoke to resolve with success payload → modal renders dose + monitoring; click Apply → onApply called with { dose_mg, monitoring }
- Mock invoke to resolve with refusal:true → modal renders 'Suggestion blocked' warning + 'Go to RAG queue →' link with href='/admin/rag'
- Mock invoke to reject with 429-shaped response → toast 'AI assist limit reached for today.' shown; modal closes
- Loading state: while invoke pending, Skeleton present, Apply button has aria-busy='true'

Constraints:
  - All typography: only text-[11px], text-[13px], text-[18px], text-heading
  - Only font-normal / font-semibold
  - All color refs MUST exist in @theme (rose-soft + warning-soft + surface-elevated all defined by Plan 04 Task 1 — guaranteed by Wave 2 ordering)
  - SELF_REVIEW_REJECTED is NOT this plan's concern — only ProtocolEditorPage handles it
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && test -f src/components/admin/protocols/ProtocolReviewBanner.tsx && test -f src/components/admin/protocols/EvidenceSearchSheet.tsx && test -f src/components/admin/protocols/AiAssistModal.tsx && npx vitest run --config vite.config.ts src/components/admin/protocols/__tests__/ProtocolReviewBanner.test.tsx src/components/admin/protocols/__tests__/EvidenceSearchSheet.test.tsx src/components/admin/protocols/__tests__/AiAssistModal.test.tsx 2>&1 | tail -20 | grep -E "passed|✓"</automated>
  </verify>
  <done>3 components render; 3 unit-test files all green (≥10 assertions total); ProtocolReviewBanner verified to NOT render Publish button for authors.</done>
</task>

<task type="auto">
  <name>Task 2: Write ProtocolStepRow + ProtocolEditorPage with state machine + version-on-edit</name>
  <files>src/components/admin/protocols/ProtocolStepRow.tsx, src/components/admin/protocols/ProtocolEditorPage.tsx, src/components/admin/protocols/__tests__/ProtocolEditorPage.test.tsx</files>
  <action>
**ProtocolStepRow.tsx** (per PATTERNS.md Step Row + UI-SPEC Surface 2 step rows):

Props:
```typescript
export interface ProtocolStepRowProps {
  step: ProtocolStep;
  evidenceCount: number;
  onChange: (patch: Partial<ProtocolStep>) => void;
  onRemove: () => void;
  onCiteEvidence: () => void;
  onAiAssist: () => void;
}
```

Layout: a `<tr>` (when inside table) or flex row. Cells:
- Week number — `<td className="text-[11px] font-mono">{step.week}</td>` (non-editable)
- dose_mg — Input DS primitive, `type="number"`, `step="0.1"`, `className="font-mono tabular-nums w-20"`, aria-label={`Week ${step.week} dose mg`}, onChange updates patch
- frequency — native `<select>` with options daily/weekly/bi-weekly/custom-cron; aria-label={`Week ${step.week} frequency`}
- if frequency === 'custom-cron': render extra Input for cron_string
- monitoring — array of 5 Pill DS primitives toggling on click; aria-pressed reflects inclusion
- Cite evidence button — Button variant="secondary", `text-[13px] font-semibold`, accent border via `border-[var(--color-primary)]`; click → onCiteEvidence(); badge `{evidenceCount > 0 && <span className="ms-1 text-[11px]">({evidenceCount})</span>}`
- Suggest button — Button variant="secondary", click → onAiAssist()
- Remove — icon-only Button (X icon), aria-label={`Remove step ${step.week}`}, click → onRemove() (parent handles undo Toast)

Evidence chips row (below the step row, spans full width):
- Render array of evidence items as small chips: `<button className="text-[11px] bg-[var(--color-surface-elevated)] px-2 py-1 rounded">` showing citation_text.slice(0, 30)
- click chip → opens CitationPopover (use anchor ref pattern from `src/components/dashboard/ai/CitationPopover.tsx`)
- Import CitationPopover verbatim: `import { CitationPopover } from '@/components/dashboard/ai/CitationPopover';`

**ProtocolEditorPage.tsx** (per PATTERNS.md `QueueDetailPane` analog + UI-SPEC Surface 2):

Exported as named export: `export function ProtocolEditorPage()`.

Resolve `:id` from window.location.pathname: parse `/admin/protocols/([^/]+)`. If no id in URL, render an EmptyState.

State:
- `protocol: Protocol | null` (the current version row being edited)
- `steps: ProtocolStep[]` (sorted by week asc)
- `evidence: Record<step_id, ProtocolEvidence[]>` (grouped)
- `loading`, `error`, `publishing`, `submitting`, `savingDraft`
- `evidenceSheet: { open: boolean; stepId?: string }`
- `aiAssistModal: { open: boolean; stepWeek?: number }`
- `currentUserId` via useStore selector

Load:
- On mount: fetch `protocols` row + protocol_steps + protocol_evidence via 3 supabase queries (or one RPC `get_protocol_for_edit` — not in Plan 02; do via direct selects with RLS). When editing a published version, also fetch the row to display rollback options.

Two-column grid layout: `grid gap-6 lg:grid-cols-[1fr_320px]`. Sticky metadata panel `lg:sticky lg:top-4 lg:self-start`.

Above grid: `{protocol.review_state === 'in_review' && <ProtocolReviewBanner isAuthor={isSelfCreated} reviewerName={...} onPublish={!isSelfCreated ? handlePublish : undefined} publishing={publishing} />}`

Left column — step builder:
- Protocol name Input (text-[18px] font-semibold, inline editable, onBlur saves draft)
- Compound picker — select with options: tirzepatide, retatrutide, ghrp-2, semaglutide, other
- Audience multiselect — Pill toggles for 'B2C', 'clinic'
- Table head: Week | Dose | Frequency | Monitoring | Evidence | Suggest | (remove)
- Map `steps` to `<ProtocolStepRow>` instances
- "Add week" Button at end — inserts step with week = max(week) + 1 (or 1 if no steps)

Right column — metadata panel:
- Protocol name (read-only mirror)
- Version badge: text-[11px] font-mono — `v{protocol.version}`
- ProtocolStatusBadge
- Created by (text-[13px] text-[var(--color-text-secondary)])
- "Save draft" Button (secondary; calls handleSaveDraft)
- "Submit for review" Button (primary, accent) — shown when review_state='draft' AND isSelfCreated (author submits own draft)
- "Rollback to v{N}" link (text-[13px] text-[var(--color-danger)]) — shown when there are archived versions for this protocol id; opens Confirm.tsx
- "Archive" Button (text-[13px] text-[var(--color-danger)]) — shown for non-archived states

Critical 2-person rule (PROTOCOL-04 UI Layer 2):
```typescript
const isSelfCreated = currentUserId === protocol?.created_by;
// DO NOT render Publish button when isSelfCreated. The ProtocolReviewBanner above already
// conditionally omits the Publish CTA via the onPublish prop. The metadata panel must NOT
// include any Publish button — Publish lives ONLY in the banner for reviewers.
```

`handlePublish` async:
```typescript
const { error } = await supabase.rpc('publish_protocol', {
  p_protocol_id: protocol.id,
  p_version: protocol.version,
});
if (error) {
  if (error.message?.includes('SELF_REVIEW_REJECTED') || error.code === '42501') {
    showToast({ tone: 'danger', message: 'Another admin must review this protocol before publish.' });
    return;
  }
  showToast({ tone: 'danger', message: error.message ?? 'Publish failed' });
  return;
}
showToast({ tone: 'success', message: 'Protocol published.' });
// Re-fetch
```

`handleSubmitReview` → `supabase.rpc('submit_protocol_for_review', { p_protocol_id, p_version })`.

`handleArchive` → confirm dialog → `supabase.rpc('archive_protocol', ...)`.

`handleRollback(targetVersion)` → confirm dialog → `supabase.rpc('rollback_protocol', { p_protocol_id, p_target_version: targetVersion })`.

`handleSaveDraft` — IMPORTANT versioning behavior (PROTOCOL-05):
- If `protocol.review_state === 'draft'`: UPDATE the existing row
- If `protocol.review_state === 'published'` AND user edits a field: INSERT a NEW row with `version = max(version) + 1`, `review_state = 'draft'`, same base_slug, name, compound, audience, created_by = currentUserId. Copy all steps + evidence to the new version (INSERT new rows referencing new protocol_version). Navigate to `/admin/protocols/{id}` showing the new draft version. Old published row remains live.
- If `review_state === 'in_review'`: disallow edits (read-only); show toast 'Cannot edit while in review.'

Step removal flow:
```typescript
const handleRemoveStep = (stepId: string) => {
  const removed = steps.find(s => s.id === stepId);
  setSteps(steps.filter(s => s.id !== stepId));
  showToast({
    message: `Week ${removed.week} removed. Undo?`,
    action: { label: 'Undo', onClick: () => setSteps(prev => [...prev, removed].sort((a,b) => a.week - b.week)) },
    duration: 6000,
  });
  // After 6s, persist removal: supabase.from('protocol_steps').delete().eq('id', stepId)
};
```

Test (`ProtocolEditorPage.test.tsx`) — at minimum 5 cases:

1. **Renders with author view (Publish button absent from DOM):**
   - Mock supabase to return a protocol with `created_by = 'user-A'`, `review_state = 'in_review'`
   - Mock useStore to return `currentUserId = 'user-A'` (author)
   - Render `<ProtocolEditorPage />`
   - Assert ProtocolReviewBanner renders 'Pending review by another admin'
   - Assert `screen.queryByText('Publish Protocol')` returns null (CRITICAL — DOM-level removal per PROTOCOL-04 UI layer)

2. **Renders with reviewer view (Publish button present):**
   - Same protocol with `created_by = 'user-A'`, but `currentUserId = 'user-B'` (reviewer)
   - Assert ProtocolReviewBanner renders 'Review as: ...' + 'Publish Protocol' button

3. **Publish RPC error with SELF_REVIEW_REJECTED → toast renders correct copy:**
   - Mock supabase.rpc to return `{ error: { code: '42501', message: 'SELF_REVIEW_REJECTED: publisher cannot equal creator' } }`
   - Click Publish button (in reviewer view)
   - Assert toast 'Another admin must review this protocol before publish.' rendered

4. **Step removal triggers undo Toast (not modal):**
   - Render with 3 steps; click Remove on step 2
   - Assert toast appears with 'Week 2 removed. Undo?' and an Undo action
   - Click Undo within 6s → step reappears

5. **Editing a published protocol creates a NEW version row:**
   - Mock supabase to return protocol with `review_state = 'published', version = 1`
   - User edits dose_mg in a step → handleSaveDraft triggered (or auto-save)
   - Assert `supabase.from('protocols').insert` called with payload including `version: 2, review_state: 'draft'`, same `id` (composite PK)
   - Assert all existing steps inserted as new protocol_steps with new protocol_version=2

Constraints:
  - Typography ceiling honored
  - 2-person UI layer: NO `disabled` attribute on Publish — full DOM removal
  - All RPCs called via `supabase.rpc(...)` not direct UPDATE
  - SELF_REVIEW_REJECTED detection: BOTH `error.message?.includes('SELF_REVIEW_REJECTED')` AND `error.code === '42501'` (per RESEARCH.md Pitfall 1)
  - Sticky metadata panel: `lg:sticky lg:top-4 lg:self-start`
  - `useReducedMotion()` gate on any framer-motion (Sheet/Modal/Toast — DS primitives already gated; no extra work needed)
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && test -f src/components/admin/protocols/ProtocolStepRow.tsx && test -f src/components/admin/protocols/ProtocolEditorPage.tsx && npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -E "error TS" | grep -E "(protocols/)" | (! grep -q .) && npx vitest run --config vite.config.ts src/components/admin/protocols/__tests__/ProtocolEditorPage.test.tsx 2>&1 | tail -20 | grep -E "passed|✓"</automated>
  </verify>
  <done>ProtocolStepRow + ProtocolEditorPage render; 5 unit-test cases green; author-view does NOT include Publish button in DOM (verified via queryByText null assertion); SELF_REVIEW_REJECTED → toast verified; version-on-edit verified via INSERT spy.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Author → Publish button | UI Layer 2: button completely absent from DOM for authors (not just `disabled`); DB Layer 1 (Plan 02 RPC) is the authoritative guard |
| Admin browser → protocol-ai-assist | JWT-authenticated invocation; Edge Fn enforces rate limit + PHARMA-02 |
| Admin browser → rag-retrieve | JWT-authenticated invocation (existing Phase 60 contract) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-61-05-01 | Elevation of privilege | Author bypasses 2-person rule by inspecting DOM and re-enabling disabled button | mitigate | NO disabled button shipped — full conditional render; DOM has zero Publish element when isSelfCreated. Plan 02 SECDEF RPC is the authoritative backstop |
| T-61-05-02 | Tampering | XSS via protocol name input rendered without escape | mitigate | React renders all user content escaped; protocol name read-only in summary card uses text children, not innerHTML |
| T-61-05-03 | Information disclosure | Cited verbatim_quote text from non-published RAG chunks leaking | accept | Evidence search calls rag-retrieve which already enforces approved-chunks-only filter; staff-only surface |
| T-61-05-04 | Tampering | UI bypasses version-on-edit by direct UPDATE of published row | mitigate | Plan 02 omitted an UPDATE RPC for published rows; staff RLS allows UPDATE but UI flow goes through handleSaveDraft which INSERTs new version. Detection at Layer 1 via published row immutability is deferred to Phase 63 tech debt (acceptable for v1.4 — staff is small + audited) |
</threat_model>

<verification>
- 5 unit tests pass: ProtocolReviewBanner, EvidenceSearchSheet, AiAssistModal, ProtocolEditorPage (5 cases), ProtocolStepRow (covered transitively by ProtocolEditorPage test)
- `npx tsc -p tsconfig.app.json --noEmit` shows no NEW errors in modified files
- Author-view DOM verification: `screen.queryByText('Publish Protocol')` returns null when `currentUserId === protocol.created_by`
- SELF_REVIEW_REJECTED toast verified via mock RPC + assertion on toast text
- Step-removal undo path verified (Toast with Undo action, NOT a confirm modal)
</verification>

<success_criteria>
- [ ] All 5 components exist and render
- [ ] 4 unit-test files green
- [ ] Author NEVER sees Publish button in DOM (conditional render)
- [ ] Publish RPC error with SELF_REVIEW_REJECTED → correct toast copy
- [ ] Editing published row → new version INSERT verified
- [ ] Step removal uses undo Toast (6s), not confirm modal
- [ ] Typography + @theme token discipline maintained
</success_criteria>

<output>
Create `.planning/phases/61-admin-protocol-creator/61-05-SUMMARY.md` documenting the 2-person UI layer mechanism, the version-on-edit flow, evidence attach flow, and rate-limit/refusal handling in AI-assist.
</output>
