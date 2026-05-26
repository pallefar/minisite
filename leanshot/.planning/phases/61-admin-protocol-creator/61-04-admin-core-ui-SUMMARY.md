---
phase: 61-admin-protocol-creator
plan: "04"
subsystem: admin-ui
tags:
  - admin
  - protocols
  - keyboard-nav
  - tailwind-tokens
dependency_graph:
  requires:
    - 61-01-db-tables-rls  # protocols table + review_state ENUM
  provides:
    - admin-protocols-module  # /admin/protocols entry point
    - ProtocolsLayout         # sub-nav shell
    - ProtocolsListPage       # list + filter + keyboard nav
    - ProtocolStatusBadge     # status badge primitive
    - ProtocolKeyboardHelpModal # keyboard help modal
  affects:
    - src/lib/admin/modules.ts  # new protocols entry added
    - src/types/protocols.ts    # updated_at field added
tech_stack:
  added:
    - ClipboardListIcon (lucide-react) — admin sidebar icon for protocols
  patterns:
    - pathname-based sub-nav (RagLayout analog)
    - lazy import with .catch() fallback for parallel Wave 1 (feedback_stub_then_replace_sibling_collision)
    - supabase.from().select().order() chainable query
    - keyboard shortcut handler (N/J/K/Shift+?)
    - admin module manifest registration (feedback_admin_module_manifest_vs_router_branch_drift)
key_files:
  created:
    - leanshot/src/components/admin/protocols/ProtocolsLayout.tsx
    - leanshot/src/components/admin/protocols/ProtocolsListPage.tsx
    - leanshot/src/components/admin/protocols/ProtocolStatusBadge.tsx
    - leanshot/src/components/admin/protocols/ProtocolKeyboardHelpModal.tsx
    - leanshot/src/components/admin/protocols/__tests__/ProtocolStatusBadge.test.tsx
    - leanshot/src/components/admin/protocols/__tests__/ProtocolsListPage.test.tsx
  modified:
    - leanshot/src/lib/admin/modules.ts (protocols entry + ClipboardListIcon import)
    - leanshot/src/types/protocols.ts (added updated_at field)
decisions:
  - "Used existing --color-rose-soft + --color-warning-soft tokens (already in @theme, no duplicates needed)"
  - "Badge tone 'muted' not in BadgeTone union — used 'neutral' + opacity-60 for archived status per plan instructions"
  - "Dynamic import with @vite-ignore for ProtocolEditorPage (Plan 05 file) avoids compile-time TS2307 error while preserving lazy-fallback resilience"
  - "protocols module placed before rag entry in ADMIN_MODULES for sidebar logical grouping"
  - "added updated_at to Protocol interface (Rule 2: DB column existed via tg_set_updated_at trigger, type was missing it)"
metrics:
  duration: "8m 24s"
  completed: "2026-05-26"
  tasks_completed: 2
  files_created: 6
  files_modified: 2
  tests_passing: 9
---

# Phase 61 Plan 04: Admin Core UI Summary

Admin Protocols module shell, list page, status badge, and keyboard help modal — entry point at `/admin/protocols` for PROTOCOL-02.

## What Was Built

**ProtocolsLayout** (`src/components/admin/protocols/ProtocolsLayout.tsx`) — Pathname-based sub-nav shell mirroring RagLayout.tsx verbatim. Two sub-routes: `list` (ProtocolsListPage) and `editor` (ProtocolEditorPage via lazy import with `.catch()` fallback while Plan 05 is parallel). PopState listener for back/forward nav without react-router.

**ProtocolsListPage** (`src/components/admin/protocols/ProtocolsListPage.tsx`) — Full list view querying `public.protocols`, deduping to highest version per id. Five filter pills (All/Published/In Review/Draft/Archived). Keyboard shortcuts: N=new, J/K=row nav, Shift+?=help. New Protocol CTA inserts a draft row and pushes to `/admin/protocols/<id>`. Empty state, loading skeletons, and error state all implemented.

