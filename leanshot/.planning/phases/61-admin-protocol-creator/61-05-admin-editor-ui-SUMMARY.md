---
phase: 61-admin-protocol-creator
plan: "05"
subsystem: admin-protocols
tags:
  - admin
  - protocols
  - 2-person-review
  - versioning
  - rag-evidence
  - ai-assist
dependency_graph:
  requires:
    - 61-01-db-tables-rls      # protocol tables, RLS
    - 61-02-secdef-rpcs        # publish_protocol, submit_protocol_for_review RPCs
    - 61-03-protocol-ai-assist-fn  # Edge Fn for AiAssistModal
    - 61-04-admin-core-ui      # @theme tokens (rose-soft, warning-soft), ProtocolStatusBadge
  provides:
    - ProtocolEditorPage       # full admin authoring surface
    - ProtocolStepRow          # per-week titration step row
    - ProtocolReviewBanner     # 2-person review UI guard
    - EvidenceSearchSheet      # RAG evidence attach drawer
    - AiAssistModal            # AI-assisted dose/monitoring modal
  affects:
    - 61-08-close-out          # uses all 5 components
tech_stack:
  added: []
  patterns:
    - "QueueDetailPane two-column grid analog"
    - "isSelfCreated conditional render (PROTOCOL-04 UI layer)"
    - "vi.hoisted() for test mock state"
    - "version-on-edit INSERT pattern (PROTOCOL-05)"
key_files:
  created:
    - leanshot/src/components/admin/protocols/ProtocolReviewBanner.tsx
    - leanshot/src/components/admin/protocols/EvidenceSearchSheet.tsx
    - leanshot/src/components/admin/protocols/AiAssistModal.tsx
    - leanshot/src/components/admin/protocols/ProtocolStepRow.tsx
    - leanshot/src/components/admin/protocols/ProtocolEditorPage.tsx
    - leanshot/src/components/admin/protocols/__tests__/ProtocolReviewBanner.test.tsx
    - leanshot/src/components/admin/protocols/__tests__/EvidenceSearchSheet.test.tsx
    - leanshot/src/components/admin/protocols/__tests__/AiAssistModal.test.tsx
    - leanshot/src/components/admin/protocols/__tests__/ProtocolEditorPage.test.tsx
  modified: []
decisions:
  - "ProtocolEditorPage resolves protocol_id from window.location.pathname (no router, per CLAUDE.md)"
  - "vi.hoisted() used for test mock state — vi.mock() factory hoisting prevents const declarations"
  - "Reviewer name from profiles deferred to future phase (empty state rendered gracefully)"
  - "node_modules symlinked from main leanshot checkout to worktree (npm install worktree-main drift pattern)"
metrics:
  duration: "9m"
  completed: "2026-05-26T17:34:47Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 9
  files_modified: 0
  tests_added: 17
  tests_total: 29
---

# Phase 61 Plan 05: Admin Editor UI Summary

**One-liner:** Full 2-person-rule editor with step builder, RAG evidence drawer, AI assist modal, and PROTOCOL-05 version-on-edit INSERT pattern.

## What Was Built

### ProtocolReviewBanner (Task 1)

Warning banner above the editor grid rendered when `review_state = 'in_review'`. Two visual modes:
- **Author view** (`isAuthor=true`): renders "Pending review by another admin". The `onPublish` prop is `undefined` so the Publish button is never rendered — full DOM removal, not `disabled`.
- **Reviewer view** (`isAuthor=false`): renders "Review as: {name}" + "Publish Protocol" button.

PROTOCOL-04 invariant: `screen.queryByText('Publish Protocol')` returns `null` in author view tests.

### EvidenceSearchSheet (Task 1)

Right-side drawer (Sheet DS primitive) for searching RAG evidence and attaching to a step:
- Calls `rag-retrieve` Edge Fn via `supabase.functions.invoke`
- Top-10 results with checkboxes and TierBadge
- Multi-attach: `supabase.from('protocol_evidence').insert([...rows])` with `step_id NOT NULL`
- Keyboard navigation (ArrowDown/Up + Space to toggle)
- Loading: 3 Skeleton rows; Empty: `<EmptyState>` DS primitive

