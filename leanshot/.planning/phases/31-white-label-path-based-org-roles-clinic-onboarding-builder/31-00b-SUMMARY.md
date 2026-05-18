---
phase: "31"
plan: "00b"
subsystem: "frontend/ui-primitives"
tags: ["dnd-kit", "refactor", "generic-component", "accessibility", "page-builder"]
dependency_graph:
  requires: []
  provides: ["src/components/ui/SortableTreePanel.tsx"]
  affects: ["src/components/admin/pages/editor/BlockTreePanel.tsx"]
tech_stack:
  added: []
  patterns: ["Generic React component with type parameter", "dnd-kit v6 accessibility.announcements", "useReducedMotion gating"]
key_files:
  created:
    - "src/components/ui/SortableTreePanel.tsx"
  modified:
    - "src/components/admin/pages/editor/BlockTreePanel.tsx"
decisions:
  - "Used concat+renumber onReorder adapter (see Deviations) to preserve reorderBlocks semantics"
  - "Drag handle split into conditional span/button to avoid tabIndex collision with useSortable attributes"
metrics:
  duration: "6 minutes"
  completed: "2026-05-18"
  tasks_completed: 3
  files_created: 1
  files_modified: 1
requirements:
  - "ORG-13"
---

# Phase 31 Plan 00b: SortableTreePanel Extraction Summary

Extracted the Phase 15 dnd-kit reorder primitives from `BlockTreePanel.tsx` into a reusable generic `SortableTreePanel<T>` primitive at `src/components/ui/SortableTreePanel.tsx`. Refactored `BlockTreePanel.tsx` to consume the new primitive with zero functional change.

## Tasks Completed

| Task | Description | Commit | Status |
|------|-------------|--------|--------|
| 1 | Create `SortableTreePanel<T>` generic primitive | `82a8256` | DONE |
| 2 | Refactor `BlockTreePanel.tsx` to consume primitive | `bf06f31` | DONE |
| 3 | Verify zero-regression (vitest + typecheck + build + bundle) | (verification only) | DONE |

## SortableTreePanel<T> API Surface

For Plan 31-05's consumer-side reference:

```typescript
export interface SortableTreePanelProps<T> {
  items: T[];
  getId: (item: T) => string;
  onReorder: (next: T[]) => void;
  renderItem: (item: T, index: number, isDragging: boolean) => ReactNode;
  announceItemLabel: (item: T) => string;
  isDragDisabled?: (item: T) => boolean;
  announcements?: Partial<Announcements>; // per-handler overrides, merged over defaults
}

export function SortableTreePanel<T>(props: SortableTreePanelProps<T>);
export { SortableTreePanelProps };
```

Import path: `import { SortableTreePanel } from '@/components/ui/SortableTreePanel'`

**Drag handle:** Rendered internally by `SortableTreePanel` — 40×44 px, `cursor-grab touch-none`, `aria-label="Drag to reorder {announceItemLabel(item)}"`, lucide-react `GripVertical` 16px. Hidden (opacity 0 + pointer-events none + span instead of button) when `isDragDisabled(item)` returns true.

**SR announcements (defaults):**
- onDragStart: "Picked up {name}. It is in position {pos} of {total}."
- onDragOver: "{name} moved to position {pos} of {total}."
- onDragEnd: "{name} dropped at position {pos}."
- onDragCancel: "Reordering cancelled. {name} returned to position {pos}."

Consumer overrides via `announcements?: Partial<Announcements>` — `undefined` handlers are filtered out before merging so defaults are preserved.

**a11y contract values (Phase 15 preserved):**
- PointerSensor: `activationConstraint: { distance: 5 }`
- KeyboardSensor: `coordinateGetter: sortableKeyboardCoordinates`
- Collision: `closestCenter`
- Strategy: `verticalListSortingStrategy`
- Transition: gated on `useReducedMotion()` — skipped when true

## Verification Results

