/**
 * Generic drag-and-drop sortable tree panel primitive.
 *
 * Extracted from Phase 15's `BlockTreePanel.tsx` in Plan 31-00b so that
 * the onboarding builder (Plan 31-05) can reuse the same dnd-kit wiring
 * with a different item schema (`OnboardingStepNode` vs `BlockNode`).
 *
 * a11y contract (preserved from Phase 15):
 *   - PointerSensor with 5 px activation distance
 *   - KeyboardSensor with `sortableKeyboardCoordinates` (Arrow Up/Down,
 *     Space/Enter to grab, Escape to cancel)
 *   - `closestCenter` collision detection
 *   - `verticalListSortingStrategy`
 *   - `useReducedMotion()` gating on per-item CSS transition
 *   - v6 built-in `accessibility.announcements` with all four handlers
 *
 * No `@dnd-kit/accessibility` package — the v6 DndContext `accessibility`
 * prop is the chosen shape (D-09/D-11 in 31-CONTEXT.md).
 */
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SortableTreePanelProps<T> {
  items: T[];
  getId: (item: T) => string;
  onReorder: (next: T[]) => void;
  /**
   * Render the row body (label + secondary controls). The drag handle is
   * rendered by `SortableTreePanel` itself; do NOT include it in `renderItem`.
   */
  renderItem: (item: T, index: number, isDragging: boolean) => ReactNode;
  /** Returns the human-readable label used in screen-reader announcements. */
  announceItemLabel: (item: T) => string;
  /** When true for an item, its drag handle is hidden and `useSortable` is disabled. */
  isDragDisabled?: (item: T) => boolean;
  /**
   * Optional per-handler overrides for the four SR announcement callbacks.
   * Provided handlers WIN over the built-in defaults (merged via spread).
   * Passing `{ onDragStart: undefined }` has no effect — undefined handlers
   * are filtered out before merging so defaults are preserved.
   */
  announcements?: Partial<Announcements>;
}

export function SortableTreePanel<T>({
  items,
  getId,
  onReorder,
  renderItem,
  announceItemLabel,
  isDragDisabled,
  announcements,
}: SortableTreePanelProps<T>) {
  const reducedMotion = useReducedMotion();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((item) => getId(item) === String(active.id));
    const newIdx = items.findIndex((item) => getId(item) === String(over.id));
    if (oldIdx !== -1 && newIdx !== -1) {
      onReorder(arrayMove(items, oldIdx, newIdx));
    }
  };

  const defaultAnnouncements: Announcements = {
    onDragStart({ active }) {
      const item = items.find((t) => getId(t) === String(active.id));
      if (!item) return '';
      const pos = items.indexOf(item) + 1;
      return `Picked up ${announceItemLabel(item)}. It is in position ${pos} of ${items.length}.`;
    },
    onDragOver({ active, over }) {
      if (!over) return '';
      const item = items.find((t) => getId(t) === String(active.id));
      const overItem = items.find((t) => getId(t) === String(over.id));
      if (!item || !overItem) return '';
      const pos = items.indexOf(overItem) + 1;
      return `${announceItemLabel(item)} moved to position ${pos} of ${items.length}.`;
    },
    onDragEnd({ active, over }) {
      const item = items.find((t) => getId(t) === String(active.id));
      if (!item) return '';
      const overItem = over ? items.find((t) => getId(t) === String(over.id)) : null;
      const pos = overItem ? items.indexOf(overItem) + 1 : items.length;
      return `${announceItemLabel(item)} dropped at position ${pos}.`;
    },
    onDragCancel({ active }) {
      const item = items.find((t) => getId(t) === String(active.id));
      if (!item) return '';
      const pos = items.indexOf(item) + 1;
      return `Reordering cancelled. ${announceItemLabel(item)} returned to position ${pos}.`;
    },
  };

  // Merge consumer overrides over defaults, filtering out undefined handlers
  // so a consumer passing `{ onDragStart: undefined }` keeps the default.
  const mergedAnnouncements: Announcements = {
    ...defaultAnnouncements,
    ...(announcements
      ? (Object.fromEntries(
          Object.entries(announcements).filter(([, v]) => v !== undefined),
        ) as Partial<Announcements>)
      : {}),
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={{ announcements: mergedAnnouncements }}
    >
      <SortableContext items={items.map(getId)} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-1">
          {items.map((item, index) => (
            <SortableItem
              key={getId(item)}
              id={getId(item)}
              disabled={isDragDisabled?.(item) ?? false}
              reducedMotion={reducedMotion}
              ariaLabel={`Drag to reorder ${announceItemLabel(item)}`}
              render={(isDragging) => renderItem(item, index, isDragging)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

// ---------------------------------------------------------------------------
// Internal SortableItem
// ---------------------------------------------------------------------------

interface SortableItemProps {
  id: string;
  disabled: boolean;
  reducedMotion: boolean;
  ariaLabel: string;
  render: (isDragging: boolean) => ReactNode;
}

function SortableItem({ id, disabled, reducedMotion, ariaLabel, render }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: reducedMotion ? undefined : transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-2">
      {/* Drag handle — hidden (visually + for AT) when drag is disabled */}
      {disabled ? (
        <span
          aria-hidden
          className="cursor-grab touch-none flex items-center justify-center h-[44px] w-[40px] opacity-0 pointer-events-none"
        >
          <GripVertical size={16} aria-hidden />
        </span>
      ) : (
        <button
          type="button"
          aria-label={ariaLabel}
          className="cursor-grab touch-none flex items-center justify-center h-[44px] w-[40px] text-[var(--color-text-secondary)]"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} aria-hidden />
        </button>
      )}
      {render(isDragging)}
    </li>
  );
}
