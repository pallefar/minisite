---
phase: 31-white-label-path-based-org-roles-clinic-onboarding-builder
plan: 00b
type: execute
wave: 0
depends_on: []
files_modified:
  - src/components/ui/SortableTreePanel.tsx
  - src/components/admin/pages/editor/BlockTreePanel.tsx
autonomous: true
requirements:
  - ORG-13
must_haves:
  truths:
    - "Reusable `SortableTreePanel<T>` primitive exists at `src/components/ui/SortableTreePanel.tsx` exporting the API surface RESEARCH Finding 7 + Pattern 5 specify."
    - "Page-builder block tree at `BlockTreePanel.tsx` consumes `SortableTreePanel<BlockNode>` and exhibits zero externally-visible behavior change (same DOM shape, same drag-handle aria-label, same selection/highlight)."
    - "Phase 15 page-builder vitest neighbors (`PreviewPane.test.tsx` + `VersionHistoryPanel.test.tsx`) still pass after the refactor."
    - "`SortableTreePanel<T>` preserves the Phase 15 a11y contract: PointerSensor 5px activation distance, KeyboardSensor with `sortableKeyboardCoordinates`, `closestCenter` collision detection, `verticalListSortingStrategy`, and `useReducedMotion()`-gated per-item transitions."
    - "`<DndContext>` inside `SortableTreePanel<T>` wires the v6 built-in `accessibility.announcements` 4-handler shape (`onDragStart`, `onDragOver`, `onDragEnd`, `onDragCancel`) — no new `@dnd-kit/accessibility` package added."
    - "`scripts/assert-clinic-bundle-budget.sh` still passes — dnd-kit remains in the `vendor-dnd-kit` chunk and is NOT statically imported by the index chunk (the `dnd-kit index-leak invariant OK` guard at line 417 continues to pass)."
  artifacts:
    - path: "src/components/ui/SortableTreePanel.tsx"
      provides: "Generic `SortableTreePanel<T>` primitive (PUBLIC API: `items`, `getId`, `onReorder`, `renderItem`, `announceItemLabel`, optional `isDragDisabled`, optional `announcements`) used by Plan 31-05 OnboardingTab and by `BlockTreePanel`."
      exports: ["SortableTreePanel", "SortableTreePanelProps"]
      min_lines: 80
    - path: "src/components/admin/pages/editor/BlockTreePanel.tsx"
      provides: "Refactored page-builder block tree consuming `SortableTreePanel<BlockNode>`; preserves all existing externally-visible behavior."
      contains: "SortableTreePanel"
  key_links:
    - from: "src/components/admin/pages/editor/BlockTreePanel.tsx"
      to: "src/components/ui/SortableTreePanel.tsx"
      via: "import { SortableTreePanel } from '@/components/ui/SortableTreePanel'"
      pattern: "from\\s+['\"]@/components/ui/SortableTreePanel['\"]"
    - from: "src/components/ui/SortableTreePanel.tsx"
      to: "@dnd-kit/core + @dnd-kit/sortable + @dnd-kit/utilities (v6)"
      via: "DndContext + useSortable + arrayMove + accessibility.announcements"
      pattern: "accessibility\\s*=\\s*\\{"
    - from: "src/components/ui/SortableTreePanel.tsx"
      to: "src/hooks/useReducedMotion.ts"
      via: "import { useReducedMotion } — per-item transition gated on reducedMotion"
      pattern: "useReducedMotion"
---

<objective>
Extract the dnd-kit reorder primitives from Phase 15's page-builder `BlockTreePanel.tsx` into a reusable generic primitive `SortableTreePanel<T>` at `src/components/ui/SortableTreePanel.tsx`. Refactor `BlockTreePanel.tsx` to consume the new primitive with zero functional change. This unblocks Plan 31-05's `OnboardingTab` (Wave 2) which will consume `SortableTreePanel<OnboardingStepNode>` (D-11 — separate `OnboardingStepNode` schema vs marketing-oriented `BlockNode`).

Purpose: D-11 requires extracting the Phase 15 dnd-kit primitives so the onboarding step builder can reuse them without re-implementing keyboard a11y, sensor activation, SR announcements, and reduced-motion handling. Isolating the extraction in Wave 0 means the verifier confirms Phase 15 page-builder vitest neighbors still pass BEFORE any clinic-specific plans start — if the refactor regresses the page builder, the fix is contained in one plan with no other P31 work entangled (per RESEARCH Finding 5 + Finding 7).