| Gate | Command | Result |
|------|---------|--------|
| 1. Page-builder vitest neighbors | `npm run test:unit -- PreviewPane.test.tsx VersionHistoryPanel.test.tsx` | 2 files / 10 tests PASSED |
| 2. Full typecheck | `npm run typecheck` | PASSED |
| 3. Full build | `npm run build` | PASSED (4.06s) |
| 4. Clinic bundle invariants | `bash scripts/assert-clinic-bundle-budget.sh` | PASSED — `dnd-kit index-leak invariant OK` |
| 5. vendor-dnd-kit chunk present | node -e "..." | `vendor-dnd-kit-qKB2t0o2.js` FOUND |

## Bundle Math

- `vendor-dnd-kit`: 15.28 kB gz (unchanged — still in its own chunk)
- `clinic-D9VbCHpI.js`: 35.43 kB gz (within 36 kB ceiling)
- `page-builder-runtime`: 4.99 kB gz (slightly reduced — dnd-kit wiring abstracted)
- Index chunk: 19.68 kB gz (dnd-kit not leaked in)
- `SortableTreePanel.tsx` net cost: ~0 kB (page-builder chunk offset by primitive extraction)

## Deviations from Plan

### Chosen onReorder Adapter Pattern

**Task:** Task 2 — BlockTreePanel refactor `onReorder` callback shape

**Decision:** Used concat+renumber approach:
```typescript
onReorder={(nextRoot) => {
  const nonRoot = blocks.filter((b) => b.parent_id !== null);
  onChange(
    [...nextRoot, ...nonRoot].map((b, i) => (b.order === i ? b : { ...b, order: i }))
  );
}}
```

**Reason:** Reading `reorderBlocks` in `page-api.ts`: it calls `arrayMove(blocks, fromIdx, toIdx)` on the FULL blocks array then `renumber` (contiguous `order` re-index). For Phase 15's flat tree (no nested blocks, `parent_id` always null), `blocks === rootBlocks`. The concat approach produces identical output since `SortableTreePanel` already performed the `arrayMove`, and renumbering is applied inline. This avoids deriving `(activeId, overId)` from `(nextRoot, rootBlocks)` which would require scanning for position changes and is error-prone.

**Plan note:** Plan Implementation Note Option 1 — "if [reorderBlocks] is simply arrayMove, then onReorder={(nextRoot) => onChange([...nextRoot, ...blocks.filter((b) => b.parent_id !== null)])}". Added the inline renumber (`.map((b, i) => ...)`) to exactly match `reorderBlocks`'s `renumber` pass.

### Rule 1 Fix — drag handle tabIndex collision

**Found during:** Task 1 implementation (`npm run typecheck` caught it)

**Issue:** `useSortable` spreads `attributes` which includes `tabIndex`. Passing an additional `tabIndex` prop on the same button caused TS2783: "'tabIndex' is specified more than once."

**Fix:** Split the drag handle into two render paths: when `isDragDisabled`, render a `<span aria-hidden>` placeholder (no attributes, no tabIndex conflict); when enabled, render `<button>` with spread `{...attributes} {...listeners}` only.

**Files:** `src/components/ui/SortableTreePanel.tsx`

**Impact:** Zero behavioral change. Correct handling (disabled → not focusable, not activatable).

## Known Stubs

None — no data sources, no placeholder text, no hardcoded empty values. This plan is a pure frontend refactor.

## Threat Flags

None — no new network endpoints, no auth paths, no schema changes. Pure component extraction.

## Self-Check: PASSED

- `src/components/ui/SortableTreePanel.tsx` EXISTS: VERIFIED
- `export function SortableTreePanel` in file: VERIFIED
- Commits `82a8256` + `bf06f31` in git log: VERIFIED
- Page-builder tests still green: VERIFIED (10/10)
- dnd-kit index-leak invariant OK: VERIFIED
- vendor-dnd-kit chunk present: VERIFIED
