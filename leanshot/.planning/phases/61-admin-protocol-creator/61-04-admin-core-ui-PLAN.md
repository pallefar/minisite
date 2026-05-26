---
phase: 61-admin-protocol-creator
plan: 04
type: execute
wave: 1
depends_on:
  - 61-01-db-tables-rls
files_modified:
  - src/components/admin/protocols/ProtocolsLayout.tsx
  - src/components/admin/protocols/ProtocolsListPage.tsx
  - src/components/admin/protocols/ProtocolStatusBadge.tsx
  - src/components/admin/protocols/ProtocolKeyboardHelpModal.tsx
  - src/components/admin/protocols/__tests__/ProtocolsListPage.test.tsx
  - src/components/admin/protocols/__tests__/ProtocolStatusBadge.test.tsx
  - src/lib/admin/modules.ts
  - src/index.css
autonomous: true
requirements:
  - PROTOCOL-02
must_haves:
  truths:
    - "Visiting /admin/protocols renders ProtocolsLayout with sub-nav + ProtocolsListPage as default child"
    - "ProtocolsListPage lists rows from `public.protocols` filtered by review_state pills (All / Published / In Review / Draft / Archived) with empty-state copy 'No protocols yet'"
    - "New Protocol CTA (top-right, accent primary) inserts a draft row and routes to /admin/protocols/<id>"
    - "Keyboard shortcuts: N=new, J/K=row nav, Shift+? help modal, ?-key opens help"
    - "ProtocolStatusBadge renders for 4 statuses with correct tones (success/warning/neutral/muted) + aria-label"
    - "Admin module manifest includes `protocols` entry; AdminShell switch handles the new module"
    - "`src/index.css` @theme block includes `--color-rose-soft: #fbe4dc` and `--color-warning-soft` (if not already present)"
    - "All Phase 61 components use only allowed typography tokens (text-[11px], text-[13px], text-[18px], text-heading) and only @theme-defined color tokens"
  artifacts:
    - path: "src/components/admin/protocols/ProtocolsLayout.tsx"
      provides: "Pathname-based sub-nav + Suspense boundary; exports default ProtocolsLayout"
      contains: "ProtocolsLayout"
    - path: "src/components/admin/protocols/ProtocolsListPage.tsx"
      provides: "List + filter + keyboard + New Protocol CTA"
      contains: "ProtocolsListPage"
    - path: "src/components/admin/protocols/ProtocolStatusBadge.tsx"
      provides: "Thin Badge wrapper for protocol_review_state ENUM"
      exports: ["ProtocolStatusBadge"]
    - path: "src/components/admin/protocols/ProtocolKeyboardHelpModal.tsx"
      provides: "Modal listing N/J/K/?-key shortcuts"
      exports: ["ProtocolKeyboardHelpModal"]
    - path: "src/lib/admin/modules.ts"
      provides: "ADMIN_MODULES manifest with new 'protocols' entry registered"
      contains: "key: 'protocols'"
  key_links:
    - from: "ProtocolsLayout"
      to: "src/lib/admin/modules.ts manifest"
      via: "lazy() import declared in ADMIN_MODULES entry"
      pattern: "@/components/admin/protocols/ProtocolsLayout"
    - from: "ProtocolsListPage"
      to: "public.protocols"
      via: "supabase.from('protocols').select(...)"
      pattern: "from\\('protocols'\\)"
    - from: "All Phase 61 component files"
      to: "src/index.css @theme tokens"
      via: "var(--color-rose-soft) and similar — verified defined"
      pattern: "rose-soft"
---

<objective>
Ship the admin Protocols module shell + list page + status badge + keyboard help modal + admin manifest registration + missing @theme tokens. This is the entry point at `/admin/protocols` for PROTOCOL-02.

Purpose: Provides the navigation skeleton and list view per UI-SPEC Surfaces 1. Reuses the RagLayout + RagQueuePage analog VERBATIM in structure — only label/path/Component entries change. Adds missing Tailwind v4 tokens (per Phase 60 UI BLOCKER lesson) so subsequent Phase 61 plans can use `var(--color-rose-soft)` and `var(--color-warning-soft)` without invisible-render bugs.

Output: 4 new components, 2 unit tests, 1 manifest modification, 1 CSS token additions.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-CONTEXT.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-UI-SPEC.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-PATTERNS.md

