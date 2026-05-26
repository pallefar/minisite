---
phase: 60-rag-knowledge-base-completion-waves-2-4
plan: "08"
subsystem: admin-queue-ui
tags: [rag, admin, queue, ui, 2-person-rule, dompurify, keyboard-shortcuts, posthog]
dependency_graph:
  requires: [60-01, 60-02]
  provides: [admin-queue-surface, chunk-api-wrappers]
  affects: [rag-chunks-review-workflow]
tech_stack:
  added: []
  patterns:
    - DOMPurify.sanitize with explicit ALLOWED_TAGS/ALLOWED_ATTR allowlist (XSS hardening)
    - 2-person rule UI layer (disabled Approve + warning Badge when created_by===currentUserId)
    - SECDEF RPC typed wrappers with posthog.capture telemetry
    - Keyboard shortcuts (A/R/E/J/K/Shift+?) with overlay-open guard
    - TDD RED→GREEN per plan task (5 suites, 56 tests total)
key_files:
  created:
    - leanshot/src/lib/admin/rag/chunk-api.ts
    - leanshot/src/lib/admin/rag/__tests__/chunk-api.test.ts
    - leanshot/src/components/admin/rag/QueueDetailPane.tsx
    - leanshot/src/components/admin/rag/__tests__/QueueDetailPane.test.tsx
    - leanshot/src/components/admin/rag/RejectReasonSheet.tsx
    - leanshot/src/components/admin/rag/EditChunkModal.tsx
    - leanshot/src/components/admin/rag/RetractChunkModal.tsx
    - leanshot/src/components/admin/rag/QueueKeyboardHelpModal.tsx
    - leanshot/src/components/admin/rag/__tests__/RejectReasonSheet.test.tsx
    - leanshot/src/components/admin/rag/__tests__/RagQueuePage.test.tsx
    - leanshot/src/components/admin/rag/__tests__/two-person-rule.test.tsx
    - leanshot/src/components/admin/rag/RagQueuePage.tsx
    - leanshot/e2e/admin/rag-queue.spec.ts
  modified:
    - leanshot/src/components/admin/rag/RagLayout.tsx
    - leanshot/playwright.config.ts
decisions:
  - Use lazy(() => import('./RagQueuePage')) instead of static import in RagLayout.tsx — consistent with existing RagTopicsPage + RagSourcesPage pattern; avoids eager loading the queue UI on every rag sub-route
  - useStore(s => s.signedIn?.user?.id) for currentUserId — actual store shape uses signedIn.user.id, not s.user?.id (plan had incorrect assumption; fixed per live codebase grep)
  - Playwright E2E at e2e/admin/rag-queue.spec.ts (not tests/e2e/) — Playwright testDir is ./e2e relative to playwright.config.ts; tests/e2e/ is the vitest integration test dir
metrics:
  duration: "~40 minutes"
  completed: "2026-05-26"
  tasks_completed: 6
  tasks_total: 6
  files_created: 13
  files_modified: 2
---

# Phase 60 Plan 08: Admin Queue UI Summary

Ships the admin curation queue UI at `/admin/rag/queue` — the highest-density human-in-the-loop surface in Phase 60. Karsten and the clinical reviewer use this surface to approve, reject, retract, and edit chunks before they reach RAG retrieval.

## What Was Built

**chunk-api.ts** — Typed wrappers over 5 SECDEF RPCs from 60-01 (approve, reject, retract, queue, list_review_queue). Every successful call emits `posthog.capture('rag_chunk_reviewed', { chunk_id, source_tier, action, reject_reason?, queue_age_hours })`. Errors return `{ data: null, error }` without throwing (project convention).

**QueueDetailPane.tsx** — Side-by-side SOURCE TEXT (DOMPurify-sanitized react-markdown) vs EXTRACTED QUOTE (plain text + kind badges) pane. Sticky action row with Approve/Reject/Edit & approve buttons. 2-person rule UI layer: Approve disabled + warning Badge when `currentUserId === chunk.created_by`. Inline TierSelect + TopicTagInput with batched Save edits call.

**RejectReasonSheet.tsx** — Bottom Sheet with 6-reason radiogroup (Off-topic / Factually wrong / Off-label / Low quality / Duplicate / Safety concern). Danger-toned pills for Factually wrong, Off-label, Safety concern. Arrow-key cycling. Single tap = onSelect(reason) + close.

**EditChunkModal.tsx** — Full edit surface for summary + quote_blocks JSON. Validates JSON parse (shows "Invalid JSON" inline), summary ≤ 2000 chars, quote_blocks ≤ 16KB. Disabled Save on errors.

**RetractChunkModal.tsx** — Retract confirmation with verbatim UI-SPEC body copy. Required reason textarea (disabled Retract until non-whitespace). Buttons: "Keep chunk" / "Retract chunk" (destructive).

**QueueKeyboardHelpModal.tsx** — 5 shortcut rows: A / R / E / J-K / Shift+?

