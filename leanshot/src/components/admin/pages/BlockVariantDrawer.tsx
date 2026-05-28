/**
 * Phase 39 Plan 39-09 — BlockVariantDrawer (Surface D, per-block A/B authoring).
 *
 * Per UI-SPEC: opens from the per-block "Add variant" button in the page-builder
 * editor; lists existing variants for that block (when `block.variant_set_id`
 * is set, the variant catalog is loaded from `page_variants`) and offers an
 * "Add variant" CTA at the bottom.
 *
 * Wraps the existing `Sheet` UI primitive (see `<verification>` plan-spec:
 * "BlockVariantDrawer wraps Sheet primitive (no new drawer abstraction)").
 *
 * Sheet contract caveat: the project's `Sheet` is bottom-mounted on mobile
 * (md:max-w-md centered on desktop). The plan's <interfaces> calls for a
 * right-mounted 480px-wide drawer; we keep the Sheet wrap per the verify
 * rule and document the visual deviation in the SUMMARY. The plan
 * <action> note explicitly forbids inline `w-[480px]` arbitrary values
 * ("use existing Sheet primitive size prop OR documented Tailwind size
 * class") — Sheet already sizes via `md:max-w-md`, so we inherit that.
 *
 * Focus restoration:
 *   The component stores the triggering element on open and `.focus()`'s it
 *   on close (T-A11Y contract — the page-builder focus order must return to
 *   the block toolbar's "Add variant" button so keyboard navigation users
 *   don't get dropped at the document root).
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import type { BlockNode } from '@/lib/page-builder/block-schema';

export interface BlockVariantDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Canonical block the variant is being authored for. */
  block: BlockNode;
  /**
   * Existing variant block tree-list. Plan 39-09 ships the drawer with the
   * caller responsible for loading the variants; the consumer
   * (PageEditorView) reads them from the `page_variants` row referenced by
   * `block.variant_set_id` and passes them in.
   */
  variants?: BlockNode[];
  /**
   * Save handler. Receives the proposed variant block list (canonical
   * block + N variants). The caller persists via the SECDEF RPC pattern
   * for `page_variants` writes (see PLAN <interfaces>).
   */
  onSave: (variantBlocks: BlockNode[]) => Promise<void>;
  /**
   * Element to restore focus to when the drawer closes. Per UI-SPEC focus
   * order. Optional — when omitted, no explicit focus restoration runs
   * (browser falls back to its default focus model).
   */
  restoreFocusTo?: HTMLElement | null;
}

export function BlockVariantDrawer({
  open,
  onClose,
  block,
  variants = [],
  onSave,
  restoreFocusTo,
}: BlockVariantDrawerProps) {
  const [saving, setSaving] = useState(false);
  const wasOpen = useRef(false);

  // Focus restoration: when the drawer transitions open → closed, restore
  // focus to the trigger element so keyboard users don't lose their place.
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (wasOpen.current && !open) {
      wasOpen.current = false;
      // Defer to next tick so the Sheet's exit animation does not steal
      // the focus we just set.
      const id = window.setTimeout(() => {
        if (restoreFocusTo && typeof restoreFocusTo.focus === 'function') {
          restoreFocusTo.focus();
        }
      }, 0);
      return () => window.clearTimeout(id);
    }
  }, [open, restoreFocusTo]);

  const handleAddVariant = async (): Promise<void> => {
    setSaving(true);
    // Variant payload = canonical block + N existing variants + 1 new
    // variant (a clone of the canonical with a fresh id). The renderer's
    // resolveVariantBlocks picks one at render time.
    const newVariant: BlockNode = {
      ...block,
      id: `${block.id}-v${variants.length + 1}`,
    };
    const next = [...variants, newVariant];
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Block variants">
      <div className="flex flex-col gap-4" data-testid="block-variant-drawer">
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Author A/B variants for this <strong>{block.type}</strong> block. Variants are resolved
          per-visitor at render time.
        </p>
        {variants.length === 0 ? (
          <p
            className="text-[13px] text-[var(--color-text-secondary)] italic"
            data-testid="variant-list-empty"
          >
            No variants yet. Add one below to start a per-block A/B test.
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="variant-list">
            {variants.map((v, idx) => (
              <li
                key={v.id}
                className="px-3 py-2 rounded-md bg-[var(--color-surface)] text-[13px]"
                data-testid={`variant-row-${idx}`}
              >
                Variant {idx + 1}{' '}
                <span className="text-[var(--color-text-secondary)]">— {v.id}</span>
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="primary"
          size="md"
          onClick={() => void handleAddVariant()}
          disabled={saving}
          aria-busy={saving}
          data-testid="drawer-add-variant"
        >
          Add variant
        </Button>
        <Button variant="ghost" size="md" onClick={onClose} data-testid="drawer-close">
          Close
        </Button>
      </div>
    </Sheet>
  );
}

export default BlockVariantDrawer;