# Verbatim analog files — mirror structure exactly:
@/Users/karstenhaldan/minisite/leanshot/src/components/admin/rag/RagLayout.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/admin/rag/RagQueuePage.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/admin/rag/TierBadge.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/admin/rag/QueueKeyboardHelpModal.tsx

# Module manifest to extend:
@/Users/karstenhaldan/minisite/leanshot/src/lib/admin/modules.ts

# Phase 60 token audit lesson:
# Tailwind v4 @theme tokens that don't exist silently no-op → invisible render.
# Verify each token used exists in src/index.css @theme {} BEFORE using.
@/Users/karstenhaldan/minisite/leanshot/src/index.css

# Shared types from Plan 01:
@/Users/karstenhaldan/minisite/leanshot/src/types/protocols.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add missing @theme tokens + ProtocolStatusBadge + KeyboardHelpModal (parallel-safe primitives)</name>
  <files>src/index.css, src/components/admin/protocols/ProtocolStatusBadge.tsx, src/components/admin/protocols/__tests__/ProtocolStatusBadge.test.tsx, src/components/admin/protocols/ProtocolKeyboardHelpModal.tsx</files>
  <action>
Step 1 — Audit `src/index.css` `@theme {}` block. Grep for `--color-rose-soft` and `--color-warning-soft`. If either missing, ADD them inside the existing `@theme { ... }` block (find the block by `grep -n '@theme' src/index.css`):

```css
@theme {
  /* ... existing tokens ... */
  --color-rose-soft: #fbe4dc;        /* Phase 61 review banner background — UI-SPEC §Color */
  --color-warning-soft: #fbe4dc;     /* Phase 61 alias — UI-SPEC §Surface 3 */
  /* Verify --color-surface-elevated already exists from Phase 60 (#f6f2e8) */
}
```

If either token already exists, DO NOT duplicate — leave existing definition. Use `grep -c '\-\-color-rose-soft' src/index.css` to gate the addition.

Step 2 — Write `src/components/admin/protocols/ProtocolStatusBadge.tsx` mirroring `src/components/admin/rag/TierBadge.tsx` verbatim with these substitutions:

```typescript
import { Badge } from '@/components/ui/Badge';
import type { ProtocolReviewState } from '@/types/protocols';

const TONE_MAP: Record<ProtocolReviewState, 'neutral' | 'warning' | 'success' | 'muted'> = {
  draft:     'neutral',
  in_review: 'warning',
  published: 'success',
  archived:  'muted',
};

const ARIA_MAP: Record<ProtocolReviewState, string> = {
  draft:     'Protocol status: draft',
  in_review: 'Protocol status: pending review',
  published: 'Protocol status: published',
  archived:  'Protocol status: archived',
};

const LABEL_MAP: Record<ProtocolReviewState, string> = {
  draft:     'Draft',
  in_review: 'In review',
  published: 'Published',
  archived:  'Archived',
};

export function ProtocolStatusBadge({ status }: { status: ProtocolReviewState }) {
  return (
    <Badge tone={TONE_MAP[status]} aria-label={ARIA_MAP[status]}>
      {LABEL_MAP[status]}
    </Badge>
  );
}
```

Note: Verify the DS Badge primitive supports `tone="muted"` by reading `src/components/ui/Badge.tsx`. If `muted` is not supported, use `tone="neutral"` for archived and add `className="opacity-60"` per UI-SPEC text-tertiary intent.

Step 3 — Write the unit test `src/components/admin/protocols/__tests__/ProtocolStatusBadge.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProtocolStatusBadge } from '../ProtocolStatusBadge';

describe('ProtocolStatusBadge', () => {
  it.each([
    ['draft', 'Draft', 'Protocol status: draft'],
    ['in_review', 'In review', 'Protocol status: pending review'],
    ['published', 'Published', 'Protocol status: published'],
    ['archived', 'Archived', 'Protocol status: archived'],
  ] as const)('renders %s with label %s and aria %s', (status, label, aria) => {
    render(<ProtocolStatusBadge status={status} />);
    expect(screen.getByLabelText(aria)).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
```

