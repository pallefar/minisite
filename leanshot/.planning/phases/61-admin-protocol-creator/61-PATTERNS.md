# Phase 61: Admin Protocol Creator — Pattern Map

**Mapped:** 2026-05-26
**Files analyzed:** 16 new/modified files
**Analogs found:** 14 / 16

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/components/admin/protocols/ProtocolsLayout.tsx` | component/layout | request-response | `src/components/admin/rag/RagLayout.tsx` | exact |
| `src/components/admin/protocols/ProtocolsListPage.tsx` | component/page | CRUD | `src/components/admin/rag/RagQueuePage.tsx` | exact |
| `src/components/admin/protocols/ProtocolEditorPage.tsx` | component/page | CRUD | `src/components/admin/rag/QueueDetailPane.tsx` | role-match |
| `src/components/admin/protocols/ProtocolStepRow.tsx` | component | CRUD | `src/components/admin/rag/QueueDetailPane.tsx` (row pattern) | partial |
| `src/components/admin/protocols/EvidenceSearchSheet.tsx` | component/sheet | request-response | `src/components/admin/rag/RejectReasonSheet.tsx` | role-match |
| `src/components/admin/protocols/AiAssistModal.tsx` | component/modal | request-response | `src/components/admin/rag/EditChunkModal.tsx` | role-match |
| `src/components/admin/protocols/ProtocolReviewBanner.tsx` | component/banner | request-response | `src/components/admin/rag/QueueDetailPane.tsx` (self-review badge) | partial |
| `src/components/admin/protocols/ProtocolStatusBadge.tsx` | component/badge | transform | `src/components/admin/rag/TierBadge.tsx` | exact |
| `src/components/admin/protocols/ProtocolKeyboardHelpModal.tsx` | component/modal | event-driven | `src/components/admin/rag/QueueKeyboardHelpModal.tsx` | exact |
| `src/components/admin/protocols/ProtocolSummaryCard.tsx` | component/card | CRUD | `src/components/admin/rag/TierBadge.tsx` + Card DS primitive | role-match |
| `src/components/admin/protocols/ClinicProtocolsPage.tsx` | component/page | CRUD | `src/components/admin/rag/RagQueuePage.tsx` | role-match |
| `src/components/admin/protocols/AdoptProtocolSheet.tsx` | component/sheet | CRUD | `src/components/admin/rag/RejectReasonSheet.tsx` | role-match |
| `src/components/protocols/PublicProtocolPage.tsx` | component/page | request-response | `src/components/knowledge/KnowledgeArticleDetailPage.tsx` | role-match |
| `supabase/migrations/20260526*_protocols_*.sql` | migration | CRUD | `supabase/migrations/20281201000002_phase60_secdef_rpcs.sql` | exact |
| `supabase/functions/protocol-ai-assist/index.ts` | Edge Fn | request-response | `supabase/functions/rag-tip-of-day-generate/index.ts` + `rag-retrieve/index.ts` | role-match |
| `src/lib/markdown/protocol-shortcode-plugin.ts` | utility | transform | `src/lib/rag/remark-citations.ts` | role-match |

---

## Pattern Assignments

### `src/components/admin/protocols/ProtocolsLayout.tsx` (layout, request-response)

**Closest analog:** `src/components/admin/rag/RagLayout.tsx`

**Conventions to follow:**
- Copy the `SUB_ROUTES` readonly const array + `resolveActive()` pathname function verbatim; change only `path` / `label` / `Component` entries.
- Pathname-based navigation — no react-router. Plain `<a href>` anchors so AdminShell re-matches module on nav.
- Sub-nav links use `aria-current="page"` on the active item.
- Active pill class: `bg-[var(--color-primary)] text-[var(--color-primary-foreground)]`; inactive: `text-[var(--color-text-secondary)] hover:text-[var(--color-primary)]`.
- Grid container: `grid gap-6 lg:grid-cols-[200px_1fr]`; content area: `max-w-screen-xl`.

**Imports pattern** (`RagLayout.tsx` lines 18-20):
```typescript
import { Suspense, lazy, useEffect, useState, type ComponentType } from 'react';
import { Card } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';
```

**Core sub-nav + route resolution pattern** (`RagLayout.tsx` lines 130-212):
```typescript
const SUB_ROUTES: readonly SubRoute[] = [
  { key: 'list',   label: 'Protocols',  path: 'list',   Component: ProtocolsListPage },
  { key: 'editor', label: 'Editor',     path: 'editor', Component: ProtocolEditorPage },
] as const;