### AiAssistModal (Task 1)

Modal (Modal DS primitive) posting to `protocol-ai-assist` Edge Fn:
- State machine: `idle → loading → loaded | refusal | error`
- Rate-limit 429: `showToast('AI assist limit reached for today. Resets at midnight UTC.', 'error')` + close
- Refusal: AlertTriangle warning + "Go to RAG queue →" link (`href=/admin/rag`)
- Loaded: dose_mg (font-mono tabular-nums) + monitoring chips + cited sources count
- Apply: calls `onApply({ dose_mg, monitoring })` + closes modal

### ProtocolStepRow (Task 2)

Per-week table row:
- Week label (font-mono, non-editable)
- dose_mg input (number, `step="0.1"`, font-mono tabular-nums)
- frequency select (daily/weekly/bi-weekly/custom-cron) + cron_string when custom
- Monitoring pills (5 options, aria-pressed toggles)
- "Cite" button with evidence count badge
- "Suggest" AI assist button
- Remove button (X icon, danger hover, aria-label="Remove step {week}")
- Evidence chips below row → CitationPopover on click

### ProtocolEditorPage (Task 2)

Two-column editor (`grid gap-6 lg:grid-cols-[1fr_320px]`):

**Left column (step builder):**
- Protocol name (text-[18px] font-semibold, inline editable, onBlur saves)
- Compound select + Audience pills
- Steps table (thead + tbody with ProtocolStepRow instances)
- Sticky action row: "+ Add week" button

**Right column (metadata panel, `lg:sticky lg:top-4 lg:self-start`):**
- Protocol name mirror, version badge, ProtocolStatusBadge
- Save draft, Submit for review (author + draft only), Archive protocol

**Critical invariants:**
- `isSelfCreated = currentUserId === protocol.created_by` → `onPublish` prop is `undefined` for authors → banner renders no button
- `handlePublish` detects `SELF_REVIEW_REJECTED` via BOTH `error.message.includes('SELF_REVIEW_REJECTED')` AND `error.code === '42501'`
- `handleSaveDraft` for published protocol: INSERTs new row with `version = old.version + 1`, `review_state = 'draft'`, copies steps
- `handleRemoveStep`: removes from state immediately, calls `showToast('Week N removed. Undo?', 'info')` — no confirm modal

## 2-Person Review UI Mechanism

The UI enforces PROTOCOL-04 at Layer 2 (UI) through **full conditional render**:

```typescript
const isSelfCreated = currentUserId === protocol?.created_by;
// ProtocolReviewBanner: onPublish is undefined when isSelfCreated
onPublish={!isSelfCreated ? handlePublish : undefined}
// Banner: no button rendered when onPublish is undefined
{onPublish && <Button>Publish Protocol</Button>}
```

Layer 1 (DB) is the `publish_protocol` SECDEF RPC (Plan 02) which enforces `SELF_REVIEW_REJECTED`.

## Version-on-Edit Flow (PROTOCOL-05)

When `handleSaveDraft` is called and `protocol.review_state === 'published'`:
1. INSERT new row with `version = protocol.version + 1`, `review_state = 'draft'`
2. INSERT all existing steps with `protocol_version = newVersion`
3. Old published row stays untouched (Row-per-version pattern)

## Evidence Attach Flow

1. User clicks "Cite" on a step → `EvidenceSearchSheet` opens with `stepId`
2. User searches → `rag-retrieve` returns top-10 chunks
3. User checks chunks → clicks "Attach N sources"
4. `supabase.from('protocol_evidence').insert([{ protocol_id, step_id, citation_text, rag_source_id, verbatim_quote }])` for each checked chunk
5. `onAttached(count)` → toast + reload protocol

## Rate-Limit/Refusal Handling in AI Assist