Output: New file `src/components/ui/SortableTreePanel.tsx` (generic primitive with v6 `accessibility.announcements` wired) + refactored `src/components/admin/pages/editor/BlockTreePanel.tsx` consuming it. No schema, no migration, no Edge Function — pure frontend refactor. Net bundle impact ≈ 0 kB (page-builder chunk loses what `src/components/ui/` gains; dnd-kit stays in the `vendor-dnd-kit` chunk).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/31-white-label-path-based-org-roles-clinic-onboarding-builder/31-CONTEXT.md
@.planning/phases/31-white-label-path-based-org-roles-clinic-onboarding-builder/31-RESEARCH.md
@.planning/phases/31-white-label-path-based-org-roles-clinic-onboarding-builder/31-UI-SPEC.md
@.planning/phases/31-white-label-path-based-org-roles-clinic-onboarding-builder/31-PLAN-OUTLINE.md
@src/components/admin/pages/editor/BlockTreePanel.tsx
@src/components/admin/pages/editor/PreviewPane.test.tsx
@src/components/admin/pages/editor/VersionHistoryPanel.test.tsx
@src/hooks/useReducedMotion.ts
@src/lib/page-builder/page-api.ts

<interfaces>
<!-- Key types and contracts the executor needs. Extracted from RESEARCH §Finding 5/7 + Pattern 5 + the live source files. -->
<!-- Executor should use these directly — no codebase exploration needed. -->

From src/components/admin/pages/editor/BlockTreePanel.tsx (CURRENT — to be refactored):

```typescript
export interface BlockTreePanelProps {
  blocks: BlockNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChange: (blocks: BlockNode[]) => void;
}

// Current behavior to preserve EXACTLY:
//  1. Filter root blocks (b.parent_id === null) and pass them as the sortable list.
//  2. Render Card variant="flat" padding="md" wrapper with h2 "Blocks" heading.
//  3. Empty-state copy: "Add your first block from the palette below, or pick a template to get started."
//  4. Per-row layout: drag handle (40x44 cursor-grab, aria-label="Drag to reorder", GripVertical 16px)
//     + selection button (flex-1, 44px tall, 13px font, data-testid="block-tree-item-{id}",
//     data-block-type={type}). Selected row gets bg-[var(--color-primary-soft)] + ring-1.
//  5. Drop end: call reorderBlocks(blocks, active.id, over.id) from '@/lib/page-builder/page-api'
//     and pass result to onChange.
//  6. ReducedMotion: per-item style.transition = reduced ? undefined : transition.
//  7. isDragging opacity: 0.5.
```

From RESEARCH §Pattern 5 — TARGET API for src/components/ui/SortableTreePanel.tsx (NEW):

```typescript
import type { ReactNode } from 'react';
import type { Announcements } from '@dnd-kit/core';

export interface SortableTreePanelProps<T> {
  items: T[];
  getId: (item: T) => string;
  onReorder: (next: T[]) => void;
  // renderItem receives the item, its index, and isDragging flag; render the row body
  // (label + secondary controls). The drag handle is rendered by SortableTreePanel itself
  // OR (per option below) the consumer may provide a custom handle slot. See <action>.
  renderItem: (item: T, index: number, isDragging: boolean) => ReactNode;
  // For SR announcements — given an item, return its human label (e.g. "Hero" / "Welcome step").
  announceItemLabel: (item: T) => string;
  // Optional per-item lock — locked items get a disabled (or hidden) drag handle.
  isDragDisabled?: (item: T) => boolean;
  // Optional override of any of the 4 announcement handlers (consumer keeps the defaults
  // for the handlers it does not provide).
  announcements?: Partial<Announcements>;
}

export function SortableTreePanel<T>(props: SortableTreePanelProps<T>): JSX.Element;
```

From @dnd-kit/core v6.3.1 (already installed — DO NOT add @dnd-kit/accessibility):

```typescript
// v6 DndContext supports an `accessibility` prop with two sub-fields.
<DndContext
  sensors={sensors}
  collisionDetection={closestCenter}
  onDragEnd={handleDragEnd}
  accessibility={{
    announcements: {
      onDragStart({ active }) { /* ... */ },
      onDragOver({ active, over }) { /* ... */ },
      onDragEnd({ active, over }) { /* ... */ },
      onDragCancel({ active }) { /* ... */ },
    },
    // Optional: screenReaderInstructions: { draggable: '...' }
  }}
>
```

From @dnd-kit/sortable 10.0.0:
```typescript
import { arrayMove, SortableContext, sortableKeyboardCoordinates,
         useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
```