Step 4 — Write `src/components/admin/protocols/ProtocolKeyboardHelpModal.tsx`, copying `src/components/admin/rag/QueueKeyboardHelpModal.tsx` verbatim and replacing the SHORTCUTS array:

```typescript
const SHORTCUTS = [
  { key: 'N',          description: 'New protocol' },
  { key: 'J / K',      description: 'Next / Previous protocol' },
  { key: 'Shift + ?',  description: 'Show / hide this help' },
  { key: 'Escape',     description: 'Close current sheet or modal' },
] as const;
```

Keep all DS Modal usage, `<kbd>` chip styling, and aria attributes identical to the analog.

Constraints:
  - All text in these files uses ONLY: text-[11px], text-[13px], text-[18px], text-heading (per UI-SPEC Typography ceiling)
  - All color tokens MUST exist in @theme {} (audit Step 1 ensures rose-soft + warning-soft exist)
  - No `font-medium` or `font-bold` — only font-normal / font-semibold (Phase 60 lesson)
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && grep -c "color-rose-soft" src/index.css | grep -vE "^0$" && test -f src/components/admin/protocols/ProtocolStatusBadge.tsx && test -f src/components/admin/protocols/ProtocolKeyboardHelpModal.tsx && npx vitest run --config vite.config.ts src/components/admin/protocols/__tests__/ProtocolStatusBadge.test.tsx 2>&1 | tail -10 | grep -E "passed|✓"</automated>
  </verify>
  <done>rose-soft + warning-soft tokens present in @theme; ProtocolStatusBadge renders 4 statuses with correct labels + aria; ProtocolKeyboardHelpModal lists 4 shortcuts; unit test green.</done>
</task>

<task type="auto">
  <name>Task 2: Write ProtocolsLayout + ProtocolsListPage + register admin module</name>
  <files>src/components/admin/protocols/ProtocolsLayout.tsx, src/components/admin/protocols/ProtocolsListPage.tsx, src/components/admin/protocols/__tests__/ProtocolsListPage.test.tsx, src/lib/admin/modules.ts</files>
  <action>
Step 1 — Read `src/components/admin/rag/RagLayout.tsx` (lines 1-220) and `src/components/admin/rag/RagQueuePage.tsx` (lines 1-380) once. These are the verbatim shape templates.

Step 2 — Write `src/components/admin/protocols/ProtocolsLayout.tsx` mirroring RagLayout structure:
- Same imports block (Suspense, lazy, useEffect, useState, Card, supabase)
- `SUB_ROUTES` readonly array — entries for: `{ key: 'list', label: 'Protocols', path: 'list', Component: ProtocolsListPage }` and optionally `{ key: 'editor', label: 'Editor', path: 'editor', Component: ProtocolEditorPage }` — Editor Component is imported lazily and used by the editor route (Plan 05 fills the file; lazy import means no compile-time dep)
- `resolveActive(pathname: string): SubRoute` — match regex `^\/admin\/protocols\/?(?:([^/]+).*)?$`
- Same grid layout `grid gap-6 lg:grid-cols-[200px_1fr]`, max-w-screen-xl
- Sub-nav links use `<a href="/admin/protocols/{path}" aria-current={active ? 'page' : undefined}>`
- Active pill class: `bg-[var(--color-primary)] text-[var(--color-primary-foreground)]`; inactive: `text-[var(--color-text-secondary)] hover:text-[var(--color-primary)]`
- Export as DEFAULT export (matching RagLayout pattern so lazy() in modules.ts works)

For the lazy-loaded ProtocolEditorPage import inside ProtocolsLayout:
```typescript
const ProtocolEditorPage = lazy(() => import('./ProtocolEditorPage').then(m => ({ default: m.ProtocolEditorPage })));
```
This file is provided by Plan 05 (same wave, different file ownership). At Plan 04 compile time the file may not exist yet — guard via:
```typescript
// Plan 05 ships ProtocolEditorPage.tsx. If absent, the editor route shows a Suspense skeleton.
const ProtocolEditorPage = lazy(() => import('./ProtocolEditorPage').then(m => ({ default: m.ProtocolEditorPage })).catch(() => ({ default: () => <div /> })));
```
The `.catch(() => ...)` makes the import resilient during parallel development. Plan 05 ships ProtocolEditorPage.tsx with a NAMED export `ProtocolEditorPage`.