- **429 / rate_limit_exceeded**: `showToast('AI assist limit reached for today. Resets at midnight UTC.', 'error')` + `onClose()`
- **refusal: true**: renders warning banner with "Go to RAG queue →" link; Apply button hidden
- **error**: renders error message in output area
- **loaded**: shows dose_mg + monitoring chips + cited source count + Apply button

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vi.hoisted() pattern for test mock state**
- **Found during:** Task 2
- **Issue:** `vi.mock()` factories are hoisted by Vitest before `const _state = ...` is evaluated. Using `let/const` in test file for mock state causes `ReferenceError: Cannot access '_state' before initialization`.
- **Fix:** Used `vi.hoisted()` to declare the shared `_state` object and `mockShowToast` fn. These are guaranteed to run before mock factories.
- **Files modified:** `__tests__/ProtocolEditorPage.test.tsx`

**2. [Rule 1 - Bug] Skeleton class for loading assertion**
- **Found during:** Task 1 AiAssistModal test
- **Issue:** Test asserted `.animate-pulse` CSS class to detect loading state. The project's `Skeleton` component uses `skeleton-shimmer` class (not `animate-pulse`).
- **Fix:** Changed assertion to `.skeleton-shimmer`.
- **Files modified:** `__tests__/AiAssistModal.test.tsx`

**3. [Rule 1 - Bug] node_modules symlink required for worktree**
- **Found during:** Task 1 test execution
- **Issue:** Worktree doesn't inherit `node_modules` (gitignored). `npx vitest run` failed with `Cannot find package 'vite-plugin-pwa'`.
- **Fix:** `ln -s /Users/karstenhaldan/minisite/leanshot/node_modules ./leanshot/node_modules` in worktree. Matches `reference_npm_install_worktree_main_drift` known pattern.
- **Files modified:** None (symlink, not tracked)

**4. [Rule 2 - Missing] useToast mock at hook level (not store level)**
- **Found during:** Task 1 AiAssistModal test T3
- **Issue:** `useToast` calls `useStore.getState().showToast()` directly (not through React hook). Mocking `@/lib/store` alone didn't intercept the toast call.
- **Fix:** Added `vi.mock('@/hooks/useToast', () => ({ useToast: () => mockShowToast }))` in both AiAssistModal and ProtocolEditorPage tests.
- **Files modified:** `__tests__/AiAssistModal.test.tsx`, `__tests__/ProtocolEditorPage.test.tsx`

## Known Stubs

- **Reviewer name**: `const [reviewerName] = useState<string | undefined>(undefined)` — `reviewerName` is always `undefined` in current implementation. The banner shows "Review as: reviewer" as fallback. Wiring to profiles query is a future enhancement (stub is intentional for v1.4; the banner still renders correctly).

## Threat Flags

No new threat surface beyond the plan's `<threat_model>`. T-61-05-01 (author bypass) is fully mitigated: DOM has zero Publish element when `isSelfCreated`. T-61-05-02 (XSS via protocol name) is mitigated by React text children escaping.

## Self-Check

### Files exist
- leanshot/src/components/admin/protocols/ProtocolReviewBanner.tsx: FOUND
- leanshot/src/components/admin/protocols/EvidenceSearchSheet.tsx: FOUND
- leanshot/src/components/admin/protocols/AiAssistModal.tsx: FOUND
- leanshot/src/components/admin/protocols/ProtocolStepRow.tsx: FOUND
- leanshot/src/components/admin/protocols/ProtocolEditorPage.tsx: FOUND
- 4 test files: FOUND

### Commits exist
- 353e3090: Task 1 — leaf components (ProtocolReviewBanner + EvidenceSearchSheet + AiAssistModal)
- 5463c35c: Task 2 — ProtocolStepRow + ProtocolEditorPage + test

### Test results
- 17 new assertions across 4 test files: ALL PASSED
- 29 total assertions in protocols/__tests__/ directory: ALL PASSED
- TypeScript: 0 errors in protocols/ files (noEmit check clean)

## Self-Check: PASSED