function resolveActive(pathname: string): SubRoute {
  const m = pathname.match(/^\/admin\/protocols\/?(?:([^/]+).*)?$/);
  const seg = (m?.[1] ?? '').toLowerCase();
  return SUB_ROUTES.find((r) => r.path === seg) ?? SUB_ROUTES[0]!;
}
```

**Diff from analog:** Base path changes from `/admin/rag` to `/admin/protocols`. Sub-route list reflects protocols module surfaces (list, editor). No telemetry inline page — remove `RagTelemetryPage` co-located component.

---

### `src/components/admin/protocols/ProtocolsListPage.tsx` (page, CRUD)

**Closest analog:** `src/components/admin/rag/RagQueuePage.tsx`

**Conventions to follow:**
- `useStore` for `currentUserId` and `showToast` — same two-selector pattern (lines 67-82 of analog).
- Filter pills use `<Pill size="sm" active={filter === key} aria-pressed={...}>`.
- Keyboard handler on `window.addEventListener('keydown', handler)` with overlay-open guard.
- Empty state uses `<EmptyState illustration={...} title="..." body="..." />` DS primitive.
- Loading skeleton: `div.h-20.rounded-card.bg-[var(--color-surface-elevated)].animate-pulse` repeated 3×.
- Error state: `<p className="text-[13px] text-[var(--color-danger)]">{error}</p>`.

**Imports pattern** (`RagQueuePage.tsx` lines 13-34):
```typescript
import { CheckCheck, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import { useStore } from '@/lib/store';
import { ProtocolEditorPage } from './ProtocolEditorPage';
import { ProtocolKeyboardHelpModal } from './ProtocolKeyboardHelpModal';
import { ProtocolStatusBadge } from './ProtocolStatusBadge';
```

**Filter + list head pattern** (`RagQueuePage.tsx` lines 261-284):
```typescript
<div className="sticky top-0 bg-[var(--color-surface)] z-10 pb-3 border-b border-[var(--color-border)] mb-4">
  <div className="flex items-center gap-2 flex-wrap">
    <h1 className="text-[18px] font-semibold tracking-tight">Protocols</h1>
    <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>New Protocol</Button>
  </div>
  <div className="flex gap-1.5 flex-wrap mt-3">
    {FILTER_PILLS.map((fp) => (
      <Pill key={fp.key} size="sm" active={filter === fp.key} aria-pressed={filter === fp.key}
        onClick={() => setFilter(fp.key)}>{fp.label}</Pill>
    ))}
  </div>
</div>
```

**Keyboard shortcuts wiring** (`RagQueuePage.tsx` lines 212-253):
```typescript
useEffect(() => {
  const overlayOpen = helpOpen || editorOpen;
  if (overlayOpen) return undefined;
  const handler = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (typeof target.matches === 'function' &&
        target.matches('input, textarea, [contenteditable="true"]')) return;
    switch (e.key) {
      case 'n': case 'N': setCreateOpen(true); break;
      case 'j': case 'J': moveActive(+1); break;
      case 'k': case 'K': moveActive(-1); break;
      case '?': if (e.shiftKey) setHelpOpen(true); break;
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [helpOpen, editorOpen, moveActive]);
```

**Diff from analog:** Table replaces the card list (protocol list is columnar: Name | Compound | Audience | Version | Status | Last Updated | Actions). Self-review indicator becomes `ProtocolStatusBadge`. Two-column split moves to `ProtocolEditorPage`; list page is full-width. Add `aria-sort` on Name + Last Updated columns.

---

### `src/components/admin/protocols/ProtocolEditorPage.tsx` (page, CRUD)

**Closest analog:** `src/components/admin/rag/QueueDetailPane.tsx`

**Conventions to follow:**
- Sticky right metadata panel: `lg:sticky lg:top-4 lg:self-start` (line 126 of analog).
- 2-person rule: `isSelfCreated = currentUserId === protocol.created_by` — **conditional render removes Publish button entirely** (never `disabled`-only; see CONTEXT.md Area 2).
- Inline edit radio-group pattern for state machine fields (lines 154-191 of analog) — reuse for tier/status selector.
- Sticky action row at bottom of left column: `sticky bottom-0 bg-[var(--color-surface)] border-t border-[var(--color-border)] p-3 flex items-center gap-2`.
- Loading state: `[loading, setLoading]` + `[approving, setApproving]` pattern on async handlers.

**Props interface pattern** (`QueueDetailPane.tsx` lines 62-71):
```typescript
export interface ProtocolEditorPageProps {
  protocolId: string;
  currentUserId: string | null;
  onPublish: () => Promise<void>;
  onSaveDraft: () => Promise<void>;
  onSubmitReview: () => Promise<void>;
  onRollback?: (targetVersion: number) => Promise<void>;
}
```

**Two-column grid pattern** (`QueueDetailPane.tsx` lines 125-126):
```typescript
<aside className="grid gap-4 lg:sticky lg:top-4 lg:self-start">
  {/* step builder — left; metadata panel — right */}
```

Use `grid gap-6 lg:grid-cols-[1fr_320px]` per UI-SPEC §Surface 2.

**Conditional publish pattern** (`QueueDetailPane.tsx` line 103-105):
```typescript
// Publish button: conditional render — NOT disabled. Author never sees it.
{!isSelfCreated && reviewState === 'in_review' && (
  <Button size="sm" variant="primary" loading={publishing} onClick={handlePublish}>
    Publish Protocol
  </Button>
)}
```

**Diff from analog:** Left column holds `StepBuilderGrid` sub-component (not a source-text vs quote split). Right column is metadata panel. Adds `ProtocolReviewBanner` above the grid. `onRetract` replaces `onReject`.

---

### `src/components/admin/protocols/ProtocolStepRow.tsx` (component, CRUD)

**Closest analog:** `src/components/admin/rag/QueueDetailPane.tsx` (inline edit row, lines 154-191)

**Conventions to follow:**
- Field-level `aria-label="Week {N} {field_name}"` on every input (UI-SPEC interaction contract).
- `Input` DS primitive for `dose_mg`; add `className="font-mono tabular-nums"` for numeric field.
- `freq` select uses native `<select>` with same border/ring class as DS Input: `border border-[var(--color-border)] rounded-pill bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]`.
- Evidence chips below row: `TierBadge`-style chip with `var(--color-surface-elevated)` background + 11px/400 text — click opens `CitationPopover` via `anchorEl` ref pattern from `CitationPopover.tsx`.
- Remove button: icon-only, `aria-label="Remove step {week}"`, danger hover color.

**Evidence chip + popover hook pattern** (from `CitationPopover.tsx` lines 76-82):
```typescript
const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null);
const [activeCitationId, setActiveCitationId] = useState<string | null>(null);
// On evidence chip click:
setPopoverAnchor(e.currentTarget);
setActiveCitationId(citation.rag_source_id);
```

**Diff from analog:** No radio-group tier selector. Fields are `dose_mg` + `frequency` select + `monitoring[]` multiselect pills + "Cite evidence" button + "Suggest" button. Full row rendered in a `<tr>` or grid-row context.

---

### `src/components/admin/protocols/EvidenceSearchSheet.tsx` (sheet, request-response)

**Closest analog:** `src/components/admin/rag/RejectReasonSheet.tsx`

**Conventions to follow:**
- `<Sheet open={open} onClose={onClose} title="Cite evidence">` — Sheet DS primitive wraps all content. `role="dialog"` + `aria-modal="true"` inherited from primitive.
- Arrow-key cycling inside `role="radiogroup"` → extend to checkboxes with `ArrowDown`/`ArrowUp` + `Space` to toggle.
- Loading skeleton: three `<Skeleton>` DS primitive rows while `rag-retrieve` call is in flight.
- Empty state: `<EmptyState>` micro variant inline (no heading CTA needed per copywriting contract).
- Results list: `TierBadge` reuse on each chunk result row.

**Sheet wrapper pattern** (`RejectReasonSheet.tsx` lines 64-66):
```typescript
return (
  <Sheet open={open} onClose={onClose} title="Cite evidence">
    <div role="listbox" aria-label="RAG evidence results" aria-live="polite" aria-busy={loading}>
```

**Keyboard handler pattern** (`RejectReasonSheet.tsx` lines 42-57):
```typescript
const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIdx((p) => (p + 1) % results.length); }
  if (e.key === 'ArrowUp')   { e.preventDefault(); setFocusIdx((p) => (p - 1 + results.length) % results.length); }
  if (e.key === ' ')         { e.preventDefault(); toggleCheck(results[focusIdx]?.id); }
};
```

**Diff from analog:** No radio-group (single-select) — this is a multi-select checkbox list. Search input added above result list. "Attach {N} sources" CTA button at bottom. Calls `rag-retrieve` Edge Fn (via `src/lib/rag/retrieve-client.ts`) with `query` from search box.

---

### `src/components/admin/protocols/AiAssistModal.tsx` (modal, request-response)

**Closest analog:** `src/components/admin/rag/EditChunkModal.tsx`

**Conventions to follow:**
- `<Modal open={open} onClose={onClose} title="AI Suggestion" size="lg">` — Modal DS primitive.
- `role="dialog"` + `aria-modal="true"` inherited from Modal primitive.
- Loading state: `[loading, setLoading]` flag + `aria-busy={loading}` on Apply button.
- Error branch renders before loading branch; success renders suggestion output area.
- Footer action row: `<div className="flex items-center justify-end gap-2 pt-2">` with Cancel (secondary) + Apply (primary, accent).

**Modal + state pattern** (`EditChunkModal.tsx` lines 29-45):
```typescript
export function AiAssistModal({ open, step, protocol, onClose, onApply }: AiAssistModalProps) {
  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'loaded'; suggestion: AiSuggestion }
    | { status: 'refusal' }
    | { status: 'error'; message: string }
  >({ status: 'idle' });
  const [applying, setApplying] = useState(false);
