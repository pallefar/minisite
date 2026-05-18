/**
 * Phase 15 Plan 15-04 — Left rail: sortable block tree.
 *
 * Refactored in Phase 31 Plan 31-00b to delegate all dnd-kit wiring to the
 * generic `SortableTreePanel<T>` primitive at `src/components/ui/SortableTreePanel.tsx`.
 * Zero externally-visible behavior change — same props shape, same DOM output,
 * same per-row visuals, same data-testid attributes.
 *
 * `reorderBlocks` semantics are preserved via the `onReorder` callback, which
 * reconstructs the full blocks array from the reordered root slice + unchanged
 * non-root blocks and re-applies the contiguous `order` numbering. This is
 * identical to calling `reorderBlocks(blocks, active.id, over.id)` when the
 * tree is flat (all root-level — Slice 1; nested blocks land in 15-05+).
 */
import { Card } from '@/components/ui/Card';
import { SortableTreePanel } from '@/components/ui/SortableTreePanel';
import type { BlockNode } from '@/lib/page-builder/block-schema';

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
  const rootBlocks = blocks.filter((b) => b.parent_id === null);

  const handleReorder = (nextRoot: BlockNode[]): void => {
    // Reconstruct the full blocks array: reordered root blocks + unchanged
    // non-root blocks, then renumber `order` to keep it contiguous 0..n.
    // Equivalent to reorderBlocks(blocks, active.id, over.id) for flat trees.
    const nonRoot = blocks.filter((b) => b.parent_id !== null);
    onChange(
      [...nextRoot, ...nonRoot].map((b, i) => (b.order === i ? b : { ...b, order: i })),
    );
  };

  return (
    <Card variant="flat" padding="md" className="h-full overflow-auto">
      <h2 className="text-[14px] font-semibold mb-3 tracking-tight">Blocks</h2>
      {rootBlocks.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Add your first block from the palette below, or pick a template to get started.
        </p>
      ) : (
        <SortableTreePanel<BlockNode>
          items={rootBlocks}
          getId={(b) => b.id}
          onReorder={handleReorder}
          announceItemLabel={(b) => labelForType(b.type)}
          renderItem={(b, _index, _isDragging) => (
            <BlockTreeItemBody
              block={b}
              selected={selectedId === b.id}
              onSelect={onSelect}
            />
          )}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Row body — rendered by SortableTreePanel's renderItem callback.
// The drag handle is rendered by SortableTreePanel itself.
// ---------------------------------------------------------------------------

interface BlockTreeItemBodyProps {
  block: BlockNode;
  selected: boolean;
  onSelect: (id: string) => void;
}

function BlockTreeItemBody({ block, selected, onSelect }: BlockTreeItemBodyProps) {
  return (
    <div
      className={
        'flex-1 flex items-center rounded-md px-1 ' +
        (selected
          ? 'bg-[var(--color-primary-soft)] ring-1 ring-[var(--color-primary)]'
          : 'hover:bg-[var(--color-surface)]')
      }
    >
      <button
        type="button"
        onClick={() => onSelect(block.id)}
        className="flex-1 text-start h-[44px] text-[13px] font-medium"
        data-testid={`block-tree-item-${block.id}`}
        data-block-type={block.type}
      >
        {labelForType(block.type)}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