From src/hooks/useReducedMotion.ts:
```typescript
export function useReducedMotion(): boolean;
```

From src/lib/page-builder/page-api.ts (referenced by current BlockTreePanel):
```typescript
// Generic semantics: returns blocks with active.id moved to over.id's position.
export function reorderBlocks(blocks: BlockNode[], activeId: string, overId: string): BlockNode[];
```
</interfaces>

<scope_anchors>
- This plan touches ONLY two files. DO NOT modify `page-api.ts`, `BlockNode` schema, vite config, package.json, ESLint rules, or anything else.
- DO NOT add any new npm dependency (specifically: NOT `@dnd-kit/accessibility`).
- DO NOT change the page-builder UI in any externally-visible way (no copy change, no class change beyond what's required to preserve the existing visuals, no data-testid change).
- DO NOT touch any test file in this plan. The neighbor vitest files (`PreviewPane.test.tsx`, `VersionHistoryPanel.test.tsx`) are read-only references that MUST still pass.
- Out of scope (lives in Plan 31-05): consumption of `SortableTreePanel<OnboardingStepNode>` by `OnboardingTab.tsx`.
- Out of scope (lives in Plan 31-04): the `OnboardingStepNode` type itself.
</scope_anchors>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create generic `SortableTreePanel<T>` primitive at `src/components/ui/SortableTreePanel.tsx`</name>
  <files>src/components/ui/SortableTreePanel.tsx</files>
  <read_first>
    - @src/components/admin/pages/editor/BlockTreePanel.tsx — verbatim source of the dnd-kit wiring being generalized. Preserve sensor params, collision strategy, sortable strategy, and reducedMotion handling.
    - @src/hooks/useReducedMotion.ts — confirm the hook returns `boolean` and is safe to call at component top-level (no SSR; project is SPA per CLAUDE.md).
    - @.planning/phases/31-white-label-path-based-org-roles-clinic-onboarding-builder/31-RESEARCH.md §Finding 5 (lines 520-590) for the v6 `accessibility.announcements` 4-handler shape and §Pattern 5 (lines 968-1058) for the reference implementation skeleton.
    - @.planning/phases/31-white-label-path-based-org-roles-clinic-onboarding-builder/31-UI-SPEC.md §Interaction States → "Drag-and-drop (SortableTreePanel) keyboard a11y contract" for the SR announcement strings (positions and "Reordering cancelled. … returned to position {pos}."). The default announcement strings inside `SortableTreePanel<T>` should follow these shapes but parameterized by `announceItemLabel(item)`.
  </read_first>
  <behavior>
    - Exports `SortableTreePanelProps<T>` and `SortableTreePanel<T>` matching the interface block above.
    - Wires `useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))` — identical to current `BlockTreePanel`.
    - `DndContext` uses `collisionDetection={closestCenter}`, `onDragEnd={handleDragEnd}`, and `accessibility={{ announcements: { ... } }}` with all four handlers (`onDragStart`, `onDragOver`, `onDragEnd`, `onDragCancel`) implemented per RESEARCH Pattern 5. The default announcement strings reference `announceItemLabel(item)`; if `props.announcements` is provided, each handler in it overrides the corresponding default (use `{ ...defaults, ...props.announcements }`).
    - `SortableContext` uses `items={items.map(getId)}` + `strategy={verticalListSortingStrategy}`.
    - Renders `<ul className="flex flex-col gap-1">` wrapping one `<SortableItem>` per item. `<SortableItem>` is a local component inside the same file that calls `useSortable({ id, disabled })`, computes `style = { transform: CSS.Transform.toString(transform), transition: reducedMotion ? undefined : transition, opacity: isDragging ? 0.5 : 1 }`, and renders the row.
    - Each row provides BOTH a drag handle (built-in, 40×44 px, cursor-grab, `aria-label={"Drag to reorder " + announceItemLabel(item)}`, lucide-react `GripVertical` 16px) AND the consumer's `renderItem(item, index, isDragging)` rendered alongside the handle. The handle is hidden (`opacity: 0; pointer-events: none; aria-hidden=true; tabIndex=-1`) when `isDragDisabled?.(item)` returns true; `useSortable` is called with `disabled: isDragDisabled?.(item) ?? false`.
    - Empty state: when `items.length === 0`, render nothing inside the `<DndContext>` (consumer owns its own empty UI — `BlockTreePanel` already short-circuits on `rootBlocks.length === 0` BEFORE handing off to SortableTreePanel, so this primitive does not need an empty state of its own; see Task 2 below).
    - `handleDragEnd`: if `!over || active.id === over.id` return; otherwise compute `oldIdx` + `newIdx` via `items.findIndex(getId === String(active.id|over.id))`; if both ≥0, call `onReorder(arrayMove(items, oldIdx, newIdx))`.
    - File ends with no default export (named exports only).
    - No console.log, no TODO comments, no `any` types. TS strict mode must pass.

    Tests for THIS plan are out of scope at the task level (no new test file added per `<scope_anchors>`). Behavioral correctness is proven by Task 3's vitest neighbor regression check — if the page-builder neighbors keep passing after `BlockTreePanel` consumes this primitive, the primitive itself is correct.
  </behavior>
  <action>
    Create `src/components/ui/SortableTreePanel.tsx` as a generic `<T>` component that fully encapsulates the dnd-kit wiring presently inlined in `BlockTreePanel.tsx`. Follow RESEARCH §Pattern 5 (lines 968-1058) as the reference skeleton and adapt it to: (1) render the drag handle inside the primitive (40×44 px button with `cursor-grab touch-none flex items-center justify-center text-[var(--color-text-secondary)]`, lucide-react `GripVertical` 16px, dynamic `aria-label` from `announceItemLabel`), (2) gate the handle on `isDragDisabled?.(item)`, (3) accept optional `announcements` override merged over the defaults (consumer overrides win per-handler). Use TS generics for `T`; do NOT widen to `unknown`. Import `useReducedMotion` from `@/hooks/useReducedMotion` and gate `transition` on it. Match the exact sensor params (PointerSensor distance 5; KeyboardSensor `sortableKeyboardCoordinates`) and the exact strategies (`closestCenter` + `verticalListSortingStrategy`) — these are the Phase 15 a11y contract values and must not drift. Use named exports only. Do NOT install or import `@dnd-kit/accessibility` (per RESEARCH Finding 5 — the v6 built-in `accessibility.announcements` prop on `DndContext` is the chosen shape; D-09/D-11 in CONTEXT confirm no new dependency).
  </action>
  <verify>
    <automated>npm run typecheck 2>&amp;1 | tail -20 &amp;&amp; test -f src/components/ui/SortableTreePanel.tsx &amp;&amp; grep -q "export function SortableTreePanel" src/components/ui/SortableTreePanel.tsx &amp;&amp; grep -q "accessibility" src/components/ui/SortableTreePanel.tsx &amp;&amp; grep -q "useReducedMotion" src/components/ui/SortableTreePanel.tsx &amp;&amp; grep -q "PointerSensor" src/components/ui/SortableTreePanel.tsx &amp;&amp; grep -q "KeyboardSensor" src/components/ui/SortableTreePanel.tsx &amp;&amp; grep -q "verticalListSortingStrategy" src/components/ui/SortableTreePanel.tsx &amp;&amp; grep -q "closestCenter" src/components/ui/SortableTreePanel.tsx &amp;&amp; grep -q "arrayMove" src/components/ui/SortableTreePanel.tsx &amp;&amp; ! { grep -v '^\s*//\|^\s*\*' src/components/ui/SortableTreePanel.tsx | grep -q "@dnd-kit/accessibility"; } &amp;&amp; echo "OK: no @dnd-kit/accessibility import" || { echo "FAIL: @dnd-kit/accessibility must NOT be imported"; exit 1; }</automated>
  </verify>
  <done>
    `src/components/ui/SortableTreePanel.tsx` exists, exports `SortableTreePanel` + `SortableTreePanelProps`, passes `npm run typecheck`, wires v6 `accessibility.announcements` with all 4 handlers, gates per-item `transition` on `useReducedMotion()`, and contains NO `@dnd-kit/accessibility` import.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Refactor `BlockTreePanel.tsx` to consume `SortableTreePanel<BlockNode>` (zero functional change)</name>
  <files>src/components/admin/pages/editor/BlockTreePanel.tsx</files>
  <read_first>
    - @src/components/admin/pages/editor/BlockTreePanel.tsx — full current source. Note: the `<Card variant="flat">` wrapper + h2 "Blocks" heading + empty-state copy + root-block filter live OUTSIDE the new primitive and must stay in `BlockTreePanel`.
    - @src/components/admin/pages/editor/PreviewPane.test.tsx + @src/components/admin/pages/editor/VersionHistoryPanel.test.tsx — neighbor tests in the same folder. Confirm they do not import or assert against `BlockTreePanel` internals (they do not — they exercise PreviewPane and VersionHistoryPanel independently). The refactor must keep these tests green by NOT introducing transitive failures (e.g. shared module errors, circular imports, build-time breakage).
    - @src/lib/page-builder/page-api.ts — `reorderBlocks(blocks, activeId, overId)` — preserved; we will keep calling it from the `onReorder` callback handed to `SortableTreePanel`.
  </read_first>
  <behavior>
    - `BlockTreePanel` still exports the same `BlockTreePanelProps` shape (`blocks`, `selectedId`, `onSelect`, `onChange`) — no consumer changes.
    - Outer wrapper, "Blocks" heading, empty-state copy, and root-block filter (`b.parent_id === null`) all remain in `BlockTreePanel` (NOT moved into the generic primitive).
    - When `rootBlocks.length > 0`, render `<SortableTreePanel<BlockNode> items={rootBlocks} getId={(b) => b.id} announceItemLabel={(b) => labelForType(b.type)} onReorder={(next) => onChange(reorderBlocks(blocks, ...derive...))} renderItem={(b, _i, _isDragging) => <BlockTreeItemBody block={b} selected={selectedId === b.id} onSelect={onSelect} />} />`.
    - **Important compatibility note for `onReorder`:** The current `BlockTreePanel.handleDragEnd` calls `reorderBlocks(blocks, String(active.id), String(over.id))` against the FULL `blocks` array (not just `rootBlocks`). The new primitive's `onReorder(next)` callback hands back the reordered `rootBlocks`. The refactor must preserve identical semantics: reconstruct the full `blocks` array by replacing the root-level slice with the new order while keeping non-root blocks in place. Simplest correct approach: instead of using `onReorder(next)` directly, pass `onReorder={(next) => { /* compute new active/over from next vs rootBlocks and call onChange(reorderBlocks(blocks, activeId, overId)) */ }}` — OR (cleaner) pass `onReorder={(nextRoot) => onChange([...nextRoot, ...blocks.filter((b) => b.parent_id !== null)])}` IF that preserves Phase 15's semantics. Verify by reading `reorderBlocks` in `page-api.ts` before choosing; the goal is byte-identical behavior for the test surface. If `reorderBlocks` does more than `arrayMove` over root blocks (e.g. nested-tree-aware), keep using `reorderBlocks` by capturing `active.id` + `over.id` via a custom `onReorder` adapter (you may instead provide an override via the `announcements` and use the `handleDragEnd` from inside a thin wrapper — see Implementation Note below).
    - The drag-handle row body (`BlockTreeItemBody`) renders: the selection button (flex-1, 44px tall, 13px font, `data-testid="block-tree-item-{id}"`, `data-block-type={type}`, selected-row highlight ring/bg). The drag handle itself is now rendered by `SortableTreePanel` — `BlockTreeItemBody` no longer renders `GripVertical`. The outer `<li>` and selection/highlight wrapper classes that USED to live on the `<li>` need to be re-homed: the `<li>` is now provided by `SortableTreePanel`; the selection-highlight classes (`bg-[var(--color-primary-soft)] ring-1 ring-[var(--color-primary)]` etc.) move INTO the `renderItem` body OR onto a wrapper `<div>` inside it. The end-user visual result must match.
    - All existing `data-testid="block-tree-item-{id}"` and `data-block-type={type}` attributes preserved EXACTLY for any downstream tests/selectors.
    - `labelForType()` helper preserved verbatim and used for both the selection button text and `announceItemLabel`.

    **Implementation Note for the `onReorder` shape mismatch:**
    Reading `reorderBlocks` in `src/lib/page-builder/page-api.ts` first is mandatory. Two acceptable patterns depending on what `reorderBlocks` does:
    - If it is simply `arrayMove` over the passed array, then `onReorder={(nextRoot) => onChange([...nextRoot, ...blocks.filter((b) => b.parent_id !== null)])}` is correct (concatenation order is irrelevant if downstream consumers don't depend on full-array ordering of non-root nodes; verify against page-builder tests).
    - If `reorderBlocks` does tree-aware repositioning (parent_id traversal, sibling-only swaps), then keep calling it. To get `activeId`/`overId` into the callback, pass an `onReorder` adapter that re-derives `activeId` = the item whose position in `nextRoot` differs from its position in `rootBlocks` (the moved item), and `overId` = the item now at that position. Or simpler: skip `arrayMove` semantics entirely and keep the original `handleDragEnd` by accepting a `customHandleDragEnd` escape hatch — but per the `<scope_anchors>` rule, we MUST NOT change `SortableTreePanel<T>`'s API for this. The clean path is: derive `(activeId, overId)` from `(rootBlocks, nextRoot)` in the consumer, then call `onChange(reorderBlocks(blocks, activeId, overId))`. This keeps `SortableTreePanel<T>` purely generic.
  </behavior>
  <action>
    Refactor `src/components/admin/pages/editor/BlockTreePanel.tsx` to delegate all dnd-kit wiring (DndContext, sensors, SortableContext, useSortable, drag handle rendering, reducedMotion gating, drag-end calculation) to `<SortableTreePanel<BlockNode>>` from `@/components/ui/SortableTreePanel`. Preserve the `<Card variant="flat">` wrapper, h2 "Blocks" heading, root-block filter, empty-state copy, `BlockTreePanelProps` export shape, `labelForType()` helper, `data-testid="block-tree-item-{id}"` attributes, and `data-block-type` attributes EXACTLY. Inline the row body (formerly `BlockTreeItem`'s inner content) into a `renderItem` callback — the selection button keeps the same Tailwind classes that produce the existing selected-state highlight. Adapt the `onReorder` callback per the Implementation Note above (read `reorderBlocks` first to pick the correct pattern). Remove the now-unused dnd-kit imports from this file (they live in `SortableTreePanel` now); keep only the imports actually used by the refactored file (`Card`, `BlockNode`, `reorderBlocks`, `useReducedMotion` is no longer needed here since SortableTreePanel owns it). Run `npm run typecheck` and fix any drift; run `npm run lint -- src/components/admin/pages/editor/BlockTreePanel.tsx src/components/ui/SortableTreePanel.tsx` and fix any new lint errors INTRODUCED by this plan (do not fix pre-existing repo-wide lint debt — that's documented in [[project_lint_debt_import_x_order]]).
  </action>
  <verify>
    <automated>npm run typecheck 2>&amp;1 | tail -10 &amp;&amp; grep -q "SortableTreePanel" src/components/admin/pages/editor/BlockTreePanel.tsx &amp;&amp; grep -q "from '@/components/ui/SortableTreePanel'" src/components/admin/pages/editor/BlockTreePanel.tsx &amp;&amp; grep -q "labelForType" src/components/admin/pages/editor/BlockTreePanel.tsx &amp;&amp; grep -q 'data-testid=\`block-tree-item-' src/components/admin/pages/editor/BlockTreePanel.tsx &amp;&amp; grep -q 'data-block-type' src/components/admin/pages/editor/BlockTreePanel.tsx &amp;&amp; ! grep -qE "from\\s+'@dnd-kit/(core|sortable|utilities)'" src/components/admin/pages/editor/BlockTreePanel.tsx &amp;&amp; echo "OK: BlockTreePanel refactored — dnd-kit imports removed, SortableTreePanel consumed, testid + block-type + labelForType preserved"</automated>
  </verify>
  <done>
    `BlockTreePanel.tsx` consumes `SortableTreePanel<BlockNode>`, contains no direct `@dnd-kit/*` imports, preserves `BlockTreePanelProps` + `labelForType` + `data-testid="block-tree-item-{id}"` + `data-block-type` attributes, and passes `npm run typecheck`.
  </done>
</task>

<task type="auto">
  <name>Task 3: Verify zero-regression — page-builder vitest neighbors green AND clinic bundle invariants pass</name>
  <files>(no file modifications — verification only)</files>
  <read_first>
    - @scripts/assert-clinic-bundle-budget.sh — the bundle invariants script. The dnd-kit-in-index guard (`dnd-kit index-leak invariant OK`) lives near line 417. Confirm it still prints success after `npm run build`.
  </read_first>
  <action>
    Run the verification gauntlet in this exact order and stop at the first failure (diagnose then fix; do not "fix forward" by editing tests):
    1. `npm run test:unit -- src/components/admin/pages/editor/PreviewPane.test.tsx src/components/admin/pages/editor/VersionHistoryPanel.test.tsx` — Phase 15 page-builder vitest neighbors must remain green. If they fail, the refactor in Task 2 broke a shared assumption (most likely: a class name or testid moved). Diagnose by reading the failing assertion, then fix `BlockTreePanel.tsx` to restore parity — do NOT edit the test files.
    2. `npm run typecheck` — full project typecheck must pass.
    3. `npm run build` — full Vite build must succeed.
    4. `bash scripts/assert-clinic-bundle-budget.sh` — the clinic bundle invariants script must print `dnd-kit index-leak invariant OK: no static @dnd-kit imports in index chunk` AND exit 0. This proves dnd-kit stayed in the `vendor-dnd-kit` chunk and was NOT inlined into the index chunk by the refactor.
    5. `node -e "const fs=require('fs');const dist=require('child_process').execSync('ls dist/assets/').toString().split('\n');const ddir=dist.find(f=>/vendor-dnd-kit/.test(f));if(!ddir){console.error('FAIL: vendor-dnd-kit chunk missing from dist/assets/');process.exit(1);}console.log('OK: vendor-dnd-kit chunk present:', ddir);"` — sanity check that dnd-kit chunk exists in build output (proves manualChunks routing is intact).

    If all 5 gates pass, the refactor is verified zero-regression. If any gate fails, do NOT mark the plan complete — diagnose and fix in the appropriate task (Task 1 or Task 2) and re-run from gate 1.
  </action>
  <verify>
    <automated>npm run test:unit -- src/components/admin/pages/editor/PreviewPane.test.tsx src/components/admin/pages/editor/VersionHistoryPanel.test.tsx 2>&amp;1 | tail -15 &amp;&amp; npm run typecheck 2>&amp;1 | tail -5 &amp;&amp; npm run build 2>&amp;1 | tail -10 &amp;&amp; bash scripts/assert-clinic-bundle-budget.sh 2>&amp;1 | tail -10</automated>
  </verify>
  <done>
    All 5 verification gates pass: page-builder vitest neighbors green, typecheck green, build green, dnd-kit-index-leak invariant green, vendor-dnd-kit chunk present in `dist/assets/`.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Frontend refactor → page-builder admin surface | The refactor changes how the page-builder block tree composes its dnd-kit wiring. The boundary is "Phase 15 admin user reorders blocks in a draft page" — preserving the existing keyboard-a11y reorder path is a contract. |
| Frontend refactor → clinic chunk bundle math | The extracted `SortableTreePanel<T>` lives at `src/components/ui/` and will be imported by Plan 31-05's `OnboardingTab.tsx` (clinic chunk). Vite's manualChunks must continue to route `@dnd-kit/*` into the dedicated `vendor-dnd-kit` chunk; if it leaks into the index chunk, the `assert-clinic-bundle-budget.sh` guard at line 417 fails CI. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-31-00b-01 | T (Tampering with existing behavior) | `BlockTreePanel.tsx` refactor → Phase 15 page-builder a11y reorder path (keyboard + SR announcements) | mitigate | Task 3 verifies `PreviewPane.test.tsx` + `VersionHistoryPanel.test.tsx` still pass after refactor; PointerSensor 5px / KeyboardSensor `sortableKeyboardCoordinates` / `closestCenter` / `verticalListSortingStrategy` params preserved verbatim from `BlockTreePanel`; v6 `accessibility.announcements` 4-handler shape wired in `SortableTreePanel<T>` (Task 1) so a11y is improved (Phase 15 had no SR announcements; SortableTreePanel adds them as part of the extraction). The existing per-row `aria-label="Drag to reorder"` + `cursor-grab` + 40×44 px touch target are preserved by Task 1 (drag handle renders inside primitive with dynamic aria-label `"Drag to reorder {announceItemLabel(item)}"`). `useReducedMotion()` gating on per-item `transition` preserved. |
| T-31-00b-02 | I (Information disclosure via bundle bloat) | Clinic chunk bundle math — dnd-kit accidentally inlined into the index chunk due to `src/components/ui/SortableTreePanel.tsx` being imported by an index-eligible module | mitigate | `SortableTreePanel.tsx` lives in `src/components/ui/` but its ONLY consumers in this phase are `BlockTreePanel.tsx` (admin chunk, behind `React.lazy()` per Phase 15) and (in Plan 31-05) `OnboardingTab.tsx` (clinic chunk, behind `React.lazy()` per Phase 30). Neither consumer is statically imported by the index chunk. Task 3 gate 4 (`bash scripts/assert-clinic-bundle-budget.sh`) verifies the `dnd-kit index-leak invariant OK` guard at line 417 still passes after build. If the guard fails, the refactor introduced a static import path from the index chunk into `SortableTreePanel.tsx` — diagnose by reading the build's index chunk and trace the import path. |
| T-31-00b-03 | T (Tampering — silent test-file edit to mask regression) | The two neighbor vitest files are READ-ONLY references; editing them to make the build pass would mask a genuine regression | mitigate | `<scope_anchors>` and Task 3's action explicitly prohibit editing the test files; `files_modified` frontmatter lists only the two production files. Inline-fix policy: when a vitest neighbor fails, fix `BlockTreePanel.tsx` to restore parity, never the test. |
| T-31-00b-04 | I (Implicit a11y regression via missing announcement strings) | If a consumer passes `announcements: {}` (empty) by mistake, the merge `{ ...defaults, ...overrides }` correctly keeps defaults — but if `announcements: { onDragStart: undefined }` is passed, the merge would null out the handler. Low risk because this plan does not produce any consumer; Plan 31-05 consumer is reviewed separately. | accept | Low-risk because the only consumer in this plan (BlockTreePanel) does not pass `announcements` at all (uses defaults). Plan 31-05 consumer follows the same pattern. Defensive guard inside `SortableTreePanel<T>` (filter out `undefined` handlers from the override map before merging) is a nice-to-have but not strictly required for ASVS L1 — accepting the risk. |
</threat_model>

<verification>
End-to-end phase-level checks (in addition to per-task `<verify>` gates):

1. `npm run test:unit -- src/components/admin/pages/editor/` — runs ALL vitest tests in the editor folder (catches any indirect regression beyond the two named neighbors). MUST be green.
2. `npm run typecheck` — full project typecheck green.
3. `npm run build` — successful Vite build.
4. `bash scripts/assert-clinic-bundle-budget.sh` — clinic bundle invariants PASS (specifically the `dnd-kit index-leak invariant OK` line near line 417).
5. `test -f src/components/ui/SortableTreePanel.tsx` AND `grep -q "export function SortableTreePanel" src/components/ui/SortableTreePanel.tsx` — primitive file exists with named export.
6. `! grep -rE "@dnd-kit/accessibility" src/ package.json` — confirms NO new dependency introduced.
7. `grep -q "SortableTreePanel" src/components/admin/pages/editor/BlockTreePanel.tsx && ! grep -qE "from\\s+'@dnd-kit/(core|sortable|utilities)'" src/components/admin/pages/editor/BlockTreePanel.tsx` — BlockTreePanel consumes the primitive and no longer directly imports dnd-kit.
</verification>

<success_criteria>
1. `src/components/ui/SortableTreePanel.tsx` exists as a generic `<T>` primitive exporting `SortableTreePanel` + `SortableTreePanelProps` with the API shape specified in `<interfaces>`. Wires PointerSensor 5px, KeyboardSensor `sortableKeyboardCoordinates`, `closestCenter`, `verticalListSortingStrategy`, v6 `accessibility.announcements` 4-handler shape, and `useReducedMotion()`-gated per-item transitions.
2. `src/components/admin/pages/editor/BlockTreePanel.tsx` consumes `SortableTreePanel<BlockNode>` and exhibits ZERO externally-visible behavior change: same `BlockTreePanelProps`, same `<Card variant="flat">` wrapper, same "Blocks" heading, same empty-state copy, same per-row visuals (selection highlight + 44px row height + 13px font + drag handle aria-label), same `data-testid="block-tree-item-{id}"` + `data-block-type={type}` attributes, same `labelForType()` mapping, same `reorderBlocks` call semantics.
3. Page-builder vitest neighbors (`PreviewPane.test.tsx` + `VersionHistoryPanel.test.tsx`) still pass — proves no cross-module regression in the editor folder.
4. `npm run typecheck` AND `npm run build` AND `bash scripts/assert-clinic-bundle-budget.sh` all green — proves the dnd-kit-stays-in-vendor-chunk invariant survives the extraction.
5. ZERO new npm dependencies (specifically no `@dnd-kit/accessibility`); ZERO changes to test files; ZERO changes to `BlockNode` schema, `page-api.ts`, vite config, or package.json.
</success_criteria>

<output>
After completion, create `.planning/phases/31-white-label-path-based-org-roles-clinic-onboarding-builder/31-00b-SUMMARY.md` using the standard summary template, documenting:
- The extracted `SortableTreePanel<T>` API surface (for Plan 31-05's consumer-side reference).
- Confirmation that Phase 15 page-builder vitest neighbors remained green.
- Confirmation that the `dnd-kit index-leak invariant OK` bundle guard remained green after build.
- Any deviations from the planned `onReorder` adapter pattern (Task 2 Implementation Note — record which of the two acceptable patterns was chosen and why, based on the actual `reorderBlocks` implementation in `page-api.ts`).
</output>