```

**Suggestion output area pattern** (follow `EditChunkModal.tsx` textarea bg convention):
```typescript
<div
  aria-live="polite"
  aria-busy={state.status === 'loading'}
  className="p-4 rounded-card border border-[var(--color-border)] bg-[var(--color-surface-elevated)] text-[13px]"
>
  {state.status === 'loading' && <Skeleton />}
  {state.status === 'loaded' && <SuggestionContent suggestion={state.suggestion} />}
  {state.status === 'refusal' && <RefusalMessage />}
</div>
```

**Diff from analog:** No textarea — suggestion is server-generated, read-only. Adds refusal state rendering (warning icon + "Go to RAG queue →" link). Adds rate-limit Toast trigger on 429 response from Edge Fn. Apply writes `dose_mg` + `monitoring[]` back to step row via `onApply` callback.

---

### `src/components/admin/protocols/ProtocolReviewBanner.tsx` (banner, request-response)

**Closest analog:** `src/components/admin/rag/QueueDetailPane.tsx` lines 237-239 (self-review warning badge)

**Conventions to follow:**
- Warning tone: `bg-[var(--color-rose-soft)]` (= `#fbe4dc` per UI-SPEC) outer container.
- Text: `text-[13px] font-semibold text-[var(--color-warning)]`.
- `Clock` icon from lucide-react with `aria-hidden="true"`.
- Full DOM removal of Publish button for author (conditional render, not disabled+hidden).