Step 3 — Write `src/components/admin/protocols/ProtocolsListPage.tsx` mirroring RagQueuePage structure (lines 1-380):
- Imports: { CheckCheck, X, ClipboardList } from 'lucide-react', useCallback/useEffect/useState/useMemo from react, DS primitives Badge/Button/EmptyState/Pill/Card, useStore from store, ProtocolStatusBadge + ProtocolKeyboardHelpModal locally
- State: `protocols: Protocol[]`, `filter: 'all' | 'published' | 'in_review' | 'draft' | 'archived'`, `loading`, `error`, `helpOpen`, `activeIdx`
- useEffect on mount: `supabase.from('protocols').select('id, version, name, compound, audience, slug, base_slug, review_state, created_by, updated_at, published_at').order('updated_at', { ascending: false })` — when fetched, dedupe to one row per `id` (highest version) for the list view
- Filter logic in `useMemo`: when filter='all' show all; otherwise filter by review_state
- FILTER_PILLS const: `[{ key: 'all', label: 'All' }, { key: 'published', label: 'Published' }, { key: 'in_review', label: 'In Review' }, { key: 'draft', label: 'Draft' }, { key: 'archived', label: 'Archived' }]`
- Sticky header: H1 'Protocols' (`text-heading font-semibold`, 28px/600 per UI-SPEC) + 'New Protocol' Button (primary, accent)
- Filter pills row (same pattern as RagQueuePage lines 261-284)
- Table head: columns Name | Compound | Audience | Version | Status | Last Updated | Actions; use `aria-sort` on Name + Last Updated columns
- Each row: link to `/admin/protocols/{id}`; render `<ProtocolStatusBadge status={row.review_state} />`; audience as Pill chips
- Empty state per UI-SPEC copywriting:
  ```typescript
  <EmptyState
    illustration={<ClipboardList aria-hidden="true" />}
    title="No protocols yet"
    body="Create your first dosing protocol to distribute to clinicians and patients."
    cta={<Button variant="primary" onClick={handleNew}>New Protocol</Button>}
  />
  ```
- Loading skeleton: 3 × `<div className="h-20 rounded-card bg-[var(--color-surface-elevated)] animate-pulse" />`
- Error state: `<p className="text-[13px] text-[var(--color-danger)]">{error}</p>`
- New Protocol handler `handleNew`: INSERT into `public.protocols` with `name = 'Untitled Protocol'`, `compound = ''`, `audience = '{}'`, `base_slug = 'untitled-' + crypto.randomUUID().slice(0,8)`, version = 1, review_state = 'draft', created_by = currentUserId. On insert success → window.history.pushState to `/admin/protocols/{id}` + dispatch a popstate event so AdminShell re-resolves the route.
- Keyboard handler per RagQueuePage lines 212-253: N=handleNew, J/K=moveActive(+1/-1), Shift+?=setHelpOpen(true)

Step 4 — Register the admin module. Open `src/lib/admin/modules.ts` and find the existing `rag` entry (around line 326). Insert a new entry right BEFORE the `rag` entry (alphabetical order matters for sidebar) or after — match the existing convention. Add `ClipboardList as ClipboardListIcon` to the lucide-react import at file top:

```typescript
// Phase 61 — Admin Protocol Creator (PROTOCOL-01..08)
{
  key: 'protocols',
  label: 'Protocols',
  route: 'protocols',
  icon: ClipboardListIcon,
  lazy: () => import('@/components/admin/protocols/ProtocolsLayout'),
  flagKey: 'admin_protocols',
  minRole: 'admin',
} as const,
```

Verify the existing `AdminModule` type accepts these fields by reading lines 52-90 of modules.ts. If `flagKey` requires a specific union literal, add `'admin_protocols'` to the union at its definition site.

Then run `cat src/lib/admin/modules.ts | head -90 | grep ADMIN_MODULES` to confirm the export remains intact. Append the new entry inside the existing exported array.

