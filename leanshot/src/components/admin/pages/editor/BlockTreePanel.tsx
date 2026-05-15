/**
 * Phase 15 Plan 15-04 — Left rail: sortable block tree.
 *
 * Uses the stable @dnd-kit API per 15-RESEARCH Pattern 2:
 *   - DndContext (collision detection = closestCenter)
 *   - PointerSensor (5px activation distance — match Phase 9 pattern)
 *   - KeyboardSensor (sortableKeyboardCoordinates) — Arrow Up/Down, Space/Enter
 *     to grab, Escape to cancel. THIS is the a11y reorder path required by
 *     UI-SPEC Accessibility Contract.
 *   - SortableContext + verticalListSortingStrategy
 *   - useSortable per row item; CSS.Transform from @dnd-kit/utilities
 *
 * Reduced-motion: when `useReducedMotion()` returns true, we skip the per-
 * item CSS transition so the drag overlay doesn't slide.
 *
 * Slice 1: flat list only (root-level blocks). Nesting lands in 15-05+.
 */
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { BlockNode } from '@/lib/page-builder/block-schema';
import { reorderBlocks } from '@/lib/page-builder/page-api';

export interface BlockTreePanelProps {
  blocks: BlockNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChange: (blocks: BlockNode[]) => void;
}

export function BlockTreePanel({
  blocks,
  selectedId,
  onSelect,
  onChange,
}: BlockTreePanelProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const rootBlocks = blocks.filter((b) => b.parent_id === null);

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const next = reorderBlocks(blocks, String(active.id), String(over.id));
    onChange(next);
  };

  return (
    <Card variant="flat" padding="md" className="h-full overflow-auto">
      <h2 className="text-[14px] font-semibold mb-3 tracking-tight">Blocks</h2>
      {rootBlocks.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Add your first block from the palette below, or pick a template to get started.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={rootBlocks.map((b) => b.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col gap-1">
              {rootBlocks.map((b) => (
                <BlockTreeItem
                  key={b.id}
                  block={b}
                  selected={selectedId === b.id}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </Card>
  );
}

interface BlockTreeItemProps {
  block: BlockNode;
  selected: boolean;
  onSelect: (id: string) => void;
}

function BlockTreeItem({ block, selected, onSelect }: BlockTreeItemProps) {
  const reduced = useReducedMotion();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: reduced ? undefined : transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={
        'flex items-center gap-2 rounded-md px-2 ' +
        (selected
          ? 'bg-[var(--color-primary-soft)] ring-1 ring-[var(--color-primary)]'
          : 'hover:bg-[var(--color-surface)]')
      }
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        className="cursor-grab touch-none flex items-center justify-center h-[44px] w-[40px] text-[var(--color-text-secondary)]"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onSelect(block.id)}
        className="flex-1 text-left h-[44px] text-[13px] font-medium"
        data-testid={`block-tree-item-${block.id}`}
        data-block-type={block.type}
      >
        {labelForType(block.type)}
      </button>
    </li>
  );
}

function labelForType(type: BlockNode['type']): string {
  switch (type) {
    case 'hero':
      return 'Hero';
    case 'cta':
      return 'Call to action';
    case 'footer':
      return 'Footer';
    case 'faq':
      return 'FAQ';
    case 'pricing':
      return 'Pricing';
    case 'testimonial':
      return 'Testimonial';
    case 'feature-grid':
      return 'Feature grid';
    case 'image-text':
      return 'Image + text';
    case 'calendly':
      return 'Calendly';
    case 'youtube':
      return 'YouTube';
    case 'tally':
      return 'Tally';
    case 'lead-form':
      return 'Lead form';
    default:
      return type;
  }
}