**Warning badge extract pattern** (`QueueDetailPane.tsx` lines 237-239):
```typescript
{isSelfCreated && (
  <Badge tone="warning">You created this — needs a different reviewer</Badge>
)}
```

**Phase 61 banner pattern** (extend to full-width banner):
```typescript
export function ProtocolReviewBanner({ isAuthor, reviewerName, onPublish, publishing }: Props) {
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
            Review as: {reviewerName}
          </span>
          <Button size="sm" variant="primary" loading={publishing} onClick={onPublish}
            className="ms-auto">
            Publish Protocol
          </Button>
        </>
      )}
    </div>
  );
}
```

**Diff from analog:** Standalone component (not inline in detail pane). Two visual modes: author (banner only) vs reviewer (banner + Publish CTA). Width is full-column, not a chip.

---

### `src/components/admin/protocols/ProtocolStatusBadge.tsx` (badge, transform)

**Closest analog:** `src/components/admin/rag/TierBadge.tsx`

**Conventions to follow:**
- Thin wrapper around `<Badge>` DS primitive — one component, one prop, one render.
- Explicit `aria-label` per tier describing semantics.
- Tone mapping mirrors TierBadge tone logic.

**TierBadge pattern** (`TierBadge.tsx` lines 15-35 — copy verbatim, change props):
```typescript
import { Badge } from '@/components/ui/Badge';

export type ProtocolStatus = 'draft' | 'in_review' | 'published' | 'archived';

const TONE_MAP: Record<ProtocolStatus, 'neutral' | 'warning' | 'success' | 'muted'> = {
  draft:     'neutral',
  in_review: 'warning',
  published: 'success',
  archived:  'muted',
};

const ARIA_MAP: Record<ProtocolStatus, string> = {
  draft:     'Protocol status: draft',
  in_review: 'Protocol status: pending review',
  published: 'Protocol status: published',
  archived:  'Protocol status: archived',
};

export function ProtocolStatusBadge({ status }: { status: ProtocolStatus }) {
  return (
    <Badge tone={TONE_MAP[status]} aria-label={ARIA_MAP[status]}>
      {status.replace('_', ' ')}
    </Badge>
  );
}
```

**Diff from analog:** Status domain differs from RAG tier domain. Four-value enum vs three-value. Tones: success=published, warning=in_review, neutral=draft, muted=archived (muted may need DS Badge tone extension if not present — check `src/components/ui/Badge.tsx` before writing).

---

### `src/components/admin/protocols/ProtocolKeyboardHelpModal.tsx` (modal, event-driven)

**Closest analog:** `src/components/admin/rag/QueueKeyboardHelpModal.tsx`

**Conventions to follow:**
- Copy file verbatim. Change only the `SHORTCUTS` const array.
- `<Modal open={open} onClose={onClose} title="Keyboard shortcuts" size="sm">`.
- `<kbd>` chips: `h-6 min-w-[1.5rem] px-1.5 rounded text-[11px] font-mono bg-[var(--color-surface-elevated)] border border-[var(--color-border)]`.

**Shortcuts list** (`QueueKeyboardHelpModal.tsx` lines 12-18 — replace content):
```typescript
const SHORTCUTS = [
  { key: 'N',        description: 'New protocol' },
  { key: 'J / K',   description: 'Next / Previous row' },
  { key: 'Shift + ?', description: 'Show/hide this help' },
] as const;
```

**Diff from analog:** Fewer shortcuts (A/R/E not applicable). Add `N` for new protocol.

---

### `src/components/admin/protocols/ProtocolSummaryCard.tsx` (card, CRUD)

**Closest analog:** `src/components/admin/rag/TierBadge.tsx` composition + Card DS primitive