**ProtocolStatusBadge** (`src/components/admin/protocols/ProtocolStatusBadge.tsx`) — Thin Badge wrapper for `ProtocolReviewState` ENUM with correct tone mapping (draft=neutral, in_review=warning, published=success, archived=neutral+opacity-60) and aria-labels.

**ProtocolKeyboardHelpModal** (`src/components/admin/protocols/ProtocolKeyboardHelpModal.tsx`) — Modal listing N/J/K/Shift+? shortcuts, mirroring QueueKeyboardHelpModal.tsx structure verbatim.

**Admin module registered** in `src/lib/admin/modules.ts` — protocols entry with `ClipboardListIcon`, `flagKey: 'admin_protocols'`, `minRole: 'admin'`, lazy-importing `ProtocolsLayout` default export.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Field] Added `updated_at` to Protocol interface**
- **Found during:** Task 2 TypeScript check
- **Issue:** `ProtocolsListPage` references `updated_at` per plan spec (`ORDER BY updated_at DESC`), but the `Protocol` interface in `src/types/protocols.ts` only had `created_at`. The DB table has `updated_at` via `tg_set_updated_at` trigger.
- **Fix:** Added `updated_at: string` field to `Protocol` interface.
- **Files modified:** `leanshot/src/types/protocols.ts`
- **Commit:** 391ac7fc

**2. [Rule 1 - Bug] Dynamic import for ProtocolEditorPage to avoid TS2307**
- **Found during:** Task 2 TypeScript check
- **Issue:** `import('./ProtocolEditorPage')` causes TS2307 "Cannot find module" because Plan 05's file doesn't exist yet at Wave 1 build time. The plan's `.catch()` pattern doesn't suppress compile-time errors.
- **Fix:** Used `/* @vite-ignore */` comment + dynamic string path to prevent static module resolution while preserving the `.catch()` runtime fallback.
- **Files modified:** `leanshot/src/components/admin/protocols/ProtocolsLayout.tsx`
- **Commit:** 391ac7fc

**3. [Rule 1 - Bug] `Badge tone="muted"` not supported**
- **Found during:** Task 1
- **Issue:** `BadgeTone` union doesn't include `'muted'`. Plan instructions anticipated this and specified the fallback.
- **Fix:** Used `tone="neutral"` + `className="opacity-60"` for archived status per plan fallback instruction.
- **Files modified:** `leanshot/src/components/admin/protocols/ProtocolStatusBadge.tsx`
- **Commit:** 87017bed

**4. [Rule 3 - Blocking] Merged main into worktree to get Wave 0 files**
- **Found during:** Pre-execution
- **Issue:** `src/types/protocols.ts` (from 61-01 Wave 0) not in worktree branch; was in main but worktree branch predated Wave 0 merges.
- **Fix:** `git merge main --no-edit` — fast-forward, no conflicts.

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced beyond what the plan's `<threat_model>` already covers.

- T-61-04-01 (AdminShell route guard + RLS backstop): Implemented via existing AdminShell pattern (minRole: 'admin' in module manifest).
- T-61-04-02 (XSS via protocol name/compound): No `dangerouslySetInnerHTML` used — all content rendered via React text nodes.
- T-61-04-03 (Direct INSERT bypass): Accepted per plan — INSERT still requires SECDEF state machine for publishing.

## Known Stubs

None — ProtocolEditorPage lazy fallback returns `null` (invisible, not a placeholder text stub). Plan 05 ships the real file.

## Self-Check: PASSED

- `ProtocolsLayout.tsx` exists: FOUND
- `ProtocolsListPage.tsx` exists: FOUND
- `ProtocolStatusBadge.tsx` exists: FOUND
- `ProtocolKeyboardHelpModal.tsx` exists: FOUND
- `key: 'protocols'` in modules.ts: FOUND (1 match)
- `--color-rose-soft` in index.css: 2 matches (definition + alias)
- `--color-warning-soft` in index.css: 2 matches (definition + alias)
- TypeScript: 0 new errors
- Tests: 9/9 passed (4 ProtocolStatusBadge + 5 ProtocolsListPage)
- Commits 87017bed (Task 1) + 391ac7fc (Task 2): confirmed in git log