Step 5 — Write `src/components/admin/protocols/__tests__/ProtocolsListPage.test.tsx`:
- Mock `@/lib/supabase` with `vi.mock` returning a chainable `from().select().order()` that resolves to an array of 3 protocols (one in each non-archived state)
- Render `<ProtocolsListPage />` wrapped in any required providers (check RagQueuePage tests for the pattern)
- Assertions:
  1. All 3 protocol names appear in the document
  2. ProtocolStatusBadge appears for each (3 elements with aria-label starting with 'Protocol status:')
  3. Click on 'Published' filter pill → only the published row remains
  4. Empty state appears when supabase returns `data: []`: heading 'No protocols yet' + body 'Create your first dosing protocol to distribute to clinicians and patients.'
  5. Click 'New Protocol' button → supabase.from('protocols').insert called once with expected payload

Constraints:
  - Read RagQueuePage.tsx once and reuse all patterns; do NOT invent new patterns
  - All typography uses only allowed tokens
  - No `font-medium`; only `font-normal` / `font-semibold`
  - Color tokens ONLY from @theme — verify each `var(--color-*)` exists before use
  - This plan is parallel-safe with Plan 05/06/07 because all are net-new files except `src/lib/admin/modules.ts` (only this plan touches) and `src/index.css` (only this plan touches in Wave 1)
  - The catch-on-import for ProtocolEditorPage is the [[feedback_stub_then_replace_sibling_collision]] pattern in reverse: Plan 05 will provide the real export; until then the lazy import yields a no-op fallback so the layout file compiles standalone.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && test -f src/components/admin/protocols/ProtocolsLayout.tsx && test -f src/components/admin/protocols/ProtocolsListPage.tsx && grep -q "key: 'protocols'" src/lib/admin/modules.ts && grep -q "admin/protocols/ProtocolsLayout" src/lib/admin/modules.ts && npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -E "error TS" | grep -E "(protocols|modules\\.ts)" | (! grep -q .) && npx vitest run --config vite.config.ts src/components/admin/protocols/__tests__/ProtocolsListPage.test.tsx 2>&1 | tail -15 | grep -E "passed|✓"</automated>
  </verify>
  <done>ProtocolsLayout + ProtocolsListPage render; admin manifest includes protocols entry; TypeScript clean for these files; ProtocolsListPage unit test green (5 assertions).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Admin browser → /admin/protocols | Authenticated staff users only; AdminShell route guard verifies `is_staff()` before mount |
| ProtocolsListPage → public.protocols | Browser supabase client uses user JWT; RLS `using (public.is_staff())` filters to staff-readable rows |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-61-04-01 | Information disclosure | Non-staff user navigates to /admin/protocols URL | mitigate | AdminShell route guard checks `is_staff` profile flag (existing Phase 24 pattern); RLS on protocols table backstops at DB layer |
| T-61-04-02 | Tampering | XSS via protocol name/compound rendered without escape | mitigate | React renders text content escaped by default; no `dangerouslySetInnerHTML` on user content |
| T-61-04-03 | Spoofing | Direct INSERT to public.protocols bypassing UI | accept | Acceptable — direct INSERT is staff-only via RLS; INSERTed rows still must traverse SECDEF state machine to reach published |
</threat_model>

<verification>
- `npx tsc -p tsconfig.app.json --noEmit` shows no NEW errors in files modified by this plan
- `npx vitest run --config vite.config.ts src/components/admin/protocols/__tests__/` — both unit tests green
- `grep "key: 'protocols'" src/lib/admin/modules.ts` returns exactly one match
- `grep "color-rose-soft" src/index.css` returns ≥1 match
- Manual: visiting `/admin/protocols` (deferred to Plan 08 runtime) renders the layout with sub-nav
</verification>

<success_criteria>
- [ ] ProtocolsLayout + ProtocolsListPage + ProtocolStatusBadge + ProtocolKeyboardHelpModal all exist
- [ ] Admin manifest has `protocols` entry pointing to ProtocolsLayout lazy import
- [ ] `--color-rose-soft` + `--color-warning-soft` defined in @theme
- [ ] 2 unit tests pass (StatusBadge + ListPage)
- [ ] Typography ceiling honored (no text-sm/lg/base/xl/2xl, no font-medium/bold)
- [ ] Tailwind v4 token safety honored (no undefined @theme tokens)
</success_criteria>

<output>
Create `.planning/phases/61-admin-protocol-creator/61-04-SUMMARY.md` documenting the module registration, lazy-fallback for ProtocolEditorPage, and the @theme tokens added.
</output>