**Conventions to follow:**
- Use `<Card variant="flat" padding="md">` DS primitive.
- Compound (13px/400, `var(--color-text-secondary)`) below protocol name.
- Week count badge: `<Badge tone="neutral">` with `text-[11px]` label.
- Link: `var(--color-primary)` text color — the one permitted accent use on interactive links (UI-SPEC reserved-for #4 equivalent).
- Citation footnotes `[N]` styled identically to Phase 60-10 AI-coach citation markers: `text-[11px] text-[var(--color-text-secondary)]`.

**Card pattern** (DS `Card.tsx` usage from existing analogs):
```typescript
export function ProtocolSummaryCard({ protocol }: { protocol: ProtocolSummaryData }) {
  return (
    <Card variant="flat" padding="md" className="max-w-[480px] w-full">
      <div className="space-y-1">
        <p className="text-[13px] font-semibold">{protocol.title}</p>
        <p className="text-[13px] text-[var(--color-text-secondary)]">{protocol.compound}</p>
        <div className="flex items-center gap-2 mt-2">
          <Badge tone="neutral" className="text-[11px]">{protocol.week_count} weeks</Badge>
          <a href={`/protocols/${protocol.slug}`}
            className="text-[13px] text-[var(--color-primary)] hover:underline ms-auto">
            View full protocol →
          </a>
        </div>
      </div>
    </Card>
  );
}
```

**Diff from analog:** No existing inline-card-in-KB analog. Builds from Card primitive. Citation footnotes list appended below card when present.

---

### `src/components/admin/protocols/ClinicProtocolsPage.tsx` (page, CRUD)

**Closest analog:** `src/components/admin/protocols/ProtocolsListPage.tsx` (the new file above)

**Conventions to follow:**
- Same table shape as `ProtocolsListPage` minus admin-only actions (no Edit, no Archive, no Submit-for-review columns).
- Filter pills: Compound + Audience only (not status-based).
- Per-row "Adopt for patient" CTA: accent primary button, min 44px height.
- Empty state copy differs (UI-SPEC copywriting: "No published protocols" / "Protocols appear here once approved by two admins.").
- Auth guard: clinician role only; redirect if no `clinician` flag on profile.

**Diff from analog:** Clinician surface, not admin. No 2-person review UI. Adds "Adopt for patient" button opening `AdoptProtocolSheet`. List is read-only filtered to `status = 'published'`.

---

### `src/components/admin/protocols/AdoptProtocolSheet.tsx` (sheet, CRUD)

**Closest analog:** `src/components/admin/rag/RejectReasonSheet.tsx`

**Conventions to follow:**
- `<Sheet open={open} onClose={onClose} title="Adopt Protocol">` — Sheet DS primitive.
- Patient picker: reuse Phase 30 roster patient-list component (import path TBD at plan time — confirm in Phase 30 source).
- "Preview assignment" advances to `AdoptDiffModal` (controlled state in parent).
- Escape closes sheet per DS Sheet primitive default.

**Diff from analog:** Two-step flow (picker → diff modal → confirm) vs one-step reject reason. Does not close on select — advances to next step.

---

### `src/components/protocols/PublicProtocolPage.tsx` (page, request-response)

**Closest analog:** `src/components/knowledge/KnowledgeArticleDetailPage.tsx`

**Conventions to follow:**
- Single-column, `max-w-[680px] mx-auto` layout.
- `useParams` (react-router is used in admin surfaces per `reference_react_router_consumer_admin_split`; confirm at plan time whether public `/protocols/:slug` uses react-router or Zustand TabId routing).
- `noindex` meta: `<Helmet><meta name="robots" content="noindex" /></Helmet>` (Phase 60-13 analog line 22 uses react-helmet-async).
- 404 state uses `<EmptyState>` DS primitive (not the full `KnowledgeNotFound` sub-component).
- Auth gate: redirect to login if no active session (only `status = 'published'` resolvable).
- Typography: H1 at `text-heading` (28px/600); section headings 18px/600; body 13px/400.
- Step table: read-only columns (Week | Dose | Frequency | Monitoring) — no inputs.

**Imports pattern** (`KnowledgeArticleDetailPage.tsx` lines 23-35):
```typescript
import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import { useNavigate, useParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { supabase } from '@/lib/supabase';
```

**Diff from analog:** No sidebar or breadcrumb. No related-chunks panel. Protocol-specific schema (steps table, evidence footnotes). SEO is `noindex` (clinical content, not crawlable).

---

### `supabase/migrations/20260526*_protocols_*.sql` (migration, CRUD)

**Closest analog:** `supabase/migrations/20281201000002_phase60_secdef_rpcs.sql`

**Conventions to follow:**
- Every SECDEF RPC: `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_catalog`.
- Opens with: `if not public.is_staff() then raise exception 'not authorized' using errcode = '42501'; end if;`.
- 2-person rule guard for `publish_protocol`: `if v_created_by = auth.uid() then raise exception '...' using errcode = '42501'; end if;` — mirror `approve_rag_chunk` lines 66-71 exactly. Use error code `SELF_REVIEW_REJECTED` in message body for UI toast consumption.
- `REVOKE ALL ON FUNCTION ... FROM public;` then `GRANT EXECUTE ON FUNCTION ... TO authenticated;` — both lines after every RPC definition.
- State machine guard: check current status before transition, raise exception on invalid transition.
- `FOR UPDATE` row lock before state check to prevent concurrent races (lines 52-58 of analog).
- `CREATE OR REPLACE` for idempotency.
- Patient-facing tables (`patient_protocol_assignment`): RLS policy uses `auth.uid() = patient_id` (not `is_staff()`).
- All other protocol tables: `USING (public.is_staff())` per `reference_supabase_is_staff_helper`.
- `text[]` for `monitoring` column (CONTEXT.md decision — not a lookup table).

**SECDEF RPC skeleton** (`approve_rag_chunk` lines 36-93):
```sql
create or replace function public.publish_protocol(
  p_protocol_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_created_by uuid;
  v_status     text;
begin
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select created_by, status
  into   v_created_by, v_status
  from   public.protocols
  where  id = p_protocol_id
  for    update;

  if not found then
    raise exception 'protocol % not found', p_protocol_id;
  end if;

  if v_created_by is not null and v_created_by = auth.uid() then
    raise exception 'SELF_REVIEW_REJECTED: publisher (%) cannot equal creator (%)',
      auth.uid(), v_created_by
      using errcode = '42501';
  end if;

  if v_status <> 'in_review' then
    raise exception 'cannot publish protocol in status %', v_status;
  end if;

  update public.protocols
  set    status      = 'published',
         published_at = now(),
         reviewed_by  = auth.uid()
  where  id = p_protocol_id;

  insert into public.protocol_review_log (protocol_id, version, actor, action)
  values (p_protocol_id, (select version from public.protocols where id = p_protocol_id), auth.uid(), 'published');
end
$$;

revoke all on function public.publish_protocol(uuid) from public;
grant execute on function public.publish_protocol(uuid) to authenticated;
```

**Diff from analog:** Protocol RPCs add `protocol_review_log` audit INSERT inside each state transition. `rollback_protocol` function takes `target_version` parameter (archive current, re-publish target). Seed data (3 reference protocols) in a separate `20260526*_protocol_seed.sql` migration.

---

### `supabase/functions/protocol-ai-assist/index.ts` (Edge Fn, request-response)

**Closest analog:** `supabase/functions/rag-tip-of-day-generate/index.ts` + `supabase/functions/rag-retrieve/index.ts`

**Conventions to follow:**
- `Deno.serve` guarded by `if (import.meta.main)` per `reference_deno_test_top_level_serve_trap`.
- OpenRouter via native `fetch` (not SDK): `POST https://openrouter.ai/api/v1/chat/completions` with `Authorization: Bearer ${Deno.env.get('OPENROUTER_API_KEY')}`.
- Required headers: `HTTP-Referer: https://leanshot.app`, `X-Title: LeanShot`.
- Model: `anthropic/claude-sonnet-4-5` (OpenRouter dotted convention; NOT hyphenated — hyphenated rule applies only for direct Anthropic API).
- PostHog model field: `openrouter/anthropic/claude-sonnet-4-5`.
- Auth: Bearer `SUPABASE_SERVICE_ROLE_KEY` or admin JWT — choose per caller context.
- Emit `$ai_generation` + `$ai_evaluation` via `emitAiGeneration` from `_shared/posthog-rag-events.ts`.
- PHARMA-02 layer 2: import `isPharma02GatedTopic` from `_shared/pharma-02-carveout.ts` and check BEFORE OpenRouter call.
- Rate-limit check: query `admin_ai_assist_log` — count today's rows for `auth.uid()`; if >= 50 return 429 with JSON `{ error: 'rate_limit_exceeded', resets_at: '<midnight UTC ISO>' }`.
- Refusal: if `cited_chunk_ids.length === 0` from RAG retrieve → set `refusal: true` in response, skip OpenRouter call.
- `await shutdownPostHog()` in `finally` block before returning Response.
- Zod input validation: `query` (step context string) + `protocol_id` (uuid) + `step_week` (int) + `compound` (string).

**Env vars:**
```typescript
const apiKey     = Deno.env.get('OPENROUTER_API_KEY') ?? '';
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const posthogKey  = Deno.env.get('POSTHOG_PROJECT_KEY'); // optional; no-op if absent
```

**OpenRouter call pattern** (`rag-tip-of-day-generate/index.ts` env + fetch shape):
```typescript
const MODEL = 'anthropic/claude-sonnet-4-5';
const POSTHOG_MODEL = 'openrouter/anthropic/claude-sonnet-4-5';

const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://leanshot.app',
    'X-Title': 'LeanShot',
  },
  body: JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    max_tokens: 512,
  }),
});
```

**Response schema** (structured JSON output):
```typescript
// Expected Edge Fn response shape
interface AiAssistResponse {
  dose_mg: number;
  monitoring: string[];
  cited_chunk_ids: string[];
  refusal: boolean;
  refusal_reason?: string;
}
```

**Diff from analog:** Single user request (not cron-driven batch). Rate-limit via `admin_ai_assist_log` table (50/day/admin). Shorter output schema (dose_mg + monitoring[] + cited_chunk_ids vs full tip). Injects top-5 RAG chunks via `rag-retrieve` shared helper. No push-dispatch step.

---

### `src/lib/markdown/protocol-shortcode-plugin.ts` (utility, transform)

**Closest analog:** `src/lib/rag/remark-citations.ts`

**Conventions to follow:**
- Pure function — no React imports, no side effects, no network calls.
- Export a single named function (no default export, matching `parseCitations` pattern).
- Regex pattern: `\[protocol:([0-9a-f-]{36})\]` matching `[protocol:<uuid>]` tokens.
- Returns `{ segments, protocols }` parallel to `{ segments, citations }` in analog.
- UUID regex reset before use: `REGEX.lastIndex = 0`.

**Parser structure** (`remark-citations.ts` lines 67-116 — mirror structure):
```typescript
const PROTOCOL_SHORTCODE_REGEX = /\[protocol:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;

export function parseProtocolShortcodes(text: string): ProtocolParseResult {
  const segments: ProtocolSegment[] = [];
  const protocols: ProtocolRef[] = [];
  const seen = new Map<string, number>();

  let lastIndex = 0;
  PROTOCOL_SHORTCODE_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = PROTOCOL_SHORTCODE_REGEX.exec(text)) !== null) {
    // ... same slice/push pattern as parseCitations
  }
  return { segments, protocols };
}
```

**Diff from analog:** Token format is `[protocol:<uuid>]` vs `[<uuid>]`. Returns protocol refs (not citation refs). The KB renderer uses this to inject `<ProtocolSummaryCard>` inline (resolved at render time via Supabase query, not pre-loaded).

---

### `eval/phase61/protocol-ai-assist.test.ts` (test, request-response)

**Closest analog:** `tests/eval/phase38/precision-at-3.test.ts`

**Conventions to follow:**
- `SHOULD_RUN_EVAL` guard: `describe.skip` when env var not set (prevents CI eval calls on PRs).
- Vitest `describe`/`it`/`expect` imports.
- Fixture-driven: load gold-set from a local JSON/JSONL file — do not hardcode test cases inline.
- Per-case assertions with descriptive `expect(cond, message).toBe(true)` (not `toBeTruthy()`).

**Test structure pattern** (`precision-at-3.test.ts` lines 14-20):
```typescript
import { describe, expect, it } from 'vitest';
import { SHOULD_RUN_EVAL } from '../_fixtures/refset.ts';

const describeIfLive = SHOULD_RUN_EVAL ? describe : describe.skip;

describeIfLive('Phase 61 protocol-ai-assist eval', () => {
  // per-case: call Edge Fn, assert dose_mg in safe range, assert cited_chunk_ids.length >= 1,
  // assert refusal:false for valid compounds, assert refusal:true when no RAG evidence
});
```

**Diff from analog:** Test target is `protocol-ai-assist` Edge Fn (not recommender). Assertions focus on: (1) `cited_chunk_ids.length >= 1` when refusal=false, (2) `dose_mg` within pharmacologically reasonable range for the compound, (3) `refusal:true` when test query has no matching RAG chunks, (4) 429 response after 50 requests/day fixture.

---

## Shared Patterns

### 2-Person Review (SECDEF + UI)
**Source:** `supabase/migrations/20281201000002_phase60_secdef_rpcs.sql` lines 64-71 (DB layer) + `src/components/admin/rag/RagQueuePage.tsx` lines 141-143 (UI layer)
**Apply to:** `publish_protocol` RPC (DB) + `ProtocolEditorPage.tsx` + `ProtocolReviewBanner.tsx` (UI)
```sql
-- DB layer (approve_rag_chunk lines 64-71):
if v_created_by is not null and v_created_by = auth.uid() then
  raise exception '2-person rule: publisher (%) cannot equal creator (%)',
    auth.uid(), v_created_by
    using errcode = '42501';
end if;
```
```typescript
// UI layer (RagQueuePage.tsx line 141-143):
const handleApprove = useCallback(async (row: ReviewQueueRow) => {
  if (row.created_by === currentUserId) return; // 2-person rule UI guard
```

### Typography Ceiling (Hard Constraint)
**Source:** `src/components/admin/rag/QueueDetailPane.tsx` (file comment lines 7-9) + `61-UI-SPEC.md` §Typography
**Apply to:** All Phase 61 component files
```
ONLY: text-[11px] / text-[13px] / text-[18px] / text-heading
FORBIDDEN: text-base, text-lg, text-sm, text-xl, text-2xl, any ad-hoc px outside {11,13,18,28}
WEIGHTS: font-normal (400) body | font-semibold (600) headings/buttons
MONO: font-mono tabular-nums on dose_mg inputs and version numbers
```

### Tailwind v4 Token Safety
**Source:** `src/index.css` `@theme {}` block (Phase 60 BLOCKER lesson)
**Apply to:** All Phase 61 component files
```
Only use tokens defined in src/index.css @theme {}.
New tokens required for Phase 61:
  var(--color-rose-soft)       — #fbe4dc (review banner background)
  var(--color-surface-elevated) — already defined (Phase 60)
  var(--color-warning-soft)    — verify exists; if not, add to @theme
```

### `is_staff()` RLS Guard
**Source:** `supabase/migrations/20261101000006_is_staff_helper.sql`
**Apply to:** All admin-facing protocol table RLS policies
```sql
-- Staff RLS policy (all admin protocol tables):
create policy "staff_only" on public.protocols
  for all using (public.is_staff());

-- Patient-facing table:
create policy "own_assignments" on public.patient_protocol_assignment
  for select using (auth.uid() = patient_id);
```

### `useReducedMotion()` Animation Gate
**Source:** `src/components/admin/rag/QueueDetailPane.tsx` line 84 + `src/components/dashboard/ai/CitationPopover.tsx` lines 94, 339
**Apply to:** All Phase 61 Sheet and Modal component files
```typescript
import { useReducedMotion } from '@/hooks/useReducedMotion';
const reducedMotion = useReducedMotion();
// On framer-motion variants:
initial={reducedMotion ? {} : { opacity: 0, x: 40 }}
animate={reducedMotion ? {} : { opacity: 1, x: 0 }}
```

### PostHog `$ai_generation` + `$ai_evaluation` Emission
**Source:** `supabase/functions/_shared/posthog-rag-events.ts` + `supabase/functions/rag-tip-of-day-generate/index.ts` lines 43-44
**Apply to:** `supabase/functions/protocol-ai-assist/index.ts`
```typescript
import { emitAiGeneration, shutdownPostHog } from '../_shared/posthog-rag-events.ts';
// In finally block:
await shutdownPostHog();
// After successful OpenRouter call:
await emitAiGeneration({
  userId: adminUserId,
  model: POSTHOG_MODEL,               // 'openrouter/anthropic/claude-sonnet-4-5'
  prompt_tokens: usage.prompt_tokens,
  completion_tokens: usage.completion_tokens,
  trace_id: crypto.randomUUID(),
  surface: 'protocol_ai_assist',      // new surface tag
  vendor_field: 'openrouter_anthropic', // per Phase 60 CR-01
});
```

### OpenRouter HTTP Pattern
**Source:** `supabase/functions/rag-tip-of-day-generate/index.ts` (OpenRouter fetch body)
**Apply to:** `supabase/functions/protocol-ai-assist/index.ts`
```typescript
// Required headers + dotted model ID (OpenRouter convention):
const MODEL = 'anthropic/claude-sonnet-4-5';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
headers: {
  'Authorization': `Bearer ${Deno.env.get('OPENROUTER_API_KEY')}`,
  'HTTP-Referer': 'https://leanshot.app',
  'X-Title': 'LeanShot',
  'Content-Type': 'application/json',
}
```

### Admin Module Manifest Registration
**Source:** `src/lib/admin/modules.ts` lines 52-60 (AdminModule interface)
**Apply to:** `src/lib/admin/modules.ts` (modification — add `protocols` entry)
```typescript
// Add to ADMIN_MODULES array:
{
  key: 'protocols',
  label: 'Protocols',
  route: 'protocols',
  icon: ClipboardListIcon,  // from lucide-react
  lazy: () => import('@/components/admin/protocols/ProtocolsLayout'),
  flagKey: 'admin_protocols',
  minRole: 'admin',
}
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/components/admin/protocols/AdoptDiffModal.tsx` | modal | CRUD | Two-column diff layout has no existing analog. Closest: Modal DS primitive + custom diff rendering. Use `grid grid-cols-2 gap-4` inside Modal body with "Current schedule" vs "Protocol expectation" headers. |
| `src/components/dashboard/tabs/MedicationTab.tsx` (extension) | modification | CRUD | Extension to existing file; not a new file. Pattern: find `patient_protocol_assignment` for active patient, compute current week from `started_at`, inject `Expected: Xmg` row beneath empty dose entries. |

---

## Metadata

**Analog search scope:** `src/components/admin/rag/`, `src/components/admin/`, `src/components/dashboard/ai/`, `src/components/knowledge/`, `src/lib/rag/`, `src/lib/admin/`, `supabase/functions/rag-*/`, `supabase/functions/helpdesk-ai-assist/`, `supabase/functions/_shared/`, `supabase/migrations/20281201*`, `tests/eval/phase38/`
**Files scanned:** 18
**Pattern extraction date:** 2026-05-26