**RagQueuePage.tsx** — Two-column layout (`lg:grid-cols-[7fr_5fr]`). Filter pills (All / Tier B / Tier C / by tag / by source). Per-row Approve (disabled when self-created) + Reject buttons. Keyboard shortcuts (A/R/E/J/K/Shift+?) inert when overlay open or focus in input. Empty state: "Queue clear" + verbatim body. Error state. Optimistic row removal with rollback.

**RagLayout.tsx (surgical edit)** — QueuePlaceholder replaced with lazy import of RagQueuePage in SUB_ROUTES.

**e2e/admin/rag-queue.spec.ts** — 8 Playwright tests gated by `PLAYWRIGHT_RUN_RAG_QUEUE=1`: approve/reject/retract/queue/list RPCs + 2-person rule disabled-Approve + DOMPurify XSS smoke. Uses page.route() API mocks (no live Supabase needed).

## Test Summary

| Suite | Tests | Status |
|-------|-------|--------|
| chunk-api.test.ts | 10 | GREEN |
| QueueDetailPane.test.tsx | 12 | GREEN |
| RejectReasonSheet.test.tsx | 16 | GREEN |
| RagQueuePage.test.tsx | 12 | GREEN |
| two-person-rule.test.tsx | 6 | GREEN |
| **Total** | **56** | **ALL GREEN** |

Playwright E2E: 8 tests compile and list correctly; skipped by default (requires `PLAYWRIGHT_RUN_RAG_QUEUE=1` + dev server).

## Verification Gates

All 5 plan gates passed:

1. TypeScript + Lint: clean
2. All 5 vitest suites: 56/56 green
3. Typography gate (no forbidden tokens): CLEAN
4. DOMPurify gate (≥1 sanitize call + explicit ALLOWED_TAGS/ATTR): PASS
5. Mount-point gate (Component: RagQueuePage, QueuePlaceholder gone): PASS

## Deviations from Plan

### Auto-applied Corrections

**1. [Rule 1 - Bug] Lazy import instead of static import for RagQueuePage in RagLayout.tsx**
- Found during: Task 5
- Issue: Plan specified `import RagQueuePage from './RagQueuePage'` (static import). Existing pattern in RagLayout.tsx for all sibling pages uses `const X = lazy(() => import('./X'))`.
- Fix: Used `const RagQueuePage = lazy(() => import('./RagQueuePage'))` — consistent with RagTopicsPage + RagSourcesPage. Avoids loading the full queue bundle on every rag sub-route visit.
- Files modified: RagLayout.tsx
- Commit: e8cae7f7

**2. [Rule 1 - Bug] Store selector uses `s.signedIn?.user?.id` not `s.user?.id`**
- Found during: Task 4 (RagQueuePage implementation)
- Issue: Plan instruction said `useStore((s) => s.user?.id)` but actual store shape (confirmed via grep of admin components) uses `s.signedIn?.user?.id`.
- Fix: Updated all components to use the correct store path.
- Files modified: RagQueuePage.tsx
- Commit: c3d5e99a

**3. [Rule 1 - Bug] Playwright spec path is e2e/admin/ not tests/e2e/admin/**
- Found during: Task 6
- Issue: Plan said `tests/e2e/admin/rag-queue.spec.ts`. Playwright testDir is `./e2e` (relative to playwright.config.ts). The `tests/` dir contains vitest integration specs.
- Fix: Created spec at `e2e/admin/rag-queue.spec.ts` (Playwright canonical location).
- Commit: adc39bad

### Out-of-scope Pre-existing Issues Deferred

- AddSourceSheet.tsx + AddTopicSheet.tsx have pre-existing `jsx-a11y/no-autofocus` lint errors (not touched by this plan; logged for future cleanup)

## Security (Threat Model Coverage)

| Threat | Mitigation | Status |
|--------|------------|--------|
| T-60-08-XSS-1 | DOMPurify allowlist on SOURCE TEXT (14 tags, 3 attrs) | Implemented + vitest + E2E XSS smoke |
| T-60-08-XSS-2 | quote_blocks rendered as plain text (no innerHTML) | Implemented |
| T-60-08-AUTHN-1 | UI disabled state + defensive posthog event; DB SECDEF is hard defense | Implemented (UI layer) |
| T-60-08-JSON-1 | JSON.parse in try/catch before queue_rag_chunk submit | Implemented in EditChunkModal |
| T-60-08-DOS-1 | Client-side summary ≤2000 + quote_blocks JSON ≤16KB validation | Implemented in EditChunkModal |

## Known Stubs

None. All RPCs are wired to real Supabase SECDEF functions shipped in 60-01. All copy is verbatim from UI-SPEC.

## Self-Check: PASSED

All 8 output files exist on disk. All 7 task commits verified in git log (hashes: a770513a, 78f08aa2, 7a8f7725, c3d5e99a, e8cae7f7, adc39bad, d7d50153).
